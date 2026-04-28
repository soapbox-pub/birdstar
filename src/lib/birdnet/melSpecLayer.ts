// Custom TensorFlow.js layer matching the MelSpecLayerSimple baked into
// the BirdNET V2.4 model. Without this registered, tf.loadLayersModel()
// will fail to deserialize the model.
//
// At inference time we do NOT actually execute this layer's `call()`: the
// hybrid pipeline (see `model.ts` and `melSpec.ts`) monkey-patches the
// loaded layer instance so the GPU-heavy STFT is replaced by a CPU
// implementation. This file still needs to exist — tfjs's deserializer
// looks up layer classes by `className` via the global registry and
// instantiates them from the saved config before we get a chance to
// replace anything — but the `call()` body below is effectively dead
// code in production and only kept for reference / to document the
// original shipped implementation.
//
// Reference implementation: Chirpity-Electron/js/models/BirdNet2.4.js
// by Matt Kirkland (CC-BY-NC-SA-4.0, same license as the model weights).
//
// The layer takes raw audio samples [batch, 144000] and produces a
// mel-spectrogram image [batch, 96, 511, 1] that the rest of the CNN
// operates on. The mel filterbank matrix is stored in the saved model's
// config, not as a trainable weight.
import * as tf from '@tensorflow/tfjs';

interface MelSpecLayerConfig {
  sampleRate: number;
  specShape: [number, number];
  frameStep: number;
  frameLength: number;
  fmin: number;
  fmax: number;
  melFilterbank: number[][];
  name?: string;
}

export class MelSpecLayerSimple extends tf.layers.Layer {
  static className = 'MelSpecLayerSimple';

  private sampleRate: number;
  private specShape: [number, number];
  private frameStep: number;
  private frameLength: number;
  private fmin: number;
  private fmax: number;
  private melFilterbankRaw: number[][];
  private melFilterbank: tf.Tensor2D;
  private two: tf.Scalar;
  private one: tf.Scalar;
  private magScale!: tf.LayerVariable;

  constructor(config: MelSpecLayerConfig) {
    super(config as unknown as tf.serialization.ConfigDict);
    this.sampleRate = config.sampleRate;
    this.specShape = config.specShape;
    this.frameStep = config.frameStep;
    this.frameLength = config.frameLength;
    this.fmin = config.fmin;
    this.fmax = config.fmax;
    this.melFilterbankRaw = config.melFilterbank;
    this.melFilterbank = tf.tensor2d(config.melFilterbank);
    this.two = tf.scalar(2);
    this.one = tf.scalar(1);
  }

  override build(inputShape: tf.Shape | tf.Shape[]): void {
    this.magScale = this.addWeight(
      'magnitude_scaling',
      [],
      'float32',
      tf.initializers.constant({ value: 1.23 }),
    );
    super.build(inputShape);
  }

  override computeOutputShape(inputShape: tf.Shape | tf.Shape[]): tf.Shape {
    const shape = Array.isArray(inputShape[0]) ? inputShape[0] : (inputShape as tf.Shape);
    return [shape[0], this.specShape[0], this.specShape[1], 1];
  }

  private normaliseAudioBatch(tensor: tf.Tensor): tf.Tensor {
    return tf.tidy(() => {
      const sigMax = tf.max(tensor, -1, true);
      const sigMin = tf.min(tensor, -1, true);
      const range = sigMax.sub(sigMin);
      return tensor.sub(sigMin).divNoNan(range).mul(this.two).sub(this.one);
    });
  }

  // Batched STFT that works across WebGL / WebGPU / CPU backends.
  // tf.signal.stft only supports 1-D signals, so we split the batch
  // and stack the results.
  private batchStft(signalBatch: tf.Tensor2D): tf.Tensor3D {
    return tf.tidy(() => {
      const frames = signalBatch.shape[0];
      const rows = tf.split(signalBatch, frames);
      const spectra = rows.map((row) => {
        const squeezed = row.squeeze<tf.Tensor1D>();
        const complex = tf.signal.stft(
          squeezed,
          this.frameLength,
          this.frameStep,
          this.frameLength,
          tf.signal.hannWindow,
        );
        // Magnitude of STFT = sqrt(real^2 + imag^2). tf.signal.stft already
        // returns the magnitude as a real tensor in recent tfjs versions.
        return complex.cast('float32');
      });
      return tf.stack(spectra) as tf.Tensor3D;
    });
  }

  override call(inputs: tf.Tensor | tf.Tensor[]): tf.Tensor {
    return tf.tidy(() => {
      const input = (Array.isArray(inputs) ? inputs[0] : inputs) as tf.Tensor2D;
      const normalised = this.normaliseAudioBatch(input) as tf.Tensor2D;
      const stftOut = this.batchStft(normalised);

      // stftOut: [batch, frames, fftBins] of STFT magnitudes
      // matMul with melFilterbank [fftBins, melBins] -> [batch, frames, melBins]
      const mel = stftOut.matMul(this.melFilterbank);
      const powered = mel.pow(this.two);
      const scale = tf.div(this.one, tf.add(this.one, tf.exp(this.magScale.read())));
      const compressed = powered.pow(scale);
      // Reverse the mel axis (low freqs at bottom in image),
      // transpose to [batch, melBins, frames], add channel dim.
      return compressed.reverse(-1).transpose([0, 2, 1]).expandDims(-1);
    });
  }

  override getConfig(): tf.serialization.ConfigDict {
    const baseConfig = super.getConfig();
    return {
      ...baseConfig,
      sampleRate: this.sampleRate,
      specShape: this.specShape,
      frameStep: this.frameStep,
      frameLength: this.frameLength,
      fmin: this.fmin,
      fmax: this.fmax,
      melFilterbank: this.melFilterbankRaw,
    } as tf.serialization.ConfigDict;
  }
}

// Register once per module load. Registering multiple times is harmless.
tf.serialization.registerClass(MelSpecLayerSimple);
