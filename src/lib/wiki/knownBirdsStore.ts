// Local IndexedDB index of "known" birds the user has confirmed or
// interacted with — heard species, species added to the Birdex, and
// Wikipedia-discovered birds the user opened. It exists so the search box
// can match those birds INSTANTLY and OFFLINE, without re-hitting
// Wikipedia, and so a bird the user confirmed once stays findable forever
// even if its Wikipedia article later moves or the network is down.
//
// One object store:
//
//   knownBirds:
//     Key:   lower-cased scientific name (stable, unique per species).
//     Value: KnownBird — scientific + common name, optional Wikidata
//            entity URI, and a lastSeenAt timestamp for recency ordering.
//
// This is intentionally additive and never auto-pruned: the set of birds
// a user cares about only grows, and the row count is tiny (one per
// species they've touched) compared to the per-prediction birdHitStore.
//
// Mirrors the resilience pattern of the other stores: a singleton
// dbPromise that self-resets on error, and every public function swallows
// storage failures (returning []/no-op) so a broken or unavailable
// IndexedDB can never break search.

import { openDB, type IDBPDatabase } from 'idb';

const getDBName = () => {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'default';
  return `birdstar-known-birds-${hostname}`;
};
const DB_NAME = getDBName();
const DB_VERSION = 1;
const STORE = 'knownBirds';

/** A bird the user has confirmed or interacted with, cached for local
 *  (instant, offline) search. */
export interface KnownBird {
  /** Lower-cased scientific name — the primary key. */
  scientificName: string;
  /** Original-case scientific (binomial) name for display. */
  scientificNameDisplay: string;
  /** English common name. */
  commonName: string;
  /** Canonical Wikidata entity URI when known; null otherwise. Lets a
   *  matched known bird open with its real Birdex identity. */
  entityUri: string | null;
  /** ms since epoch of the most recent interaction. Drives recency
   *  ordering so freshly-confirmed birds rank first among local hits. */
  lastSeenAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

// In-memory mirror of the store, populated lazily by readAllKnownBirds
// and invalidated on every write, so the search path doesn't hit
// IndexedDB on every keystroke.
let allCache: KnownBird[] | null = null;

function getDB(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'scientificName' });
        }
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export interface KnownBirdInput {
  scientificName: string;
  commonName: string;
  entityUri?: string | null;
}

/**
 * Upsert one or more known birds. Idempotent on scientific name: a repeat
 * record refreshes `lastSeenAt` (and fills in a previously-missing
 * `entityUri` / `commonName`) without creating a duplicate. Blank or
 * placeholder names are skipped so we never index junk.
 */
export async function rememberKnownBirds(
  birds: KnownBirdInput[],
): Promise<void> {
  if (birds.length === 0) return;
  try {
    const dbp = getDB();
    if (!dbp) return;
    const db = await dbp;
    const now = Date.now();
    const tx = db.transaction(STORE, 'readwrite');
    for (const bird of birds) {
      const display = bird.scientificName.trim();
      const common = bird.commonName.trim();
      const key = display.toLowerCase();
      // Need at least a usable name to be searchable. Skip empties.
      if (!key || (!common && !display)) continue;

      const existing = (await tx.store.get(key)) as KnownBird | undefined;
      const row: KnownBird = {
        scientificName: key,
        scientificNameDisplay: display || existing?.scientificNameDisplay || display,
        // Prefer a non-empty common name; keep the prior one if this
        // input lacks it (e.g. a detection that only had a binomial).
        commonName: common || existing?.commonName || display,
        entityUri: bird.entityUri ?? existing?.entityUri ?? null,
        lastSeenAt: now,
      };
      await tx.store.put(row);
    }
    await tx.done;
    // Newly-remembered birds must be searchable immediately, so drop the
    // in-memory read cache built by readAllKnownBirds.
    allCache = null;
  } catch (error) {
    console.warn('[knownBirdsStore] remember failed', error);
  }
}

/**
 * Read every known bird. Cached in memory after the first read (and
 * invalidated whenever `rememberKnownBirds` writes) so the search path
 * doesn't hit IndexedDB on every keystroke. Returns [] when the DB is
 * unavailable or empty.
 */
export async function readAllKnownBirds(): Promise<KnownBird[]> {
  if (allCache) return allCache;
  try {
    const dbp = getDB();
    if (!dbp) return [];
    const db = await dbp;
    const rows = (await db.getAll(STORE)) as KnownBird[];
    allCache = Array.isArray(rows) ? rows : [];
    return allCache;
  } catch (error) {
    console.warn('[knownBirdsStore] readAll failed', error);
    return [];
  }
}
