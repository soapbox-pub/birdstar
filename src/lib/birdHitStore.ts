// Local-only IndexedDB log of *raw* bird detection hits — every prediction
// above a low confidence floor, regardless of whether it ultimately leads to
// a confirmed sighting. This log feeds the rolling-window confidence
// accumulator (see useDetectionAccumulator) and survives page reloads so an
// in-progress accumulation isn't lost.
//
// This is deliberately independent from the in-memory display state and from
// Nostr: the things the user sees and the events we publish are the derived
// "confirmed" tier; this raw log is the source they're derived from.
//
// Mirrors the domain-keyed DB-name pattern used by dmMessageStore.ts so two
// apps on the same origin can't collide.

import { openDB, type IDBPDatabase } from 'idb';

// ============================================================================
// Schema
// ============================================================================

const getDBName = () => {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'default';
  return `birdsong-spotter-hits-${hostname}`;
};
const DB_NAME = getDBName();
const DB_VERSION = 1;
const STORE_NAME = 'hits';
const TIMESTAMP_INDEX = 'by-timestamp';
const SPECIES_INDEX = 'by-species';

export interface BirdHit {
  /** Auto-increment key assigned by IndexedDB on insert. */
  id?: number;
  /** `${scientificName}|${commonName}` — matches speciesKey() in Index.tsx. */
  speciesKey: string;
  scientificName: string;
  commonName: string;
  /** BirdNET label index — useful for debugging/model rollover. */
  labelIndex: number;
  /**
   * Raw sigmoid-scaled score from BirdNET, 0..1. This is the objective
   * model output BEFORE any location-aware damping is applied. Kept raw
   * on disk so the damping multiplier can be changed / recomputed later
   * without losing the original signal.
   */
  score: number;
  /**
   * Location-aware damping factor applied to this hit at ingest time,
   * in [0, 1]. Snapshot of whatever `locationAdjuster` (iNat nearest-
   * distance, iNat bulk band, or .bin ecoregion fallback) returned for
   * this species at the moment the audio chunk was ingested.
   *
   * 1 means no damping (in-range, or no adjuster configured). A hit's
   * effective confidence for accumulation is `score * multiplier` —
   * computed at read time, never stored pre-multiplied. This lets us
   * re-tune the damping pipeline without rewriting the log.
   *
   * The multiplier is intentionally a snapshot: we do NOT re-evaluate
   * the adjuster on hydrate. A hit you heard in one region stays
   * scored the way it was scored then, even if you move or iNat data
   * refines later.
   */
  multiplier: number;
  /** ms since epoch, taken from the audio chunk (not wall-clock at write). */
  timestamp: number;
}

// ============================================================================
// Database
// ============================================================================

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex(TIMESTAMP_INDEX, 'timestamp');
          store.createIndex(SPECIES_INDEX, 'speciesKey');
        }
      },
    }).catch((err) => {
      // Reset so a later call can retry (e.g. user unblocks storage).
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Append a single raw hit. Fire-and-forget from the caller's perspective —
 * errors are logged but not rethrown so a storage failure never blocks the
 * detection pipeline.
 */
export async function appendHit(hit: Omit<BirdHit, 'id'>): Promise<void> {
  try {
    const db = await getDB();
    await db.add(STORE_NAME, hit);
  } catch (error) {
    console.warn('[birdHitStore] append failed', error);
  }
}

/**
 * Return all hits with `timestamp >= sinceMs`, in ascending timestamp order.
 * Used on startup to seed the rolling window, and could later back a
 * "recent activity" UI.
 */
export async function getHitsSince(sinceMs: number): Promise<BirdHit[]> {
  try {
    const db = await getDB();
    const range = IDBKeyRange.lowerBound(sinceMs);
    return (await db.getAllFromIndex(STORE_NAME, TIMESTAMP_INDEX, range)) as BirdHit[];
  } catch (error) {
    console.warn('[birdHitStore] read failed', error);
    return [];
  }
}

/**
 * Delete every hit with `timestamp < cutoffMs`. Called once on app load to
 * cap the log at ~24h so the DB doesn't grow without bound on long-running
 * installs.
 */
export async function pruneOlderThan(cutoffMs: number): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.store.index(TIMESTAMP_INDEX);
    const range = IDBKeyRange.upperBound(cutoffMs, true);
    let cursor = await index.openCursor(range);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    console.warn('[birdHitStore] prune failed', error);
  }
}

/**
 * Wipe the entire log. Exposed for future settings / debug hooks; not wired
 * into any UI today.
 */
export async function clearAllHits(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch (error) {
    console.warn('[birdHitStore] clear failed', error);
  }
}
