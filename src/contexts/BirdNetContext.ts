import { createContext } from 'react';
import type { BirdPrediction } from '@/lib/birdnet/model';

/**
 * Status of the BirdNET model loading / inference pipeline.
 *
 * `idle`       — the worker hasn't been spawned yet; `load()` hasn't been called.
 * `loading`    — model is being fetched / deserialized / warmed up. `fraction`
 *                is a 0..1 progress estimate for the UI.
 * `ready`      — model is loaded, shaders are warmed, `predict()` will work.
 *                `backend` is the tfjs backend name (e.g. `webgl`).
 * `error`      — a fatal error occurred. `error` is a human-readable message.
 */
export type BirdNetStatus =
  | { state: 'idle' }
  | { state: 'loading'; fraction: number }
  | { state: 'ready'; backend: string }
  | { state: 'error'; error: string };

/**
 * The shape of the BirdNET context, exposed to consumers via `useBirdNet()`.
 *
 * The worker (and therefore the loaded model) lives for the lifetime of the
 * provider, NOT for the lifetime of any one consumer component. This lets the
 * user flip between Birds and Stars mode without having to reload the model
 * every time Birds mode remounts.
 */
export interface BirdNetContextType {
  /** Current model status. Consumers watch this to drive UI. */
  status: BirdNetStatus;
  /**
   * Trigger model load. Idempotent: calling it when the model is already
   * loading or ready is a no-op. Safe to call from an effect on every mount.
   */
  load: () => void;
  /**
   * Run inference on a single `BIRDNET_CHUNK_SAMPLES`-length audio chunk and
   * return the top-`topK` predictions. Returns `[]` (and logs a warning) if
   * the worker isn't ready or the call fails — a single failed inference
   * shouldn't tear the detection loop down.
   */
  predict: (samples: Float32Array, topK?: number) => Promise<BirdPrediction[]>;
}

export const BirdNetContext = createContext<BirdNetContextType | undefined>(
  undefined,
);
