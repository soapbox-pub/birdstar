// Coarse lat/lon → continent / country / subdivision resolver.
//
// We deliberately don't ship a polygon-based geocoder — city-accurate
// political boundaries would require a large shapefile or an online
// service. Instead we use axis-aligned bounding boxes, which are accurate
// enough for avifaunal filtering: being wrong by a few dozen km inland
// only shifts a bird between adjacent US states or adjacent European
// countries, which is a cosmetic rather than factual error for a "what
// birds are near you" list.
//
// Two resolver shapes are exposed:
//
//   resolveContinent(lat, lon) → RegionCode | null
//     Legacy signature kept for the confidence-damping path. Returns
//     just the coarse continent.
//
//   resolveUserPlaces(lat, lon) → UserPlaceSet | null
//     The new call the checklist roster uses. Returns the full hierarchy
//     of places the user is in — e.g. { continent: 'NA', country: 'US',
//     subdivision: 'US-TX' }, plus a flattened Set<Place> for matching.
//
// Subdivisions are only emitted for countries where Wikipedia has useful
// "Birds of <subdivision>" categories: US states, Canadian provinces,
// Australian states/territories, Indian states, and Brazilian states. For
// every other country we stop at the country level.

import { REGION, type RegionCode } from '@/lib/geo/continent.regions';

export { REGION } from '@/lib/geo/continent.regions';
export type { RegionCode, RegionMask } from '@/lib/geo/continent.regions';

/** A place code string: continent ("NA"), country ("US"), or
 * subdivision ("US-TX"). Matches the grammar in
 * `@/lib/birdnet/speciesRegions`. */
export type Place = string;

/**
 * The user's resolved location as a hierarchy plus a flat set. All fields
 * are optional except `continent` and `places`. The flat `places` set is
 * what `classifySpeciesInRegion` / `isSpeciesInRegion` match against.
 */
export interface UserPlaceSet {
  continent: RegionCode;
  country?: string;
  subdivision?: string;
  /** Flattened: always contains at minimum `continent`, plus `country`
   * and `subdivision` when those are known. */
  places: ReadonlySet<Place>;
}

// ---------------------------------------------------------------------------
// Continent resolution (original bounding-box classifier).
// ---------------------------------------------------------------------------

/**
 * Resolve a lat/lon fix to a single continent code. Returns null for
 * clearly-invalid input. Never returns MARINE — that bucket only makes
 * sense for species coded as pelagic, not for a user's location.
 */
export function resolveContinent(
  latitude: number,
  longitude: number,
): RegionCode | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  let lon = longitude;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  const lat = latitude;

  if (lat <= -60) return 'AN';

  // Oceania
  if (lat <= -10 && lon >= 110 && lon <= 180) return 'OC';
  if (lat <= 0 && lat > -10 && lon >= 130 && lon <= 180) return 'OC';
  if (lat <= -30 && lat > -60 && lon >= 160) return 'OC';
  if (lat <= -30 && lat > -60 && lon <= -170) return 'OC';

  // South America
  if (lat <= 13 && lat >= -60 && lon >= -82 && lon <= -34) return 'SA';

  // North America
  if (lat >= 7 && lon >= -170 && lon <= -50) return 'NA';
  if (lat >= 50 && lon >= 170) return 'NA';

  // Africa
  if (lat >= -35 && lat <= 37 && lon >= -20 && lon <= 52) return 'AF';
  if (lat >= -30 && lat <= 0 && lon > 52 && lon <= 65) return 'AF';

  // Europe
  if (lat >= 36 && lat <= 72 && lon >= -25 && lon <= 60) return 'EU';
  if (lat >= 63 && lat <= 70 && lon >= -25 && lon <= -10) return 'EU';

  // Asia
  if (lat >= -10 && lat <= 80 && lon >= 25 && lon <= 180) return 'AS';

  if (lon >= -170 && lon <= -30) return lat >= 0 ? 'NA' : 'SA';
  if (lon > -30 && lon < 60) return lat >= 35 ? 'EU' : 'AF';
  return lat >= 0 ? 'AS' : 'OC';
}

/** Convert a region code into its bitmask bit. */
export function regionToMask(region: RegionCode): number {
  return REGION[region];
}

// ---------------------------------------------------------------------------
// Country + subdivision resolution.
//
// Each entry is a rectangle that, when hit, narrows the user down to a
// specific country (and optionally a subdivision within that country).
// Checks are ordered most-specific-first: subdivisions before their
// countries, then the country-only fallbacks. A user who lands outside
// every bounding box keeps just their continent — the roster will still
// work, just coarser.
//
// Bounding boxes are intentionally generous at coastal edges so a user
// hiking near a border lands in the obvious jurisdiction even if their
// GPS fix drifts a few km. For overlapping boxes the first match wins
// (the table is ordered so the most-specific option is listed first).
// ---------------------------------------------------------------------------

interface PlaceBox {
  /** [minLat, maxLat, minLon, maxLon] */
  box: [number, number, number, number];
  /** ISO country code. */
  country?: string;
  /** Optional subdivision code, e.g. "AU-NSW" or a US ecoregion code like
   * "US-SW". Ecoregion codes are not ISO 3166-2 — they match the codes
   * emitted by the scraper (see `scripts/build-species-regions.ts` and
   * the header comment there). */
  subdivision?: string;
  /** Extra disqualifier. */
  notWhen?: (lat: number, lon: number) => boolean;
}

// US ecoregion boxes. A point can match several (they overlap
// intentionally): a user in central Texas lands in US-SE + US-MW + US-SW,
// which is the union of "Native birds of..." regions Wikipedia uses for
// species there. Broad overlaps are fine because the roster uses set
// intersection — being in an extra ecoregion only adds candidates to
// the roster, never removes correct ones.
const US_ECOREGIONS: PlaceBox[] = [
  // Hawaii (state-only place)
  { box: [18.5, 22.5, -161, -154.5], country: 'US', subdivision: 'US-HI' },
  // Alaska
  { box: [51.0, 72.0, -180, -130], country: 'US', subdivision: 'US-AK' },
  { box: [51.0, 72.0, 170, 180], country: 'US', subdivision: 'US-AK' },

  // Northeast US — New England + Mid-Atlantic
  { box: [37.0, 47.5, -80.5, -66.9], country: 'US', subdivision: 'US-NE' },
  // Southeast US — Gulf coast, Florida, southern Appalachia, east
  // Texas into the Hill Country. Extends west to -99 so central-Texas
  // users (Austin, San Antonio) land in SE — Wikipedia categorizes much
  // of central Texas's avifauna as "Native birds of the Southeastern US".
  { box: [24.5, 39.5, -99.0, -75.0], country: 'US', subdivision: 'US-SE' },
  // Plains-Midwest — Great Plains + upper Midwest + Ohio valley.
  // Extends into north/central Texas; overlaps SE at the east, SW at
  // the west. Intentional (central Texas species carry both tags on WP).
  { box: [30.0, 49.1, -104.5, -82.0], country: 'US', subdivision: 'US-MW' },
  // Southwest US — desert SW + west/central Texas.
  { box: [25.8, 37.5, -114.9, -97.5], country: 'US', subdivision: 'US-SW' },
  // Rocky Mountains — MT/ID/WY/CO/NM spine
  { box: [33.0, 49.1, -115.0, -103.0], country: 'US', subdivision: 'US-RM' },
  // Northwest US (inland) — ID, eastern WA/OR
  { box: [41.5, 49.1, -124.8, -111.0], country: 'US', subdivision: 'US-NW' },
  // West Coast — coastal CA/OR/WA
  { box: [32.4, 49.1, -125.0, -119.5], country: 'US', subdivision: 'US-WC' },

  // Texas-specific ecoregions
  // Rio Grande Valley — south Texas border.
  { box: [25.8, 29.5, -101.0, -96.0], country: 'US', subdivision: 'US-TX-RG' },
  // Chihuahuan Desert — West Texas + SE New Mexico.
  { box: [29.0, 33.5, -106.7, -100.5], country: 'US', subdivision: 'US-TX-CD' },

  // Country-level US fallback — any point inside lower-48 that wasn't
  // captured by any of the boxes above. Caps bottom at 24.0 to avoid
  // matching northern Mexico.
  { box: [24.0, 49.5, -125.0, -66.5], country: 'US' },
];

// Canadian ecoregions (coarser than US — Wikipedia only distinguishes
// east / west / prairies).
const CA_ECOREGIONS: PlaceBox[] = [
  // Canadian prairies (SK + MB + AB south)
  { box: [48.9, 60.1, -114.5, -95.0], country: 'CA', subdivision: 'CA-PR' },
  // Eastern Canada
  { box: [41.6, 62.6, -95.2, -52.0], country: 'CA', subdivision: 'CA-E' },
  // Western Canada (incl. BC, Yukon)
  { box: [48.0, 70.0, -141.1, -109.9], country: 'CA', subdivision: 'CA-W' },
  // Country-level Canada fallback
  { box: [41.6, 84.0, -141.1, -52.0], country: 'CA' },
];

// Mexican ecoregions. Upper latitudes capped at ~30°N to prevent
// Texas/Arizona/New Mexico users from getting spurious MX tags. The
// actual US/MX border ranges 25.8°N (Brownsville) to 32.5°N (El Paso),
// so a clamp at 30 sacrifices a thin border strip — we'd rather a
// Brownsville user not see Chihuahuan Desert species than a Dallas
// user get every Mexican oriole.
const MX_ECOREGIONS: PlaceBox[] = [
  // Baja California
  { box: [22.5, 30.0, -118.5, -109.4], country: 'MX', subdivision: 'MX-NW' },
  // Northeastern (Chihuahua, Coahuila)
  { box: [23.5, 30.0, -108.0, -98.0], country: 'MX', subdivision: 'MX-NE' },
  // Western (Sinaloa, Jalisco, Michoacán)
  { box: [17.5, 27.5, -109.5, -100.0], country: 'MX', subdivision: 'MX-W' },
  // Eastern (Tamaulipas, Veracruz)
  { box: [17.0, 25.5, -98.5, -93.5], country: 'MX', subdivision: 'MX-E' },
  // Central (México City, Puebla plateau)
  { box: [18.0, 22.5, -102.0, -96.5], country: 'MX', subdivision: 'MX-C' },
  // Southern (Oaxaca, Chiapas, Yucatán)
  { box: [14.5, 19.5, -98.5, -86.6], country: 'MX', subdivision: 'MX-S' },
  // Country-level Mexico fallback. Capped at 28 to avoid matching
  // south Texas (Brownsville lat 25.9 still falls through to US here —
  // we'd rather a Brownsville user miss "MX" than a Houston user pick
  // it up; country-level MX species are still reachable via the NA
  // continent tag).
  { box: [14.5, 28.0, -118.5, -86.6], country: 'MX' },
];

// Australia (states + territories)
const AU_STATES: PlaceBox[] = [
  { box: [-39.2, -33.9, 140.9, 150.0], country: 'AU', subdivision: 'AU-VIC' },
  { box: [-43.7, -39.5, 143.8, 148.5], country: 'AU', subdivision: 'AU-TAS' },
  { box: [-37.5, -28.1, 140.9, 153.7], country: 'AU', subdivision: 'AU-NSW' },
  { box: [-35.3, -33.7, 148.7, 149.4], country: 'AU', subdivision: 'AU-ACT' },
  { box: [-29.2, -9.2, 137.9, 153.6], country: 'AU', subdivision: 'AU-QLD' },
  { box: [-26.1, -10.9, 129.0, 138.0], country: 'AU', subdivision: 'AU-NT' },
  { box: [-38.1, -25.9, 128.9, 141.1], country: 'AU', subdivision: 'AU-SA' },
  { box: [-35.2, -13.5, 112.9, 129.1], country: 'AU', subdivision: 'AU-WA' },
];

// India — major states only; using the subset that Wikipedia's "Birds of
// <state>" categories actually cover reasonably well. Bounding boxes are
// very approximate because Indian state borders are complex; for
// avifaunal filtering this is fine.
const IN_STATES: PlaceBox[] = [
  { box: [8.0, 13.6, 76.2, 80.4], country: 'IN', subdivision: 'IN-TN' }, // Tamil Nadu
  { box: [8.1, 12.9, 74.8, 77.5], country: 'IN', subdivision: 'IN-KL' }, // Kerala
  { box: [11.5, 18.5, 74.0, 78.6], country: 'IN', subdivision: 'IN-KA' }, // Karnataka
  { box: [11.5, 19.9, 76.8, 84.7], country: 'IN', subdivision: 'IN-AP' }, // Andhra Pradesh (approx.)
  { box: [15.6, 22.1, 72.6, 80.9], country: 'IN', subdivision: 'IN-MH' }, // Maharashtra
  { box: [20.1, 24.7, 68.1, 74.5], country: 'IN', subdivision: 'IN-GJ' }, // Gujarat
  { box: [23.1, 30.2, 69.5, 78.3], country: 'IN', subdivision: 'IN-RJ' }, // Rajasthan
  { box: [21.1, 26.9, 74.0, 82.8], country: 'IN', subdivision: 'IN-MP' }, // Madhya Pradesh
  { box: [23.6, 30.5, 77.1, 84.6], country: 'IN', subdivision: 'IN-UP' }, // Uttar Pradesh
  { box: [23.6, 27.0, 83.3, 88.5], country: 'IN', subdivision: 'IN-BR' }, // Bihar
  { box: [21.5, 27.3, 86.0, 90.0], country: 'IN', subdivision: 'IN-WB' }, // West Bengal
  { box: [17.7, 22.6, 81.2, 87.6], country: 'IN', subdivision: 'IN-OR' }, // Odisha
  { box: [26.0, 29.5, 89.6, 96.9], country: 'IN', subdivision: 'IN-AS' }, // Assam
  { box: [28.5, 37.1, 73.2, 79.0], country: 'IN', subdivision: 'IN-JK' }, // Jammu & Kashmir / Ladakh
  { box: [30.2, 33.5, 75.4, 79.4], country: 'IN', subdivision: 'IN-HP' }, // Himachal Pradesh
  { box: [28.5, 32.5, 75.4, 77.1], country: 'IN', subdivision: 'IN-PB' }, // Punjab
  { box: [27.6, 31.0, 77.2, 81.1], country: 'IN', subdivision: 'IN-UT' }, // Uttarakhand
];

// Brazilian states — only a handful of the largest/best-categorized ones.
// The rest fall through to country-level BR.
const BR_STATES: PlaceBox[] = [
  { box: [-25.4, -19.7, -53.1, -44.1], country: 'BR', subdivision: 'BR-SP' },
  { box: [-23.4, -20.7, -44.9, -40.9], country: 'BR', subdivision: 'BR-RJ' },
  { box: [-22.9, -14.2, -51.1, -39.9], country: 'BR', subdivision: 'BR-MG' },
  { box: [-18.4, -8.5, -46.6, -37.3], country: 'BR', subdivision: 'BR-BA' },
  { box: [-5.3, 5.3, -61.4, -46.5], country: 'BR', subdivision: 'BR-PA' },
  { box: [-9.9, -1.0, -73.8, -56.1], country: 'BR', subdivision: 'BR-AM' },
  { box: [-33.8, -27.0, -57.7, -49.7], country: 'BR', subdivision: 'BR-RS' },
];

// Countries without subdivision breakdowns. Keep this list tight — we're
// only encoding the countries whose Wikipedia "Birds of <country>"
// categories the scraper actually consumes. Anything missing falls
// through to continent-only matching, which is still useful.
const COUNTRY_BOXES: PlaceBox[] = [
  // Mexico and US/Canada are handled by the ecoregion tables above.
  { box: [7.0, 18.5, -92.3, -77.2], country: 'GT' }, // Mesoamerica approximated
  { box: [8.3, 11.3, -85.9, -82.5], country: 'CR' },
  { box: [7.1, 9.6, -83.0, -77.1], country: 'PA' },
  { box: [21.4, 23.3, -85.0, -74.1], country: 'CU' },
  // South America country-level (for the states not listed in BR_STATES
  // and all other SA countries).
  { box: [-56.2, 12.4, -82.0, -66.5], country: 'CO', notWhen: (lat, lon) => lat < -5 || lon < -79 || lon > -66 }, // Colombia (approx)
  { box: [-35.3, -21.8, -58.5, -53.6], country: 'UY' }, // crude
  { box: [-55.1, -21.8, -73.6, -53.6], country: 'AR' }, // Argentina whole-country fallback
  { box: [-56.5, -17.5, -76.0, -66.5], country: 'CL' },
  { box: [-18.5, 0.0, -81.4, -68.7], country: 'PE' },
  { box: [-22.9, -9.7, -69.7, -57.5], country: 'BO' },
  { box: [-4.0, 1.5, -81.1, -75.2], country: 'EC' },
  { box: [0.6, 12.2, -73.4, -59.8], country: 'VE' },
  // Europe
  { box: [49.0, 55.1, -6.0, 1.9], country: 'GB' },
  { box: [51.3, 55.5, -10.7, -5.4], country: 'IE' },
  { box: [42.3, 51.1, -4.9, 8.3], country: 'FR' },
  { box: [35.6, 44.0, -9.6, 3.4], country: 'ES' },
  { box: [36.9, 42.2, -9.6, -6.2], country: 'PT' },
  { box: [47.2, 55.1, 5.8, 15.1], country: 'DE' },
  { box: [35.5, 47.1, 6.6, 18.6], country: 'IT' },
  { box: [49.0, 51.6, 2.5, 6.5], country: 'BE' },
  { box: [50.7, 53.6, 3.3, 7.3], country: 'NL' },
  { box: [45.8, 47.9, 5.9, 10.5], country: 'CH' },
  { box: [46.4, 49.0, 9.5, 17.2], country: 'AT' },
  { box: [55.3, 58.0, 8.0, 15.2], country: 'DK' },
  { box: [54.3, 69.1, 4.4, 31.3], country: 'NO' },
  { box: [55.3, 69.1, 11.0, 24.2], country: 'SE' },
  { box: [59.3, 70.1, 19.1, 32.0], country: 'FI' },
  { box: [63.2, 66.6, -25.0, -13.4], country: 'IS' },
  { box: [48.9, 54.9, 14.0, 24.2], country: 'PL' },
  { box: [48.5, 51.1, 12.0, 18.8], country: 'CZ' },
  { box: [47.7, 49.6, 16.8, 22.6], country: 'SK' },
  { box: [45.7, 48.6, 16.1, 22.9], country: 'HU' },
  { box: [43.6, 48.3, 20.3, 29.7], country: 'RO' },
  { box: [40.8, 44.2, 22.3, 28.6], country: 'BG' },
  { box: [34.8, 42.0, 19.3, 29.7], country: 'GR' },
  { box: [35.7, 42.1, 25.7, 44.8], country: 'TR' },
  { box: [44.4, 51.4, 22.1, 40.2], country: 'UA' },
  // Africa (continent-level fallback covers most)
  { box: [30.0, 37.0, -9.9, -1.0], country: 'MA' },
  { box: [21.7, 31.7, 24.6, 36.9], country: 'EG' },
  { box: [3.9, 14.0, 2.5, 14.8], country: 'NG' },
  { box: [-35.1, -22.0, 16.3, 32.9], country: 'ZA' },
  { box: [-5.0, 5.0, 33.8, 42.0], country: 'KE' },
  { box: [-11.8, -1.0, 29.3, 40.5], country: 'TZ' },
  // Middle East & Asia (country-level fallback)
  { box: [13.3, 32.7, 34.3, 56.4], country: 'SA' },
  { box: [29.3, 33.5, 34.2, 35.9], country: 'IL' },
  { box: [25.0, 40.0, 44.0, 63.3], country: 'IR' },
  { box: [23.6, 37.1, 60.9, 77.0], country: 'PK' },
  // India — country-level fallback for states not enumerated above.
  { box: [6.7, 37.1, 68.1, 97.4], country: 'IN' },
  { box: [20.4, 53.6, 73.5, 134.8], country: 'CN' },
  { box: [30.0, 45.6, 129.0, 146.0], country: 'JP' },
  { box: [33.0, 38.7, 124.5, 130.9], country: 'KR' },
  { box: [5.6, 21.4, 97.3, 106.0], country: 'TH' },
  { box: [8.0, 23.4, 102.1, 109.5], country: 'VN' },
  { box: [-11.1, 6.2, 95.0, 141.0], country: 'ID' },
  { box: [5.9, 19.3, 117.1, 126.6], country: 'PH' },
  { box: [-47.3, -34.1, 166.4, 179.0], country: 'NZ' },
  { box: [-10.8, -1.0, 140.9, 155.6], country: 'PG' },
  // Falls back to continent-level for everything else.
];

/**
 * Resolve a lat/lon fix to a full place set (continent + country +
 * ecoregions where available). Returns null for invalid coordinates.
 *
 * Unlike a strict "one subdivision per point" resolver, this matches
 * every ecoregion box the point lies inside. A Texas user in Austin
 * lands in US-SE + US-MW + US-SW simultaneously, reflecting the way
 * Wikipedia actually categorizes the avifauna there (central Texas
 * species carry overlapping region tags). Being in an extra ecoregion
 * only adds candidates to the roster, never removes real ones.
 *
 * The first country/continent match wins for the summary `country` /
 * `subdivision` fields (used for labeling "Texas · United States" in
 * the UI); the full `places` set includes all matches.
 */
export function resolveUserPlaces(
  latitude: number,
  longitude: number,
): UserPlaceSet | null {
  const continent = resolveContinent(latitude, longitude);
  if (!continent) return null;

  const places = new Set<Place>([continent]);
  let country: string | undefined;
  let subdivision: string | undefined;

  const allTables: PlaceBox[][] = [
    US_ECOREGIONS,
    CA_ECOREGIONS,
    MX_ECOREGIONS,
    AU_STATES,
    IN_STATES,
    BR_STATES,
    COUNTRY_BOXES,
  ];

  for (const table of allTables) {
    for (const entry of table) {
      if (!contains(entry.box, latitude, longitude)) continue;
      if (entry.notWhen && entry.notWhen(latitude, longitude)) continue;
      if (entry.country) places.add(entry.country);
      if (entry.subdivision) places.add(entry.subdivision);
      // First match captures the "primary" country and subdivision for
      // display purposes. Subdivision prefers the most-specific (with
      // a dash), which comes first in the tables.
      if (!country && entry.country) country = entry.country;
      if (!subdivision && entry.subdivision) subdivision = entry.subdivision;
    }
  }

  return { continent, country, subdivision, places };
}

function contains(
  box: [number, number, number, number],
  lat: number,
  lon: number,
): boolean {
  return lat >= box[0] && lat <= box[1] && lon >= box[2] && lon <= box[3];
}

/** Build a place set from explicit country / subdivision / continent
 * values — used by the manual fallback picker, where the user chooses a
 * country or subdivision without a GPS fix. */
export function placeSetFor(
  continent: RegionCode,
  country?: string,
  subdivision?: string,
): UserPlaceSet {
  const places = new Set<Place>([continent]);
  if (country) places.add(country);
  if (subdivision) places.add(subdivision);
  return { continent, country, subdivision, places };
}
