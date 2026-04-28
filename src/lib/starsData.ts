/**
 * Star catalog for Starpoint.
 *
 * Star positions, magnitudes, names, and constellation assignments are
 * derived from the `d3-celestial` npm package (Olaf Frohn, BSD-3-Clause),
 * which aggregates data from:
 *
 *   - ESA's Hipparcos mission catalog (positions, magnitudes, B-V)
 *   - IAU Catalog of Star Names (proper names)
 *   - IAU constellation boundaries (Davenhall & Leggett 1989)
 *
 * At module load we transform the raw GeoJSON into the `Star` shape the
 * rest of the app uses: RA in hours (not degrees), HIP as a number,
 * name/bayer joined from the separate starnames table, and constellation
 * assigned by point-in-polygon against the IAU bounds.
 *
 * Attribution (BSD-3-Clause): https://github.com/ofrohn/d3-celestial
 */

import starsGeoJson from "d3-celestial/data/stars.6.json";
import starnamesJson from "d3-celestial/data/starnames.json";
import boundsGeoJson from "d3-celestial/data/constellations.bounds.json";

// ---------------------------------------------------------------------------
// Source-data types
// ---------------------------------------------------------------------------

/** One entry in d3-celestial's stars.N.json GeoJSON. */
interface StarFeature {
  type: "Feature";
  id: number; // HIP catalog number (plain number)
  properties: {
    mag: number;
    bv: string | number | ""; // B-V index, usually a string like "0.011"
  };
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [RA degrees, Dec degrees]
  };
}

interface StarsCollection {
  type: "FeatureCollection";
  features: StarFeature[];
}

/** One entry in d3-celestial's starnames.json (keyed by HIP string). */
interface StarNameEntry {
  name?: string;       // IAU / traditional proper name
  bayer?: string;      // Greek letter, already Unicode (e.g. "α")
  flam?: string;       // Flamsteed number
  hd?: string;         // Henry Draper designation
  hip?: string;        // "HIP 32349"
  c?: string;          // 3-letter IAU constellation code
  desig?: string;      // shortest display designation
}

type StarNames = Record<string, StarNameEntry>;

interface BoundsFeature {
  type: "Feature";
  id: string; // 3-letter IAU constellation code
  geometry: {
    type: "Polygon";
    coordinates: number[][][]; // rings of [lon, lat]
  };
}

interface BoundsCollection {
  type: "FeatureCollection";
  features: BoundsFeature[];
}

// Casts to bridge the loose JSON types into our declared interfaces. The
// runtime data has been spot-checked to match; any stars that violate the
// shape (missing mag, invalid HIP) are filtered out below.
const RAW_STARS = starsGeoJson as unknown as StarsCollection;
const RAW_NAMES = starnamesJson as unknown as StarNames;
const RAW_BOUNDS = boundsGeoJson as unknown as BoundsCollection;

// ---------------------------------------------------------------------------
// Public Star type
// ---------------------------------------------------------------------------

export interface Star {
  /**
   * Hipparcos catalog number — stable, frozen since 1997, used as the
   * canonical identifier both internally and on the Nostr wire.
   */
  hip: number;
  /** IAU / traditional proper name, if any. */
  name?: string;
  /** Bayer designation (Greek letter, already Unicode). */
  bayer?: string;
  /** 3-letter IAU constellation code (e.g. "CMa"). */
  constellation?: string;
  /** Right ascension in hours, 0..24. */
  ra: number;
  /** Declination in degrees, -90..90. */
  dec: number;
  /** Apparent visual magnitude. */
  mag: number;
  /** Johnson B-V color index. */
  bv?: number;
}

// ---------------------------------------------------------------------------
// Point-in-polygon for constellation assignment
// ---------------------------------------------------------------------------

/**
 * Precomputed bounds per constellation: the outer ring (we ignore holes
 * — IAU constellations have none) plus an axis-aligned bounding box in
 * (RA degrees, Dec degrees) for a cheap prefilter.
 *
 * Ray-casting point-in-polygon is fast, but over 88 constellations × 5k
 * stars the box prefilter turns O(N·M·K) (K = ring points) into
 * O(N·M + rare full-polygon checks), which is meaningfully faster at
 * module init without complicating the code.
 */
interface PreparedBound {
  id: string;
  ring: number[][]; // [lon, lat] points
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  /** True if the polygon crosses the 0°/360° RA seam. */
  wraps: boolean;
}

const PREPARED_BOUNDS: PreparedBound[] = RAW_BOUNDS.features.map((f) => {
  const ring = f.geometry.coordinates[0];
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  // Detect RA-seam wraparound: a polygon that legitimately spans the
  // 0°/360° boundary will be encoded with some longitudes near 0 and
  // others near 360. We flag and handle by temporarily remapping.
  const wraps = maxLon - minLon > 180;
  return { id: f.id, ring, minLon, maxLon, minLat, maxLat, wraps };
});

/** Standard even-odd ray-casting PIP in degree-coordinates. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Assign the IAU constellation code containing a given sky point. */
function constellationFor(lon: number, lat: number): string | undefined {
  for (const b of PREPARED_BOUNDS) {
    if (lat < b.minLat || lat > b.maxLat) continue;
    if (b.wraps) {
      // Remap longitudes < 180 up by 360 so the polygon becomes simply
      // connected in longitude. Test against the remapped ring and lon.
      const testLon = lon < 180 ? lon + 360 : lon;
      // Most wrap-crossing polygons still have points both near 0 and
      // near 360 after encoding; doing a straight PIP without remap
      // would split the polygon visually. Remap both consistently.
      const remapped = b.ring.map(([x, y]) =>
        x < 180 ? [x + 360, y] : [x, y],
      );
      if (pointInRing(testLon, lat, remapped)) return b.id;
    } else {
      if (lon < b.minLon || lon > b.maxLon) continue;
      if (pointInRing(lon, lat, b.ring)) return b.id;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Build the catalog
// ---------------------------------------------------------------------------

/**
 * All catalog stars, fully resolved. Drops features with invalid HIP
 * numbers or unparseable magnitudes (there shouldn't be any, but the
 * external data could change).
 */
export const STARS: Star[] = (() => {
  const out: Star[] = [];

  for (const f of RAW_STARS.features) {
    const hip = f.id;
    if (typeof hip !== "number" || !Number.isFinite(hip) || hip <= 0) {
      continue;
    }
    const mag = Number(f.properties.mag);
    if (!Number.isFinite(mag)) continue;

    const [lon, lat] = f.geometry.coordinates;
    // d3-celestial longitude is [0, 360) in degrees for RA.
    const ra = ((lon + 360) % 360) / 15;
    const dec = lat;

    const bvRaw = f.properties.bv;
    const bvNum =
      typeof bvRaw === "number"
        ? bvRaw
        : bvRaw === "" || bvRaw === undefined || bvRaw === null
          ? NaN
          : parseFloat(bvRaw);
    const bv = Number.isFinite(bvNum) ? bvNum : undefined;

    const nameEntry = RAW_NAMES[String(hip)];
    // Star names from d3-celestial already carry IAU/traditional names;
    // Bayer letters are pre-encoded as Unicode Greek glyphs.
    const name = nameEntry?.name || undefined;
    const bayer = nameEntry?.bayer || undefined;

    // Prefer the constellation code recorded alongside the name when
    // available (always correct for named stars); otherwise derive it
    // via point-in-polygon against the IAU bounds.
    const constellation = nameEntry?.c || constellationFor(lon, lat);

    const star: Star = {
      hip,
      name,
      bayer,
      constellation: constellation || undefined,
      ra,
      dec,
      mag,
      bv,
    };

    out.push(star);
  }

  // Deterministic ordering by brightness first, then HIP — helpful for
  // render loops that benefit from drawing brightest-last (on top).
  out.sort((a, b) => a.mag - b.mag || a.hip - b.hip);
  return out;
})();

/** Lookup map from HIP → Star. Built once at module load. */
export const STARS_BY_HIP: ReadonlyMap<number, Star> = (() => {
  const m = new Map<number, Star>();
  for (const s of STARS) m.set(s.hip, s);
  return m;
})();

/** Resolve a star by HIP number. Returns undefined if unknown. */
export function starByHip(hip: number): Star | undefined {
  return STARS_BY_HIP.get(hip);
}
