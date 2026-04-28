// CPU mel-spectrogram computation for BirdNET V2.4.
//
// Why this exists:
//   Running the MelSpecLayerSimple on tfjs's WebGL backend dispatches an
//   11-call FFT decomposition + ~1500 Slice kernels per predict. A Chrome
//   trace showed this saturating the shared GPU process with 2.5 s of
//   GPU kernel-time per 2 s prediction cycle, which caused visible jank
//   across *every* tab in the browser (the GPU process is shared). The
//   rest of the CNN only costs ~70 ms of GPU time; the mel-spec is the
//   entire problem.
//
//   Moving the mel-spec to CPU (plain JS, single-threaded inside the
//   dedicated Web Worker) takes it off the GPU entirely. The CNN still
//   runs on WebGL — fast and it does not oversubscribe the GPU process.
//
// What this module does:
//   Accepts a Float32Array of raw audio samples (48 kHz, 3 s = 144,000
//   samples), produces a Float32Array representing a 96 × 511 mel-spec
//   image laid out as [1, 96, 511, 1] in channels-last NHWC order (the
//   exact layout the CNN expects). The shipped model config says the
//   frame axis is 512 long, but the layer's actual framing rule (inherited
//   from `tf.signal.stft`) only yields 511 frames for the canonical
//   params (`frameLength=2048, frameStep=278`). That mismatch was baked
//   in at training time, so the CNN operates on the true 511-frame
//   output, not the declared 512.
//
// Fidelity:
//   This matches the *real-part* mel-spectrogram the Chirpity model was
//   trained against — not the classical magnitude. Chirpity's reference
//   implementation (both its tfjs-node path and its WebGPU custom kernel)
//   passes only the real part of the FFT into the mel filterbank. See
//   the investigation notes in the accompanying commit for the full
//   trail; the short version is that `.cast('float32')` on a complex
//   tensor in tfjs drops the imaginary part, and Chirpity's WebGPU
//   `FFT2` kernel's final pass outputs only the real bin vector. We
//   reproduce that exactly so the CNN sees the same numerical
//   distribution it was trained on.
//
// Performance:
//   FFT kernel is fft.js (Fedor Indutny, MIT, radix-4). 2048-point real
//   FFTs at ~0.04 ms each × 511 frames lands around 20 ms wall clock;
//   add ~5 ms for the filterbank matmul (513×96 per frame) and ~1 ms for
//   the compression pow() and the full CPU mel-spec fits well under
//   the 2-second predict budget.
//
// All scratch buffers are allocated up-front in `createMelSpec` and
// reused across calls; the per-call path does zero allocation.
import FFT from 'fft.js';

export interface MelSpecParams {
  /** Total input length in samples (e.g. 144_000 for 3 s @ 48 kHz). */
  chunkSamples: number;
  /** Window/FFT size. Must be a power of two (e.g. 2048). */
  frameLength: number;
  /** Hop size between consecutive windows (e.g. 278). */
  frameStep: number;
  /**
   * Output mel shape `[melBins, declaredFrames]` as taken straight from
   * the model config. `melBins` is authoritative; `declaredFrames` is
   * used for a sanity log only — the actual frame count is derived from
   * `(chunkSamples, frameLength, frameStep)` via tfjs's framing rule, to
   * match what the original `MelSpecLayerSimple.call()` really produces
   * at runtime. See the module header for why these can differ.
   */
  specShape: [number, number];
  /**
   * Mel filterbank matrix shape [frameLength/2 + 1, melBins] — same
   * orientation the model config ships in (rows = FFT bins, cols = mel
   * bins). The caller should pass the exact array the baked model
   * holds, not a re-derived one, so we inherit any quirks of Chirpity's
   * filterbank construction.
   */
  melFilterbank: number[][];
  /**
   * Trained magnitude-scaling scalar. The layer applies
   * `compressed = x^(2 / (1 + exp(magScale)))`. The shipped model has
   * magScale = 1.23 (and never trains further during inference, so
   * we can bake the final exponent here).
   */
  magScale: number;
}

export interface MelSpec {
  /**
   * Compute the mel-spectrogram for a single 3-second audio chunk.
   * Returns the internal scratch buffer (valid until the next call);
   * callers that need to retain the data across async boundaries must
   * copy it.
   *
   * Output layout: Float32Array of length `melBins * numFrames`,
   * representing a NHWC tensor of shape `[1, melBins, numFrames, 1]`
   * in row-major order (mel bin is the slow axis, frame is the fast
   * axis). That's the layout the downstream CNN was saved with.
   */
  readonly run: (samples: Float32Array) => Float32Array;
  /** Shape of the produced tensor, for convenience when building the tf.tensor. */
  readonly outputShape: readonly [1, number, number, 1];
}

/**
 * Build a non-periodic-even Hann window matching `tf.signal.hannWindow`.
 *
 * tfjs uses a cosine window with `even = 1 - windowLength%2` in the
 * divisor: for even `windowLength` the divisor collapses to
 * `windowLength`, which is the DSP-standard **periodic** Hann (as in
 * NumPy, librosa, scipy). We reproduce that exactly so the framed signal
 * is tapered identically.
 */
function buildHannWindow(windowLength: number): Float32Array {
  const even = 1 - (windowLength % 2);
  const denom = windowLength + even - 1;
  const w = new Float32Array(windowLength);
  for (let i = 0; i < windowLength; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom);
  }
  return w;
}

/**
 * Transpose the filterbank from its shipped orientation
 * `[fftBins, melBins]` into the cache-friendly `[melBins, fftBins]`
 * orientation. We later iterate `mel = sum_over_fft(fbRow[m] * fft[f])`
 * where the inner loop reads `fbRow[m][f]` sequentially, so this
 * transpose turns the accumulation into a contiguous-stride scan.
 *
 * Packs into a single Float32Array for ~2× better L1 behaviour than a
 * nested number[][] (no per-row pointer chase, no boxed numbers).
 */
function flattenAndTranspose(
  filterbank: number[][],
  fftBins: number,
  melBins: number,
): Float32Array {
  if (filterbank.length !== fftBins) {
    throw new Error(
      `Mel filterbank row count ${filterbank.length} does not match fftBins ${fftBins}`,
    );
  }
  const out = new Float32Array(melBins * fftBins);
  for (let f = 0; f < fftBins; f++) {
    const row = filterbank[f];
    if (row.length !== melBins) {
      throw new Error(
        `Mel filterbank row ${f} has ${row.length} cols, expected ${melBins}`,
      );
    }
    for (let m = 0; m < melBins; m++) {
      out[m * fftBins + f] = row[m];
    }
  }
  return out;
}

export function createMelSpec(params: MelSpecParams): MelSpec {
  const { chunkSamples, frameLength, frameStep, specShape, melFilterbank, magScale } =
    params;
  const [melBins, declaredFrames] = specShape;
  const fftBins = frameLength / 2 + 1;

  // Actual frame count derived from tfjs's non-padded framing rule:
  //   while (start + frameLength <= size): emit; start += frameStep.
  // = floor((size - frameLength) / frameStep) + 1
  //
  // The shipped BirdNET V2.4 model config declares `specShape: [96, 512]`
  // but tfjs's `signal.stft` (called inside the original
  // `MelSpecLayerSimple`) actually produces 511 frames for the canonical
  // `(chunkSamples=144000, frameLength=2048, frameStep=278)` settings.
  // The layer never reshapes to the declared length — it just streams the
  // stft output into the matmul — so the downstream CNN was trained and
  // runs against the real 511-frame output, not the 512-frame declaration.
  // We match that: derive the frame count from the framing rule and warn
  // if it diverges from specShape (which happens in production for the
  // shipped config, and is harmless).
  const numFrames = Math.floor((chunkSamples - frameLength) / frameStep) + 1;
  if (numFrames !== declaredFrames) {
    // Not an error — this mismatch is baked into the shipped Chirpity
    // model config. Log once per engine build so unexpected mismatches
    // elsewhere (say, a future model revision) are still visible.
    console.warn(
      `[birdnet-melspec] specShape declares ${declaredFrames} frames but framing rule ` +
        `yields ${numFrames} (chunkSamples=${chunkSamples}, frameLength=${frameLength}, ` +
        `frameStep=${frameStep}); using the framing-derived value, which is what ` +
        `tfjs's MelSpecLayerSimple actually produces.`,
    );
  }

  // --- scratch / precomputed state --------------------------------------

  const fft = new FFT(frameLength);
  // fft.js complex buffer layout: [re0, im0, re1, im1, ...] of length 2N.
  const fftOut = fft.createComplexArray() as number[];
  // Framing scratch: a single frame's worth of windowed samples, fed to
  // realTransform. fft.js accepts plain Arrays or typed arrays here.
  const frameBuf = new Float32Array(frameLength);
  const hann = buildHannWindow(frameLength);

  // Per-frame real-part vector after taking the non-redundant half:
  // fftBins = frameLength/2 + 1 = 1025 for frameLength=2048.
  const realHalf = new Float32Array(fftBins);

  // Mel values for the current frame, pre-compression.
  const melFrame = new Float32Array(melBins);

  // Transposed filterbank: [melBins, fftBins] flat.
  const fbFlat = flattenAndTranspose(melFilterbank, fftBins, melBins);

  // Output tensor storage: [1, melBins, numFrames, 1] in row-major.
  // With channels=1 and batch=1 this flattens to length melBins*numFrames
  // with index = mel*numFrames + frame.
  const out = new Float32Array(melBins * numFrames);

  // Compression exponent — the layer does `x.pow(2).pow(1/(1+exp(s)))`.
  // We apply pow(2) explicitly below (as `x*x`) and then raise that
  // squared value to `1/(1+exp(s))`. The combined effect is
  // `x^(2/(1+exp(s)))`, ≈ `x^0.4524` for the shipped magScale=1.23.
  const compressionExp = 1 / (1 + Math.exp(magScale));

  const outputShape: readonly [1, number, number, 1] = [1, melBins, numFrames, 1];

  // --- per-call hot path -------------------------------------------------

  function run(samples: Float32Array): Float32Array {
    if (samples.length !== chunkSamples) {
      throw new Error(
        `Mel-spec expected ${chunkSamples} samples, got ${samples.length}`,
      );
    }

    // Per-chunk amplitude normalisation to [-1, 1]:
    //   scaled = (x - min) / (max - min) * 2 - 1
    // Matches MelSpecLayerSimple.normaliseAudioBatch. Applied over the
    // whole 3-second chunk (not per-frame).
    let sigMin = samples[0];
    let sigMax = samples[0];
    for (let i = 1; i < chunkSamples; i++) {
      const v = samples[i];
      if (v < sigMin) sigMin = v;
      else if (v > sigMax) sigMax = v;
    }
    const range = sigMax - sigMin;
    // divNoNan semantics: range=0 -> normalised signal is 0 (then * 2 - 1
    // = -1 uniformly, which matches tfjs's div-by-zero-returns-zero
    // behaviour inside the .mul(2).sub(1) chain).
    const invRange = range === 0 ? 0 : 1 / range;

    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      const start = frameIdx * frameStep;

      // Normalise + window in a single pass into the frame buffer.
      for (let n = 0; n < frameLength; n++) {
        const raw = samples[start + n];
        const normalised = (raw - sigMin) * invRange * 2 - 1;
        frameBuf[n] = normalised * hann[n];
      }

      // Real-input FFT. fft.js writes the full complex spectrum
      // interleaved (re0, im0, re1, im1, ...) — we need only the real
      // parts of the first `fftBins` = N/2+1 bins (Chirpity drops the
      // imaginary component; see header).
      fft.realTransform(fftOut, frameBuf);
      for (let k = 0; k < fftBins; k++) {
        realHalf[k] = fftOut[2 * k];
      }

      // Mel matmul: melFrame[m] = sum_f fbFlat[m, f] * realHalf[f].
      // fbFlat is row-major [melBins, fftBins], so the inner loop scans
      // a contiguous span in both fbFlat and realHalf. Fastest JS
      // matvec you can write without SIMD.
      for (let m = 0; m < melBins; m++) {
        const rowBase = m * fftBins;
        let acc = 0;
        for (let f = 0; f < fftBins; f++) {
          acc += fbFlat[rowBase + f] * realHalf[f];
        }
        melFrame[m] = acc;
      }

      // Compression + mel-axis reversal + transpose into output buffer,
      // all fused into a single pass to avoid extra scratch. The model
      // stores mel bins in reversed order (low freqs at the bottom of
      // the image) and lays the output out as
      //   [batch, melBins, frames, channels].
      // We write directly to out[mel*numFrames + frameIdx] with the
      // reversed mel index.
      for (let m = 0; m < melBins; m++) {
        const x = melFrame[m];
        // Match Chirpity's .pow(2).pow(1/(1+exp(s))) fusion: square the
        // (possibly negative) FFT-derived matmul output, then raise that
        // nonneg squared value to the baked compression exponent.
        const squared = x * x;
        const compressed = squared === 0 ? 0 : Math.pow(squared, compressionExp);
        const reversedMel = melBins - 1 - m;
        out[reversedMel * numFrames + frameIdx] = compressed;
      }
    }

    return out;
  }

  return { run, outputShape };
}
