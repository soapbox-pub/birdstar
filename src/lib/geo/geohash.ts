// Geohash encoder for the NIP-52 `g` tag.
//
// Geohash (https://en.wikipedia.org/wiki/Geohash) packs a lat/lon into
// a short base-32 string where each additional character roughly
// quadruples the precision. Birdstar emits length-3 geohashes on bird
// detections (~156km cells), matching the 1°-rounded precision of the
// lat/lon we persist for users who opted in via Settings → "Publish
// location". Higher precision would imply more accuracy than the
// upstream coordinate actually carries.
//
// Implementation is the standard interleave-bits-then-base32 encoder.
// We ship our own rather than adding a dependency (ngeohash is ~20KB
// gzipped and covers features we don't need, like neighbor / bbox
// decoding).
//
// The base-32 alphabet is the de-facto geohash standard: digits 0-9
// followed by the consonants b-z with a, i, l, and o removed to avoid
// visually ambiguous characters.

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode a latitude/longitude pair as a geohash of the requested
 * character length.
 *
 * Constraints:
 *   - `lat` must be in [-90, 90].
 *   - `lon` must be in [-180, 180].
 *   - `precision` must be a positive integer; anything larger than ~12
 *     exceeds the float64 precision of the underlying bisection and
 *     is rejected to avoid returning silently-bogus trailing digits.
 *
 * Throws on invalid input rather than returning a sentinel — callers
 * have already validated the coordinate is real (it came from
 * `navigator.geolocation` via `useUserRegion`), so a throw signals a
 * programming error rather than an expected case.
 */
export function encodeGeohash(
  lat: number,
  lon: number,
  precision: number,
): string {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`encodeGeohash: lat out of range: ${lat}`);
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`encodeGeohash: lon out of range: ${lon}`);
  }
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) {
    throw new Error(`encodeGeohash: precision out of range: ${precision}`);
  }

  // Standard geohash encoding bisects alternating longitude and
  // latitude ranges. `evenBit` tracks which axis we're bisecting next
  // — it starts true (longitude) because the very first bit written
  // into each base-32 character is a longitude bit.
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = '';
  let bits = 0;
  let bitCount = 0;
  let evenBit = true;

  while (hash.length < precision) {
    if (evenBit) {
      const lonMid = (lonMin + lonMax) / 2;
      if (lon >= lonMid) {
        bits = (bits << 1) | 1;
        lonMin = lonMid;
      } else {
        bits = bits << 1;
        lonMax = lonMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        bits = (bits << 1) | 1;
        latMin = latMid;
      } else {
        bits = bits << 1;
        latMax = latMid;
      }
    }
    evenBit = !evenBit;
    bitCount++;

    // Every 5 bits, flush a base-32 character.
    if (bitCount === 5) {
      hash += GEOHASH_BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }

  return hash;
}

// Adjacency / border tables for computing the geohash cell immediately
// adjacent to a given cell in a cardinal direction. This is the
// standard algorithm (after David Troy's geohash.js): a geohash grid
// alternates orientation with each character, so the lookup table is
// indexed by parity (even/odd length) within each direction.
const NEIGHBOR = {
  n: ['p0r21436x8zb9dcf5h7kjnmqesgutwvy', 'bc01fg45238967deuvhjyznpkmstqrwx'],
  s: ['14365h7k9dcfesgujnmqp0r2twvyx8zb', '238967debc01fg45kmstqrwxuvhjyznp'],
  e: ['bc01fg45238967deuvhjyznpkmstqrwx', 'p0r21436x8zb9dcf5h7kjnmqesgutwvy'],
  w: ['238967debc01fg45kmstqrwxuvhjyznp', '14365h7k9dcfesgujnmqp0r2twvyx8zb'],
} as const;

const BORDER = {
  n: ['prxz', 'bcfguvyz'],
  s: ['028b', '0145hjnp'],
  e: ['bcfguvyz', 'prxz'],
  w: ['0145hjnp', '028b'],
} as const;

type Direction = keyof typeof NEIGHBOR;

/**
 * Return the geohash of the cell directly adjacent to `hash` in the
 * given cardinal direction. The result is the same length as the
 * input. Throws on an empty or malformed geohash.
 */
function adjacentGeohash(hash: string, direction: Direction): string {
  const lower = hash.toLowerCase();
  if (lower.length === 0) {
    throw new Error('adjacentGeohash: empty geohash');
  }

  const lastChar = lower.charAt(lower.length - 1);
  let base = lower.slice(0, -1);
  // Parity: even-length prefixes flip the orientation of the table.
  const type = lower.length % 2; // 0 = even, 1 = odd

  // If the last char sits on the border for this direction, the base
  // (everything but the last char) must itself be carried over to its
  // own neighbor before we append the new last char.
  if (BORDER[direction][type].indexOf(lastChar) !== -1 && base !== '') {
    base = adjacentGeohash(base, direction);
  }

  const idx = NEIGHBOR[direction][type].indexOf(lastChar);
  if (idx === -1) {
    throw new Error(`adjacentGeohash: invalid geohash character: ${lastChar}`);
  }
  return base + GEOHASH_BASE32.charAt(idx);
}

/**
 * Return the geohash cell containing `hash` plus its eight surrounding
 * cells (N, NE, E, SE, S, SW, W, NW), deduplicated. Used to widen a
 * "nearby" query so events that fall just across a grid-cell boundary
 * from the user aren't missed — a single geohash prefix is a fixed
 * grid square, so a user near an edge would otherwise see only half
 * their true neighborhood.
 *
 * The center cell is always first in the returned array.
 */
export function geohashNeighbors(hash: string): string[] {
  const n = adjacentGeohash(hash, 'n');
  const s = adjacentGeohash(hash, 's');
  const e = adjacentGeohash(hash, 'e');
  const w = adjacentGeohash(hash, 'w');
  const ne = adjacentGeohash(n, 'e');
  const nw = adjacentGeohash(n, 'w');
  const se = adjacentGeohash(s, 'e');
  const sw = adjacentGeohash(s, 'w');

  const all = [hash, n, ne, e, se, s, sw, w, nw];
  // Dedup while preserving order (center first). Near the poles or the
  // ±180° meridian some neighbors can coincide.
  return Array.from(new Set(all));
}
