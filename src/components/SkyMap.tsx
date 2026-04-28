import { useEffect, useMemo, useRef, useState } from "react";
import type { Star } from "@/lib/stars";
import { STARS, bvToColor } from "@/lib/stars";
import { equatorialToHorizontal } from "@/lib/astronomy";
import { altAzToVector, vectorToAltAz } from "@/lib/astronomy";
import { moonPhase, moonPosition } from "@/lib/moon";
import { sunPosition } from "@/lib/sun";
import { PLANETS, planetPosition, type PlanetId, type PlanetInfo } from "@/lib/planets";
import { convexHull, pointInPolygon, pointToSegmentDistance } from "@/lib/geometry";

/**
 * A constellation overlay (user-drawn or built-in). Each entry is a list
 * of HIP-number pairs and an optional title for labelling. Rendered with
 * a distinctive accent color so they read as added-on figures rather
 * than part of the canonical star catalog.
 */
export interface CustomConstellationOverlay {
  id: string;
  title: string;
  edges: Array<[number, number]>;
  /** Optional — if present, highlights this overlay more strongly. */
  highlight?: boolean;
  /** Author display (shown under the title). */
  byline?: string;
  /**
   * Visual style. `"custom"` (default) is the violet dashed look used
   * for user-drawn constellations; `"zodiac"` uses a warmer gold tone
   * and a solid line to mark the built-in astrological signs as a
   * separate, authoritative layer. Identical hit-test behaviour.
   */
  variant?: "custom" | "zodiac";
}

interface SkyMapProps {
  latitude: number;
  longitude: number;
  /** Azimuth (deg, 0=N) the phone's BACK is pointing */
  azimuth: number;
  /** Altitude (deg) the phone's BACK is pointing */
  altitude: number;
  /** Roll in degrees (rotation around viewing axis) */
  roll: number;
  /** Field of view in degrees for the screen diagonal */
  fov?: number;
  /** Whether to show star names */
  showNames?: boolean;
  /** Override the date used for celestial calculations */
  date?: Date;
  /** Called when user taps a star */
  onSelectStar?: (star: Star) => void;
  /**
   * Called when the user taps on (or near) one of the rendered custom
   * constellations. Receives the overlay `id` (pubkey:d). Constellation
   * hits take priority over star hits, so a tap on a constellation line
   * won't also fire `onSelectStar` — unless drawing mode is on, in which
   * case constellation hit-testing is skipped entirely so every tap
   * reliably adds a star to the chain.
   */
  onSelectConstellation?: (id: string) => void;
  /** Called when user pinches to change FOV. Receives the new FOV (clamped). */
  onFovChange?: (fov: number) => void;
  /** Minimum FOV allowed when pinching */
  minFov?: number;
  /** Maximum FOV allowed when pinching */
  maxFov?: number;
  /**
   * Called when the user drags on the canvas to pan the view. Receives the
   * delta in azimuth and altitude degrees (signed). The consumer is
   * responsible for applying these to its view-state and handling wrap /
   * clamp as appropriate.
   */
  onPan?: (dAzDeg: number, dAltDeg: number) => void;
  /** Called when a pan drag starts. */
  onPanStart?: () => void;
  /**
   * Called when a pan drag ends. `canceled` is `true` if the pan was
   * abandoned because it turned into a multi-touch pinch gesture (so the
   * consumer can skip any "user just panned, hold off sensors" cooldown
   * it would normally apply for a deliberate pan).
   */
  onPanEnd?: (opts?: { canceled?: boolean }) => void;
  /** User-drawn constellation overlays to render beneath the stars. */
  customConstellations?: CustomConstellationOverlay[];
  /**
   * Drawing mode: when true, onSelectStar is called normally but the SkyMap
   * also renders the list of `drawingStars` as a chain — each consecutive
   * pair is a line — plus a dotted line from the last star to the centre
   * of the view, so the user can see exactly what they're sketching as
   * they move.
   */
  drawingMode?: boolean;
  /** Ordered list of HIP catalog numbers currently being chained in draw mode. */
  drawingStars?: number[];
  /**
   * Called when the user taps the Moon's disk. The Moon is drawn visibly
   * larger than its true angular diameter so this is a deliberately
   * forgiving target. Skipped while `drawingMode` is on so the Moon
   * can't hijack a star-picking tap.
   */
  onSelectMoon?: () => void;
  /**
   * Called when the user taps the Sun's disk. Like the Moon, the Sun is
   * drawn visibly larger than its ~0.5° true diameter and rendered even
   * when below the horizon, so the touch target is always reachable.
   * Skipped while `drawingMode` is on.
   */
  onSelectSun?: () => void;
  /**
   * Called when the user taps one of the rendered planet disks. Planets
   * are drawn visibly larger than their true angular diameter (which is
   * usually well under 0.02°) — just like the Sun and Moon — so the
   * touch target is generous. Skipped while `drawingMode` is on so a
   * planet can't intercept a star-picking tap.
   */
  onSelectPlanet?: (id: PlanetId) => void;
}

interface ScreenStar {
  star: Star;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  inView: boolean;
  alt: number;
  az: number;
  /**
   * Screen-space rectangle covering the star's rendered name label, if
   * a label was drawn this frame. Measured during the render pass with
   * `ctx.measureText` so the pointer handler can extend the tap target
   * to include the name — tapping "Sirius" selects Sirius. `undefined`
   * when the star was below the label magnitude threshold, had no
   * name, or labels were disabled entirely. Coordinates are in CSS
   * pixels, matching the pointer-event coordinate space.
   */
  label?: { x: number; y: number; w: number; h: number };
}

/**
 * Screen-space rectangle covering a solar-system body's rendered name
 * label. Same purpose and coordinate system as `ScreenStar.label` — we
 * store these on the luminary / planet footprint caches so a tap
 * landing on "Moon", "Sun", "Mars", etc. counts as a hit on that body
 * rather than falling through to stars or constellations behind the
 * text.
 */
interface ScreenLabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A single projected edge of a custom constellation, kept around after
 * rendering so that pointer taps can find which overlay they hit.
 * Coordinates are already in CSS pixels (same space as pointer events).
 */
interface ScreenConstellationEdge {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * A constellation overlay's tappable catchment area, derived from the
 * projected star positions after rendering. The convex hull is used as
 * a fallback hit region when a tap doesn't land close to any edge but
 * does fall *inside* the figure (e.g. the middle of Cancer's Y). The
 * centroid gives us a deterministic tiebreaker when a tap sits inside
 * multiple overlapping hulls.
 */
interface ScreenConstellationHull {
  id: string;
  /** Screen-space convex hull points in CCW or CW order. */
  points: Array<{ x: number; y: number }>;
  /** Centroid of the hull points (mean), used for tiebreaking. */
  cx: number;
  cy: number;
  /** Axis-aligned bounding box for fast reject before the polygon test. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const DEG = Math.PI / 180;

/** Project a world unit vector onto 2D screen coords relative to the view direction. */
function project(
  vec: [number, number, number],
  viewDir: [number, number, number],
  upDir: [number, number, number],
  rightDir: [number, number, number],
  focalLength: number,
): { x: number; y: number; z: number } {
  // Stereographic projection from the sphere onto a plane.
  //
  // The sphere is projected from the point diametrically opposite the
  // view direction onto the plane through the center of the sphere that
  // is perpendicular to the view direction. This is angle-preserving,
  // stays finite for every FOV < 360°, and degrades gracefully near the
  // antipode (the one point that can't be projected).
  //
  // We keep the returned `z` as the forward dot-product so callers can
  // still use it as a "is this point near the antipode?" guard. A value
  // of z = 1 means dead ahead, z = 0 is 90° off-axis, z = -1 is directly
  // behind (the singular point).
  const z = vec[0] * viewDir[0] + vec[1] * viewDir[1] + vec[2] * viewDir[2];
  const rx = vec[0] * rightDir[0] + vec[1] * rightDir[1] + vec[2] * rightDir[2];
  const ry = vec[0] * upDir[0] + vec[1] * upDir[1] + vec[2] * upDir[2];
  // Denominator (1 + z) vanishes at the exact antipode; clamp to avoid
  // divide-by-zero / Infinity. Any nearly-antipodal point will project
  // to a huge radius, which naturally falls off-screen and gets culled.
  const denom = 1 + z;
  if (denom < 1e-4) {
    return { x: rx * 1e6, y: ry * 1e6, z };
  }
  const s = (2 * focalLength) / denom;
  return { x: rx * s, y: ry * s, z };
}

function magnitudeToRadius(mag: number): number {
  // Brighter (lower mag) = bigger. Clamp at reasonable range.
  const m = Math.max(-2, Math.min(5, mag));
  return Math.max(0.6, 4.2 - m * 0.7);
}

function magnitudeToAlpha(mag: number): number {
  const m = Math.max(-2, Math.min(6, mag));
  return Math.max(0.25, 1 - m * 0.12);
}

/**
 * Rotate vector `v` around unit-axis `k` by `angleRad` radians using
 * Rodrigues' rotation formula. Used by the drag-to-pan logic so that
 * screen drags become proper 3D rotations of the view direction rather
 * than linear alt/az increments (which degenerate near the poles).
 */
function rotateAroundAxis(
  v: [number, number, number],
  k: [number, number, number],
  angleRad: number,
): [number, number, number] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  // cross = k × v
  const cross: [number, number, number] = [
    k[1] * v[2] - k[2] * v[1],
    k[2] * v[0] - k[0] * v[2],
    k[0] * v[1] - k[1] * v[0],
  ];
  return [
    v[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + k[2] * dot * (1 - c),
  ];
}

export function SkyMap({
  latitude,
  longitude,
  azimuth,
  altitude,
  roll,
  fov = 75,
  showNames = true,
  date,
  onSelectStar,
  onSelectConstellation,
  onFovChange,
  minFov = 20,
  maxFov = 280,
  onPan,
  onPanStart,
  onPanEnd,
  customConstellations,
  drawingMode = false,
  drawingStars,
  onSelectMoon,
  onSelectSun,
  onSelectPlanet,
}: SkyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Recompute star sky positions every ~2 seconds (time moves slowly)
  const [now, setNow] = useState<Date>(date ?? new Date());
  useEffect(() => {
    if (date) {
      setNow(date);
      return;
    }
    const id = window.setInterval(() => setNow(new Date()), 2000);
    return () => window.clearInterval(id);
  }, [date]);

  // Compute horizontal coordinates of all stars for this location/time
  const starHorz = useMemo(() => {
    return STARS.map((s) => {
      const h = equatorialToHorizontal(s.ra, s.dec, latitude, longitude, now);
      return { star: s, ...h };
    });
  }, [latitude, longitude, now]);

  // Compute the Moon's position and phase for this location/time. This is
  // recomputed on the same ~2s tick as the stars. The Moon moves ~0.5°
  // per hour across the sky (about its own diameter), so the cadence is
  // more than enough for a snappy, jitter-free display.
  const moonState = useMemo(() => {
    const pos = moonPosition(now);
    const horz = equatorialToHorizontal(pos.ra, pos.dec, latitude, longitude, now);
    const phase = moonPhase(now, pos);
    return { pos, horz, phase };
  }, [latitude, longitude, now]);

  // Compute the Sun's position for this location/time on the same ~2s
  // tick as the Moon and stars. The Sun moves ~15°/hour in azimuth near
  // the equator (its own diameter every 2 minutes), so this cadence is
  // ample for a smooth display.
  const sunState = useMemo(() => {
    const pos = sunPosition(now);
    const horz = equatorialToHorizontal(pos.ra, pos.dec, latitude, longitude, now);
    return { pos, horz };
  }, [latitude, longitude, now]);

  // Compute each planet's apparent horizontal position on the same ~2s
  // tick. Planets move slowly against the stars (Jupiter: ~1°/month;
  // Mercury: ~1.3°/day at max) — the dominant motion on screen is just
  // the Earth's rotation, which the Sun/Moon/star cadence already
  // handles well. We keep the list ordered the same way as the PLANETS
  // table so the renderer draws outer planets first (behind closer
  // ones at any conjunction), while still drawing them all above the
  // Sun and below the Moon in z-order.
  const planetStates = useMemo(() => {
    return PLANETS.map((info) => {
      const pos = planetPosition(info.id, now);
      const horz = equatorialToHorizontal(pos.ra, pos.dec, latitude, longitude, now);
      return { info, pos, horz };
    });
  }, [latitude, longitude, now]);

  const starByHip = useMemo(() => {
    const m = new Map<number, (typeof starHorz)[number]>();
    for (const s of starHorz) {
      m.set(s.star.hip, s);
    }
    return m;
  }, [starHorz]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute current on-screen stars (for hit-testing and rendering)
  const screenStarsRef = useRef<ScreenStar[]>([]);

  // Cache of projected constellation edge segments for hit-testing.
  // Populated by the render effect on every draw so that taps can map
  // pixel coordinates back to the overlay id without re-running the
  // 3D projection in the pointer handler.
  const screenConstellationsRef = useRef<ScreenConstellationEdge[]>([]);

  // Per-overlay convex hulls (one entry per visible constellation)
  // derived from the same projected star positions. Used as a fallback
  // hit region so taps landing *inside* a figure — not near any single
  // edge — still register on the intended constellation. Without this,
  // the whole interior of a sparse figure like Cancer or Cassiopeia is
  // dead zone.
  const screenConstellationHullsRef = useRef<ScreenConstellationHull[]>([]);

  // Cache of the Moon's projected disk for hit-testing. `null` when the
  // Moon is off-screen (projected behind the viewer) or otherwise not
  // rendered. Like the other screen caches, this is refreshed on every
  // draw so pointer handlers never work from stale projection math.
  // The Moon is drawn regardless of horizon position, so the below-
  // horizon state is NOT a null case.
  const screenMoonRef = useRef<
    { x: number; y: number; r: number; label?: ScreenLabelRect } | null
  >(null);
  /** Same, for the Sun. See notes above — always rendered when on-screen. */
  const screenSunRef = useRef<
    { x: number; y: number; r: number; label?: ScreenLabelRect } | null
  >(null);
  /**
   * Same, for each rendered planet. Only entries whose disk landed in
   * the visible canvas are pushed; off-screen or behind-the-viewer
   * planets are omitted. Refreshed every frame so pointer logic never
   * works against stale projection math.
   */
  const screenPlanetsRef = useRef<
    Array<{
      id: PlanetId;
      x: number;
      y: number;
      r: number;
      label?: ScreenLabelRect;
    }>
  >([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = size.w;
    const h = size.h;
    if (w === 0 || h === 0) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background gradient (deep night sky)
    // We subtly tint the lower portion toward an earthy brown to indicate
    // "below horizon" — reinforced later by a darker overlay in that region.
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, "#0b1026");
    bgGrad.addColorStop(0.55, "#05070f");
    bgGrad.addColorStop(1, "#03040a");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Build camera basis vectors
    const view = altAzToVector(altitude, azimuth);

    // "World up" that we'd like on screen is celestial up (z axis), but when
    // looking near zenith we need a fallback. Use the projection of world up
    // onto the plane perpendicular to view.
    const worldUp: [number, number, number] = [0, 0, 1];
    const dotVU = view[0] * worldUp[0] + view[1] * worldUp[1] + view[2] * worldUp[2];
    let up: [number, number, number] = [
      worldUp[0] - view[0] * dotVU,
      worldUp[1] - view[1] * dotVU,
      worldUp[2] - view[2] * dotVU,
    ];
    let upLen = Math.hypot(up[0], up[1], up[2]);
    if (upLen < 0.01) {
      // Looking straight up/down: use north as up
      const worldN: [number, number, number] = [0, 1, 0];
      const dotVN = view[0] * worldN[0] + view[1] * worldN[1] + view[2] * worldN[2];
      up = [
        worldN[0] - view[0] * dotVN,
        worldN[1] - view[1] * dotVN,
        worldN[2] - view[2] * dotVN,
      ];
      upLen = Math.hypot(up[0], up[1], up[2]) || 1;
    }
    up = [up[0] / upLen, up[1] / upLen, up[2] / upLen];

    // right = view × up. Using up × view here would horizontally mirror the sky.
    const right: [number, number, number] = [
      view[1] * up[2] - view[2] * up[1],
      view[2] * up[0] - view[0] * up[2],
      view[0] * up[1] - view[1] * up[0],
    ];

    // Apply roll: rotate (up, right) around view by -roll.
    const rRad = -roll * DEG;
    const cr = Math.cos(rRad), sr = Math.sin(rRad);
    const upR: [number, number, number] = [
      up[0] * cr + right[0] * sr,
      up[1] * cr + right[1] * sr,
      up[2] * cr + right[2] * sr,
    ];
    const rightR: [number, number, number] = [
      right[0] * cr - up[0] * sr,
      right[1] * cr - up[1] * sr,
      right[2] * cr - up[2] * sr,
    ];

    // Stereographic focal length for the given diagonal FOV.
    // In a stereographic projection, a half-angle θ from center maps to
    // a planar radius r = 2 * f * tan(θ / 2). We want the screen
    // diagonal to span exactly `fov` degrees, so:
    //   diag / 2 = 2 * f * tan(fov / 4)   ⇒   f = diag / (4 * tan(fov/4))
    // This stays finite for every FOV < 360°.
    const diag = Math.hypot(w, h);
    const focal = diag / (4 * Math.tan((fov * DEG) / 4));

    // FOV-dependent magnitude cut. Our catalog has ~5000 stars down to
    // mag 6 (the naked-eye limit). Drawing all of them at wide FOV is
    // wasted work — tiny dim dots would be invisible anyway — and can
    // cost real frame time on mobile. Narrow FOV (zoomed in) shows
    // everything; wide FOV shows only brighter stars. The curve is
    // tuned to approximate how the eye reads a real sky: at a ~90° FOV
    // you see mag ≤ 4.5; at a ~20° FOV you see everything.
    const maxMag = Math.max(4.5, Math.min(6.5, 6.5 - fov * 0.022));

    // Project stars
    const projected: ScreenStar[] = [];
    for (const { star, alt, az } of starHorz) {
      if (star.mag > maxMag) continue;
      const vec = altAzToVector(alt, az);
      const p = project(vec, view, upR, rightR, focal);
      const sx = w / 2 + p.x;
      const sy = h / 2 - p.y;
      const inView = p.z > -0.9999 && sx >= -50 && sx <= w + 50 && sy >= -50 && sy <= h + 50;
      projected.push({
        star,
        x: sx,
        y: sy,
        radius: magnitudeToRadius(star.mag),
        alpha: magnitudeToAlpha(star.mag),
        inView,
        alt,
        az,
      });
    }
    screenStarsRef.current = projected;

    // --- Below-horizon shading -------------------------------------------
    // Fill the "ground" — the region in screen space whose directions point
    // below the celestial horizon (alt < 0). Stereographic projection maps
    // the horizon to a perfect circle on screen, so we can compute the fill
    // region exactly using the even-odd winding rule:
    //
    //   • Trace the full horizon as one closed subpath.
    //   • If the viewer is looking AT or ABOVE the horizon (alt ≥ 0), the
    //     zenith lies inside the horizon curve → ground is the *outside*
    //     of the curve. Add a full-canvas rectangle as a second subpath so
    //     the even-odd rule fills the outside (rect ⊕ circle = outside).
    //   • If the viewer is looking BELOW the horizon (alt < 0), the nadir
    //     lies inside the horizon curve → ground is the *inside*. Skip the
    //     outer rectangle so only the circle is filled.
    //
    // Degenerate cases:
    //   • Looking essentially straight down (alt ≤ −89.99°): the horizon
    //     curve blows up toward the antipode. Just fill the whole canvas.
    //   • Looking essentially straight up: the horizon is a tiny circle
    //     around the antipode; rect ⊕ circle still does the right thing.
    ctx.save();
    ctx.fillStyle = "rgba(30, 18, 10, 0.35)";

    if (altitude <= -89.99) {
      // Looking at (or past) the nadir — everything on screen is ground.
      ctx.fillRect(0, 0, w, h);
    } else {
      const horizonPts: Array<{ x: number; y: number; valid: boolean }> = [];
      let anyInvalid = false;
      for (let az = 0; az < 360; az += 1) {
        const v = altAzToVector(0, az);
        const p = project(v, view, upR, rightR, focal);
        const valid = p.z > -0.9999;
        if (!valid) anyInvalid = true;
        horizonPts.push({
          x: w / 2 + p.x,
          y: h / 2 - p.y,
          valid,
        });
      }

      if (anyInvalid) {
        // One or more horizon samples landed at the antipodal singularity.
        // This should only happen when looking essentially straight down,
        // which we already handled above — but guard just in case.
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.beginPath();

        // Outer subpath (only when ground is OUTSIDE the horizon curve).
        // Slight overscan so the rect reliably covers any antialias seam.
        if (altitude >= 0) {
          ctx.rect(-10, -10, w + 20, h + 20);
        }

        // Horizon subpath — a single closed loop through all 360 samples.
        ctx.moveTo(horizonPts[0].x, horizonPts[0].y);
        for (let i = 1; i < horizonPts.length; i++) {
          ctx.lineTo(horizonPts[i].x, horizonPts[i].y);
        }
        ctx.closePath();

        ctx.fill("evenodd");
      }
    }
    ctx.restore();

    // --- User-drawn custom constellation overlays ------------------------
    // Rendered under the stars, with a distinct amber/violet tone so they
    // read as "community art" rather than canonical constellation data.
    // Reset the per-frame hit-test cache every render so stale segments
    // from a previous view don't leak into pointer logic.
    const screenEdges: ScreenConstellationEdge[] = [];
    const screenHulls: ScreenConstellationHull[] = [];
    if (customConstellations && customConstellations.length) {
      for (const overlay of customConstellations) {
        const highlight = !!overlay.highlight;
        const isZodiac = overlay.variant === "zodiac";
        ctx.save();
        // Zodiacs get a warm amber tone and a dotted line so they read as
        // built-in / authoritative reference figures without competing
        // visually with real star patterns. Custom user constellations
        // keep their cooler violet dashed look. Highlighted (focused) ones
        // brighten regardless of variant.
        ctx.strokeStyle = highlight
          ? "rgba(255, 200, 120, 0.85)"
          : isZodiac
            ? "rgba(255, 210, 150, 0.55)"
            : "rgba(200, 170, 255, 0.42)";
        ctx.lineWidth = highlight ? 1.8 : isZodiac ? 1.3 : 1.1;
        // Round line caps make [0, N] dashes render as circular dots
        // rather than tiny rectangles, which reads much cleaner on-screen.
        // The surrounding ctx.save/restore pair handles resetting lineCap
        // back to its previous value after this overlay is drawn.
        if (isZodiac) {
          ctx.lineCap = "round";
          // Dot spacing scales slightly with highlight state so focused
          // zodiacs stay visibly dotted without bleeding into a near-
          // solid line.
          ctx.setLineDash([0, highlight ? 6 : 5]);
        } else {
          ctx.setLineDash(highlight ? [] : [4, 4]);
        }
        let labelAnchor: { x: number; y: number } | null = null;
        // Collect every unique endpoint we successfully project for this
        // overlay; used after the edge loop to build a convex-hull hit
        // region for mid-figure taps.
        const overlayPoints: Array<{ x: number; y: number }> = [];
        const seenPointKeys = new Set<string>();
        for (const [a, b] of overlay.edges) {
          const sa = starByHip.get(a);
          const sb = starByHip.get(b);
          if (!sa || !sb) continue;
          // We deliberately do NOT skip edges based on horizon altitude.
          // A constellation that straddles the horizon (e.g. Cancer setting
          // with ι above and α/β well below) must draw every edge so the
          // figure stays intact — the ground shading overlay dims whatever
          // is below horizon. An older cull dropped edges when both endpoints
          // sat below −5° alt, which silently lopped off the bottom of any
          // setting constellation and produced truncated-looking figures.
          // The z-dot cull below still handles the truly-antipodal case.
          const va = altAzToVector(sa.alt, sa.az);
          const vb = altAzToVector(sb.alt, sb.az);
          const pa = project(va, view, upR, rightR, focal);
          const pb = project(vb, view, upR, rightR, focal);
          if (pa.z <= -0.9999 || pb.z <= -0.9999) continue;
          const ax = w / 2 + pa.x;
          const ay = h / 2 - pa.y;
          const bx = w / 2 + pb.x;
          const by = h / 2 - pb.y;
          if (
            (ax < -200 && bx < -200) ||
            (ax > w + 200 && bx > w + 200) ||
            (ay < -200 && by < -200) ||
            (ay > h + 200 && by > h + 200)
          ) {
            continue;
          }
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          // Remember the segment in screen-space for tap hit-testing.
          screenEdges.push({ id: overlay.id, ax, ay, bx, by });
          // Record each endpoint once for the hull build. Keying on a
          // rounded integer coord is plenty — we only need to dedupe
          // obvious repeats, not sub-pixel jitter.
          const keyA = `${Math.round(ax)},${Math.round(ay)}`;
          if (!seenPointKeys.has(keyA)) {
            seenPointKeys.add(keyA);
            overlayPoints.push({ x: ax, y: ay });
          }
          const keyB = `${Math.round(bx)},${Math.round(by)}`;
          if (!seenPointKeys.has(keyB)) {
            seenPointKeys.add(keyB);
            overlayPoints.push({ x: bx, y: by });
          }
          // Remember a midpoint so we can place a label near the figure.
          if (!labelAnchor) {
            labelAnchor = { x: (ax + bx) / 2, y: (ay + by) / 2 };
          }
        }
        ctx.setLineDash([]);

        // Build the convex hull for this overlay. Only meaningful when
        // we have at least 3 projected points — a figure with fewer is
        // well served by the per-edge hit-test alone (there's no real
        // interior to speak of).
        if (overlayPoints.length >= 3) {
          const hullPts = convexHull(overlayPoints);
          if (hullPts.length >= 3) {
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            let sumX = 0;
            let sumY = 0;
            for (const p of hullPts) {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
              sumX += p.x;
              sumY += p.y;
            }
            screenHulls.push({
              id: overlay.id,
              points: hullPts,
              cx: sumX / hullPts.length,
              cy: sumY / hullPts.length,
              minX,
              maxX,
              minY,
              maxY,
            });
          }
        }
        if (labelAnchor && overlay.title) {
          ctx.font = highlight
            ? "bold 12px ui-sans-serif, system-ui, sans-serif"
            : "11px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = highlight
            ? "rgba(255, 220, 160, 0.95)"
            : isZodiac
              ? "rgba(255, 225, 180, 0.85)"
              : "rgba(220, 200, 255, 0.8)";
          ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
          ctx.shadowBlur = 4;
          ctx.fillText(overlay.title, labelAnchor.x, labelAnchor.y - 14);
          if (overlay.byline && highlight) {
            ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
            ctx.fillStyle = "rgba(255, 220, 160, 0.7)";
            ctx.fillText(overlay.byline, labelAnchor.x, labelAnchor.y + 2);
          }
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }
    }
    // Publish the latest hit-test caches for the pointer handler. We
    // do this unconditionally (even when there are no overlays) so
    // stale segments/hulls from a previous frame are always cleared.
    screenConstellationsRef.current = screenEdges;
    screenConstellationHullsRef.current = screenHulls;

    // --- In-progress drawing (while the user is connecting stars) ---------
    if (drawingMode && drawingStars && drawingStars.length > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 220, 120, 0.95)";
      ctx.lineWidth = 2;
      // Solid chain between committed stars.
      ctx.beginPath();
      let started = false;
      for (const hip of drawingStars) {
        const s = starByHip.get(hip);
        if (!s) {
          started = false;
          continue;
        }
        const v = altAzToVector(s.alt, s.az);
        const p = project(v, view, upR, rightR, focal);
        if (p.z <= -0.9999) {
          started = false;
          continue;
        }
        const x = w / 2 + p.x;
        const y = h / 2 - p.y;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      // Highlight each committed star with a numbered ring.
      ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawingStars.forEach((hip, i) => {
        const s = starByHip.get(hip);
        if (!s) return;
        const v = altAzToVector(s.alt, s.az);
        const p = project(v, view, upR, rightR, focal);
        if (p.z <= -0.9999) return;
        const x = w / 2 + p.x;
        const y = h / 2 - p.y;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 220, 120, 0.95)";
        ctx.lineWidth = 2;
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(15, 12, 25, 0.85)";
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 220, 120, 0.95)";
        ctx.fillText(String(i + 1), x, y + 0.5);
      });
      // Dotted preview from last star to the center of the view.
      if (drawingStars.length > 0) {
        const lastHip = drawingStars[drawingStars.length - 1];
        const s = starByHip.get(lastHip);
        if (s) {
          const v = altAzToVector(s.alt, s.az);
          const p = project(v, view, upR, rightR, focal);
          if (p.z > -0.9999) {
            const sx = w / 2 + p.x;
            const sy = h / 2 - p.y;
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = "rgba(255, 220, 120, 0.5)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(w / 2, h / 2);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
      ctx.restore();
    }

    // Draw horizon line (where alt = 0) on top of the ground for clarity.
    ctx.strokeStyle = "rgba(230, 170, 110, 0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let horizonStarted = false;
    for (let az = 0; az < 360; az += 2) {
      const v = altAzToVector(0, az);
      const p = project(v, view, upR, rightR, focal);
      if (p.z <= -0.9999) {
        horizonStarted = false;
        continue;
      }
      const sx = w / 2 + p.x;
      const sy = h / 2 - p.y;
      if (!horizonStarted) {
        ctx.moveTo(sx, sy);
        horizonStarted = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();

    // Cardinal direction markers at alt=0
    const cardinals = [
      { az: 0, label: "N" },
      { az: 90, label: "E" },
      { az: 180, label: "S" },
      { az: 270, label: "W" },
    ];
    ctx.font = "bold 18px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of cardinals) {
      const v = altAzToVector(0, c.az);
      const p = project(v, view, upR, rightR, focal);
      if (p.z <= -0.9999) continue;
      const sx = w / 2 + p.x;
      const sy = h / 2 - p.y;
      if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
      ctx.fillStyle = "rgba(255, 180, 120, 0.9)";
      ctx.fillText(c.label, sx, sy);
    }

    // Draw stars with soft glow
    for (const ss of projected) {
      if (!ss.inView) continue;
      const color = bvToColor(ss.star.bv);
      // Glow
      const glowRadius = ss.radius * 3.5;
      const grad = ctx.createRadialGradient(ss.x, ss.y, 0, ss.x, ss.y, glowRadius);
      grad.addColorStop(0, hexWithAlpha(color, 0.55 * ss.alpha));
      grad.addColorStop(0.4, hexWithAlpha(color, 0.2 * ss.alpha));
      grad.addColorStop(1, hexWithAlpha(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ss.x, ss.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      // Core
      ctx.fillStyle = hexWithAlpha(color, Math.min(1, ss.alpha + 0.2));
      ctx.beginPath();
      ctx.arc(ss.x, ss.y, ss.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw star names — kept upright (not rolled with the sky) so they're
    // always comfortable to read regardless of how the phone is tilted.
    //
    // While drawing, also record each name's pixel rectangle on the
    // corresponding ScreenStar so the pointer handler can treat a tap
    // on the text as equivalent to a tap on the star itself. The disk
    // alone has a generous grace zone, but the label does not — this
    // closes that gap.
    if (showNames) {
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(210, 225, 255, 0.82)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = 3;
      for (const ss of projected) {
        if (!ss.inView) continue;
        if (ss.star.mag > 2.2) continue;
        if (!ss.star.name) continue;
        const labelX = ss.x + ss.radius + 6;
        const labelY = ss.y;
        ctx.fillText(ss.star.name, labelX, labelY);
        const textW = ctx.measureText(ss.star.name).width;
        // Font is 12px with textBaseline "middle", so the glyphs sit
        // roughly ±6px around labelY. Small extra vertical padding
        // gives the tap target a comfortable 18–20px height.
        ss.label = {
          x: labelX,
          y: labelY - 8,
          w: textW,
          h: 16,
        };
      }
      ctx.shadowBlur = 0;
    }

    // --- Sun --------------------------------------------------------------
    // Drawn before the Moon so that if the two disks overlap (near a
    // solar eclipse, or any line-of-sight coincidence at wide FOV) the
    // Moon is rendered on top — preserving the familiar "dark disk
    // across the Sun" eclipse geometry. Both bodies are rendered
    // regardless of altitude so the user can tap them at any hour.
    screenSunRef.current = null;
    {
      const { alt: sAlt, az: sAz } = sunState.horz;
      const vSun = altAzToVector(sAlt, sAz);
      const pSun = project(vSun, view, upR, rightR, focal);
      if (pSun.z > -0.9999) {
        const sx_ = w / 2 + pSun.x;
        const sy_ = h / 2 - pSun.y;

        // Disk sizing mirrors the Moon's: the Sun's true ~0.5°
        // diameter is far too small to read on a phone, so apply the
        // same visual boost and the same floor/ceiling clamps.
        const SUN_VISUAL_BOOST = 6;
        const sunAngRad = (sunState.pos.angularDiameterDeg * DEG) / 2;
        const sunTrueR = 2 * focal * Math.tan(sunAngRad / 2);
        const sunRawR = sunTrueR * SUN_VISUAL_BOOST;
        const sunMinR = 14;
        const sunMaxR = Math.min(w, h) * 0.4;
        const sR = Math.max(sunMinR, Math.min(sunRawR, sunMaxR));

        // Only draw if the Sun's glow footprint overlaps the visible
        // area (the halo extends well past the disk).
        if (
          sx_ + sR * 3.5 >= -20 &&
          sx_ - sR * 3.5 <= w + 20 &&
          sy_ + sR * 3.5 >= -20 &&
          sy_ - sR * 3.5 <= h + 20
        ) {
          ctx.save();

          // Two-layer halo: a wide warm outer glow followed by a
          // tighter, brighter inner glow that gives the disk its
          // "burning" edge. Scales with apparent size so at narrow
          // FOV the glow shrinks with the disk and doesn't visually
          // consume the whole screen.
          const outerHaloR = sR * 3.5;
          const outerHalo = ctx.createRadialGradient(
            sx_,
            sy_,
            sR * 0.8,
            sx_,
            sy_,
            outerHaloR,
          );
          outerHalo.addColorStop(0, "rgba(255, 190, 95, 0.42)");
          outerHalo.addColorStop(0.35, "rgba(255, 170, 80, 0.18)");
          outerHalo.addColorStop(1, "rgba(255, 160, 70, 0)");
          ctx.fillStyle = outerHalo;
          ctx.beginPath();
          ctx.arc(sx_, sy_, outerHaloR, 0, Math.PI * 2);
          ctx.fill();

          const innerHaloR = sR * 1.6;
          const innerHalo = ctx.createRadialGradient(
            sx_,
            sy_,
            sR * 0.9,
            sx_,
            sy_,
            innerHaloR,
          );
          innerHalo.addColorStop(0, "rgba(255, 230, 160, 0.7)");
          innerHalo.addColorStop(1, "rgba(255, 210, 120, 0)");
          ctx.fillStyle = innerHalo;
          ctx.beginPath();
          ctx.arc(sx_, sy_, innerHaloR, 0, Math.PI * 2);
          ctx.fill();

          // Radial "rays": 12 thin tapered spokes at fixed angles.
          // A schoolroom-sun affectation that reads immediately as a
          // solar icon even on a glance. Kept faint so they don't
          // dominate the rendering when other sky content is nearby.
          const rays = 12;
          const rayInner = sR * 1.15;
          const rayOuter = sR * 2.0;
          ctx.save();
          ctx.strokeStyle = "rgba(255, 210, 120, 0.55)";
          ctx.lineWidth = 1.4;
          ctx.lineCap = "round";
          for (let i = 0; i < rays; i++) {
            const ang = (i / rays) * Math.PI * 2;
            const cA = Math.cos(ang);
            const sA = Math.sin(ang);
            ctx.beginPath();
            ctx.moveTo(sx_ + cA * rayInner, sy_ + sA * rayInner);
            ctx.lineTo(sx_ + cA * rayOuter, sy_ + sA * rayOuter);
            ctx.stroke();
          }
          ctx.restore();

          // The bright disk itself. A radial gradient from white-hot
          // core through warm yellow at the edge gives a sense of
          // depth without looking like a flat circle. Finished with
          // a slightly brighter rim so the disk reads cleanly even
          // against the daytime-blue-sky tint near the horizon.
          const disk = ctx.createRadialGradient(
            sx_,
            sy_,
            sR * 0.1,
            sx_,
            sy_,
            sR,
          );
          disk.addColorStop(0, "rgba(255, 252, 230, 1)");
          disk.addColorStop(0.6, "rgba(255, 225, 140, 1)");
          disk.addColorStop(1, "rgba(255, 190, 90, 1)");
          ctx.fillStyle = disk;
          ctx.beginPath();
          ctx.arc(sx_, sy_, sR, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = "rgba(255, 240, 190, 0.9)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx_, sy_, sR, 0, Math.PI * 2);
          ctx.stroke();

          ctx.restore();

          // Label — upright, placed just outside the disk. Mirrors the
          // Moon's treatment so the two luminaries read consistently.
          // When drawn, the label's pixel rectangle is also recorded on
          // the Sun's footprint below so a tap on the word "Sun" counts
          // as a tap on the Sun — not a fall-through to whatever's
          // behind the text.
          let sunLabelRect: ScreenLabelRect | undefined;
          if (showNames) {
            ctx.save();
            ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(255, 220, 160, 0.95)";
            ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
            ctx.shadowBlur = 3;
            const labelX = sx_ + sR + 6;
            const labelY = sy_;
            ctx.fillText("Sun", labelX, labelY);
            const textW = ctx.measureText("Sun").width;
            ctx.shadowBlur = 0;
            ctx.restore();
            sunLabelRect = {
              x: labelX,
              y: labelY - 8,
              w: textW,
              h: 16,
            };
          }

          // Record the Sun's on-screen footprint for pointer hits.
          screenSunRef.current = {
            x: sx_,
            y: sy_,
            r: sR,
            label: sunLabelRect,
          };
        }
      }
    }

    // --- Planets ---------------------------------------------------------
    // The seven other major planets, drawn between the Sun and the Moon
    // in z-order: above the Sun's halo (so Mercury near conjunction
    // isn't washed out by the corona) but below the Moon (which, when
    // it occludes a planet in reality, should visually cover it).
    //
    // Sizing is strictly proportional to the true apparent angular
    // diameter, using the SAME visual boost factor as the Sun and
    // Moon so all solar-system bodies share one consistent scale.
    // That keeps the relative sizes physically faithful — Jupiter is
    // about 1/40th of the Moon, Neptune about 1/800th — and it
    // accurately conveys "planets are distant point sources, not
    // worlds". The outer planets become sub-pixel specks at wide
    // FOV; that's how they actually look to the naked eye.
    //
    // Planets are rendered regardless of altitude so the touch target
    // and "where's Saturn right now" cue are always available. We
    // do NOT apply a minimum-radius floor to the disk itself — that
    // would break proportionality — but hit-testing uses a generous
    // padded radius so the small disks remain tappable.
    const PLANET_VISUAL_BOOST = 6; // identical to Sun/Moon
    const projectedPlanets: Array<{
      id: PlanetId;
      info: PlanetInfo;
      x: number;
      y: number;
      /** True, physics-driven disk radius in px. */
      radius: number;
    }> = [];
    for (const { info, pos, horz } of planetStates) {
      const v = altAzToVector(horz.alt, horz.az);
      const p = project(v, view, upR, rightR, focal);
      if (p.z <= -0.9999) continue;
      const px = w / 2 + p.x;
      const py = h / 2 - p.y;

      // Angular-diameter → screen radius, identical to the Sun/Moon
      // formula (2 · focal · tan(θ/2)) with the same 6× visual
      // boost. Because planet angular diameters are typically a few
      // arcseconds, this produces sub-pixel radii at normal FOV —
      // which is physically correct.
      const angRad = (pos.angularDiameterDeg * DEG) / 2;
      const trueR = 2 * focal * Math.tan(angRad / 2);
      const radius = trueR * PLANET_VISUAL_BOOST;

      // The visible footprint (disk + soft halo). Culled generously
      // so barely-on-screen planets are still considered for hit
      // testing when their glow touches the canvas.
      const footprint = Math.max(radius * 3.5, 2);
      if (
        px + footprint < -20 ||
        px - footprint > w + 20 ||
        py + footprint < -20 ||
        py - footprint > h + 20
      ) {
        continue;
      }

      projectedPlanets.push({ id: info.id, info, x: px, y: py, radius });
    }

    // Reset the hit-test cache before we start drawing so a planet
    // that fell off-screen this frame doesn't linger for a tap.
    screenPlanetsRef.current = [];

    // Draw dim planets first so brighter ones overlap cleanly when
    // two happen to coincide at a conjunction.
    const planetDrawOrder = [...projectedPlanets].sort(
      (a, b) => b.info.nominalMag - a.info.nominalMag,
    );
    for (const pp of planetDrawOrder) {
      // Opacity / glow scaling by nominal magnitude so the brighter
      // planets (Venus, Jupiter) get a more assertive halo and the
      // dim outer ones (Uranus/Neptune) don't over-light their tiny
      // disks. Size is still strictly physical — only the *glow
      // brightness* varies, matching the visual cue used for stars.
      const alpha = Math.max(0.35, magnitudeToAlpha(pp.info.nominalMag));

      // Point-source rendering. For bodies small enough to essentially
      // be a pinprick (below ~0.6 px — which is most planets most of
      // the time), we skip the on-disk gradient entirely and just
      // draw a tiny bright point with a star-like glow. For the rare
      // cases where a planet is genuinely large on screen (Jupiter at
      // narrow FOV, Venus at greatest elongation and narrow FOV), we
      // fall through to the same disk treatment as the Sun/Moon so
      // the body actually reads as a small world rather than a big
      // featureless blob.
      const DISK_THRESHOLD_PX = 1.5;

      // Glow: minimum visible halo so the planet isn't entirely
      // invisible at wide FOVs. Scales with disk size past the
      // threshold. This is a *visibility aid*, not part of the
      // physical body, so it's fine to floor it — the body itself
      // stays proportional.
      const glowR = Math.max(pp.radius * 3.5, 4.5);
      const coreRadius = Math.max(pp.radius, 0.6);

      const grad = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, glowR);
      grad.addColorStop(0, hexWithAlpha(pp.info.color, 0.55 * alpha));
      grad.addColorStop(0.4, hexWithAlpha(pp.info.color, 0.2 * alpha));
      grad.addColorStop(1, hexWithAlpha(pp.info.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      if (pp.radius >= DISK_THRESHOLD_PX) {
        // Proper illuminated disk. Same radial-gradient shading used
        // for the Sun's sphere, scaled to the planet's palette.
        const disk = ctx.createRadialGradient(
          pp.x - pp.radius * 0.35,
          pp.y - pp.radius * 0.35,
          pp.radius * 0.1,
          pp.x,
          pp.y,
          pp.radius,
        );
        disk.addColorStop(0, pp.info.highlight);
        disk.addColorStop(0.6, pp.info.color);
        disk.addColorStop(1, pp.info.shadow);
        ctx.fillStyle = disk;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pp.radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Point-source core: a tiny bright dot in the planet's
        // highlight color. Kept slightly larger than the physical
        // radius (floor 0.6 px) purely so single-pixel disks don't
        // vanish entirely to sub-pixel antialiasing.
        ctx.fillStyle = hexWithAlpha(pp.info.highlight, Math.min(1, alpha + 0.2));
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, coreRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Planet label — upright, placed just outside the glow. Tinted
      // toward the planet's own color so the lineup reads as a
      // coordinated set rather than seven identical tags. We gate
      // labelling on the same FOV-dependent magnitude threshold used
      // for star names: the dim outer planets (Uranus/Neptune, mag
      // 5.6+) stay unlabelled at wide FOV to keep the sky uncluttered.
      //
      // When a label is drawn, its pixel rect is saved on the
      // planet's footprint so tapping the name counts as tapping the
      // planet.
      let planetLabelRect: ScreenLabelRect | undefined;
      if (showNames && pp.info.nominalMag <= maxMag) {
        ctx.save();
        ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = hexWithAlpha(pp.info.highlight, 0.95);
        ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
        ctx.shadowBlur = 4;
        // Offset outside the visible halo so the name never sits on
        // top of the planet's glow.
        const labelX = pp.x + glowR + 2;
        const labelY = pp.y;
        ctx.fillText(pp.info.name, labelX, labelY);
        const textW = ctx.measureText(pp.info.name).width;
        ctx.shadowBlur = 0;
        ctx.restore();
        planetLabelRect = {
          x: labelX,
          y: labelY - 8,
          w: textW,
          h: 16,
        };
      }

      // Record this planet's footprint for pointer hits. Use the
      // *physical* core radius; the hit-test pass pads it generously
      // so sub-pixel disks are still tappable.
      screenPlanetsRef.current.push({
        id: pp.id,
        x: pp.x,
        y: pp.y,
        r: coreRadius,
        label: planetLabelRect,
      });
    }

    // --- Moon -------------------------------------------------------------
    // Drawn on top of stars (and on top of the Sun): in reality the
    // Moon is overwhelmingly the brightest thing in the night sky, so
    // visually it should occlude nearby stars rather than be dotted
    // over. A faint corona plus a shaded disk with the correct phase
    // terminator gives the map a proper sense of "where's the Moon
    // right now" at a glance. The Moon is rendered regardless of
    // altitude — the ground shade already gives a subtle "below the
    // horizon" cue on its own.
    //
    // Also cleared first so that when the Moon isn't on screen this
    // frame, the hit-test cache doesn't hang onto last frame's position.
    screenMoonRef.current = null;
    {
      const { alt: mAlt, az: mAz } = moonState.horz;
      const vMoon = altAzToVector(mAlt, mAz);
      const pMoon = project(vMoon, view, upR, rightR, focal);
      if (pMoon.z > -0.9999) {
        const mx = w / 2 + pMoon.x;
        const my = h / 2 - pMoon.y;

        // Disk radius in screen pixels. The Moon's true angular
        // diameter is ~0.5° — geometrically correct, but visually
        // underwhelming on a phone display, where the eye expects a
        // familiar "coin-sized" Moon rather than a technical speck.
        // We scale the true disk by a visual boost factor so it reads
        // the way people remember looking up at the sky, while still
        // growing/shrinking with zoom so pinch-to-zoom feels natural.
        // Floors/caps keep it sensible at extreme FOVs.
        const MOON_VISUAL_BOOST = 6;
        const angRad = (moonState.pos.angularDiameterDeg * DEG) / 2;
        const trueR = 2 * focal * Math.tan(angRad / 2);
        const rawR = trueR * MOON_VISUAL_BOOST;
        // Minimum disk radius so the Moon is always large enough to
        // tap even when zoomed very far out.
        const minR = 14;
        // Maximum: never let the Moon eat more than ~40% of the
        // shorter screen dimension.
        const maxR = Math.min(w, h) * 0.4;
        const R = Math.max(minR, Math.min(rawR, maxR));

        // Only draw if the Moon's disk overlaps the visible area.
        if (mx + R >= -20 && mx - R <= w + 20 && my + R >= -20 && my - R <= h + 20) {
          ctx.save();

          // Figure out which way "celestial north" and "celestial east"
          // point on screen at the Moon's current location by
          // projecting nearby points offset in declination and RA.
          // Using two reference vectors lets us build the bright-limb
          // direction without having to reason about any sign
          // conventions: χ is defined as the angle measured eastward
          // from north on the sky, so we simply rotate the screen
          // "north" vector toward the screen "east" vector by χ.
          const step = 0.25; // degrees — small enough to be accurate
          const northHorz = equatorialToHorizontal(
            moonState.pos.ra,
            Math.min(89.5, moonState.pos.dec + step),
            latitude,
            longitude,
            now,
          );
          const vNorth = altAzToVector(northHorz.alt, northHorz.az);
          const pNorth = project(vNorth, view, upR, rightR, focal);
          let northDx = (w / 2 + pNorth.x) - mx;
          let northDy = (h / 2 - pNorth.y) - my;
          const nLen = Math.hypot(northDx, northDy) || 1;
          northDx /= nLen;
          northDy /= nLen;

          // "East" = increasing RA. Offset by a small amount of RA
          // (hours) while holding declination fixed; project, then
          // take the screen direction.
          const eastHorz = equatorialToHorizontal(
            moonState.pos.ra + step / 15, // hours
            moonState.pos.dec,
            latitude,
            longitude,
            now,
          );
          const vEast = altAzToVector(eastHorz.alt, eastHorz.az);
          const pEast = project(vEast, view, upR, rightR, focal);
          let eastDx = (w / 2 + pEast.x) - mx;
          let eastDy = (h / 2 - pEast.y) - my;
          const eLen = Math.hypot(eastDx, eastDy) || 1;
          eastDx /= eLen;
          eastDy /= eLen;

          // χ eastward from north: bright_dir = cos(χ)·north + sin(χ)·east.
          // Then take atan2 of the result to get the canvas-space
          // rotation angle. This is robust regardless of how the
          // celestial frame happens to be oriented on screen (roll,
          // pitch, pole-crossing, etc.).
          const chi = moonState.phase.brightLimbAngleDeg * DEG;
          const bx = Math.cos(chi) * northDx + Math.sin(chi) * eastDx;
          const by = Math.cos(chi) * northDy + Math.sin(chi) * eastDy;
          const brightAngle = Math.atan2(by, bx);

          // Soft halo around the Moon. Scales with apparent size so
          // the halo doesn't visually dominate at narrow FOV.
          const haloR = R * 2.8;
          const halo = ctx.createRadialGradient(mx, my, R * 0.9, mx, my, haloR);
          halo.addColorStop(0, "rgba(240, 235, 220, 0.38)");
          halo.addColorStop(0.4, "rgba(230, 225, 210, 0.12)");
          halo.addColorStop(1, "rgba(220, 220, 210, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(mx, my, haloR, 0, Math.PI * 2);
          ctx.fill();

          // Unlit disk: dim grey-brown for "earthshine" so the dark
          // side of a crescent moon is still faintly visible rather
          // than vanishing into the sky background.
          ctx.fillStyle = "rgba(60, 58, 54, 0.92)";
          ctx.beginPath();
          ctx.arc(mx, my, R, 0, Math.PI * 2);
          ctx.fill();

          // Lit portion. The terminator is an ellipse whose major
          // axis lies perpendicular to the bright-limb direction and
          // whose minor axis is R·|cos(phase angle)|. Combining the
          // bright half-disk (semicircle on the lit side of the
          // diameter perpendicular to the limb direction) with a
          // half-ellipse along that same diameter produces a correct
          // crescent, gibbous, or anything in between.
          const i = moonState.phase.phaseAngleDeg * DEG;
          const cosI = Math.cos(i);
          // Signed terminator half-width. For gibbous phases (cosI > 0)
          // this is positive and the terminator ellipse bulges into
          // the dark hemisphere (x < 0 in the bright-limb frame),
          // making a large lit area. For crescent phases (cosI < 0)
          // it's negative and the ellipse bulges into the bright
          // hemisphere, carving the lit area down to a thin sliver.
          // Using the signed value lets a single path draw every
          // phase correctly.
          const terminator = R * cosI;
          const lit = moonState.phase.illumination;

          if (lit > 0.995) {
            // Essentially full — just draw a bright disk.
            drawMoonDisk(ctx, mx, my, R);
          } else if (lit < 0.005) {
            // New moon — dark disk only, already drawn above. Add a
            // subtle rim so the Moon's position is still faintly
            // visible against the sky.
            ctx.strokeStyle = "rgba(200, 200, 200, 0.25)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(mx, my, R, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            // Build the lit region by intersecting two shapes:
            //   1. The bright half-disk (semicircle on the lit side).
            //   2. Either the terminator ellipse (gibbous: lit extends
            //      past the center) or the complement (crescent: lit
            //      stays on the limb side of the terminator).
            //
            // The straightforward construction is:
            //   • Transform so +x points toward the bright limb.
            //   • Lit region = (half-disk where x > 0) XOR/UNION
            //     (half-ellipse for the terminator).
            //
            // Canvas doesn't have boolean path ops, but we can exploit
            // the fact that a semicircle (+x half of the disk) is
            // bounded by a vertical diameter. If we take that diameter
            // and curve it into the terminator ellipse (semi-minor
            // axis = R·cosI, with sign following cosI), the resulting
            // closed region is exactly the illuminated portion for
            // every phase.
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(brightAngle);

            ctx.beginPath();
            // Bright-side half-arc: from top (−y) clockwise around
            // through the bright limb (+x) to bottom (+y). In canvas
            // coordinates y grows downward, so "counterclockwise=false"
            // traces the +x half of the circle.
            ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
            // Terminator: the ellipse's left half, from bottom (+y)
            // up through the terminator point back to top (−y). The
            // ellipse is axis-aligned with rx = |terminator|, ry = R;
            // we pass `terminator` with its sign and traverse CCW so
            // the arc passes through angle π, which lands at
            // (−terminator, 0). For gibbous (terminator > 0) that's
            // in the dark hemisphere and the lit region covers most
            // of the disk; for crescent (terminator < 0) it's back on
            // the bright side and the lit region shrinks to a sliver.
            ctx.ellipse(
              0,
              0,
              Math.abs(terminator),
              R,
              0,
              Math.PI / 2,
              -Math.PI / 2,
              terminator >= 0,
            );
            ctx.closePath();

            const fill = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
            fill.addColorStop(0, "rgba(255, 252, 235, 1)");
            fill.addColorStop(0.85, "rgba(240, 232, 210, 1)");
            fill.addColorStop(1, "rgba(210, 200, 180, 1)");
            ctx.fillStyle = fill;
            ctx.fill();

            // Soft limb highlight so the bright crescent doesn't look
            // flat against the dark half.
            ctx.strokeStyle = "rgba(255, 250, 225, 0.5)";
            ctx.lineWidth = 0.8;
            ctx.stroke();

            ctx.restore();
          }

          ctx.restore();

          // Label — kept upright like star names and placed just
          // outside the disk so it doesn't obscure any feature. Record
          // the text's pixel rect along with the disk footprint so a
          // tap on "Moon" selects the Moon (the disk alone already has
          // a grace zone; the label gets the same treatment).
          let moonLabelRect: ScreenLabelRect | undefined;
          if (showNames) {
            ctx.save();
            ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(240, 230, 200, 0.9)";
            ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
            ctx.shadowBlur = 3;
            const labelX = mx + R + 6;
            const labelY = my;
            ctx.fillText("Moon", labelX, labelY);
            const textW = ctx.measureText("Moon").width;
            ctx.shadowBlur = 0;
            ctx.restore();
            moonLabelRect = {
              x: labelX,
              y: labelY - 8,
              w: textW,
              h: 16,
            };
          }

          // Record the Moon's on-screen footprint for pointer hits.
          screenMoonRef.current = { x: mx, y: my, r: R, label: moonLabelRect };
        }
      }
    }

  }, [
    size,
    altitude,
    azimuth,
    roll,
    fov,
    starHorz,
    starByHip,
    showNames,
    customConstellations,
    drawingMode,
    drawingStars,
    moonState,
    sunState,
    planetStates,
    latitude,
    longitude,
    now,
  ]);

  // --- Pointer handling: tap-to-select, drag-to-pan, pinch-to-zoom ---------
  //
  // One unified code path using PointerEvents so mouse, pen, and touch all
  // go through the same state machine. Behaviour:
  //
  //   - Single pointer: if it moves more than a few pixels it becomes a
  //     pan drag (calls onPan / onPanStart / onPanEnd). If it doesn't move
  //     much, pointerup is treated as a tap and we hit-test for a star.
  //   - Two touch pointers: pinch-zoom FOV (unchanged from before).
  //   - Wheel: smooth FOV zoom on desktop (no modifier required; Ctrl/⌘
  //     still works too for legacy trackpad gestures).
  const pointersRef = useRef<
    Map<number, { x: number; y: number; startX: number; startY: number }>
  >(new Map());
  const pinchStartRef = useRef<{ dist: number; fov: number } | null>(null);
  // True once a pointer has moved past the drag threshold: we're panning
  // rather than tapping. Keyed by pointerId so multi-touch doesn't confuse.
  const dragStartedRef = useRef<boolean>(false);
  // Suppress the click synthesized at the end of a drag/pinch gesture.
  const suppressClickRef = useRef(false);
  // Keep fov accessible inside event handlers without stale closures
  const fovRef = useRef(fov);
  useEffect(() => {
    fovRef.current = fov;
  }, [fov]);
  // Current view orientation, kept in refs so pointer handlers can do
  // accurate 3D rotation-based panning without stale-closure values.
  const altitudeRef = useRef(altitude);
  const azimuthRef = useRef(azimuth);
  const rollRef = useRef(roll);
  useEffect(() => {
    altitudeRef.current = altitude;
  }, [altitude]);
  useEffect(() => {
    azimuthRef.current = azimuth;
  }, [azimuth]);
  useEffect(() => {
    rollRef.current = roll;
  }, [roll]);
  // Likewise keep the pan callbacks in refs so the handlers below don't
  // need to be recreated on every render.
  const onPanRef = useRef(onPan);
  const onPanStartRef = useRef(onPanStart);
  const onPanEndRef = useRef(onPanEnd);
  useEffect(() => {
    onPanRef.current = onPan;
  }, [onPan]);
  useEffect(() => {
    onPanStartRef.current = onPanStart;
  }, [onPanStart]);
  useEffect(() => {
    onPanEndRef.current = onPanEnd;
  }, [onPanEnd]);

  // Pixel distance a pointer must travel before we treat it as a drag
  // instead of a tap. Small enough that hand tremor on touch doesn't
  // accidentally register as a drag, big enough to avoid false positives.
  const DRAG_THRESHOLD_PX = 6;

  /**
   * Convert a screen-pixel drag delta into azimuth/altitude degree deltas
   * by rotating the current view direction in 3D. This keeps per-pixel
   * sensitivity uniform across the sky — near the zenith/nadir a
   * horizontal drag no longer accumulates huge azimuth deltas — and lets
   * the view smoothly cross over the pole (altitude just starts heading
   * back down on the other side, azimuth flips by 180°).
   *
   * Inputs are the raw screen-pixel drag in the browser's coordinate
   * system (right positive, *down* positive). The returned deltas
   * implement the natural "grab the sky and fling it" feel: dragging
   * right moves the sky right (viewer turns LEFT, azimuth decreases);
   * dragging down moves the sky down (viewer tilts UP, altitude
   * increases).
   */
  const pxToDegrees = (dx: number, dy: number): { dAz: number; dAlt: number } => {
    const diag = Math.hypot(size.w, size.h) || 1;
    const degPerPx = fovRef.current / diag;

    const alt = altitudeRef.current;
    const az = azimuthRef.current;

    // Build the same camera basis used for rendering, so that dragging
    // along the screen's X/Y axes rotates the view around those same axes.
    const view = altAzToVector(alt, az);

    // Screen-up, before roll: projection of world-up onto the view plane.
    const worldUp: [number, number, number] = [0, 0, 1];
    const dotVU = view[0] * worldUp[0] + view[1] * worldUp[1] + view[2] * worldUp[2];
    let up: [number, number, number] = [
      worldUp[0] - view[0] * dotVU,
      worldUp[1] - view[1] * dotVU,
      worldUp[2] - view[2] * dotVU,
    ];
    let upLen = Math.hypot(up[0], up[1], up[2]);
    if (upLen < 1e-4) {
      // Looking essentially straight up/down. Fall back to world-north
      // as the basis for screen-up so rotations remain well-defined.
      const worldN: [number, number, number] = [0, 1, 0];
      const dotVN = view[0] * worldN[0] + view[1] * worldN[1] + view[2] * worldN[2];
      up = [
        worldN[0] - view[0] * dotVN,
        worldN[1] - view[1] * dotVN,
        worldN[2] - view[2] * dotVN,
      ];
      upLen = Math.hypot(up[0], up[1], up[2]) || 1;
    }
    up = [up[0] / upLen, up[1] / upLen, up[2] / upLen];

    // right = view × up (matches render-side convention)
    const right: [number, number, number] = [
      view[1] * up[2] - view[2] * up[1],
      view[2] * up[0] - view[0] * up[2],
      view[0] * up[1] - view[1] * up[0],
    ];

    // Apply current roll to the screen basis so horizontal drags follow
    // the rotated screen frame rather than always tracking world up.
    const rRad = -rollRef.current * DEG;
    const cr = Math.cos(rRad), sr = Math.sin(rRad);
    const upR: [number, number, number] = [
      up[0] * cr + right[0] * sr,
      up[1] * cr + right[1] * sr,
      up[2] * cr + right[2] * sr,
    ];
    const rightR: [number, number, number] = [
      right[0] * cr - up[0] * sr,
      right[1] * cr - up[1] * sr,
      right[2] * cr - up[2] * sr,
    ];

    // Drag right (dx > 0): viewer should turn LEFT (grab-and-fling),
    // which is a positive rotation of the view direction around the
    // screen-up axis. Drag down (dy > 0): viewer should tilt UP, which
    // is a positive rotation around the screen-right axis.
    const angUp = dx * degPerPx * DEG;
    const angRt = dy * degPerPx * DEG;

    const v1 = rotateAroundAxis(view, upR, angUp);
    const v2 = rotateAroundAxis(v1, rightR, angRt);

    const next = vectorToAltAz(v2);

    // Produce the smallest signed delta that gets us from (az, alt) to
    // (next.az, next.alt). Altitude is simple (no wrap); azimuth needs
    // shortest-arc treatment so crossing due-north doesn't sweep 359°.
    let dAz = next.az - az;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    const dAlt = next.alt - alt;
    return { dAz, dAlt };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
    });
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      pinchStartRef.current = { dist: Math.max(dist, 1), fov: fovRef.current };
      // Switching into pinch: abandon any in-flight pan. Flag it as
      // canceled so the consumer knows not to treat this as a deliberate
      // pan (e.g. not to start a sensor cooldown).
      if (dragStartedRef.current) {
        dragStartedRef.current = false;
        onPanEndRef.current?.({ canceled: true });
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointersRef.current.get(e.pointerId);
    if (!prev) return;
    const dxFrame = e.clientX - prev.x;
    const dyFrame = e.clientY - prev.y;
    pointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: prev.startX,
      startY: prev.startY,
    });

    // Pinch-to-zoom path (two simultaneous touches).
    if (pointersRef.current.size === 2 && pinchStartRef.current && onFovChange) {
      e.preventDefault();
      const pts = Array.from(pointersRef.current.values());
      const pdx = pts[0].x - pts[1].x;
      const pdy = pts[0].y - pts[1].y;
      const dist = Math.max(Math.hypot(pdx, pdy), 1);
      const scale = dist / pinchStartRef.current.dist;
      // Pinch apart (scale > 1) => zoom in => smaller FOV
      const nextFov = pinchStartRef.current.fov / scale;
      const clamped = Math.max(minFov, Math.min(maxFov, nextFov));
      onFovChange(Math.round(clamped * 10) / 10);
      suppressClickRef.current = true;
      return;
    }

    // Single-pointer pan path.
    if (pointersRef.current.size !== 1) return;
    const totalDx = e.clientX - prev.startX;
    const totalDy = e.clientY - prev.startY;
    if (!dragStartedRef.current) {
      if (Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) return;
      // Cross the threshold: this is a drag.
      dragStartedRef.current = true;
      suppressClickRef.current = true;
      onPanStartRef.current?.();
    }
    // Delegate to the 3D-rotation pan helper, which handles grab-and-
    // fling direction conventions and pole behaviour correctly.
    const { dAz, dAlt } = pxToDegrees(dxFrame, dyFrame);
    if (dAz !== 0 || dAlt !== 0) {
      onPanRef.current?.(dAz, dAlt);
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const was = pointersRef.current.get(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    // If this pointer was the one doing a pan, finalize.
    if (was && dragStartedRef.current && pointersRef.current.size === 0) {
      dragStartedRef.current = false;
      onPanEndRef.current?.({ canceled: false });
    }
  };

  // Click → tap-to-select. Runs AFTER pointerup; we use suppressClickRef
  // to drop clicks synthesized by drag/pinch gestures.
  //
  // Priority order:
  //   1. Moon — a huge, unambiguous target. If the tap lands inside the
  //      rendered disk (plus a small halo margin) it almost certainly
  //      meant the Moon. Skipped in drawing mode so the Moon can't
  //      hijack a star-picking tap.
  //   2. Stars — A star is a small, precise target and a crowded
  //      constellation label area shouldn't swallow a tap that was
  //      clearly meant for one of its stars.
  //   3. Custom constellation lines — fall back to a line hit-test when
  //      no star is within range. Skipped entirely in drawing mode so
  //      every tap goes straight to a star (picking a point on the chain).
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Label tap tolerance. Labels are drawn at 12px with a little
    // vertical padding baked into the stored rect already (see the
    // render effect). We still inflate by a few pixels on every side
    // so a fingertip landing just above/below/beside the glyphs still
    // registers — matches the "grace zone" around the disk itself.
    const LABEL_TAP_PAD_PX = 4;
    const hitsLabel = (
      label: { x: number; y: number; w: number; h: number } | undefined,
    ): boolean => {
      if (!label) return false;
      return (
        x >= label.x - LABEL_TAP_PAD_PX &&
        x <= label.x + label.w + LABEL_TAP_PAD_PX &&
        y >= label.y - LABEL_TAP_PAD_PX &&
        y <= label.y + label.h + LABEL_TAP_PAD_PX
      );
    };

    // 1. Luminary (Sun / Moon / planet) hit-test. Checked before stars
    // because (a) each disk is a much bigger target than any star, so
    // there's rarely any ambiguity, and (b) when a luminary is on-screen
    // the user tapping inside its disk almost always means the luminary
    // — not a star that happens to project behind it. Skipped while
    // drawing so the luminaries can't hijack a tap meant to add a star
    // to the chain.
    //
    // When multiple are in reach of the tap (they can overlap at
    // conjunctions), pick the one whose disk center is closer to the
    // tap. That gives the user the most predictable behaviour when
    // the disks are side-by-side.
    if (!drawingMode && (onSelectMoon || onSelectSun || onSelectPlanet)) {
      let best:
        | { kind: "moon" | "sun"; d: number }
        | { kind: "planet"; id: PlanetId; d: number }
        | null = null;

      const sun = screenSunRef.current;
      if (sun && onSelectSun) {
        const dx = sun.x - x;
        const dy = sun.y - y;
        const d = Math.hypot(dx, dy);
        // Pad the hit radius a little beyond the disk itself so the
        // inner halo area also counts — makes the touch target feel
        // right on small phones without being absurdly generous.
        const hitR = Math.max(24, sun.r + 8);
        // Also count taps on the rendered "Sun" label, since the
        // label sits outside the grace zone of the disk.
        if (d <= hitR || hitsLabel(sun.label)) {
          best = { kind: "sun", d };
        }
      }

      const moon = screenMoonRef.current;
      if (moon && onSelectMoon) {
        const dx = moon.x - x;
        const dy = moon.y - y;
        const d = Math.hypot(dx, dy);
        const hitR = Math.max(24, moon.r + 8);
        if (
          (d <= hitR || hitsLabel(moon.label)) &&
          (best === null || d < best.d)
        ) {
          best = { kind: "moon", d };
        }
      }

      if (onSelectPlanet) {
        for (const p of screenPlanetsRef.current) {
          const dx = p.x - x;
          const dy = p.y - y;
          const d = Math.hypot(dx, dy);
          // Planets are small (6–14 px), so we're fairly generous
          // with the tap tolerance — ~28 px minimum ≈ a typical
          // finger pad — but never so large that one planet swallows
          // taps clearly meant for a nearby star.
          const hitR = Math.max(28, p.r * 3);
          if (
            (d <= hitR || hitsLabel(p.label)) &&
            (best === null || d < best.d)
          ) {
            best = { kind: "planet", id: p.id, d };
          }
        }
      }

      if (best) {
        if (best.kind === "sun") onSelectSun?.();
        else if (best.kind === "moon") onSelectMoon?.();
        else if (best.kind === "planet") onSelectPlanet?.(best.id);
        return;
      }
    }

    // 2. Star hit-test (unchanged behavior for disk; also accepts taps
    // on the star's rendered name label when one was drawn this frame).
    if (onSelectStar) {
      let best: { s: ScreenStar; d: number } | null = null;
      for (const ss of screenStarsRef.current) {
        if (!ss.inView) continue;
        const dx = ss.x - x;
        const dy = ss.y - y;
        const d = Math.hypot(dx, dy);
        const hitR = Math.max(24, ss.radius * 6);
        const hit = d < hitR || hitsLabel(ss.label);
        if (hit && (best === null || d < best.d)) {
          best = { s: ss, d };
        }
      }
      if (best) {
        onSelectStar(best.s.star);
        return;
      }
    }

    // 3. Constellation hit-test. Disabled while drawing so star picking
    // stays uninterrupted. Runs in two passes so the overwhelmingly
    // common case (tap near a visible line) is both fast and precise,
    // while the interior of a figure still picks something useful:
    //
    //   Pass A — nearest edge within ~22px. Bumped from the old 14px so
    //   it's comfortable for a finger pad; Apple HIG's ~44pt tappable
    //   target corresponds to roughly 22px around a 1px line. If a tap
    //   is equally close to two figures, the nearer wins.
    //
    //   Pass B — if nothing hit a line, test the convex hull of each
    //   overlay. This turns sparse figures (Cancer's Y, Cassiopeia's
    //   zigzag, the Teapot) from hollow skeletons into real tappable
    //   regions. When a tap lands inside multiple overlapping hulls,
    //   break the tie by picking the one whose centroid is nearest —
    //   that's the constellation the user most plausibly "meant".
    if (!drawingMode && onSelectConstellation) {
      const EDGE_HIT_TOL_PX = 22;
      let bestId: string | null = null;
      let bestDist = EDGE_HIT_TOL_PX;
      for (const seg of screenConstellationsRef.current) {
        const d = pointToSegmentDistance(x, y, seg.ax, seg.ay, seg.bx, seg.by);
        if (d < bestDist) {
          bestDist = d;
          bestId = seg.id;
        }
      }

      if (!bestId) {
        let bestCentroidDist = Infinity;
        for (const hull of screenConstellationHullsRef.current) {
          if (
            x < hull.minX ||
            x > hull.maxX ||
            y < hull.minY ||
            y > hull.maxY
          ) {
            continue;
          }
          if (!pointInPolygon(x, y, hull.points)) continue;
          const dc = Math.hypot(hull.cx - x, hull.cy - y);
          if (dc < bestCentroidDist) {
            bestCentroidDist = dc;
            bestId = hull.id;
          }
        }
      }

      if (bestId) onSelectConstellation(bestId);
    }
  };

  // Wheel → FOV zoom. No modifier required so it feels natural on desktop.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onFovChange) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.002);
      const next = fovRef.current * factor;
      const clamped = Math.max(minFov, Math.min(maxFov, next));
      onFovChange(Math.round(clamped * 10) / 10);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onFovChange, minFov, maxFov]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden touch-none cursor-grab active:cursor-grabbing"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}



/**
 * Draw a fully-lit Moon disk at (cx, cy) with radius R. Used for the
 * "essentially full" case; the crescent / gibbous path builds its own
 * fill inline so it can share the clipping transform with the
 * terminator ellipse.
 */
function drawMoonDisk(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
): void {
  const fill = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  fill.addColorStop(0, "rgba(255, 252, 235, 1)");
  fill.addColorStop(0.85, "rgba(240, 232, 210, 1)");
  fill.addColorStop(1, "rgba(210, 200, 180, 1)");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
}

function hexWithAlpha(hex: string, alpha: number): string {
  // hex = "#rrggbb"
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
