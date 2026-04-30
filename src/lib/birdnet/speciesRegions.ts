// Species-regions table.
//
// Maps each BirdNET label to a set of "places" where the species is
// plausibly found. A place is a short string code:
//
//   Continent codes: "NA", "SA", "EU", "AF", "AS", "OC", "AN", "MARINE"
//     (the 8 REGION bits from @/lib/geo/continent)
//
//   Country codes:   ISO 3166-1 alpha-2, e.g. "US", "MX", "FR", "AU"
//
//   Subdivisions:    "<country>-<subdivision>", e.g.
//                    "US-TX"  (Texas)
//                    "CA-ON"  (Ontario)
//                    "AU-NSW" (New South Wales)
//                    "IN-TN"  (Tamil Nadu)
//                    "BR-SP"  (São Paulo)
//
// This is richer than the old 8-bit bitmask: "Birds of Texas" maps to
// "US-TX" rather than collapsing into "NA". At runtime a user resolves to
// a hierarchical PlaceSet (see `@/lib/geo/continent.resolveUserPlaces`)
// and a species matches if any of its places is in the user's set.
//
// Binary format (BRN3 — BRN2 with an appended popularity field):
//
//   magic         4 bytes  "BRN3"
//   label_count   4 bytes  uint32 LE
//   place_count   2 bytes  uint16 LE                 // distinct places across all species
//   dict          place_count × (uint8 length + bytes) // UTF-8, length 1..63
//   offsets       (label_count + 1) × uint32 LE        // cumulative into id_blob entries
//   id_blob       totalIds × uint16 LE               // dictionary indices
//   popularity    label_count × uint16 LE            // log-scaled pageviews (0=unknown)
//
// For label `i`, its place ids are `id_blob[offsets[i] .. offsets[i+1]]`.
// An empty range means "range unknown" — the runtime treats that as
// "could be anywhere" so missing data never damps a real detection or
// excludes a plausibly-local species from the user's list.
//
// Popularity is the integer `round(log10(pageviews_per_day + 1) * 5000)`
// baked in by the scraper from the Wikipedia pageviews API. The log scale
// keeps sought-after rarities within an order of magnitude of household
// names rather than being drowned out: at 50k req/day (Bald Eagle) the
// score is ~23500, at 100/day ~10000, at 2/day ~2384. A value of 0 means
// "pageviews unknown" (article not resolved, script failed, etc.) — the
// runtime treats unknown as a low-but-nonzero score so those species
// sink to the bottom of the visible birdex rather than being hidden.
//
// BRN2 files are rejected at load: the popularity field is load-bearing
// for the visible-birdex UX and silently defaulting to zero would hide
// every bird. Users pick up the new file on next page load.
//
// The file is built offline by `scripts/build-species-regions.ts`, which
// scrapes Wikipedia's category system ("Birds of <place>", "Endemic birds
// of <place>", etc.) and maps each place name into one of the codes above.

import type { RegionCode } from '@/lib/geo/continent.regions';
import { REGION } from '@/lib/geo/continent.regions';

const TABLE_URL = '/birdnet/species-regions.bin';
const MAGIC = [0x42, 0x52, 0x4e, 0x33]; // "BRN3"
const MAX_PLACE_LABEL_LEN = 63;

/** A place code. See the file header for the grammar. */
export type Place = string;

export interface SpeciesRegionsTable {
  /** Has the table been fetched + parsed successfully? When false the
   * runtime pretends every species is "in region everywhere" so missing
   * data is never the reason to exclude a bird. */
  loaded: boolean;
  /** Number of label slots in the table (0 when not loaded). */
  labelCount: number;
  /** Look up the places for a given BirdNET label index. Returns an empty
   * array when the index is out of range or the species has no data. */
  placesForLabel(labelIndex: number): readonly Place[];
  /** Iterate every label index whose place list contains any of the
   * given places. Used by the birdex to enumerate locals efficiently
   * without scanning every label individually. */
  labelsMatchingAny(places: ReadonlySet<Place>): number[];
  /** Log-scaled Wikipedia pageview score for a label (see file header
   * for scaling). 0 means "unknown / not resolved". Used to rank the
   * visible birdex — highest scores first. */
  popularityFor(labelIndex: number): number;
}

const EMPTY_TABLE: SpeciesRegionsTable = {
  loaded: false,
  labelCount: 0,
  placesForLabel: () => EMPTY_PLACE_LIST,
  labelsMatchingAny: () => [],
  popularityFor: () => 0,
};
const EMPTY_PLACE_LIST: readonly Place[] = Object.freeze([]);

let tablePromise: Promise<SpeciesRegionsTable> | null = null;

/**
 * Fetch and parse the species-regions table. Returns an empty table on
 * any failure (missing file, wrong magic, size mismatch, network error)
 * so callers can treat the absence of data as "don't damp or filter
 * anything" without special-casing.
 *
 * `expectedLabelCount` is compared against the table's header; a mismatch
 * indicates the bin file was generated against a different labels file,
 * in which case we can't trust the index-to-species mapping.
 */
export async function loadSpeciesRegions(
  expectedLabelCount: number,
): Promise<SpeciesRegionsTable> {
  if (tablePromise) return tablePromise;

  tablePromise = (async (): Promise<SpeciesRegionsTable> => {
    let res: Response;
    try {
      res = await fetch(TABLE_URL);
    } catch {
      return EMPTY_TABLE;
    }
    if (!res.ok) return EMPTY_TABLE;

    let buffer: ArrayBuffer;
    try {
      buffer = await res.arrayBuffer();
    } catch {
      return EMPTY_TABLE;
    }

    const parsed = parseTable(buffer, expectedLabelCount);
    return parsed ?? EMPTY_TABLE;
  })();

  tablePromise.catch(() => {
    tablePromise = null;
  });

  return tablePromise;
}

/**
 * Parse a BRN2 file. Separated from `loadSpeciesRegions` for easier unit
 * testing. Returns null on any structural mismatch.
 */
export function parseTable(
  buffer: ArrayBuffer,
  expectedLabelCount: number,
): SpeciesRegionsTable | null {
  if (buffer.byteLength < 10) {
    console.warn('[speciesRegions] table too small, ignoring');
    return null;
  }
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) {
      console.warn('[speciesRegions] bad magic, ignoring table');
      return null;
    }
  }
  const view = new DataView(buffer);
  const labelCount = view.getUint32(4, /* le */ true);
  if (labelCount !== expectedLabelCount) {
    console.warn(
      `[speciesRegions] label count mismatch (table=${labelCount}, labels=${expectedLabelCount}); ignoring`,
    );
    return null;
  }
  const placeCount = view.getUint16(8, /* le */ true);

  // Parse dictionary.
  const dict: Place[] = [];
  let off = 10;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  for (let i = 0; i < placeCount; i++) {
    if (off + 1 > bytes.length) {
      console.warn('[speciesRegions] truncated dict');
      return null;
    }
    const len = bytes[off];
    off += 1;
    if (len > MAX_PLACE_LABEL_LEN) {
      console.warn(`[speciesRegions] dict entry too long (${len})`);
      return null;
    }
    if (off + len > bytes.length) {
      console.warn('[speciesRegions] truncated dict entry');
      return null;
    }
    const str = decoder.decode(bytes.subarray(off, off + len));
    dict.push(str);
    off += len;
  }

  // Offsets: (label_count + 1) uint32 LE.
  const offsetsStart = off;
  const offsetsEnd = offsetsStart + (labelCount + 1) * 4;
  if (offsetsEnd > bytes.length) {
    console.warn('[speciesRegions] truncated offset table');
    return null;
  }
  // Uint32Array requires 4-byte alignment. Since the dict is
  // variable-length the offset table usually isn't aligned; copy into a
  // fresh buffer when needed rather than failing to construct the view.
  let offsets: Uint32Array;
  if (offsetsStart % 4 === 0) {
    offsets = new Uint32Array(buffer, offsetsStart, labelCount + 1);
  } else {
    offsets = new Uint32Array(labelCount + 1);
    for (let i = 0; i <= labelCount; i++) {
      const p = offsetsStart + i * 4;
      offsets[i] =
        bytes[p] |
        (bytes[p + 1] << 8) |
        (bytes[p + 2] << 16) |
        (bytes[p + 3] << 24);
    }
  }
  // Offsets must be non-decreasing; final offset is the total uint16 count.
  for (let i = 1; i <= labelCount; i++) {
    if (offsets[i] < offsets[i - 1]) {
      console.warn('[speciesRegions] non-monotonic offset table');
      return null;
    }
  }
  const totalIds = offsets[labelCount];

  const idsStart = offsetsEnd;
  const idsEnd = idsStart + totalIds * 2;
  if (idsEnd > bytes.length) {
    console.warn('[speciesRegions] truncated id blob');
    return null;
  }
  // Uint16Array requires 2-byte alignment; copy if the offset isn't aligned.
  let ids: Uint16Array;
  if (idsStart % 2 === 0) {
    ids = new Uint16Array(buffer, idsStart, totalIds);
  } else {
    ids = new Uint16Array(totalIds);
    for (let i = 0; i < totalIds; i++) {
      ids[i] = bytes[idsStart + i * 2] | (bytes[idsStart + i * 2 + 1] << 8);
    }
  }

  // Validate all ids point into the dict.
  for (let i = 0; i < totalIds; i++) {
    if (ids[i] >= placeCount) {
      console.warn('[speciesRegions] id blob contains out-of-range dict ref');
      return null;
    }
  }

  // Popularity: label_count × uint16 LE, log-scaled pageviews.
  const popStart = idsEnd;
  const popEnd = popStart + labelCount * 2;
  if (popEnd > bytes.length) {
    console.warn('[speciesRegions] truncated popularity table');
    return null;
  }
  let popularity: Uint16Array;
  if (popStart % 2 === 0) {
    popularity = new Uint16Array(buffer, popStart, labelCount);
  } else {
    popularity = new Uint16Array(labelCount);
    for (let i = 0; i < labelCount; i++) {
      popularity[i] =
        bytes[popStart + i * 2] | (bytes[popStart + i * 2 + 1] << 8);
    }
  }

  const placesForLabel = (labelIndex: number): readonly Place[] => {
    if (labelIndex < 0 || labelIndex >= labelCount) return EMPTY_PLACE_LIST;
    const start = offsets[labelIndex];
    const end = offsets[labelIndex + 1];
    if (start === end) return EMPTY_PLACE_LIST;
    const out = new Array<Place>(end - start);
    for (let i = 0; i < out.length; i++) out[i] = dict[ids[start + i]];
    return out;
  };

  // Inverted lookup: place → list of label indices. Built lazily because
  // most callers only need the forward lookup (labelsMatchingAny is used
  // by the birdex at mount, placesForLabel is used per-cell).
  let inverted: Map<Place, number[]> | null = null;
  const buildInverted = (): Map<Place, number[]> => {
    const m = new Map<Place, number[]>();
    for (let label = 0; label < labelCount; label++) {
      const start = offsets[label];
      const end = offsets[label + 1];
      for (let j = start; j < end; j++) {
        const place = dict[ids[j]];
        let arr = m.get(place);
        if (!arr) {
          arr = [];
          m.set(place, arr);
        }
        arr.push(label);
      }
    }
    return m;
  };

  const labelsMatchingAny = (places: ReadonlySet<Place>): number[] => {
    if (places.size === 0) return [];
    if (!inverted) inverted = buildInverted();
    const seen = new Set<number>();
    for (const place of places) {
      const arr = inverted.get(place);
      if (!arr) continue;
      for (const idx of arr) seen.add(idx);
    }
    return Array.from(seen);
  };

  return {
    loaded: true,
    labelCount,
    placesForLabel,
    labelsMatchingAny,
    popularityFor: (labelIndex: number): number => {
      if (labelIndex < 0 || labelIndex >= labelCount) return 0;
      return popularity[labelIndex];
    },
  };
}

/**
 * Classify a species relative to the user's place set (subdivision +
 * country + continent).
 *
 *   in-region     — at least one of the species' places matches the user's.
 *   out-of-region — species has place data, none of it matches.
 *   unknown       — species has no place data, or the table isn't loaded.
 *
 * The birdex uses this tri-state: "unknown" species join the birdex
 * (being conservative about missing data) while "out-of-region" species
 * only surface if the user has actually heard one (rare finds).
 */
export type SpeciesRegionStatus = 'in-region' | 'out-of-region' | 'unknown';

export function classifySpeciesInRegion(
  labelIndex: number,
  userPlaces: ReadonlySet<Place>,
  table: SpeciesRegionsTable,
): SpeciesRegionStatus {
  if (!table.loaded) return 'unknown';
  const places = table.placesForLabel(labelIndex);
  if (places.length === 0) return 'unknown';
  // Worldwide / pelagic species count as in-region everywhere.
  for (const p of places) {
    if (p === 'MARINE') return 'in-region';
    if (userPlaces.has(p)) return 'in-region';
  }
  return 'out-of-region';
}

/**
 * Same predicate as `classifySpeciesInRegion !== 'out-of-region'` but
 * inlined for hot use. The confidence-damping path calls this once per
 * prediction tick and benefits from skipping the string status return.
 *
 * Note the asymmetry: for damping we treat "unknown" as in-region (so
 * missing data never damps a real detection), same as the old
 * `isSpeciesInRegion` behavior.
 */
export function isSpeciesInRegion(
  labelIndex: number,
  userPlaces: ReadonlySet<Place>,
  table: SpeciesRegionsTable,
): boolean {
  if (!table.loaded) return true;
  const places = table.placesForLabel(labelIndex);
  if (places.length === 0) return true;
  for (const p of places) {
    if (p === 'MARINE') return true;
    if (userPlaces.has(p)) return true;
  }
  return false;
}

/** Compatibility helper — some callers only have a RegionCode. Wraps it
 * as a single-element set so existing call sites don't need to know about
 * the richer Place model. */
export function regionAsPlaceSet(region: RegionCode): ReadonlySet<Place> {
  return new Set<Place>([region]);
}

// Suppress "REGION imported but unused" — REGION is re-exported-via-type-
// import in other files; keeping a reference here also documents the
// continent code set that `Place` extends.
void REGION;

/** Test helper — reset the module-level cache so unit tests can re-mock. */
export function __resetSpeciesRegionsForTest(): void {
  tablePromise = null;
}
