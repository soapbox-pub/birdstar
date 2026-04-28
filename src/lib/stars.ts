/**
 * Public barrel for the Starpoint star catalog.
 *
 * Actual data and transforms live in `./starsData.ts` (sourced from the
 * `d3-celestial` npm package). Display color derivation lives in
 * `./starColor.ts`. This file exists so callers can keep using
 * `@/lib/stars` as a single import surface.
 */

export type { Star } from "./starsData";
export { STARS, STARS_BY_HIP, starByHip } from "./starsData";
export { bvToColor } from "./starColor";
