// Single squiggly line that lives in place and wiggles in response to
// audio. Not a scrolling history — the whole line reacts to "now". Each
// control point is a damped spring driven by the current audio frame, so
// the line feels physical and bouncy rather than snapping to instantaneous
// values.
//
// Design:
//   - N control points spread horizontally across the canvas.
//   - Each point's target y is derived from a distinct slice of the live
//     time-domain waveform — this spatializes the motion so the line
//     squirms instead of moving in unison.
//   - Each point tracks its target via a damped spring (velocity + spring
//     restoring force + damping). Spring physics is what gives the line
//     its "alive" feel.
//   - A light spatial smoothing pass each frame keeps neighbors roughly
//     coherent so we get a continuous curvy line, not high-frequency hash.
//   - Overall deflection is scaled by the current RMS so loud moments
//     swell the whole line (the "bouncy whole-widget" feel you'd have
//     gotten from a collective bar visualizer).
//   - Drawn as a single smooth Catmull-Rom-ish curve through the points
//     using quadratic midpoint interpolation — one crisp line, no fill.
//   - On pause: target goes to zero immediately, but the springs carry
//     the existing motion and settle naturally to flat. So the flat line
//     arrives "smoothly but soon", exactly as requested.
//
// Reads from the AnalyserNode in a requestAnimationFrame loop — bypasses
// React entirely so we don't re-render at 60 Hz.
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface AudioVisualizerProps {
  /** Returns the current AnalyserNode, or null if capture isn't active. */
  getAnalyser: () => AnalyserNode | null;
  /**
   * When false, the springs' targets fall to zero and the line settles to
   * a flat baseline (smoothly, via physics). Used for paused / loading /
   * error states.
   */
  active: boolean;
  className?: string;
  /** Accent color for the line in light mode. */
  colorLight?: string;
  /** Accent color for the line in dark mode. */
  colorDark?: string;
  /** Number of control points. ~60 gives a smooth curve without jitter. */
  points?: number;
}

export function AudioVisualizer({
  getAnalyser,
  active,
  className,
  colorLight = 'rgb(4 120 87)', // emerald-700
  colorDark = 'rgb(252 211 77)', // amber-300
  points = 60,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // All mutable per-frame state lives in refs so the RAF loop never forces
  // a React re-render.
  const rafRef = useRef<number | null>(null);
  // Current y-offset of each control point (in the range roughly [-1, 1]).
  const positionsRef = useRef<Float32Array>(new Float32Array(points));
  // Velocity of each control point — spring physics state.
  const velocitiesRef = useRef<Float32Array>(new Float32Array(points));
  // Time-domain buffer we read into each frame.
  const timeDataRef = useRef<Float32Array | null>(null);
  const lastAnalyserRef = useRef<AnalyserNode | null>(null);
  // Smoothed envelope (RMS) used to scale the whole line.
  const envelopeRef = useRef(0);
  // Last frame timestamp for dt-correct spring integration.
  const lastTsRef = useRef<number | null>(null);

  // Respect the user's motion preferences. For reduced-motion we still
  // draw once (so the widget isn't blank) but don't animate.
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Cached CSS dimensions of the canvas. `getBoundingClientRect` was
    // previously read every frame from inside `draw()` — the trace showed
    // it accounting for ~130ms of main-thread self-time across a 16-second
    // recording (~8ms/s). Since the ResizeObserver tells us exactly when
    // the canvas changes size, we can cache width/height and have the RAF
    // loop read from the cache instead.
    let cssW = 0;
    let cssH = 0;

    // DPR-aware sizing so the line stays crisp on retina displays.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // CSS-class theme detection so the line recolors on light/dark toggle.
    const isDark = () => document.documentElement.classList.contains('dark');

    /**
     * Compute RMS over the current audio frame. Returns roughly [0, 1]
     * for normal mic input. Used to scale the whole line's deflection.
     */
    const computeRms = (buf: Float32Array): number => {
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = buf[i];
        sumSq += s * s;
      }
      return Math.sqrt(sumSq / buf.length);
    };

    /**
     * Sample the time-domain waveform at N evenly-spaced positions and
     * fill `targets` with a per-point y-offset.
     *
     * Earlier versions averaged the samples inside each window, but the
     * time-domain buffer oscillates around zero — averaging 10–20 of its
     * samples is effectively a low-pass that collapses everything to ~0,
     * which is why the line looked perfectly flat. Instead, we take the
     * *peak* sample (by absolute value, preserving sign) in each window,
     * which gives each control point a sense of "how far did this slice
     * of the waveform deflect this frame". That produces a lively, non-
     * zero target even for quiet audio and varies meaningfully across
     * the line so the squiggle has spatial structure.
     *
     * An idle "breathing" term (four overlapping sines) adds gentle
     * motion so the line doesn't feel dead when there's mild ambient
     * sound. Its amplitude is gated by `idleGain` — when the audio
     * envelope falls to effectively zero (total silence / muted input),
     * the gate closes and the line settles to a perfectly flat,
     * unmoving baseline. This matches the behavior of a real oscilloscope
     * showing silent input.
     */
    const sampleTargets = (
      buf: Float32Array,
      targets: Float32Array,
      timeSec: number,
      idleGain: number,
    ): void => {
      const n = targets.length;
      const bufLen = buf.length;
      const windowSize = Math.max(1, Math.floor(bufLen / n));
      for (let i = 0; i < n; i++) {
        const start = Math.min(bufLen - 1, Math.floor((i / n) * bufLen));
        const end = Math.min(bufLen, start + windowSize);
        // Peak by absolute value, preserving sign — captures the biggest
        // deflection in this slice of the waveform.
        let peak = 0;
        for (let j = start; j < end; j++) {
          const v = buf[j];
          if (Math.abs(v) > Math.abs(peak)) peak = v;
        }
        // Idle breathing: four overlapping sines at different rates,
        // each with a per-point phase offset that winds across the line
        // several times. High spatial frequencies (winding 5–8× across
        // the line) produce visible local crests and troughs so the
        // shape looks like rolling surf, not a lazy curve. Only computed
        // when `idleGain` > 0 so total silence produces a truly flat line.
        let idle = 0;
        if (idleGain > 0) {
          const phase = (i / n) * Math.PI * 2;
          idle =
            (0.45 * Math.sin(timeSec * 2.1 + phase * 3.0) +
              0.30 * Math.sin(timeSec * 0.9 + phase * 5.0) +
              0.22 * Math.sin(timeSec * 3.4 + phase * 7.0) +
              0.15 * Math.sin(timeSec * 5.7 + phase * 8.0)) *
            idleGain;
        }
        // Very heavy amplification on the audio peak so normal mic
        // levels (~±0.1) produce dramatic, unmissable waves on top of
        // the idle motion. Soft-clipped downstream.
        targets[i] = peak * 14 + idle;
      }
    };

    // Reusable buffer for this frame's target offsets. Allocated once and
    // refilled each tick to avoid GC pressure.
    const targetBuffer = new Float32Array(points);

    /**
     * Spring physics step. For each point, integrate a damped harmonic
     * oscillator toward its target:
     *   force     = stiffness * (target - position)
     *   velocity += force * dt - damping * velocity * dt
     *   position += velocity * dt
     *
     * Stiffness and damping are tuned so a point reaches a new target in
     * a few hundred ms with a tiny overshoot — visibly bouncy but not
     * obnoxiously wobbly. After the spring step we run a single 3-tap
     * spatial smoothing pass so neighbors stay coherent and the line
     * looks continuous.
     */
    const step = (
      targets: Float32Array,
      envelope: number,
      dtSec: number,
    ): void => {
      const positions = positionsRef.current;
      const velocities = velocitiesRef.current;
      const n = positions.length;

      // Clamp dt: if the tab was backgrounded dt can jump and the explicit
      // Euler integrator below goes unstable. 32ms (~2 frames) is a safe
      // ceiling — springs just take an extra frame or two to catch up.
      const dt = Math.min(0.032, Math.max(0.001, dtSec));

      // Springs tuned for vigorous motion. Stiff + lightly damped =
      // fast tracking with pronounced overshoot, so targets don't get
      // visually averaged out by the integrator. Damping ratio here
      // ≈ 0.22 (clearly underdamped) — the line rings around its
      // target instead of easing in. Natural freq ~3.6 Hz settles in
      // ~300 ms, so idle sines at 2–6 Hz are tracked faithfully.
      const stiffness = 520;
      const damping = 10;

      // Envelope lifts deflection on loud moments (the "whole line
      // swells" effect). Base gain 1 keeps idle breathing visible. When
      // inactive, envelope and targets are both zero and the line
      // naturally settles flat via the damping term.
      const gain = 1 + envelope * 3;
      for (let i = 0; i < n; i++) {
        // Soft-clip the target into roughly [-1, 1] with tanh so loud
        // moments produce dramatic waves without shooting clear off the
        // canvas. Quiet and medium signals pass through near-linearly;
        // only extreme peaks get compressed.
        const raw = targets[i] * gain;
        const target = Math.tanh(raw);
        const x = positions[i];
        const v = velocities[i];
        const force = stiffness * (target - x) - damping * v;
        const newV = v + force * dt;
        const newX = x + newV * dt;
        velocities[i] = newV;
        positions[i] = newX;
      }

      // No spatial smoothing pass. Earlier versions averaged each point
      // with its neighbors every frame, which was a strong low-pass on
      // the line's shape and collapsed the waves into a gentle curve.
      // The midpoint-quadratic curve used by the draw step already
      // handles visual continuity between control points, so we can
      // keep the raw spring positions and let the waves breathe.
    };

    /**
     * Draw a smooth curve through the control points using midpoint
     * quadratic interpolation. For each segment, the control vertex is
     * the actual point and the curve endpoints are the midpoints of the
     * neighboring segments — this is the cheap, reliable way to get
     * Catmull-Rom-style smoothness without sharp kinks at the vertices.
     */
    const draw = () => {
      // Read cached dimensions rather than calling getBoundingClientRect
      // per frame. The ResizeObserver above keeps cssW/cssH up to date.
      const w = cssW;
      const h = cssH;
      ctx.clearRect(0, 0, w, h);

      const positions = positionsRef.current;
      const n = positions.length;
      if (n < 2) return;

      const color = isDark() ? colorDark : colorLight;
      const mid = h / 2;
      // Use nearly the full height. Targets are soft-clipped to ±1, so
      // peaks will land within the canvas even at full amplitude.
      const amp = (h / 2) * 0.95;

      // Helper: canvas coordinates for point i.
      const xOf = (i: number) => (i / (n - 1)) * w;
      const yOf = (i: number) => mid - positions[i] * amp;

      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;

      ctx.beginPath();
      ctx.moveTo(xOf(0), yOf(0));
      for (let i = 1; i < n - 1; i++) {
        const xc = (xOf(i) + xOf(i + 1)) / 2;
        const yc = (yOf(i) + yOf(i + 1)) / 2;
        ctx.quadraticCurveTo(xOf(i), yOf(i), xc, yc);
      }
      // Final segment: straight line to the last point.
      ctx.lineTo(xOf(n - 1), yOf(n - 1));
      ctx.stroke();
    };

    const tick = (ts: number) => {
      const analyser = getAnalyser();

      // Establish dt from real wall-clock time so spring physics behaves
      // consistently across 60 / 90 / 120 Hz displays and visible/hidden
      // tab transitions.
      const lastTs = lastTsRef.current;
      lastTsRef.current = ts;
      const dt = lastTs == null ? 1 / 60 : (ts - lastTs) / 1000;

      // Refresh the time-domain buffer whenever the analyser changes
      // (pause→resume recreates the AudioContext + analyser).
      if (
        active &&
        analyser &&
        (lastAnalyserRef.current !== analyser ||
          !timeDataRef.current ||
          timeDataRef.current.length !== analyser.fftSize)
      ) {
        timeDataRef.current = new Float32Array(analyser.fftSize);
        lastAnalyserRef.current = analyser;
      }

      // Build this frame's targets + envelope.
      const timeSec = ts / 1000;
      let envelope: number;
      if (active && analyser && timeDataRef.current) {
        const buf = timeDataRef.current;
        // Same ArrayBuffer-generic cast trick used elsewhere — the lib.dom
        // typings are stricter than what the runtime requires.
        analyser.getFloatTimeDomainData(
          buf as unknown as Float32Array<ArrayBuffer>,
        );

        // Gain curve on the envelope: pow < 1 lifts quiet sounds into the
        // visible range; the scalar tunes overall liveliness. Clamped to
        // 1 so very loud events don't send the whole line off-screen.
        const rms = computeRms(buf);
        const raw = Math.min(1, Math.pow(Math.min(1, rms * 2.2), 0.65));
        // Smooth the envelope so it pumps a bit rather than flickering on
        // every impulse.
        envelope = envelopeRef.current * 0.75 + raw * 0.25;
        envelopeRef.current = envelope;

        // Idle breathing gate: if the raw signal level is below the noise
        // floor of a muted / silent mic, close the gate entirely so the
        // line is flat and unmoving. A soft ramp between `silenceFloor`
        // and `silenceCeil` avoids popping when real audio returns.
        // Values chosen so a muted input (rms < ~0.001) reads as silent
        // while normal room ambience (rms > ~0.005) keeps the idle
        // motion alive.
        const silenceFloor = 0.001;
        const silenceCeil = 0.005;
        const idleGain =
          rms <= silenceFloor
            ? 0
            : rms >= silenceCeil
              ? 1
              : (rms - silenceFloor) / (silenceCeil - silenceFloor);

        sampleTargets(buf, targetBuffer, timeSec, idleGain);
      } else {
        // Not active: every target goes to zero AND the envelope decays.
        // Springs carry any existing motion and settle smoothly to flat.
        for (let i = 0; i < points; i++) targetBuffer[i] = 0;
        envelope = envelopeRef.current * 0.85;
        envelopeRef.current = envelope;
      }

      step(targetBuffer, envelope, dt);
      draw();

      if (!prefersReducedMotion) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    if (prefersReducedMotion) {
      // One static frame (just the flat baseline) and bail.
      draw();
    } else {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      ro.disconnect();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
    };
  }, [active, colorDark, colorLight, getAnalyser, points, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('block h-full w-full', className)}
    />
  );
}
