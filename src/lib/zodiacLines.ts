/**
 * Derives zodiac constellation stick-figure edges from the canonical
 * d3-celestial line data (`constellations.lines.json`), rather than
 * hand-maintaining them.
 *
 * The line geometries in `constellations.lines.json` are stored as
 * MultiLineStrings of `[raDeg, decDeg]` coordinates. Those coordinates
 * are byte-exact matches for the same stars in `stars.6.json` (same
 * upstream source), so we can build an exact `coord → HIP` lookup and
 * translate each polyline into a sequence of HIP edges.
 *
 * A very small number of points (currently just ι Cancri, ~33″ off in
 * the bundled data) don't round-trip exactly; we fall back to a tight
 * nearest-neighbour match within a tolerance far smaller than any
 * inter-star spacing (0.05°), so the fallback can't cross-link stars.
 *
 * Running this at module load costs a single pass over the 12 zodiac
 * features (≈180 points total) — negligible, and it guarantees the
 * figures always match whatever version of d3-celestial is installed.
 */
import linesGeoJson from "d3-celestial/data/constellations.lines.json";
import starsGeoJson from "d3-celestial/data/stars.6.json";

import type { ZodiacId } from "./zodiac";

// ---------------------------------------------------------------------------
// Source-data types
// ---------------------------------------------------------------------------

interface StarFeature {
  type: "Feature";
  id: number;
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [raDeg, decDeg]
  };
}

interface StarsCollection {
  type: "FeatureCollection";
  features: StarFeature[];
}

interface LinesFeature {
  type: "Feature";
  id: string; // 3-letter IAU constellation code (e.g. "Ari")
  geometry: {
    type: "MultiLineString";
    coordinates: number[][][]; // lines of [raDeg, decDeg]
  };
}

interface LinesCollection {
  type: "FeatureCollection";
  features: LinesFeature[];
}

const RAW_LINES = linesGeoJson as unknown as LinesCollection;
const RAW_STARS = starsGeoJson as unknown as StarsCollection;

// ---------------------------------------------------------------------------
// Coordinate → HIP lookup
// ---------------------------------------------------------------------------

/**
 * Exact coord match. Keys are `"ra,dec"` so we never hit the
 * `NaN !== NaN` foot-gun or the floating-point-tuple equality issue
 * a `Map<[number, number], number>` would have.
 */
const COORD_TO_HIP = new Map<string, number>();

/** Flat list of `[ra, dec, hip]` for the nearest-neighbour fallback. */
const STAR_INDEX: Array<[number, number, number]> = [];

for (const f of RAW_STARS.features) {
  const hip = f.id;
  if (typeof hip !== "number" || !Number.isFinite(hip) || hip <= 0) continue;
  const [ra, dec] = f.geometry.coordinates;
  COORD_TO_HIP.set(`${ra},${dec}`, hip);
  STAR_INDEX.push([ra, dec, hip]);
}

/**
 * Nearest-neighbour fallback, used only when a line-data coordinate
 * doesn't exactly match any star (rounding skew in the upstream data).
 * Tolerance of 0.05° (~3 arcmin) is tighter than any inter-star spacing
 * in the bright-star subset, so this can't accidentally bridge stars.
 */
const NEAREST_TOLERANCE_DEG = 0.05;

function findHipForCoord(ra: number, dec: number): number | undefined {
  const exact = COORD_TO_HIP.get(`${ra},${dec}`);
  if (exact !== undefined) return exact;

  let bestHip: number | undefined;
  let bestDist = NEAREST_TOLERANCE_DEG;
  for (const [sra, sdec, hip] of STAR_INDEX) {
    // Fast L∞ reject before the square-root-free squared distance — we
    // only care about "close enough", and RA is not cos(dec)-corrected
    // because tolerances this small don't need it.
    const dra = sra - ra;
    if (dra > bestDist || dra < -bestDist) continue;
    const ddec = sdec - dec;
    if (ddec > bestDist || ddec < -bestDist) continue;
    const d = Math.hypot(dra, ddec);
    if (d < bestDist) {
      bestDist = d;
      bestHip = hip;
    }
  }
  return bestHip;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Maps the `ZodiacId` used in the app to the 3-letter IAU code. */
const ZODIAC_TO_IAU: Record<ZodiacId, string> = {
  aries: "Ari",
  taurus: "Tau",
  gemini: "Gem",
  cancer: "Cnc",
  leo: "Leo",
  virgo: "Vir",
  libra: "Lib",
  scorpius: "Sco",
  sagittarius: "Sgr",
  capricornus: "Cap",
  aquarius: "Aqr",
  pisces: "Psc",
};

const LINES_BY_CON = new Map<string, number[][][]>();
for (const f of RAW_LINES.features) {
  LINES_BY_CON.set(f.id, f.geometry.coordinates);
}

/**
 * Derive the canonical edge list for a zodiac sign as pairs of HIP
 * numbers. Each line in the source MultiLineString is a polyline of N
 * stars which we fan out into N-1 edges. Duplicate edges (an edge that
 * appears in multiple lines, only possible if the source data branches
 * back on itself — rare but cheap to dedupe) are collapsed.
 */
function deriveEdges(zid: ZodiacId): Array<[number, number]> {
  const iau = ZODIAC_TO_IAU[zid];
  const lines = LINES_BY_CON.get(iau);
  if (!lines) return [];

  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];

  for (const line of lines) {
    let prevHip: number | undefined;
    for (const [ra, dec] of line) {
      const hip = findHipForCoord(ra, dec);
      if (hip === undefined) {
        // Break the chain on an unresolved point rather than jumping
        // past it — prevents drawing a spurious long edge across the
        // missing star.
        prevHip = undefined;
        continue;
      }
      if (prevHip !== undefined && prevHip !== hip) {
        // Canonicalise the pair so (a,b) and (b,a) dedupe to one.
        const key = prevHip < hip ? `${prevHip}-${hip}` : `${hip}-${prevHip}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([prevHip, hip]);
        }
      }
      prevHip = hip;
    }
  }

  return edges;
}

/**
 * All zodiac edge lists, derived once at module load. Frozen so
 * consumers can't mutate the shared arrays.
 */
export const ZODIAC_EDGES: Readonly<
  Record<ZodiacId, ReadonlyArray<readonly [number, number]>>
> = Object.freeze(
  (Object.keys(ZODIAC_TO_IAU) as ZodiacId[]).reduce(
    (acc, zid) => {
      acc[zid] = Object.freeze(deriveEdges(zid)) as ReadonlyArray<
        readonly [number, number]
      >;
      return acc;
    },
    {} as Record<ZodiacId, ReadonlyArray<readonly [number, number]>>,
  ),
);
