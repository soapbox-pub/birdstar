// Captures microphone audio at 48 kHz mono and maintains a rolling 3-second
// buffer. When `predictEveryMs` has elapsed, it calls `onChunk` with a fresh
// Float32Array copy of the last 3 seconds so it can be sent to BirdNET.
//
// Uses AudioWorklet for sample delivery (modern, low-latency). Falls back to
// ScriptProcessorNode on the (rare) browsers without AudioWorklet support.
//
// Intentionally reports a minimal, low-frequency React state surface
// (isRecording, error). Fine-grained signals like the instantaneous audio
// level would force a render per frame, so we expose the underlying
// AnalyserNode via `getAnalyser()` instead — callers (the visualizer)
// read from it inside their own requestAnimationFrame loop and bypass
// React entirely.
//
// Feedback-loop avoidance: the recorder reads
// useSongPlaybackActive() from the SongPlayback context and drops
// incoming mic samples on the floor while a reference song is
// playing. Without this, the mic would pick up the speaker playback
// (we can't rely on echoCancellation, it's disabled intentionally
// for classification quality) and BirdNET would happily confirm the
// species we just played -- which for a logged-in user could
// silently publish a phantom sighting to Nostr. See
// src/contexts/SongPlaybackContext.ts for the full rationale.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BIRDNET_CHUNK_SAMPLES, BIRDNET_SAMPLE_RATE } from '@/lib/birdnet/model';
import { createRecorderWorkletUrl } from '@/lib/audio/recorder-worklet';
import { useSongPlaybackActive } from '@/hooks/useSongPlayback';

export interface RecorderOptions {
  /** Called with a 3-second Float32Array every ~predictEveryMs ms. */
  onChunk: (samples: Float32Array) => void;
  /** How often to emit a chunk for prediction. Default 2000ms. */
  predictEveryMs?: number;
}

export type RecorderErrorKind =
  /** User (or browser policy) denied microphone access. */
  | 'permission-denied'
  /** No microphone hardware was found on this device. */
  | 'no-device'
  /** Mic exists but is being held by another application. */
  | 'device-busy'
  /** getUserMedia isn't available (e.g. insecure context, old browser). */
  | 'unsupported'
  /** Anything else — surface the raw message. */
  | 'other';

interface RecorderState {
  isRecording: boolean;
  error: string | null;
  errorKind: RecorderErrorKind | null;
}

/**
 * Classify a getUserMedia failure into a small set of cases the UI can
 * branch on. Browsers vary in the exact DOMException names they throw so we
 * also sniff the message as a fallback.
 */
function classifyRecorderError(err: unknown): RecorderErrorKind {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'permission-denied';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'no-device';
      case 'NotReadableError':
      case 'AbortError':
        return 'device-busy';
      case 'TypeError':
        return 'unsupported';
    }
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('permission') || msg.includes('denied') || msg.includes('not allowed')) {
    return 'permission-denied';
  }
  if (msg.includes('not found') || msg.includes('no device')) {
    return 'no-device';
  }
  return 'other';
}

export function useAudioRecorder({ onChunk, predictEveryMs = 2000 }: RecorderOptions) {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    error: null,
    errorKind: null,
  });

  // Refs for things that must survive re-renders without triggering them.
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const bufferRef = useRef<Float32Array>(new Float32Array(BIRDNET_CHUNK_SAMPLES));
  // Write position in the ring buffer — we keep appending mod length.
  const writePosRef = useRef(0);
  // Total samples captured since recording started.
  const totalSamplesRef = useRef(0);
  // Sample count at which we should emit the next chunk.
  const nextEmitAtRef = useRef(0);
  const onChunkRef = useRef(onChunk);

  // Read the shared "is a reference song playing?" flag. Mirrored
  // into a ref so ingestSamples (stable across renders via
  // useCallback) can check it without being re-created on every
  // flip -- recreating ingestSamples would do nothing useful since
  // the AudioWorklet callback holds onto the ORIGINAL reference
  // from when the graph was built (the onmessage handler closes
  // over `ingestSamples` at bind time). A ref read inside the
  // callback is the only reliable way to affect live capture.
  const songPlaybackActive = useSongPlaybackActive();
  const mutedRef = useRef(songPlaybackActive);

  useEffect(() => {
    const wasMuted = mutedRef.current;
    mutedRef.current = songPlaybackActive;

    // Actually silence the mic, don't just drop samples post-
    // capture. Disabling the MediaStreamTrack(s) makes the track
    // emit silence at the hardware level: the AnalyserNode sees
    // zeros (so the visualizer flattens, matching the "muted"
    // reality), the audio graph downstream processes zeros (so
    // BirdNET never sees anything even if our ring-buffer gate
    // below were to somehow fail), and the browser exposes a
    // more honest signal about whether audio is actually being
    // captured. Tracks re-enabling is instant -- no graph
    // rebuild, no getUserMedia reprompt.
    //
    // Guarded by streamRef so we don't try to enumerate tracks
    // when recording hasn't started yet.
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        // Only twiddle when the value actually changes; repeated
        // writes to .enabled are cheap but logging tools
        // sometimes surface them as "track state changed" events.
        if (track.enabled === songPlaybackActive) {
          track.enabled = !songPlaybackActive;
        }
      }
    }

    // Suspend the capture AudioContext entirely while a song
    // plays. Disabling the track alone keeps this context's
    // audio hardware clock running at our forced 48 kHz capture
    // rate; on many platforms (notably macOS/iOS and some
    // Android devices) a live capture context contending with
    // the <audio> element's playback forces the OS audio engine
    // to run two clocks / resample on the output path, which is
    // audible as the "crunchy"/crackling distortion in the bird
    // sound. Suspending releases that contention so playback is
    // clean. resume() on un-mute reactivates the existing graph
    // instantly -- no rebuild, no getUserMedia reprompt. The
    // promises can reject if the context was closed out from
    // under us (e.g. stop() raced the toggle); swallow those.
    const ctx = ctxRef.current;
    if (ctx) {
      if (songPlaybackActive) {
        if (ctx.state === 'running') {
          void ctx.suspend().catch(() => {});
        }
      } else {
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
      }
    }

    // On un-mute: reset the ring-buffer state so we don't emit a
    // chunk built from stale pre-mute audio the moment playback
    // ends. Otherwise a user who toggles playback briefly would
    // immediately get a prediction on a rolling window whose
    // middle is speaker feedback that leaked through before our
    // mute flag flipped. Resetting the emit schedule guarantees a
    // fresh 3 seconds of post-mute audio before the next call to
    // onChunk -- the next emit fires at total + chunk_samples.
    if (wasMuted && !songPlaybackActive) {
      writePosRef.current = 0;
      bufferRef.current.fill(0);
      nextEmitAtRef.current = totalSamplesRef.current + BIRDNET_CHUNK_SAMPLES;
    }
  }, [songPlaybackActive]);

  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  const ingestSamples = useCallback(
    (samples: Float32Array) => {
      // Drop everything coming from the mic while a reference
      // song is playing. This is the point where ingestion is
      // cheapest to short-circuit -- samples haven't hit the ring
      // buffer yet, so there's nothing to unwind. See the header
      // comment for why this matters (speaker feedback loop).
      //
      // Note: we DON'T count these samples in totalSamplesRef.
      // That counter represents "bird-audio time observed", which
      // conceptually pauses during playback. Keeping it frozen
      // means the emit schedule (nextEmitAtRef) stays valid when
      // we come back -- it's expressed in the same frozen clock.
      if (mutedRef.current) return;

      const buffer = bufferRef.current;
      const len = buffer.length;

      // Append to ring buffer
      let writePos = writePosRef.current;
      for (let i = 0; i < samples.length; i++) {
        buffer[writePos] = samples[i];
        writePos++;
        if (writePos >= len) writePos = 0;
      }
      writePosRef.current = writePos;
      totalSamplesRef.current += samples.length;

      // Emit a 3-second chunk if we've accumulated enough time.
      const total = totalSamplesRef.current;
      if (total >= BIRDNET_CHUNK_SAMPLES && total >= nextEmitAtRef.current) {
        // Copy the ring buffer out in chronological order
        const out = new Float32Array(len);
        const start = writePos; // write position is the oldest sample
        for (let i = 0; i < len; i++) {
          out[i] = buffer[(start + i) % len];
        }
        onChunkRef.current(out);
        const emitIntervalSamples = Math.max(
          1,
          Math.round((predictEveryMs / 1000) * BIRDNET_SAMPLE_RATE),
        );
        nextEmitAtRef.current = total + emitIntervalSamples;
      }
    },
    [predictEveryMs],
  );

  const stop = useCallback(() => {
    if (workletRef.current) {
      workletRef.current.port.onmessage = null;
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (scriptNodeRef.current) {
      scriptNodeRef.current.onaudioprocess = null;
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current);
      workletUrlRef.current = null;
    }
    bufferRef.current = new Float32Array(BIRDNET_CHUNK_SAMPLES);
    writePosRef.current = 0;
    totalSamplesRef.current = 0;
    nextEmitAtRef.current = 0;
    setState({ isRecording: false, error: null, errorKind: null });
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      streamRef.current = stream;

      // If a reference song is already playing when capture
      // starts, apply the current mute state to the fresh tracks
      // immediately. Without this, a user who somehow triggered
      // playback before the mic came online would get a brief
      // window of live capture feeding the graph.
      if (mutedRef.current) {
        for (const track of stream.getTracks()) {
          track.enabled = false;
        }
      }

      // Try to create a 48 kHz context so we don't have to resample in JS.
      // Firefox and Chrome both honor this; Safari falls back silently to
      // the hardware rate, in which case we'd need to resample. For now,
      // assume 48 kHz is respected and warn otherwise.
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtor({ sampleRate: BIRDNET_SAMPLE_RATE });
      ctxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Fan the source out to an AnalyserNode so the visualizer can read
      // audio data without interfering with the BirdNET pipeline. A
      // MediaStreamSource can drive any number of downstream nodes in
      // parallel, so this doesn't affect the samples the worklet receives.
      // fftSize 1024 gives us 1024 time-domain samples per frame (~21 ms
      // at 48 kHz) — enough window for the squiggle visualizer to sample
      // across spatially without the read becoming a bottleneck.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      if (ctx.audioWorklet) {
        const url = createRecorderWorkletUrl();
        workletUrlRef.current = url;
        await ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(ctx, 'recorder-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
        });
        node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
          ingestSamples(ev.data);
        };
        source.connect(node);
        workletRef.current = node;
      } else {
        // Fallback for older browsers.
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          const channel = e.inputBuffer.getChannelData(0);
          // Copy because the buffer is reused on the next callback.
          ingestSamples(new Float32Array(channel));
        };
        source.connect(node);
        node.connect(ctx.destination);
        scriptNodeRef.current = node;
      }

      // If a reference song is already playing when capture
      // starts, suspend the freshly-built context immediately so
      // it doesn't contend with playback (same rationale as the
      // mute effect above). The mute effect re-runs on the next
      // toggle to resume it.
      if (mutedRef.current && ctx.state === 'running') {
        void ctx.suspend().catch(() => {});
      }

      setState({ isRecording: true, error: null, errorKind: null });
    } catch (err) {
      stop();
      setState({
        isRecording: false,
        error: err instanceof Error ? err.message : String(err),
        errorKind: classifyRecorderError(err),
      });
    }
  }, [ingestSamples, stop]);

  // Clean up if the component unmounts mid-recording.
  useEffect(() => {
    return () => stop();
  }, [stop]);

  // Stable getter for the AnalyserNode. Returns null whenever we're not
  // actively capturing audio. Consumers (e.g. the visualizer) should call
  // this inside a requestAnimationFrame loop rather than treating it as
  // reactive — the ref identity never triggers re-renders.
  const getAnalyser = useCallback(() => analyserRef.current, []);

  // Memoize the returned object so consumers (PlayerBar, Index's effects)
  // can rely on stable identity across renders where the recorder state
  // hasn't actually changed. Previously this was `{ ...state, ... }`
  // inline, which allocated a new object on every render and broke any
  // downstream React.memo / dependency-array comparisons.
  return useMemo(
    () => ({
      isRecording: state.isRecording,
      error: state.error,
      errorKind: state.errorKind,
      start,
      stop,
      getAnalyser,
    }),
    [state.isRecording, state.error, state.errorKind, start, stop, getAnalyser],
  );
}
