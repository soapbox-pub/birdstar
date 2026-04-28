// BirdNET V2.4 model wrapper for tfjs.
// Loads the model (two mel-spectrogram layers + CNN), runs inference on
// 3-second audio chunks at 48 kHz, and returns top-K species predictions.
//
// The model weights were converted to TFJS format by the Chirpity project
// (MIT-licensed source, CC-BY-NC-SA-4.0 model weights — non-commercial use only).
// We load them from jsDelivr, which serves the GitHub repo contents with
// proper CORS headers and edge caching, and avoids us having to re-host ~50MB
// of weight shards ourselves.
//
// ## Hybrid CPU-mel-spec / GPU-CNN pipeline
//
// The model has **two** parallel `MelSpecLayerSimple` front-ends whose
// outputs are concatenated on the channel axis into a `[1, 96, 511, 2]`
// tensor that feeds the CNN:
//
//   * MEL_SPEC1 — frame_length=2048, frame_step=278, fmin=0, fmax=3000
//     (long window / low-frequency detail)
//   * MEL_SPEC2 — frame_length=1024, frame_step=280, fmin=500, fmax=15000
//     (short window / high-frequency detail)
//
// On tfjs's WebGL backend the FFTs inside these layers decompose into
// an 11-call complex-factorisation ladder plus ~1500 Slice kernels per
// layer — ~2.5 s of GPU kernel time per 2 s prediction cycle. Because
// the GPU process is shared across every browser tab, this saturates
// the compositor and drops frames everywhere (a visible stutter in
// e.g. an adjacent YouTube tab). The rest of the CNN only needs ~70 ms
// of GPU time.
//
// Our fix: compute both mel-spectrograms on CPU inside the worker (see
// `melSpec.ts`), and keep the CNN on WebGL. Implementation detail:
// rather than rebuilding the CNN as a sub-model (awkward because
// `tf.model({inputs, outputs})` requires `inputs` to originate from an
// `InputLayer`, and the post-mel-spec portion of this graph has skip
// connections that would need manual re-wiring), we monkey-patch each
// `MelSpecLayerSimple.call()` on the loaded layer instances. Before
// each predict we compute both mel-specs on CPU, set them on their
// respective layers, and pass a pre-cached zero audio tensor into
// `model.predict()`. The patched `call()` returns a clone of the
// precomputed mel tensor for its layer; the rest of the graph runs
// unchanged on WebGL. See `predictBirds` below for the hot-path.
//
// NB: patching only ONE of the two layers is a silent correctness bug —
// the unpatched layer still runs its STFT on the zero audio placeholder,
// producing a "silence mel" that the CNN was never trained to concat
// with real mel data. Symptom: all scores collapse to ~0.01 flat
// noise even on loud, clean bird calls. Found the hard way; avoid
// rediscovering.
import * as tf from '@tensorflow/tfjs';
import './melSpecLayer';
import { MelSpecLayerSimple } from './melSpecLayer';
import { createMelSpec, type MelSpec } from './melSpec';

// 3 seconds * 48 kHz = 144,000 samples — the only input size the model accepts.
export const BIRDNET_SAMPLE_RATE = 48_000;
export const BIRDNET_CHUNK_SECONDS = 3;
export const BIRDNET_CHUNK_SAMPLES = BIRDNET_SAMPLE_RATE * BIRDNET_CHUNK_SECONDS;

const MODEL_BASE_URL =
  'https://cdn.jsdelivr.net/gh/Mattk70/Chirpity-Electron@master/BirdNET_GLOBAL_6K_V2.4_Model_TFJS/static/model';

// IndexedDB key used by tfjs's built-in IOHandler to cache the model weights
// between sessions. Bump the version suffix when switching to an incompatible
// model to invalidate old caches.
const MODEL_CACHE_KEY = 'birdnet-global-6k-v2.4';
const MODEL_CACHE_URL = `indexeddb://${MODEL_CACHE_KEY}`;

export interface BirdPrediction {
  /** Index into the labels array. */
  index: number;
  /** Raw model score (already sigmoid-activated by the network). */
  score: number;
}

/**
 * A loaded BirdNET model with its mel-spec compute detached onto the CPU.
 *
 * BirdNET V2.4 has **two** parallel `MelSpecLayerSimple` layers — a
 * low-frequency / long-window one (`MEL_SPEC1`:
 * frame_length=2048, frame_step=278, fmin=0, fmax=3000) and a
 * high-frequency / short-window one (`MEL_SPEC2`:
 * frame_length=1024, frame_step=280, fmin=500, fmax=15000). Their
 * outputs are concatenated on the channel axis (→ `[1, 96, 511, 2]`)
 * before the CNN, so the model *requires* both to be fed on every
 * predict or the distribution seen by the downstream BatchNorm is
 * half-missing and the scores collapse to noise.
 *
 * `melSpecs` holds a CPU implementation + patched-layer pair for each
 * of these. `predictBirds` computes both, installs them on their
 * respective layers, then runs `model.predict()` on the zero audio
 * placeholder. Each patched `call()` returns a clone of the CPU mel
 * tensor so the surrounding `tf.tidy` can dispose the clone without
 * affecting our externally-owned tensor.
 *
 * `audioInputPlaceholder` is a cached zero tensor with the shape the
 * model's InputLayer requires (`[1, 144000]`); it's used as a no-op
 * input to `model.predict()` since both patched mel-spec layers ignore
 * their inputs. Reusing one tensor avoids a 576 KB GPU upload per
 * predict.
 */
export interface BirdNetEngine {
  readonly model: tf.LayersModel;
  readonly melSpecs: readonly MelSpecSlot[];
  readonly audioInputPlaceholder: tf.Tensor;
}

/**
 * One CPU mel-spec front-end paired with the tfjs layer whose `call()`
 * we replaced with a stub that returns its output. We keep both the
 * layer handle (for installing `_precomputedMel` before each predict)
 * and the `MelSpec` (for running on the raw audio samples).
 */
export interface MelSpecSlot {
  readonly layer: MelSpecLayerSimple;
  readonly melSpec: MelSpec;
  /** Layer name from the Keras config — useful for debug logging. */
  readonly name: string;
}

let enginePromise: Promise<BirdNetEngine> | null = null;

/** Check if the model is already cached in IndexedDB. */
async function isModelCached(): Promise<boolean> {
  try {
    const models = await tf.io.listModels();
    return MODEL_CACHE_URL in models;
  } catch {
    return false;
  }
}

/**
 * Load the raw tfjs LayersModel. Prefer `loadBirdNetEngine` in production
 * code — the engine wrapper is what makes the hybrid CPU-mel-spec pipeline
 * work. This function is exported separately so warm-up code and tests can
 * still exercise the unmodified model.
 */
export async function loadBirdNetModel(
  onProgress?: (fraction: number) => void,
): Promise<tf.LayersModel> {
  // Fast path: model weights are already in IndexedDB from a previous visit.
  if (await isModelCached()) {
    try {
      const cached = await tf.loadLayersModel(MODEL_CACHE_URL);
      // Report instant completion so the UI can advance past the loading state.
      onProgress?.(1);
      return cached;
    } catch (err) {
      // Cached copy is corrupt or incompatible — wipe it and fall through
      // to a fresh network fetch.
      console.warn('Failed to load cached BirdNET model, re-downloading', err);
      try {
        await tf.io.removeModel(MODEL_CACHE_URL);
      } catch {
        // ignore
      }
    }
  }

  const model = await tf.loadLayersModel(`${MODEL_BASE_URL}/model.json`, {
    onProgress: (fraction) => onProgress?.(fraction),
  });

  // Persist for next time. This is a background-ish operation, but we await
  // it so errors surface; it's fast once the weights are already in memory.
  try {
    await model.save(MODEL_CACHE_URL);
  } catch (err) {
    // Not fatal — quota errors etc. just mean we'll re-download next visit.
    console.warn('Failed to cache BirdNET model in IndexedDB', err);
  }

  return model;
}

/**
 * Augment a loaded `tf.LayersModel` with a CPU mel-spectrogram front-end.
 *
 * Finds every `MelSpecLayerSimple` instance in the graph (BirdNET V2.4
 * has two — see `BirdNetEngine`), reads each one's config + trained
 * `magnitude_scaling` weight, builds a matching CPU mel-spec, and
 * replaces the layer's `call()` with a stub that returns a precomputed
 * mel tensor set per-predict via `_precomputedMel`.
 */
function buildBirdNetEngine(model: tf.LayersModel): BirdNetEngine {
  // Locate every mel-spec layer by class name. Chirpity's Keras export
  // names them `MEL_SPEC1` and `MEL_SPEC2`; iterating by class means
  // we don't hard-code those names.
  const layers = model.layers.filter(
    (l) => l.getClassName() === 'MelSpecLayerSimple',
  ) as MelSpecLayerSimple[];
  if (layers.length === 0) {
    throw new Error('BirdNET model is missing any MelSpecLayerSimple layer');
  }

  const melSpecs: MelSpecSlot[] = layers.map((layer) => {
    // Extract the layer's config. The mel filterbank is baked into the
    // config (not stored as a trainable weight); `magnitude_scaling` is
    // the layer's only trainable weight and we bake it into the CPU
    // impl so compression matches exactly what the CNN was trained
    // against.
    const cfg = layer.getConfig() as {
      sampleRate: number;
      specShape: [number, number];
      frameStep: number;
      frameLength: number;
      melFilterbank: number[][];
      name?: string;
    };
    const magScale = layer.getWeights()[0].dataSync()[0];

    const melSpec = createMelSpec({
      chunkSamples: BIRDNET_CHUNK_SAMPLES,
      frameLength: cfg.frameLength,
      frameStep: cfg.frameStep,
      specShape: cfg.specShape,
      melFilterbank: cfg.melFilterbank,
      magScale,
    });

    // Monkey-patch this layer's `call()`. `_precomputedMel` is the
    // tensor set just before each predict; the patched call returns
    // a clone so the downstream tidy scope can dispose the clone
    // without affecting the original (we own the original's
    // lifecycle in `predictBirds`).
    //
    // When the A/B bypass flag is set, the patched call falls through
    // to the original GPU implementation — preserved in `_originalCall`
    // — so we can sanity-check the rest of the pipeline without
    // reloading the model.
    interface PatchedLayer extends MelSpecLayerSimple {
      _precomputedMel: tf.Tensor | null;
      _originalCall: (inputs: tf.Tensor | tf.Tensor[]) => tf.Tensor;
    }
    const patched = layer as PatchedLayer;
    patched._precomputedMel = null;
    patched._originalCall = layer.call.bind(layer) as PatchedLayer['_originalCall'];
    patched.call = function patchedCall(
      inputs: tf.Tensor | tf.Tensor[],
    ): tf.Tensor {
      if (shouldBypassCpuMel()) {
        return patched._originalCall(inputs);
      }
      const mel = patched._precomputedMel;
      if (!mel) {
        throw new Error(
          `BirdNET mel-spec layer ${cfg.name ?? '(unnamed)'} called without a ` +
            `precomputed mel tensor set. This is a bug — predictBirds must set ` +
            `_precomputedMel before every model.predict() call.`,
        );
      }
      return mel.clone();
    };

    return { layer, melSpec, name: cfg.name ?? '(unnamed)' };
  });

  // Pre-create a cached zero audio tensor so we don't re-upload 576 KB of
  // zeros on every predict. The patched mel-spec layers ignore their
  // inputs, but `model.predict()` still needs *some* tensor of the
  // declared input shape to walk the graph.
  const audioInputPlaceholder = tf.keep(
    tf.zeros([1, BIRDNET_CHUNK_SAMPLES], 'float32'),
  );

  return {
    model,
    melSpecs,
    audioInputPlaceholder,
  };
}

/**
 * Load the BirdNET model and wrap it in a `BirdNetEngine` with the CPU
 * mel-spec front-end installed. Cached on first call so repeat loads are
 * free; on failure the cache is cleared so callers can retry.
 */
export async function loadBirdNetEngine(
  onProgress?: (fraction: number) => void,
): Promise<BirdNetEngine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const model = await loadBirdNetModel(onProgress);
    return buildBirdNetEngine(model);
  })();
  enginePromise.catch(() => {
    enginePromise = null;
  });
  return enginePromise;
}

/**
 * Delete the cached BirdNET model from IndexedDB.
 * Useful for debugging or if the user wants to reclaim storage.
 */
export async function clearBirdNetCache(): Promise<void> {
  try {
    await tf.io.removeModel(MODEL_CACHE_URL);
  } catch {
    // ignore — nothing cached
  }
}

export async function warmUpBirdNet(engine: BirdNetEngine): Promise<void> {
  // Run one dummy inference so shader/pipeline compilation happens up-front
  // rather than delaying the first real detection. The zero-audio placeholder
  // produces a degenerate mel-spec (uniform after normalisation → uniform
  // after FFT → a fixed pattern after compression), but that's fine for
  // shader-compilation purposes.
  const zeroSamples = new Float32Array(BIRDNET_CHUNK_SAMPLES);
  await predictBirds(engine, zeroSamples, 1);
}

/**
 * Run BirdNET on a single 3-second audio chunk.
 * @param samples Float32Array of exactly BIRDNET_CHUNK_SAMPLES at 48 kHz.
 * @param topK How many top predictions to return.
 *
 * This function is called from a dedicated Web Worker (see
 * `worker/birdnet-worker.ts`); it has no DOM / React dependencies and is
 * safe to run in either context. We use async `.data()` for the readback
 * so the worker's event loop stays responsive to incoming messages while
 * the GPU finishes.
 *
 * Performance note: we deliberately avoid `tf.topk` here. On the WebGL
 * backend, topk issues a multi-pass GPU sort and forces a synchronous-ish
 * `readPixels` stall when its output is read. A Chrome Performance trace
 * on listening mode (when this ran on the main thread) showed `readPixels`
 * alone accounting for ~2.17s of self-time over a 16s window, with each
 * predict blocking for ~414 ms. Reading the ~6000-float logits vector in
 * a single async `.data()` call and picking top-K in JavaScript (~0.1 ms
 * on a 6000×5 partial sort) eliminates topk's GPU overhead and the
 * compounding `readPixels` stall. The gain still matters inside the
 * worker: it frees up event-loop time for message handling.
 */
// Debug counter for the opt-in diagnostic log. Bumped on every predict
// call so we can sample the first few cycles plus every Nth afterward
// without drowning the console.
let predictCount = 0;

/**
 * A/B debugging escape hatch. Set to `true` to bypass the CPU mel-spec
 * patch and run the stock GPU pipeline — useful for isolating whether
 * a correctness regression is in our CPU mel-spec (fails with `true`
 * → regression lives elsewhere; works with `true` → our patch or CPU
 * mel is at fault).
 *
 * Toggled from the browser DevTools console via `window.__birdnetBypassCpuMel = true`
 * before the first predict, or recompiled with the flag baked in here.
 */
const DEFAULT_BYPASS_CPU_MEL = false;
function shouldBypassCpuMel(): boolean {
  const g = globalThis as { __birdnetBypassCpuMel?: boolean };
  return g.__birdnetBypassCpuMel ?? DEFAULT_BYPASS_CPU_MEL;
}

/**
 * Diagnostic flag: when set, `predictBirds` runs the GPU mel-spec once
 * per audio chunk *in addition to* the CPU mel-spec, and logs the
 * element-wise difference between them. Use this to distinguish between
 * "CPU mel-spec is subtly off" (fails parity here) and "CPU mel-spec
 * matches but the CNN still misbehaves" (parity OK here → look
 * elsewhere).
 *
 * Toggled via `globalThis.__birdnetCompareMels = true`.
 */
const DEFAULT_COMPARE_MELS = false;
function shouldCompareMels(): boolean {
  const g = globalThis as { __birdnetCompareMels?: boolean };
  return g.__birdnetCompareMels ?? DEFAULT_COMPARE_MELS;
}

function summariseFloatArray(
  label: string,
  arr: ArrayLike<number>,
): string {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let nanCount = 0;
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) {
      nanCount++;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = (len - nanCount) > 0 ? sum / (len - nanCount) : 0;
  return (
    `${label}: len=${len} min=${min.toExponential(3)} ` +
    `max=${max.toExponential(3)} mean=${mean.toExponential(3)} nan=${nanCount}`
  );
}

/**
 * Partial O(n · k) top-K selection: walk the score vector once, maintaining
 * a sorted-descending array of at most `topK` entries. Beats `tf.topk` on
 * WebGL because we already had the scores in CPU memory and it avoids a
 * multi-pass GPU sort + readback.
 */
function pickTopK(
  scores: ArrayLike<number>,
  topK: number,
): BirdPrediction[] {
  const predictions: BirdPrediction[] = [];
  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    if (predictions.length < topK) {
      predictions.push({ index: i, score });
      if (predictions.length === topK) {
        predictions.sort((a, b) => b.score - a.score);
      }
    } else if (score > predictions[topK - 1].score) {
      predictions[topK - 1] = { index: i, score };
      for (
        let j = topK - 1;
        j > 0 && predictions[j].score > predictions[j - 1].score;
        j--
      ) {
        const tmp = predictions[j];
        predictions[j] = predictions[j - 1];
        predictions[j - 1] = tmp;
      }
    }
  }
  if (predictions.length < topK) {
    predictions.sort((a, b) => b.score - a.score);
  }
  return predictions;
}

export async function predictBirds(
  engine: BirdNetEngine,
  samples: Float32Array,
  topK = 5,
): Promise<BirdPrediction[]> {
  if (samples.length !== BIRDNET_CHUNK_SAMPLES) {
    throw new Error(
      `BirdNET expects exactly ${BIRDNET_CHUNK_SAMPLES} samples, got ${samples.length}`,
    );
  }

  predictCount++;
  // Opt-in startup diagnostic: dumps audio/mel/score summaries for the
  // first few predicts to the console. Toggle via
  // `globalThis.__birdnetVerbose = true` BEFORE the first predict.
  // Default off because end users don't need the spam; keep the code
  // path warm because isolated BirdNET regressions are nasty (silent
  // score collapse, not a stack trace) and these logs are the fastest
  // way to triage one.
  const g = globalThis as { __birdnetVerbose?: boolean };
  const shouldLog = g.__birdnetVerbose === true && predictCount <= 3;
  const bypass = shouldBypassCpuMel();
  const shouldCompare = shouldCompareMels() && predictCount <= 3;

  if (shouldLog) {
    console.log(
      `[birdnet-debug #${predictCount}] ${summariseFloatArray('audio', samples)}` +
        (bypass ? ' (BYPASS: GPU mel path)' : ''),
    );
  }

  if (bypass) {
    // Run the stock pipeline: real audio → GPU mel-spec → CNN. Used to
    // confirm the non-patched baseline still works when debugging a
    // suspected regression in the CPU mel-spec path.
    const logits = tf.tidy(() => {
      const input = tf.tensor2d(samples, [1, BIRDNET_CHUNK_SAMPLES]);
      const output = engine.model.predict(input) as tf.Tensor;
      return output.squeeze([0]) as tf.Tensor1D;
    });
    const scores = await logits.data();
    logits.dispose();
    if (shouldLog) {
      console.log(
        `[birdnet-debug #${predictCount}] ${summariseFloatArray('scores', scores)}`,
      );
    }
    const predictions = pickTopK(scores, topK);
    if (shouldLog) {
      console.log(
        `[birdnet-debug #${predictCount}] top-${predictions.length}:`,
        predictions.map((p) => `#${p.index}=${p.score.toFixed(4)}`).join(' '),
      );
    }
    return predictions;
  }

  // 1. Compute the mel-spectrogram on the CPU for each slot. `run`
  //    reuses each slot's internal scratch buffers and returns a
  //    Float32Array; `tf.tensor4d` uploads it to the GPU. We keep the
  //    resulting tensors outside `tf.tidy` so they survive the tidy
  //    scope; the patched `call()` returns a `clone()` each time so
  //    tidy can dispose the clone independently.
  const uploadedMels: tf.Tensor[] = [];
  interface PatchedLayerShape extends MelSpecLayerSimple {
    _precomputedMel: tf.Tensor | null;
    _originalCall: (inputs: tf.Tensor | tf.Tensor[]) => tf.Tensor;
  }
  try {
    for (const slot of engine.melSpecs) {
      const melData = slot.melSpec.run(samples);
      const [, melBins, numFrames] = slot.melSpec.outputShape;
      const melTensor = tf.tensor4d(melData, [1, melBins, numFrames, 1]);
      uploadedMels.push(melTensor);
      (slot.layer as PatchedLayerShape)._precomputedMel = melTensor;

      if (shouldLog) {
        console.log(
          `[birdnet-debug #${predictCount}] ${summariseFloatArray(
            `mel[${slot.name}]`,
            melData,
          )} shape=[1,${melBins},${numFrames},1]`,
        );
      }

      // 1b. (Diagnostic only) If the compare flag is on, also run the
      //     stock GPU mel-spec on the same audio and print element-wise
      //     diffs against our CPU output. Scoped to the first few
      //     predicts so it doesn't pollute the hot path.
      if (shouldCompare) {
        const patched = slot.layer as PatchedLayerShape;
        const gpuMelData = tf.tidy(() => {
          const audioTensor = tf.tensor2d(samples, [1, BIRDNET_CHUNK_SAMPLES]);
          return patched._originalCall(audioTensor);
        });
        const gpuMelArr = await gpuMelData.data();
        const gpuMelShape = gpuMelData.shape;
        gpuMelData.dispose();

        console.log(
          `[birdnet-compare #${predictCount}] GPU mel[${slot.name}]: ` +
            `${summariseFloatArray('gpu_mel', gpuMelArr)} shape=[${gpuMelShape.join(',')}]`,
        );

        const minLen = Math.min(gpuMelArr.length, melData.length);
        let maxAbsDiff = 0;
        let sumAbsDiff = 0;
        let dotAB = 0;
        let dotAA = 0;
        let dotBB = 0;
        for (let i = 0; i < minLen; i++) {
          const a = gpuMelArr[i];
          const b = melData[i];
          const d = Math.abs(a - b);
          if (d > maxAbsDiff) maxAbsDiff = d;
          sumAbsDiff += d;
          dotAB += a * b;
          dotAA += a * a;
          dotBB += b * b;
        }
        const cosine =
          dotAA > 0 && dotBB > 0 ? dotAB / Math.sqrt(dotAA * dotBB) : 0;
        console.log(
          `[birdnet-compare #${predictCount}] [${slot.name}] ` +
            `len_gpu=${gpuMelArr.length} len_cpu=${melData.length} ` +
            `max|diff|=${maxAbsDiff.toExponential(3)} ` +
            `mean|diff|=${(sumAbsDiff / minLen).toExponential(3)} ` +
            `cosine=${cosine.toFixed(6)}`,
        );
      }
    }

    // 2. Run the CNN portion of the model. tf.tidy disposes every
    //    intermediate the graph produces; we keep only the 1-D logits so
    //    the subsequent readback is a single small transfer.
    const logits = tf.tidy(() => {
      const output = engine.model.predict(
        engine.audioInputPlaceholder,
      ) as tf.Tensor;
      return output.squeeze([0]) as tf.Tensor1D;
    });

    // 3. Single async readback of the full score vector (~6000 floats /
    //    ~24 KB). `.data()` yields the event loop while the GPU finishes.
    //    This replaces tf.topk's multi-pass GPU sort + internal readback
    //    with one readback of the raw logits.
    const scores = await logits.data();
    logits.dispose();

    if (shouldLog) {
      console.log(
        `[birdnet-debug #${predictCount}] ${summariseFloatArray('scores', scores)}`,
      );
    }

    // 4. Partial top-K in JavaScript. For numLabels ≈ 6000 and topK = 5,
    //    this is ~30k comparisons + a handful of O(topK) insertions —
    //    under 0.1 ms on any device.
    const predictions = pickTopK(scores, topK);

    if (shouldLog) {
      console.log(
        `[birdnet-debug #${predictCount}] top-${predictions.length}:`,
        predictions
          .map((p) => `#${p.index}=${p.score.toFixed(4)}`)
          .join(' '),
      );
    }

    return predictions;
  } finally {
    // Always release each mel tensor, even if predict threw. Clear the
    // per-layer field too so a subsequent call can't accidentally reuse
    // a disposed tensor (the patched call() will throw instead).
    for (const slot of engine.melSpecs) {
      (slot.layer as PatchedLayerShape)._precomputedMel = null;
    }
    for (const t of uploadedMels) {
      t.dispose();
    }
  }
}
