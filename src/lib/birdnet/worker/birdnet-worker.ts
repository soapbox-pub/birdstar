/// <reference lib="webworker" />
// Dedicated Web Worker that owns the entire BirdNET model lifecycle.
//
// Running inference off the main thread is the only way to eliminate the
// ~150 ms/predict stall we were paying on the UI thread. Even with
// `tf.nextFrame()` yields and async `.data()` readbacks, the model's forward
// pass is a large GPU workload whose scheduling + post-processing blocks
// the renderer long enough to drop several frames every 2 seconds.
//
// Implementation notes:
//
//   • We import tfjs and MelSpecLayerSimple directly. Vite's worker pipeline
//     bundles these the same way it does for the main graph, which is why
//     this approach works today even though an earlier attempt under a
//     different bundler had to be abandoned (see useBirdNet.ts history).
//
//   • The worker has its *own* tfjs instance, its own WebGL context, and its
//     own IndexedDB namespace-per-origin-per-worker. In practice this means
//     the model is cached independently of the main thread's cache. That's
//     fine — IndexedDB on the same origin is shared by default, and tfjs's
//     IOHandler uses the same `indexeddb://` URL scheme, so a worker read
//     hits the same entry the main thread would write (and vice versa). If
//     a browser ever changed that we would just pay one extra download.
//
//   • We never free the model between predicts: the worker lives for the
//     lifetime of the page and a single terminate() call from the main
//     thread disposes everything via `onclose` / GC when the worker exits.
//
//   • All errors are caught and reported back as structured messages rather
//     than relying on the browser's error event, so the caller can surface
//     them to the UI and decide whether to retry or fall back.
import * as tf from '@tensorflow/tfjs';
import {
  loadBirdNetEngine,
  predictBirds,
  warmUpBirdNet,
  type BirdNetEngine,
} from '@/lib/birdnet/model';
import type { MainToWorker, WorkerToMain } from './protocol';

let engine: BirdNetEngine | null = null;
let loading: Promise<BirdNetEngine> | null = null;

function post(message: WorkerToMain, transfer: Transferable[] = []): void {
  // DedicatedWorkerGlobalScope#postMessage is declared with an overload that
  // accepts a transfer list; the TS lib.webworker types cover it.
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);
}

async function ensureBackend(): Promise<string> {
  // Prefer WebGL inside the worker. OffscreenCanvas + WebGL in workers is
  // supported in Chromium, Firefox, and Safari 16.4+. If the browser refuses
  // (older Safari, WebGL disabled), fall back to the CPU backend, which is
  // slow but functional.
  try {
    await tf.setBackend('webgl');
  } catch {
    await tf.setBackend('cpu');
  }
  await tf.ready();
  return tf.getBackend();
}

async function handleLoad(id: number): Promise<void> {
  // Idempotent: if a load is already in-flight or finished, reuse it.
  if (engine) {
    post({ type: 'ready', id, backend: tf.getBackend() });
    return;
  }
  if (!loading) {
    loading = (async () => {
      const backend = await ensureBackend();
      const loaded = await loadBirdNetEngine((fraction) => {
        post({ type: 'progress', id: null, fraction });
      });
      await warmUpBirdNet(loaded);
      // Signal completion with the backend that actually took. Stored so we
      // can respond to later `load` requests without re-running anything.
      void backend;
      return loaded;
    })();
  }
  try {
    engine = await loading;
    post({ type: 'ready', id, backend: tf.getBackend() });
  } catch (err) {
    loading = null;
    post({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
      fatal: true,
    });
  }
}

async function handlePredict(
  id: number,
  samples: Float32Array,
  topK: number,
): Promise<void> {
  if (!engine) {
    post({
      type: 'error',
      id,
      message: 'predict called before model was ready',
      fatal: false,
    });
    return;
  }
  try {
    const predictions = await predictBirds(engine, samples, topK);
    post({ type: 'predict-result', id, predictions });
  } catch (err) {
    post({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
      fatal: false,
    });
  }
}

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'load':
      void handleLoad(msg.id);
      break;
    case 'predict':
      void handlePredict(msg.id, msg.samples, msg.topK);
      break;
  }
};
