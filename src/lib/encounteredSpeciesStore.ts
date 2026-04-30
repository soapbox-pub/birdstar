// Local-only IndexedDB log of *species* the user has ever encountered —
// one row per scientific name, upserted on first contact and touched on
// every subsequent hit. Unlike birdHitStore (per-prediction, 24h TTL,
// feeds the accumulator), this store is "did we ever hear a blip of
// this bird?" and is NEVER pruned.
//
// The birdex uses it to populate the "unconfirmed" bucket: species
// that have produced at least one qualifying prediction (≥
// MIN_RAW_CONFIDENCE after damping) but haven't accumulated enough
// evidence to be promoted to a confirmed, Nostr-published sighting.
// That lets the grid show a ghostly "we think we heard this" entry
// the next time the user opens the app, months later, even though
// the raw hit log has long since been pruned.
//
// Mirrors the domain-keyed DB-name pattern used by birdHitStore.ts and
// dmMessageStore.ts so multiple apps on the same origin don't collide.

import { openDB, type IDBPDatabase } from 'idb';

// ============================================================================
// Schema
// ============================================================================

const getDBName = () => {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'default';
  return `birdsong-spotter-encountered-${hostname}`;
};
const DB_NAME = getDBName();
const DB_VERSION = 1;
const STORE_NAME = 'species';
const LAST_SEEN_INDEX = 'by-last-seen';

export interface EncounteredSpecies {
  /** Lower-cased scientific name. Primary key so idempotent upserts
   *  happen on repeat encounters without us having to query first. */
  scientificName: string;
  /** Original-case scientific name preserved for display. */
  scientificNameDisplay: string;
  /** Common name at time of first contact. Birds' common names
   *  occasionally change in the BirdNET label file; the store wins
   *  whatever we wrote first so the birdex tile stays stable across
   *  label updates. Consumers that care about the current canonical
   *  common name should look it up from labels instead. */
  commonName: string;
  /** ms since epoch of the first qualifying hit we ever saw. */
  firstSeenAt: number;
  /** ms since epoch of the most recent qualifying hit. Updated on
   *  every subsequent encounter. Drives "newest-first" ordering in
   *  the unconfirmed bucket so species the user just heard float to
   *  the top. */
  lastSeenAt: number;
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
            keyPath: 'scientificName',
          });
          store.createIndex(LAST_SEEN_INDEX, 'lastSeenAt');
        }
      },
    }).catch((err) => {
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
 * Record an encounter with a species. Idempotent: inserts on first
 * contact, updates `lastSeenAt` on subsequent hits. Never prunes.
 *
 * Fire-and-forget from the caller's perspective — we log failures
 * but don't rethrow so a storage glitch never breaks the audio
 * pipeline.
 */
export async function recordEncounter(input: {
  scientificName: string;
  commonName: string;
  timestamp: number;
}): Promise<void> {
  try {
    const db = await getDB();
    const key = input.scientificName.toLowerCase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const existing = (await tx.store.get(key)) as EncounteredSpecies | undefined;
    const next: EncounteredSpecies = existing
      ? {
          ...existing,
          lastSeenAt: Math.max(existing.lastSeenAt, input.timestamp),
        }
      : {
          scientificName: key,
          scientificNameDisplay: input.scientificName,
          commonName: input.commonName,
          firstSeenAt: input.timestamp,
          lastSeenAt: input.timestamp,
        };
    await tx.store.put(next);
    await tx.done;
  } catch (error) {
    console.warn('[encounteredSpeciesStore] record failed', error);
  }
}

/**
 * Read every encountered species. Used once at hook mount to seed
 * the in-memory set the birdex consumes; subsequent updates go
 * through the imperative record() path rather than re-reading.
 */
export async function getAllEncountered(): Promise<EncounteredSpecies[]> {
  try {
    const db = await getDB();
    return (await db.getAll(STORE_NAME)) as EncounteredSpecies[];
  } catch (error) {
    console.warn('[encounteredSpeciesStore] read failed', error);
    return [];
  }
}

/**
 * Wipe the entire store. Exposed for future settings / debug hooks.
 */
export async function clearAllEncountered(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch (error) {
    console.warn('[encounteredSpeciesStore] clear failed', error);
  }
}
