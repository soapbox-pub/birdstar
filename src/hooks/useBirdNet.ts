// Owns the BirdNET model lifecycle by delegating it to a dedicated Web
// Worker. The worker loads the model, compiles its WebGL shaders, and
// runs every inference so the main thread never blocks on tfjs work.
//
// History: a previous attempt to move inference off-thread was abandoned
// because the bundler in use at the time couldn't resolve
// `new Worker(new URL(..., import.meta.url))`. The project has since been
// migrated to Vite, which supports that pattern natively, so we've
// reintroduced the worker path. Chrome performance traces showed the
// main-thread inference path causing a ~156 ms stall every 2 seconds —
// roughly nine dropped frames per detection cycle. Moving the work off
// the main thread reduces that cost to a ~1–3 ms postMessage round-trip.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BirdPrediction } from '@/lib/birdnet/model';
import { BIRDNET_CHUNK_SAMPLES } from '@/lib/birdnet/model';
import type { MainToWorker, WorkerToMain } from '@/lib/birdnet/worker/protocol';

type Status =
  | { state: 'idle' }
  | { state: 'loading'; fraction: number }
  | { state: 'ready'; backend: string }
  | { state: 'error'; error: string };

interface PendingRequest {
  resolve: (predictions: BirdPrediction[]) => void;
  reject: (err: Error) => void;
}

export function useBirdNet() {
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  // Worker instance and the machinery used to correlate its async responses
  // with the callers that sent them. These refs outlive individual renders
  // so callers can hold on to stable `load` / `predict` callbacks.
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
    // Snapshot refs into locals so the cleanup closure doesn't re-read
    // them at teardown time (React lint rule react-hooks/exhaustive-deps
    // catches this even for non-DOM refs, and reading the live ref would
    // be wrong if it were ever reassigned after mount).
    const pending = pendingRef.current;
    return () => {
      mountedRef.current = false;
      // Tearing down the worker drops its WebGL context and frees the
      // model's GPU memory; no explicit dispose call is needed.
      workerRef.current?.terminate();
      workerRef.current = null;
      // Fail any in-flight requests so their awaiters don't hang forever.
      pending.forEach(({ reject }) => reject(new Error('BirdNET worker torn down')));
      pending.clear();
      loadResolversRef.current?.reject(new Error('BirdNET worker torn down'));
      loadResolversRef.current = null;
    };
  }, []);

  // Route a message from the worker to either a specific pending request
  // (by id) or the page-level status state.
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
          // Also fail any other in-flight predicts — the model is gone.
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
    // Re-entrancy guard: if we're already loading or loaded, do nothing.
    // The status state and the live loadResolversRef are the source of
    // truth; the worker itself also handles duplicate load messages
    // idempotently.
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

  return { status, load, predict };
}
