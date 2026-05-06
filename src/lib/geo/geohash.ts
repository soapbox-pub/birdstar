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
