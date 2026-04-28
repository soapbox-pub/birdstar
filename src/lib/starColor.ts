/**
 * Map a star's B-V color index to a display RGB color.
 *
 * B-V is the difference between the blue and visual magnitudes of a star,
 * which correlates directly with its surface temperature: negative values
 * are hot blue stars, large positive values are cool red stars. It's the
 * most physically meaningful color channel published in Hipparcos-derived
 * catalogs like d3-celestial's.
 *
 * The mapping below is a piecewise interpolation of well-known B-V →
 * effective-temperature → perceived-sRGB waypoints, covering the useful
 * range -0.4 (hot blue supergiants) to +2.0 (extreme red giants). It
 * intentionally biases saturation upward vs. a strict blackbody curve —
 * pure blackbody star colors look washed out on-screen and star maps
 * conventionally exaggerate them slightly for legibility.
 */

/** A single anchor point in the B-V → color curve. */
interface ColorStop {
  bv: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Anchors sorted by ascending B-V. Between anchors we linearly interpolate
 * each channel. Endpoints clamp.
 *
 * Values chosen to match the canonical planetarium/astrophotography
 * palette: O/B stars blue, A stars white, F/G sun-like, K warm, M red.
 */
const STOPS: readonly ColorStop[] = [
  { bv: -0.40, r: 0x9b, g: 0xb0, b: 0xff }, // O — deep blue
  { bv: -0.05, r: 0xaa, g: 0xbf, b: 0xff }, // B — blue-white
  { bv:  0.15, r: 0xca, g: 0xd7, b: 0xff }, // A — white
  { bv:  0.35, r: 0xf8, g: 0xf7, b: 0xff }, // F — yellow-white
  { bv:  0.58, r: 0xff, g: 0xf4, b: 0xea }, // G — yellow (sun-like)
  { bv:  0.81, r: 0xff, g: 0xd2, b: 0xa1 }, // K — orange
  { bv:  1.40, r: 0xff, g: 0xb5, b: 0x6c }, // M — red-orange
  { bv:  2.00, r: 0xff, g: 0x8f, b: 0x4f }, // late M — deep red
];

/**
 * Convert a B-V color index to a CSS hex color string (e.g. `#ffd2a1`).
 *
 * Accepts `undefined`, empty string, or non-numeric input and returns a
 * neutral white in that case — matches what Hipparcos emits for stars
 * without a measured B-V.
 */
export function bvToColor(bv: number | string | undefined | null): string {
  const v = typeof bv === "number" ? bv : bv ? parseFloat(bv) : NaN;
  if (!Number.isFinite(v)) return "#ffffff";

  // Clamp below/above the table to the endpoint colors.
  if (v <= STOPS[0].bv) return rgbHex(STOPS[0]);
  if (v >= STOPS[STOPS.length - 1].bv) return rgbHex(STOPS[STOPS.length - 1]);

  // Find the bracketing stops and linearly interpolate.
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (v >= a.bv && v <= b.bv) {
      const t = (v - a.bv) / (b.bv - a.bv);
      const r = Math.round(a.r + (b.r - a.r) * t);
      const g = Math.round(a.g + (b.g - a.g) * t);
      const bl = Math.round(a.b + (b.b - a.b) * t);
      return `#${hex(r)}${hex(g)}${hex(bl)}`;
    }
  }
  return "#ffffff";
}

function rgbHex(s: ColorStop): string {
  return `#${hex(s.r)}${hex(s.g)}${hex(s.b)}`;
}

function hex(n: number): string {
  const v = Math.max(0, Math.min(255, n));
  return v.toString(16).padStart(2, "0");
}
