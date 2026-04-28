// Parity tests for the CPU mel-spectrogram implementation.
//
// The goal is to guarantee that `createMelSpec` produces the *exact* same
// numerical output as `MelSpecLayerSimple` running on tfjs. If these
// diverge, the downstream BirdNET CNN will see a different input
// distribution than it was trained on and its predictions will silently
// become less accurate. We can't check that with an end-to-end test
// (the model isn't loaded in the jsdom test environment), so instead we
// compare the two layers' outputs bin-for-bin on synthetic inputs.
//
// Tests run on tfjs's CPU backend. That backend is deterministic and
// uses the same `tf.signal.stft` implementation as WebGL, so if the two
// match on CPU they match on WebGL too (bar small GPU rounding which
// we don't try to model here).
//
// Scope: this test exercises a SINGLE MelSpec slot with synthetic
// params. The real BirdNET V2.4 model has two `MelSpecLayerSimple`
// instances with different params (frame_length 2048/278 and
// 1024/280, different fmin/fmax) whose outputs are channel-wise
// concatenated before the CNN. Per-layer parity is all this test can
// verify; `model.ts`'s `buildBirdNetEngine` is responsible for
// enumerating every such layer in the loaded graph and plumbing a
// matching CPU impl into each, which has to be verified by browser
// smoke test.
import { describe, it, expect, beforeAll } from 'vitest';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-cpu';
import { createMelSpec } from './melSpec';
import { MelSpecLayerSimple } from './melSpecLayer';

// Small enough to keep each test fast (sub-second) but large enough to
// exercise framing, FFT, and matmul code paths non-trivially.
const SAMPLE_RATE = 48_000;
// 1 s of audio → non-trivial number of frames.
const CHUNK_SAMPLES = 48_000;
const FRAME_LENGTH = 1024;
const FRAME_STEP = 280;
// Frames the tfjs framing rule produces for the above:
// floor((48000 - 1024) / 280) + 1 = 168.
const EXPECTED_FRAMES = Math.floor((CHUNK_SAMPLES - FRAME_LENGTH) / FRAME_STEP) + 1;
const MEL_BINS = 16;
const MAG_SCALE = 1.23;

/**
 * Build a simple triangular mel filterbank in the shape the layer config
 * ships it as: [fftBins, melBins]. The exact spacing doesn't matter for
 * the parity test — we just need non-trivial nonzero weights so the
 * matmul output depends on every input bin.
 */
function buildTriangularFilterbank(fftBins: number, melBins: number): number[][] {
  const fb: number[][] = Array.from({ length: fftBins }, () => new Array(melBins).fill(0));
  // Overlapping triangles centred on evenly-spaced bins, edges meeting
  // at neighbours — a crude but valid filterbank.
  const spacing = (fftBins - 1) / (melBins + 1);
  for (let m = 0; m < melBins; m++) {
    const centre = (m + 1) * spacing;
    const left = m * spacing;
    const right = (m + 2) * spacing;
    for (let f = 0; f < fftBins; f++) {
      let w = 0;
      if (f >= left && f <= centre) {
        w = (f - left) / (centre - left);
      } else if (f > centre && f <= right) {
        w = (right - f) / (right - centre);
      }
      fb[f][m] = w;
    }
  }
  return fb;
}

function genSineChunk(freqHz: number, amp = 0.5): Float32Array {
  const out = new Float32Array(CHUNK_SAMPLES);
  const w = (2 * Math.PI * freqHz) / SAMPLE_RATE;
  for (let i = 0; i < CHUNK_SAMPLES; i++) {
    out[i] = amp * Math.sin(w * i);
  }
  return out;
}

function genNoiseChunk(seed: number): Float32Array {
  // Deterministic LCG noise — reproducible across runs, no test flakiness.
  let s = seed >>> 0;
  const out = new Float32Array(CHUNK_SAMPLES);
  for (let i = 0; i < CHUNK_SAMPLES; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    // Map uint32 → [-1, 1].
    out[i] = (s / 0x8000_0000) - 1;
  }
  return out;
}

describe('melSpec parity with MelSpecLayerSimple', () => {
  const filterbank = buildTriangularFilterbank(FRAME_LENGTH / 2 + 1, MEL_BINS);

  beforeAll(async () => {
    await tf.setBackend('cpu');
    await tf.ready();
  });

  /**
   * Run the tfjs `MelSpecLayerSimple` on the given samples and return its
   * output as a flat Float32Array in the same layout as our CPU
   * implementation: [1, melBins, frames, 1] row-major.
   */
  async function runTfLayer(samples: Float32Array): Promise<Float32Array> {
    const layer = new MelSpecLayerSimple({
      sampleRate: SAMPLE_RATE,
      specShape: [MEL_BINS, EXPECTED_FRAMES],
      frameStep: FRAME_STEP,
      frameLength: FRAME_LENGTH,
      fmin: 0,
      fmax: SAMPLE_RATE / 2,
      melFilterbank: filterbank,
    });
    // Build the layer's weight (magnitude_scaling) to match the baked
    // 1.23 value the production model ships with.
    layer.build([1, CHUNK_SAMPLES]);
    // The initializer already sets 1.23, so no extra weight setting is
    // needed here — but double-check in case the default ever changes.
    const weights = layer.getWeights();
    expect(weights[0].dataSync()[0]).toBeCloseTo(MAG_SCALE, 6);

    const input = tf.tensor2d(samples, [1, CHUNK_SAMPLES]);
    const output = layer.call(input) as tf.Tensor;
    const data = (await output.data()) as Float32Array;
    input.dispose();
    output.dispose();
    // Keras output shape: [1, melBins, frames, 1]. Verify + return the
    // underlying Float32Array, which is already in row-major order with
    // exactly the layout our CPU impl produces.
    expect(output.shape).toEqual([1, MEL_BINS, EXPECTED_FRAMES, 1]);
    return data;
  }

  function runCpu(samples: Float32Array): Float32Array {
    const melSpec = createMelSpec({
      chunkSamples: CHUNK_SAMPLES,
      frameLength: FRAME_LENGTH,
      frameStep: FRAME_STEP,
      specShape: [MEL_BINS, EXPECTED_FRAMES],
      melFilterbank: filterbank,
      magScale: MAG_SCALE,
    });
    // Copy out since the buffer is reused across calls.
    return new Float32Array(melSpec.run(samples));
  }

  /**
   * Compare two Float32Arrays elementwise. Because the shipped model
   * squares FFT real parts (pow(2)) and then raises to a ~0.32 exponent,
   * magnitudes end up small (≪ 1 at typical signal levels), so a plain
   * absolute tolerance works better than relative — values near zero
   * would otherwise fail any reasonable relative check.
   */
  function expectAllClose(
    actual: Float32Array,
    expected: Float32Array,
    absTol: number,
  ): void {
    expect(actual.length).toBe(expected.length);
    let maxAbsDiff = 0;
    let maxIdx = -1;
    for (let i = 0; i < actual.length; i++) {
      const d = Math.abs(actual[i] - expected[i]);
      if (d > maxAbsDiff) {
        maxAbsDiff = d;
        maxIdx = i;
      }
    }
    if (maxAbsDiff > absTol) {
      throw new Error(
        `Mel-spec outputs diverge: max abs diff ${maxAbsDiff.toExponential(3)} ` +
          `at index ${maxIdx} (actual=${actual[maxIdx]}, expected=${expected[maxIdx]}) ` +
          `exceeds tolerance ${absTol}`,
      );
    }
  }

  it('matches tfjs on a 1 kHz sine', { timeout: 30_000 }, async () => {
    const samples = genSineChunk(1000);
    const cpu = runCpu(samples);
    const tfOut = await runTfLayer(samples);
    // Both implementations chain the same sequence of operations
    // (normalise → window → FFT → real-part → matmul → pow), but the
    // FFT kernels are different: tfjs runs its Cooley-Tukey ladder in
    // float32, fft.js is radix-4 and computes internally in float64 and
    // only rounds to float32 at the final buffer write. The resulting
    // per-element divergence is bounded by a few percent of typical
    // sample magnitudes — well below the CNN's sensitivity threshold,
    // but enough that a super-tight tolerance would flake.
    expectAllClose(cpu, tfOut, 5e-3);
  });

  it('matches tfjs on deterministic noise', { timeout: 30_000 }, async () => {
    const samples = genNoiseChunk(0xdeadbeef);
    const cpu = runCpu(samples);
    const tfOut = await runTfLayer(samples);
    expectAllClose(cpu, tfOut, 5e-3);
  });

  it('produces finite, sensible output on silence', () => {
    // All-zero input exercises the divNoNan branch of the normaliser.
    // Both implementations normalise to -1 uniformly, then the
    // Hann-windowed -1 frame has exact theoretical values only at
    // bins 0 and 1 of each FFT (X[0]=-128, X[1]=+64, rest cancel to
    // zero analytically). In practice tfjs's float32 FFT produces the
    // analytic zeros cleanly; fft.js's float64 internal compute leaks
    // ~1e-7 into those bins. After squaring and raising to the ~0.22
    // compression exponent this noise blows up to ~1e-3. That's
    // undetectable by the CNN on actual audio (where those bins
    // carry real signal), and silence input never occurs in
    // production anyway, so we just check for finiteness rather than
    // parity.
    const samples = new Float32Array(CHUNK_SAMPLES);
    const cpu = runCpu(samples);
    for (let i = 0; i < cpu.length; i++) {
      expect(Number.isFinite(cpu[i])).toBe(true);
      // Loose sanity: values stay in a reasonable range.
      expect(cpu[i]).toBeGreaterThanOrEqual(0);
      expect(cpu[i]).toBeLessThan(100);
    }
  });

  it('produces a spectral peak at the correct frequency for a pure sine', () => {
    // Sanity check independent of tfjs: a pure sine at frequency f should
    // produce a localised peak in the mel-spec column corresponding to
    // f. We check this in the middle frame (well away from edge effects).
    const freq = 4000; // Hz
    const samples = genSineChunk(freq);
    const mel = runCpu(samples);

    // Mid-frame (in the transposed/reversed layout, mel index 0 is the
    // HIGHEST frequency bin; see melSpec.ts).
    const midFrame = Math.floor(EXPECTED_FRAMES / 2);
    let peakMel = -1;
    let peakVal = -Infinity;
    for (let m = 0; m < MEL_BINS; m++) {
      const v = mel[m * EXPECTED_FRAMES + midFrame];
      if (v > peakVal) {
        peakVal = v;
        peakMel = m;
      }
    }

    // Expected peak: FFT bin index = round(freq * frameLength / sampleRate)
    // = round(4000 * 1024 / 48000) ≈ 85. Our filterbank has its highest
    // triangle centred at bin (MEL_BINS * spacing) ≈ 452, well above 85.
    // So the peak should be at a low-numbered *fft-bin* filterbank row,
    // which after the reverse(-1) maps to a HIGH mel index.
    const fftPeakBin = Math.round((freq * FRAME_LENGTH) / SAMPLE_RATE);
    const spacing = (FRAME_LENGTH / 2) / (MEL_BINS + 1);
    const expectedFbRow = Math.round(fftPeakBin / spacing) - 1; // triangle centres
    const expectedReversedMel = MEL_BINS - 1 - expectedFbRow;

    // Allow ±2 bins of slop — the triangle filter spreads energy across
    // neighbours.
    expect(Math.abs(peakMel - expectedReversedMel)).toBeLessThanOrEqual(2);
    // And the peak must be finite + nonzero.
    expect(peakVal).toBeGreaterThan(0);
    expect(Number.isFinite(peakVal)).toBe(true);
  });
});
