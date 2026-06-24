// IndexedDB-backed cache for Wikipedia/Wikidata bird-search results.
//
// Each Wikipedia bird search costs two network hops (Wikipedia search +
// Wikidata SPARQL verification), both noticeably slower and more rate-
// limited than the instant local BirdNET scan. To keep repeated searches
// cheap — the same word typed, cleared, and retyped, or revisited in a
// later session — we cache the confirmed-bird result list per normalized
// query string.
//
// One object store:
//
//   wikiBirdSearch:
//     Key:   normalized query string (lower-cased, trimmed, accent-folded
//            — see `wikiSearchCacheKey`).
//     Value: WikiBirdSearchRow — the confirmed WikiBird[] plus TTL meta.
//
// Mirrors the resilience pattern of localSpeciesStore: a singleton
// dbPromise that self-resets on error, and every public function swallows
// storage failures (returning null / no-op) so a broken or unavailable
// IndexedDB can never break search — it just falls back to hitting the
// network every time.

import { openDB, type IDBPDatabase } from 'idb';
import type { WikiBird } from '@/lib/wiki/wikiBirdSearch';

const getDBName = () => {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'default';
  return `birdstar-wiki-search-${hostname}`;
};
const DB_NAME = getDBName();
const DB_VERSION = 1;
const STORE = 'wikiBirdSearch';

// Wikipedia/Wikidata taxonomy changes slowly; a week is plenty fresh for
// a "which birds match this word" lookup while still picking up new
// splits / articles within a reasonable window.
export const WIKI_SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Normalize a raw query into a stable cache key: trim, lower-case, strip
 * combining diacritics, and collapse internal whitespace. So "  Robin ",
 * "robin", and "RÓBIN" all hit the same cached row.
 */
export function wikiSearchCacheKey(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

interface WikiBirdSearchRow {
  query: string;
  birds: WikiBird[];
  fetchedAt: number;
  expiresAt: number;
}

/**
 * Read cached confirmed-bird results for a query. Returns null when
 * there's no entry, the DB is unavailable, the row is malformed, or the
 * row has expired (expired rows are treated as a miss so we re-verify
 * against current Wikidata).
 */
export async function readWikiBirdSearch(
  query: string,
): Promise<WikiBird[] | null> {
  try {
    const dbp = getDB();
    if (!dbp) return null;
    const db = await dbp;
    const row = (await db.get(STORE, wikiSearchCacheKey(query))) as
      | WikiBirdSearchRow
      | undefined;
    if (!row) return null;
    if (
      typeof row.expiresAt !== 'number' ||
      !Array.isArray(row.birds) ||
      row.expiresAt < Date.now()
    ) {
      return null;
    }
    return row.birds;
  } catch (error) {
    console.warn('[wikiBirdSearchStore] read failed', error);
    return null;
  }
}

/**
 * Write freshly-verified bird results for a query. Caller supplies the
 * fetch timestamp; expiresAt is derived from WIKI_SEARCH_TTL_MS.
 */
export async function writeWikiBirdSearch(
  query: string,
  birds: WikiBird[],
  fetchedAt: number = Date.now(),
): Promise<void> {
  try {
    const dbp = getDB();
    if (!dbp) return;
    const db = await dbp;
    const key = wikiSearchCacheKey(query);
    const row: WikiBirdSearchRow = {
      query: key,
      birds,
      fetchedAt,
      expiresAt: fetchedAt + WIKI_SEARCH_TTL_MS,
    };
    await db.put(STORE, row, key);
  } catch (error) {
    console.warn('[wikiBirdSearchStore] write failed', error);
  }
}

/**
 * Drop any cached rows whose expiresAt is older than the given cutoff.
 * Called opportunistically to keep the store from growing unbounded for
 * heavy searchers.
 */
export async function pruneWikiBirdSearchOlderThan(
  cutoffMs: number,
): Promise<void> {
  try {
    const dbp = getDB();
    if (!dbp) return;
    const db = await dbp;
    const tx = db.transaction(STORE, 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const row = cursor.value as WikiBirdSearchRow | undefined;
      if (
        row &&
        typeof row.expiresAt === 'number' &&
        row.expiresAt < cutoffMs
      ) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    console.warn('[wikiBirdSearchStore] prune failed', error);
  }
}
