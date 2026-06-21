// Local-only IndexedDB queue of bird detections that still need to be
// published to Nostr. A detection lands here when the kind 2473 publish
// fails — most commonly because the device is offline — so the sighting
// isn't lost. The queue is drained (oldest-heard first) whenever the
// connection comes back, and items are only removed once the publish
// actually succeeds; a repeated failure leaves the item in place to be
// retried again later.
//
// We persist the *raw detection* (species + heard timestamp + an
// optional location snapshot) rather than a fully-built or signed Nostr
// event. That keeps the queue resilient to the things that can only be
// resolved online — chiefly the Wikidata QID lookup — by replaying the
// detection through the normal publish path at flush time. The heard
// timestamp is preserved end-to-end and becomes the event's `created_at`,
// so a sighting published hours later is still timestamped to when the
// bird was actually heard.
//
// Mirrors the domain-keyed DB-name pattern used by birdHitStore.ts so
// two apps on the same origin can't collide.

import { openDB, type IDBPDatabase } from 'idb';

// ============================================================================
// Schema
// ============================================================================

const getDBName = () => {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'default';
  return `birdsong-spotter-publish-queue-${hostname}`;
};
const DB_NAME = getDBName();
const DB_VERSION = 1;
const STORE_NAME = 'pending';
const CREATED_AT_INDEX = 'by-created-at';

export interface QueuedDetection {
  /** Auto-increment key assigned by IndexedDB on insert. */
  id?: number;
  scientificName: string;
  commonName: string;
  /**
   * ms since epoch — the moment the bird was actually heard. Preserved so
   * the eventual kind 2473 event's `created_at` reflects the real sighting
   * time, not when the queue happened to flush.
   */
  timestamp: number;
  /**
   * Optional length-3 geohash snapshotted at detection time, when the user
   * had "Publish location" enabled and a coarse coordinate was available.
   * Snapshotting here (rather than re-deriving at flush time) keeps the
   * sighting tied to where it was heard, even if the user has since moved.
   * Absent when location publishing was off or no coordinate was known.
   */
  geohash?: string;
  /** Number of publish attempts that have failed so far (diagnostics). */
  attempts: number;
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
          store.createIndex(CREATED_AT_INDEX, 'timestamp');
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
 * Enqueue a detection for later publishing. Returns the assigned id, or
 * undefined if storage failed (we never throw — a storage failure must not
 * crash the detection pipeline; the worst case is one lost queued sighting).
 */
export async function enqueueDetection(
  detection: Omit<QueuedDetection, 'id' | 'attempts'> & { attempts?: number },
): Promise<number | undefined> {
  try {
    const db = await getDB();
    const record: Omit<QueuedDetection, 'id'> = {
      scientificName: detection.scientificName,
      commonName: detection.commonName,
      timestamp: detection.timestamp,
      ...(detection.geohash ? { geohash: detection.geohash } : {}),
      attempts: detection.attempts ?? 0,
    };
    const key = await db.add(STORE_NAME, record);
    return key as number;
  } catch (error) {
    console.warn('[birdQueueStore] enqueue failed', error);
    return undefined;
  }
}

/**
 * Return every queued detection in ascending heard-time order. Flushing in
 * this order matters for the Birdex (kind 12473): it's a replaceable event,
 * so publishing lifers oldest-first keeps the final `created_at` newest and
 * the chronological species order correct.
 */
export async function getQueuedDetections(): Promise<QueuedDetection[]> {
  try {
    const db = await getDB();
    return (await db.getAllFromIndex(
      STORE_NAME,
      CREATED_AT_INDEX,
    )) as QueuedDetection[];
  } catch (error) {
    console.warn('[birdQueueStore] read failed', error);
    return [];
  }
}

/** Remove a queued detection once it has been published successfully. */
export async function removeQueuedDetection(id: number): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
  } catch (error) {
    console.warn('[birdQueueStore] remove failed', error);
  }
}

/**
 * Increment the failed-attempt counter for a queued detection. Best-effort —
 * used only for diagnostics/visibility; a failure to bump the counter never
 * affects whether the item is retried.
 */
export async function markAttempt(id: number): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const record = (await tx.store.get(id)) as QueuedDetection | undefined;
    if (record) {
      record.attempts += 1;
      await tx.store.put(record);
    }
    await tx.done;
  } catch (error) {
    console.warn('[birdQueueStore] markAttempt failed', error);
  }
}

/** Number of detections currently waiting to be published. */
export async function getQueuedCount(): Promise<number> {
  try {
    const db = await getDB();
    return await db.count(STORE_NAME);
  } catch (error) {
    console.warn('[birdQueueStore] count failed', error);
    return 0;
  }
}

/** Wipe the entire queue. Exposed for settings/debug; not wired into UI. */
export async function clearQueue(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch (error) {
    console.warn('[birdQueueStore] clear failed', error);
  }
}
