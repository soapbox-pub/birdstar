// AudioWorklet processor that forwards every block of input samples to the
// main thread. We build it as a string so Vite doesn't try to bundle it as a
// module — AudioWorklets must be loaded via AudioWorklet.addModule(url) and
// run in a separate realm without access to imports.
export const recorderWorkletCode = /* js */ `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0]) {
      // input[0] is a Float32Array of the first channel (we only record mono).
      // Copy so the underlying buffer can be reused by the audio engine.
      const samples = new Float32Array(input[0]);
      this.port.postMessage(samples, [samples.buffer]);
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

export function createRecorderWorkletUrl(): string {
  const blob = new Blob([recorderWorkletCode], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}
