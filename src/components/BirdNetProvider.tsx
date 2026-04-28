// Owns the BirdNET model lifecycle for the entire app. The worker (and the
// tfjs model it holds) is spawned lazily on the first `load()` call and then
// lives for the full lifetime of this provider — which is the lifetime of
// the page.
//
// Previously this logic lived inside the `useBirdNet` hook in BirdsIndex,
// which meant flipping from Birds → Stars → Birds unmounted the hook, called
// `worker.terminate()`, and forced the next Birds mount to re-spawn a worker,
// re-deserialize weights from IndexedDB, and re-run shader warm-up. The
// user-visible effect was a ~second-long "loading model…" state every time
// they toggled modes. By hoisting the worker up here, a returning Birds user
// finds `status.state === 'ready'` instantly.
//
// The worker is NOT spawned on provider mount; it's spawned on the first
// `load()` call. So users who only ever use Stars mode never pay the cost
// of loading a bird model.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  BirdNetContext,
  type BirdNetContextType,
  type BirdNetStatus,
} from '@/contexts/BirdNetContext';
import type { BirdPrediction } from '@/lib/birdnet/model';
import { BIRDNET_CHUNK_SAMPLES } from '@/lib/birdnet/model';
import type { MainToWorker, WorkerToMain } from '@/lib/birdnet/worker/protocol';

interface PendingRequest {
  resolve: (predictions: BirdPrediction[]) => void;
  reject: (err: Error) => void;
}

interface BirdNetProviderProps {
  children: ReactNode;
}

export function BirdNetProvider({ children }: BirdNetProviderProps) {
  const [status, setStatus] = useState<BirdNetStatus>({ state: 'idle' });

  // Worker instance and the machinery used to correlate its async responses
  // with the callers that sent them. These refs outlive individual renders
  // and, because the provider sits at the app root, they effectively outlive
  // every consumer mount/unmount cycle too.
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, PendingRequest>());
  const loadResolversRef = useRef<{
    resolve: () => void;
    reject: (err: Error) => void;
  } | null>(null);
  const nextIdRef = useRef(1);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Snapshot the refs into locals so the cleanup closure captures them
    // deterministically (see the react-hooks/exhaustive-deps guidance).
    const pending = pendingRef.current;
    return () => {
      mountedRef.current = false;
      // The provider only unmounts on a full page teardown — e.g. the tab
      // closing or hot-reload swapping the root. Terminating the worker
      // here releases its WebGL context so we don't leak GPU memory if
      // the bundler happens to hot-replace the provider during development.
      workerRef.current?.terminate();
      workerRef.current = null;
      pending.forEach(({ reject }) => reject(new Error('BirdNET worker torn down')));
      pending.clear();
      loadResolversRef.current?.reject(new Error('BirdNET worker torn down'));
      loadResolversRef.current = null;
    };
  }, []);

  // Route a message from the worker to either a specific pending request
  // (by id) or the app-level status state.
  const handleMessage = useCallback((event: MessageEvent<WorkerToMain>) => {
    if (!mountedRef.current) return;
    const msg = event.data;
    switch (msg.type) {
      case 'progress':
        setStatus({ state: 'loading', fraction: msg.fraction });
        break;
      case 'ready':
        setStatus({ state: 'ready', backend: msg.backend });
        loadResolversRef.current?.resolve();
        loadResolversRef.current = null;
        break;
      case 'predict-result': {
        const pending = pendingRef.current.get(msg.id);
        if (pending) {
          pendingRef.current.delete(msg.id);
          pending.resolve(msg.predictions);
        }
        break;
      }
      case 'error': {
        // A fatal error (model load failed, backend setup failed) collapses
        // the whole session; a non-fatal error is scoped to one predict
        // call and we simply reject that caller.
        if (msg.fatal) {
          setStatus({ state: 'error', error: msg.message });
          loadResolversRef.current?.reject(new Error(msg.message));
          loadResolversRef.current = null;
          pendingRef.current.forEach(({ reject }) =>
            reject(new Error(msg.message)),
          );
          pendingRef.current.clear();
        } else if (msg.id != null) {
          const pending = pendingRef.current.get(msg.id);
          if (pending) {
            pendingRef.current.delete(msg.id);
            pending.reject(new Error(msg.message));
          }
        }
        break;
      }
    }
  }, []);

  const ensureWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;
    // Vite compiles this worker as a separate chunk; the `type: 'module'`
    // hint lets it use ES imports, so we can share `MelSpecLayerSimple`
    // and `model.ts` with the main graph without duplicating any code.
    const worker = new Worker(
      new URL('@/lib/birdnet/worker/birdnet-worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = handleMessage;
    worker.onerror = (event) => {
      // `onerror` fires for script-load failures and uncaught exceptions
      // that escape our internal try/catch. Treat them as fatal.
      if (!mountedRef.current) return;
      const message = event.message || 'Worker crashed';
      setStatus({ state: 'error', error: message });
      loadResolversRef.current?.reject(new Error(message));
      loadResolversRef.current = null;
      pendingRef.current.forEach(({ reject }) => reject(new Error(message)));
      pendingRef.current.clear();
    };
    workerRef.current = worker;
    return worker;
  }, [handleMessage]);

  const load = useCallback(() => {
    // Re-entrancy guard. With the provider hoisted to app scope, `load()`
    // will be called again every time BirdsIndex remounts — but if the
    // model is already loading or ready, this becomes a genuine no-op and
    // the returning user sees `status === 'ready'` immediately.
    if (loadResolversRef.current) return;
    setStatus((current) =>
      current.state === 'ready' ? current : { state: 'loading', fraction: 0 },
    );

    let worker: Worker;
    try {
      worker = ensureWorker();
    } catch (err) {
      setStatus({
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const id = nextIdRef.current++;
    // We don't actually await this promise anywhere — the status state is
    // what consumers watch — but keeping resolvers around lets us surface
    // teardown as a rejection and centralise error routing in one place.
    new Promise<void>((resolve, reject) => {
      loadResolversRef.current = { resolve, reject };
    }).catch(() => {
      // Swallow: the error has already been mirrored into `status`.
    });
    const msg: MainToWorker = { type: 'load', id };
    worker.postMessage(msg);
  }, [ensureWorker]);

  const predict = useCallback(
    async (samples: Float32Array, topK = 5): Promise<BirdPrediction[]> => {
      const worker = workerRef.current;
      if (!worker) return [];
      if (samples.length !== BIRDNET_CHUNK_SAMPLES) {
        console.warn(
          `BirdNET predict: expected ${BIRDNET_CHUNK_SAMPLES} samples, got ${samples.length}`,
        );
        return [];
      }

      const id = nextIdRef.current++;
      return new Promise<BirdPrediction[]>((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        // Copy the samples into a fresh buffer before transferring. The
        // caller reuses its capture ring-buffer across predicts, so
        // transferring the original would detach a buffer they still own.
        // The copy is ~576 KB and takes <0.1 ms; cheaper than the worker
        // blocking on a structured clone of the same data.
        const copy = new Float32Array(samples);
        const msg: MainToWorker = {
          type: 'predict',
          id,
          samples: copy,
          topK,
        };
        try {
          worker.postMessage(msg, [copy.buffer]);
        } catch (err) {
          pendingRef.current.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }).catch((err) => {
        // A single failed prediction shouldn't take the app down; log and
        // return an empty result so the detection loop keeps cycling.
        console.warn('BirdNET predict failed', err);
        return [] as BirdPrediction[];
      });
    },
    [],
  );

  const value = useMemo<BirdNetContextType>(
    () => ({ status, load, predict }),
    [status, load, predict],
  );

  return (
    <BirdNetContext.Provider value={value}>{children}</BirdNetContext.Provider>
  );
}
