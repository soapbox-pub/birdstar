// iNaturalist-based local bird proximity signal.
//
// This module layers an "actually observed near you" signal on top of
// the coarse ecoregion data in public/birdnet/species-regions.bin.
// The `.bin` file knows a Carolina Wren is a southeastern-US species;
// this module knows whether anybody has actually logged one on
// iNaturalist within 50 km of you in the last 5 years. The latter is
// a much tighter signal for two downstream consumers:
//
//   - Birdex ranking (useBirdex): birds observed near you should
//     outrank globally popular birds that don't actually occur in
//     your neighborhood. A user in Austin shouldn't see a Boat-tailed
//     Grackle in their tier-1 top-10 when it's a coastal species the
//     local population rarely encounters.
//
//   - Confidence damping (useDetectionAccumulator): a species whose
//     nearest iNat observation is 300 km away is less likely to
//     actually be singing in the user's backyard than one with
//     observations across the street. Graded damping by distance
//     band lets us keep real vagrants detectable while making weak
//     false-positive predictions even harder to cross the
//     confirmation threshold.
//
// Strategy: one-time bulk fan-out at page load, cached for 7 days.
//
//   Phase A (bulk, 5 requests):
//     Query /v1/observations/species_counts at five nested radii
//     (25, 50, 100, 200, 500 km) centered on the user's coarse
//     lat/lon. For each species that appears in any response, record
//     the SMALLEST radius it was seen at. This gives us a discrete
//     distance band per species (25/50/100/200/500/null) in one batch
//     without a per-species request.
//
//   Phase B (lazy, per-species):
//     When a species starts accumulating toward confirmation, optionally
//     refine its band to a specific distance by calling
//     /v1/observations?taxon_id=...&order_by=distance&per_page=1. Caches
//     the result for 7 days. Only fires for species the user is
//     actually hearing, not the whole birdex — so this is a rare
//     operation that can't runaway.
//
// Rate limiting: iNat's guideline is 60 req/min soft, 100 req/min hard,
// 10k/day max. Phase A is 5 requests per 7 days per user; phase B is
// ~1 request per bird the user actually hears. Both are well under any
// limit. No User-Agent is set because browsers don't allow overriding
// it; iNat's rate limits are per-IP and our footprint is trivial.
//
// Privacy: the user's coarse lat/lon (1°-rounded) is sent to iNat as
// a query parameter. This is strictly coarser than the country/state
// we already derive from the same fix, so no new information is
// leaked. The cache is local-only (IndexedDB).

/**
 * Nested radii (km) for the phase-A bulk fan-out. Ordered smallest to
 * largest; a species' "band" is the smallest radius it was observed
 * within. The upper bound (500 km) is chosen to comfortably exceed
 * the ecoregion scale of species-regions.bin's US-SE/US-SW codes,
 * so a species with `band: 500` is genuinely well beyond the user's
 * range rather than being "just outside the inner radii".
 */
export const LOCAL_RADII_KM = [25, 50, 100, 200, 500] as const;
export type LocalRadiusKm = (typeof LOCAL_RADII_KM)[number];

/**
 * Band assignment for a species. Null = not observed within the
 * outermost radius in the lookback window. Note: null does NOT mean
 * "absent" — iNat coverage is patchy in rural areas and outside
 * North America — downstream consumers should fall back to the
 * species-regions.bin signal rather than hiding the species.
 */
export type LocalBand = LocalRadiusKm | null;

/**
 * Entry in the local-species map. `band` is the primary signal; `count`
 * is the observation count within the OUTERMOST radius the species
 * appeared in and serves as a soft magnitude signal when breaking ties
 * between two species in the same band.
 */
export interface LocalSpeciesEntry {
  band: LocalBand;
  /** Observations within the outermost radius the species appeared in.
   * Used as a secondary signal when ranking two species in the same
   * band. Always >= 1 when band is non-null. */
  count: number;
}

/**
 * Per-coarse-coord lookup table: scientific name (LOWERCASED, to
 * match BirdNET labels via case-insensitive compare) → entry.
 */
export type LocalSpeciesMap = Map<string, LocalSpeciesEntry>;

/**
 * Cached blob layout. `expiresAt` is the unix-ms timestamp after which
 * the blob should be re-fetched. `entries` is the serialized map.
 */
export interface CachedLocalSpecies {
  /** Coarse lat/lon these results are keyed to. */
  lat: number;
  lon: number;
  /** ms since epoch when the fetch completed. */
  fetchedAt: number;
  /** ms since epoch; after this the blob should be refetched. Consumers
   * may still serve the stale value while a background refresh runs. */
  expiresAt: number;
  /** Entries keyed by lowercased scientific name. Serialized as a plain
   * object (IndexedDB can persist Maps, but plain objects are more
   * forgiving across schema evolutions and easier to inspect). */
  entries: Record<string, LocalSpeciesEntry>;
}

/** Cached nearest-observation distance for a single species at a given coord. */
export interface CachedNearest {
  inatTaxonId: number;
  lat: number;
  lon: number;
  distanceKm: number | null;
  fetchedAt: number;
  expiresAt: number;
}

export const BULK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NEAREST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Years of history to consider. Short enough to reflect current range
 * (a species that vanished 10 years ago shouldn't boost), long enough
 * to capture migratory visitors in their off-season. */
export const LOOKBACK_YEARS = 5;

/**
 * Confidence multipliers by distance band, applied by
 * useDetectionAccumulator's graded damper. `1.0` means no damping.
 * The 0.35 floor of this table is stricter than the .bin-derived
 * OUT_OF_REGION_MULTIPLIER (0.5) so that a species iNat firmly
 * places 500 km away gets MORE damping than a species that's
 * simply flagged as out-of-ecoregion by the static .bin.
 *
 * Note that damping is applied BEFORE the γ exponent in
 * useDetectionAccumulator, so the effective accumulation penalty
 * is the square of the multiplier here: a 0.5× band is a 4×
 * penalty, a 0.35× band is an ~8× penalty.
 *
 * Tuning notes:
 *   - Band 25 → no damping. A bird observed in your neighborhood is
 *     as plausible as a bird in the ecoregion-level .bin says it
 *     should be. (Usually both agree.)
 *   - Band 50 → 0.85×. Small penalty for "observed in your metro
 *     but not your block". Still allows confirmation with typical
 *     3–4 hits instead of 2–3.
 *   - Band 100 → 0.70×. Noticeable penalty. County-scale presence
 *     isn't a strong field-level signal.
 *   - Band 200 → 0.50×. Half-strength. A bird logged at this
 *     distance is probably not in the user's yard right now.
 *   - Band 500 → 0.35×. Near the .bin floor. Species is in the
 *     region but the nearest observation is already far.
 *   - null (not seen) → falls through to the .bin binary check,
 *     which applies OUT_OF_REGION_MULTIPLIER (0.5×) if out-of-ecoregion
 *     or 1.0× otherwise. We specifically do NOT apply our own
 *     multiplier here because iNat absence ≠ species absence
 *     (coverage gaps).
 */
export const BAND_TO_DAMPING: Record<LocalRadiusKm, number> = {
  25: 1.0,
  50: 0.85,
  100: 0.7,
  200: 0.5,
  500: 0.35,
};

/**
 * Popularity bonuses by distance band, added to the base (pageview-
 * derived) popularity in useBirdex's visible-bucket ordering.
 *
 * The values are chosen to be large enough that a nearby sparrow
 * outranks a globally famous species that doesn't occur locally,
 * without completely overwhelming the pageview prior for borderline
 * cases. The pageview scores in species-regions.bin are log-scaled
 * uint16 values (0..65535), typically clustering 2k–30k for
 * well-known birds; a bonus of a few thousand is meaningful but
 * not overwhelming.
 *
 * Band-to-bonus values are multiplied by POPULARITY_BONUS_SCALE on
 * read so the magnitudes can be tuned without touching this table.
 */
export const BAND_TO_POPULARITY_BONUS: Record<LocalRadiusKm, number> = {
  25: 4000,
  50: 2500,
  100: 1500,
  200: 700,
  500: 300,
};
export const POPULARITY_BONUS_SCALE = 1.0;

/** iNat's /v1/observations/species_counts page size max. */
const SPECIES_COUNTS_PAGE_SIZE = 500;

interface InatTaxon {
  id: number;
  name: string;
  rank?: string;
  iconic_taxon_name?: string;
}

interface InatSpeciesCountResult {
  count: number;
  taxon: InatTaxon;
}

interface InatSpeciesCountResponse {
  total_results?: number;
  page?: number;
  per_page?: number;
  results?: InatSpeciesCountResult[];
}

interface InatObservationGeojsonPoint {
  coordinates?: [number, number]; // [lon, lat] per GeoJSON convention
}

interface InatObservation {
  id: number;
  geojson?: InatObservationGeojsonPoint;
  location?: string; // "lat,lon" string
}

interface InatObservationsResponse {
  results?: InatObservation[];
}

/**
 * Compute approximate great-circle distance between two lat/lon points
 * in kilometers. Simple haversine — accurate enough for our
 * "how far is the nearest observation" use case (we only need to
 * know distance to the km, not the meter).
 */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Map a raw distance in km to the discrete band used by the damping +
 * ranking tables. Distances within or equal to a band boundary are
 * assigned to that band. Distances beyond the outermost radius
 * return null.
 */
export function distanceToBand(distanceKm: number): LocalBand {
  for (const radius of LOCAL_RADII_KM) {
    if (distanceKm <= radius) return radius;
  }
  return null;
}

/**
 * Interpolate a damping multiplier from a precise distance in km.
 * Uses the BAND_TO_DAMPING table as control points (each band's
 * damping is treated as the multiplier AT that radius) and linearly
 * interpolates between adjacent bands for distances in between.
 *
 * Examples (with default table):
 *   0 km    → 1.00 (anchored at band 25)
 *   25 km   → 1.00
 *   40 km   → 0.91 (linearly between 1.00 at 25 and 0.85 at 50)
 *   50 km   → 0.85
 *   75 km   → 0.775 (between 0.85 at 50 and 0.70 at 100)
 *   500 km  → 0.35
 *   1000 km → 0.35 (clamped at the outermost band; callers compose
 *                   with the .bin binary signal to get a 0.5× floor
 *                   via OUT_OF_REGION_MULTIPLIER when the species is
 *                   truly out-of-ecoregion)
 *
 * We DON'T extrapolate below the outermost band; callers should
 * compose this with the .bin binary signal (i.e. "no iNat refinement
 * beyond 500 km; defer to ecoregion data").
 */
export function interpolateDamping(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 1;
  const firstRadius = LOCAL_RADII_KM[0];
  const lastRadius = LOCAL_RADII_KM[LOCAL_RADII_KM.length - 1];
  if (distanceKm <= firstRadius) return BAND_TO_DAMPING[firstRadius];
  if (distanceKm >= lastRadius) return BAND_TO_DAMPING[lastRadius];
  for (let i = 0; i < LOCAL_RADII_KM.length - 1; i++) {
    const lo = LOCAL_RADII_KM[i];
    const hi = LOCAL_RADII_KM[i + 1];
    if (distanceKm <= hi) {
      const t = (distanceKm - lo) / (hi - lo);
      return BAND_TO_DAMPING[lo] + t * (BAND_TO_DAMPING[hi] - BAND_TO_DAMPING[lo]);
    }
  }
  // Unreachable given the early-return at lastRadius.
  return BAND_TO_DAMPING[lastRadius];
}

/**
 * Build the species_counts URL for one radius query. Extracted for
 * testability (fetch can be stubbed by URL shape).
 */
function buildSpeciesCountsUrl(params: {
  lat: number;
  lon: number;
  radiusKm: number;
  page: number;
}): string {
  const url = new URL(
    'https://api.inaturalist.org/v1/observations/species_counts',
  );
  url.searchParams.set('lat', String(params.lat));
  url.searchParams.set('lng', String(params.lon));
  url.searchParams.set('radius', String(params.radiusKm));
  url.searchParams.set('iconic_taxa', 'Aves');
  url.searchParams.set('quality_grade', 'research');
  url.searchParams.set('per_page', String(SPECIES_COUNTS_PAGE_SIZE));
  url.searchParams.set('page', String(params.page));
  // Only observations from the last LOOKBACK_YEARS years.
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - LOOKBACK_YEARS);
  url.searchParams.set('d1', since.toISOString().slice(0, 10));
  return url.toString();
}

/**
 * Fetch all species_counts pages for a single radius. Returns a
 * flat list of results. iNat returns up to 500 per page; in very
 * birdy regions the outer radii can exceed a single page, so we
 * paginate. Capped at 4 pages (2000 species) as a safety; birds are
 * 10k species globally so no realistic radius returns more.
 */
async function fetchSpeciesCountsForRadius(
  lat: number,
  lon: number,
  radiusKm: number,
  signal?: AbortSignal,
): Promise<InatSpeciesCountResult[]> {
  const results: InatSpeciesCountResult[] = [];
  const MAX_PAGES = 4;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = buildSpeciesCountsUrl({ lat, lon, radiusKm, page });
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!res.ok) {
      // Treat a failed page as end-of-data. A non-OK first page will
      // bubble up as an empty list, which the caller handles by
      // falling through to the .bin-only behavior.
      break;
    }
    const data = (await res.json()) as InatSpeciesCountResponse;
    const chunk = data.results ?? [];
    results.push(...chunk);
    if (chunk.length < SPECIES_COUNTS_PAGE_SIZE) break;
  }

  return results;
}

/**
 * Phase A — one-shot local species survey. Fires the 5 nested radii
 * requests in parallel and folds the results into a single
 * scientific-name → entry map.
 *
 * Iteration order matters: by iterating radii from SMALLEST to
 * LARGEST and only writing a band the FIRST time we encounter a
 * species, we naturally assign each species to its tightest band.
 * The count we store is the count from the band we assigned (the
 * closest one the species was seen in) — this tends to under-count
 * total presence but aligns the magnitude with the band meaning
 * ("this many observations within this radius").
 *
 * The returned map's keys are lowercased scientific names; keep
 * lookups case-insensitive by lowercasing before lookup.
 */
export async function fetchLocalSpeciesBands(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<LocalSpeciesMap> {
  // Fan out all 5 radii in parallel. iNat rate limits are per-IP at
  // 60 req/min soft, so 5 concurrent requests are fine.
  const perRadius = await Promise.all(
    LOCAL_RADII_KM.map((radius) =>
      fetchSpeciesCountsForRadius(lat, lon, radius, signal).catch(() => []),
    ),
  );

  const map: LocalSpeciesMap = new Map();

  // Smallest → largest. First write wins (tightest band).
  for (let i = 0; i < LOCAL_RADII_KM.length; i++) {
    const radius = LOCAL_RADII_KM[i];
    const entries = perRadius[i];
    for (const entry of entries) {
      const sciName = entry.taxon?.name;
      if (typeof sciName !== 'string' || sciName.length === 0) continue;
      // iconic_taxa=Aves should have already filtered to birds, but
      // defensively skip any non-species rank (genus, etc.).
      if (entry.taxon.rank && entry.taxon.rank !== 'species') continue;
      const key = sciName.toLowerCase();
      if (map.has(key)) continue; // already assigned a tighter band
      map.set(key, { band: radius, count: entry.count });
    }
  }

  return map;
}

/**
 * Parse an iNat observation's coordinates. The API returns either a
 * GeoJSON-style `geojson.coordinates: [lon, lat]` or a legacy
 * `location: "lat,lon"` string depending on endpoint version.
 * Handles both defensively.
 */
function parseObservationCoords(
  obs: InatObservation,
): { lat: number; lon: number } | null {
  const geo = obs.geojson?.coordinates;
  if (
    Array.isArray(geo) &&
    geo.length === 2 &&
    typeof geo[0] === 'number' &&
    typeof geo[1] === 'number'
  ) {
    return { lon: geo[0], lat: geo[1] };
  }
  const loc = obs.location;
  if (typeof loc === 'string' && loc.includes(',')) {
    const [latStr, lonStr] = loc.split(',').map((s) => s.trim());
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}

/**
 * Phase B — lazy refinement. Look up the single nearest research-grade
 * observation for a given taxon and compute the exact distance in km.
 * Used for graded confidence damping when we want more resolution
 * than the 5-band table provides.
 *
 * Returns null if no observation was found within the outermost
 * radius, or on any network/parse error. Callers should treat null as
 * "unknown" and fall through to the .bin-based signal.
 */
export async function fetchNearestObservationDistance(
  inatTaxonId: number,
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<number | null> {
  const url = new URL('https://api.inaturalist.org/v1/observations');
  url.searchParams.set('taxon_id', String(inatTaxonId));
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lon));
  url.searchParams.set(
    'radius',
    String(LOCAL_RADII_KM[LOCAL_RADII_KM.length - 1]),
  );
  url.searchParams.set('quality_grade', 'research');
  url.searchParams.set('order_by', 'distance');
  url.searchParams.set('per_page', '1');
  // Lookback window aligned with the bulk query.
  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - LOOKBACK_YEARS);
  url.searchParams.set('d1', since.toISOString().slice(0, 10));

  try {
    const res = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as InatObservationsResponse;
    const obs = data.results?.[0];
    if (!obs) return null;
    const coords = parseObservationCoords(obs);
    if (!coords) return null;
    return haversineKm({ lat, lon }, coords);
  } catch {
    return null;
  }
}

/**
 * Build a stable cache key string for a coarse lat/lon. The map is
 * already keyed to 1°-rounded coords; this just formats them.
 */
export function coordKey(lat: number, lon: number): string {
  return `${lat},${lon}`;
}

/**
 * Look up a species by scientific name (case-insensitive) in a local
 * species map. Convenience accessor so callers don't have to
 * remember to lowercase.
 */
export function lookupLocal(
  map: LocalSpeciesMap | null | undefined,
  scientificName: string,
): LocalSpeciesEntry | undefined {
  if (!map) return undefined;
  return map.get(scientificName.toLowerCase());
}

/**
 * Serialize a LocalSpeciesMap into a plain object for storage. Map
 * iteration preserves insertion order but the object representation
 * doesn't need to; we're only keyed by species name.
 */
export function serializeMap(
  map: LocalSpeciesMap,
): Record<string, LocalSpeciesEntry> {
  const out: Record<string, LocalSpeciesEntry> = {};
  for (const [key, value] of map) {
    out[key] = value;
  }
  return out;
}

/** Inverse of serializeMap. */
export function deserializeMap(
  obj: Record<string, LocalSpeciesEntry>,
): LocalSpeciesMap {
  const out: LocalSpeciesMap = new Map();
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== 'object') continue;
    if (
      typeof value.count !== 'number' ||
      (value.band !== null &&
        !LOCAL_RADII_KM.includes(value.band as LocalRadiusKm))
    ) {
      continue;
    }
    out.set(key, { band: value.band, count: value.count });
  }
  return out;
}
