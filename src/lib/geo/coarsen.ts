// Coarsen precise coordinates for privacy-sensitive boundaries.
//
// Birdstar keeps a single full-precision location in localStorage (see
// `useSharedLocation`) so Stars-mode astronomy math, map centering, and
// the like can all share the same source of truth. Anything that
// *leaves* the device — iNat API query params, Nostr `g` tags,
// aggregate analytics, etc. — must be coarsened first: we don't need
// and don't want to disclose meter-level precision to third parties.
//
// This module is the single place that definition lives. Passing a
// precise coord through `coarsen()` at each network boundary keeps
// the privacy contract obvious to anyone grepping the codebase:
// calls to `coarsen(` == all the places we hand coords to the
// outside world.
//
// Scale: 1° of latitude is ~111 km everywhere; 1° of longitude is
// ~111 km at the equator, ~78 km at 45°, and ~0 at the poles. So a
// 1°-rounded fix pinpoints the user to a cell that's roughly 100 km
// on a side at temperate latitudes — strictly looser than the
// country/state we already derive from the same input (and index by
// in `useUserRegion`), so we leak no new information compared with
// what we need to render region-appropriate content.

export interface CoarseLatLon {
  /** Latitude rounded to 1°. */
  lat: number;
  /** Longitude rounded to 1°. */
  lon: number;
}

/**
 * The degree granularity we coarsen to. Exposed so call sites can
 * refer to it in comments / commit messages without hardcoding 1.
 */
export const COARSE_PRECISION_DEGREES = 1;

/**
 * Round a geolocation coordinate to the nearest integer degree. This
 * is the precision we persist in cache keys and emit in iNat query
 * params / Nostr geohashes; anything finer would be leaking more
 * location than the app's user-visible features actually depend on.
 */
function roundCoord(n: number): number {
  // Math.round handles negative values correctly (-0.4 → 0, -0.6 → -1)
  // which is what we want for a symmetric 1° grid.
  return Math.round(n);
}

/**
 * Coarsen a precise lat/lon for a privacy-sensitive boundary (iNat
 * query params, Nostr `g` tag, analytics).
 *
 * Returns `null` for invalid inputs (non-finite, out-of-range) so
 * callers can short-circuit rather than propagating bogus requests
 * to external services.
 */
export function coarsen(
  latitude: number,
  longitude: number,
): CoarseLatLon | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    lat: roundCoord(latitude),
    lon: roundCoord(longitude),
  };
}
