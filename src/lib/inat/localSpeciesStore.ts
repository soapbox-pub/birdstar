// IndexedDB-backed cache for the iNaturalist-based local-species signal.
//
// Two object stores:
//
//   localSpecies:
//     Key: coordKey (e.g. "30,-97"). Value: CachedLocalSpecies blob with
//     the full scientific-name → band/count table plus TTL metadata.
//     One entry per 1°-rounded lat/lon cell the user has visited.
//
//   nearestObs:
//     Key: "<coordKey>|<inatTaxonId>". Value: CachedNearest with the
//     distance-to-nearest-observation plus TTL metadata. Populated
//     lazily by useDetectionAccumulator when it wants graded damping
//     for a specific species.
//
// Both stores are read through the same pattern as birdHitStore: a
// singleton dbPromise that self-resets on error, and all public
// functions swallow storage failures (returning null/undefined) so a
// broken IndexedDB can never block the detection pipeline.
//
// Why not localStorage: the bulk species map for a major metro can
// run 2000+ entries. localStorage's 5 MB per-origin quota would still
// fit, but serializing/parsing the whole blob on every read is
// significantly more work than an IndexedDB key lookup, and we
// already use IndexedDB for birdHitStore on the same origin.

import { openDB, type IDBPDatabase } from 'idb';
import {
  BULK_TTL_MS,
  NEAREST_TTL_MS,
  coordKey,
  deserializeMap,
  serializeMap,
  type CachedNearest,
  type LocalSpeciesEntry,
  type LocalSpeciesMap,
} from '@/lib/inat/localSpecies';

const getDBName = () => {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'default';
  return `birdsong-spotter-inat-${hostname}`;
};
const DB_NAME = getDBName();
const DB_VERSION = 1;
const LOCAL_SPECIES_STORE = 'localSpecies';
const NEAREST_OBS_STORE = 'nearestObs';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(LOCAL_SPECIES_STORE)) {
          db.createObjectStore(LOCAL_SPECIES_STORE);
        }
        if (!db.objectStoreNames.contains(NEAREST_OBS_STORE)) {
          db.createObjectStore(NEAREST_OBS_STORE);
        }
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Bulk local-species cache
// ---------------------------------------------------------------------------

/**
 * Stored row format. The map itself is serialized as a plain object
 * for stability across schema evolutions.
 */
interface LocalSpeciesRow {
  lat: number;
  lon: number;
  fetchedAt: number;
  expiresAt: number;
  entries: Record<string, LocalSpeciesEntry>;
}

export interface ReadLocalSpeciesResult {
  map: LocalSpeciesMap;
  fetchedAt: number;
  expiresAt: number;
  /** True when the stored blob has passed its expiresAt. Callers may
   * still use the map (for a progressive "stale then fresh" UX) but
   * should trigger a background refresh. */
  isStale: boolean;
}

/**
 * Read the cached local species map for a coarse coord. Returns null
 * if there's no entry, if the DB is unavailable, or if the stored
 * row is malformed. Expired entries are returned with `isStale: true`
 * so callers can decide whether to serve them during refresh.
 */
export async function readLocalSpecies(
  lat: number,
  lon: number,
): Promise<ReadLocalSpeciesResult | null> {
  try {
    const dbp = getDB();
    if (!dbp) return null;
    const db = await dbp;
    const row = (await db.get(LOCAL_SPECIES_STORE, coordKey(lat, lon))) as
      | LocalSpeciesRow
      | undefined;
    if (!row) return null;
    if (
      typeof row.fetchedAt !== 'number' ||
      typeof row.expiresAt !== 'number' ||
      !row.entries ||
      typeof row.entries !== 'object'
    ) {
      return null;
    }
    return {
      map: deserializeMap(row.entries),
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      isStale: Date.now() > row.expiresAt,
    };
  } catch (error) {
    console.warn('[localSpeciesStore] read local species failed', error);
    return null;
  }
}

/**
 * Write a freshly-fetched local species map to the cache. Caller
 * supplies the fetch timestamp; we derive expiresAt from BULK_TTL_MS.
 */
export async function writeLocalSpecies(
  lat: number,
  lon: number,
  map: LocalSpeciesMap,
  fetchedAt: number = Date.now(),
): Promise<void> {
  try {
    const dbp = getDB();
    if (!dbp) return;
    const db = await dbp;
    const row: LocalSpeciesRow = {
      lat,
      lon,
      fetchedAt,
      expiresAt: fetchedAt + BULK_TTL_MS,
      entries: serializeMap(map),
    };
    await db.put(LOCAL_SPECIES_STORE, row, coordKey(lat, lon));
  } catch (error) {
    console.warn('[localSpeciesStore] write local species failed', error);
  }
}

/**
 * Drop any local-species cache rows whose expiresAt is older than the
 * given cutoff. Called opportunistically at app start to keep the
 * DB from growing unbounded for users who move around a lot.
 */
export async function pruneLocalSpeciesOlderThan(
  cutoffMs: number,
): Promise<void> {
  try {
    const dbp = getDB();
    if (!dbp) return;
    const db = await dbp;
    const tx = db.transaction(LOCAL_SPECIES_STORE, 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const row = cursor.value as LocalSpeciesRow | undefined;
      if (row && typeof row.expiresAt === 'number' && row.expiresAt < cutoffMs) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    console.warn('[localSpeciesStore] prune local species failed', error);
  }
}

// ---------------------------------------------------------------------------
// Nearest-observation (per-species) cache
// ---------------------------------------------------------------------------

interface NearestRow {
  inatTaxonId: number;
  lat: number;
  lon: number;
  distanceKm: number | null;
  fetchedAt: number;
  expiresAt: number;
}

function nearestKey(lat: number, lon: number, inatTaxonId: number): string {
  return `${coordKey(lat, lon)}|${inatTaxonId}`;
}

export async function readNearest(
  lat: number,
  lon: number,
  inatTaxonId: number,
): Promise<CachedNearest | null> {
  try {
    const dbp = getDB();
    if (!dbp) return null;
    const db = await dbp;
    const row = (await db.get(
      NEAREST_OBS_STORE,
      nearestKey(lat, lon, inatTaxonId),
    )) as NearestRow | undefined;
    if (!row) return null;
    if (typeof row.expiresAt !== 'number') return null;
    if (row.expiresAt < Date.now()) return null;
    return {
      inatTaxonId: row.inatTaxonId,
      lat: row.lat,
      lon: row.lon,
      distanceKm:
        typeof row.distanceKm === 'number' || row.distanceKm === null
          ? row.distanceKm
          : null,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
    };
  } catch (error) {
    console.warn('[localSpeciesStore] read nearest failed', error);
    return null;
  }
}

export async function writeNearest(
  lat: number,
  lon: number,
  inatTaxonId: number,
  distanceKm: number | null,
  fetchedAt: number = Date.now(),
): Promise<void> {
  try {
    const dbp = getDB();
    if (!dbp) return;
    const db = await dbp;
    const row: NearestRow = {
      inatTaxonId,
      lat,
      lon,
      distanceKm,
      fetchedAt,
      expiresAt: fetchedAt + NEAREST_TTL_MS,
    };
    await db.put(NEAREST_OBS_STORE, row, nearestKey(lat, lon, inatTaxonId));
  } catch (error) {
    console.warn('[localSpeciesStore] write nearest failed', error);
  }
}
