// Message protocol for the BirdNET inference worker.
//
// Every request sent to the worker carries a numeric `id`; the worker's
// response echoes that id so the caller can correlate async completions.
// Progress / error notifications that are not tied to a specific request
// use `id: null`.
import type { BirdPrediction } from '@/lib/birdnet/model';

export type MainToWorker =
  | { type: 'load'; id: number }
  | { type: 'predict'; id: number; samples: Float32Array; topK: number };

export type WorkerToMain =
  | { type: 'ready'; id: number; backend: string }
  | { type: 'progress'; id: null; fraction: number }
  | { type: 'predict-result'; id: number; predictions: BirdPrediction[] }
  | { type: 'error'; id: number | null; message: string; fatal: boolean };
