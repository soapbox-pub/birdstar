// Drives the "NEW BIRD DISCOVERED" fanfare overlay in Birds mode.
//
// A "lifer" here is a species the user is confirming for the first time
// as far as we can tell. Two independent signals feed the baseline:
//
//   1. The device-local `encountered` map (IndexedDB, never pruned). Any
//      species ever heard on this device — even at the 60% "qualifying
//      encounter" level — disqualifies a future fanfare.
//   2. The logged-in user's Nostr Birdex (kind 12473), which carries the
//      scientific name for every species they've ever confirmed across
//      all their devices. This is how a bird heard on device A doesn't
//      re-fanfare on device B after the Birdex syncs.
//
// Both are captured into a BASELINE snapshot at the moment this hook
// first becomes usable (encountered hydrated AND Birdex either loaded
// or known absent). Species added to either source AFTER the baseline
// is captured — e.g. the very encounter that leads up to this
// confirmation — are ignored, so `consider(detection)` works correctly
// even though the encountered store will by construction already
// contain the species by the time it confirms (the qualifying
// threshold is 60% of the confirm threshold).
//
// The queue plays celebrations one at a time. Multiple lifers in quick
// succession each get their moment; `next()` advances.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Detection } from '@/components/BirdCard';
import { useBirdexEvent } from '@/hooks/useBirdexEvent';
import type { EncounteredSpecies } from '@/lib/encounteredSpeciesStore';

export interface LiferItem {
  /** Stable id so React can key the overlay across rapid swaps. */
  id: string;
  scientificName: string;
  commonName: string;
  /** ms epoch of the confirming detection. */
  timestamp: number;
}

export interface LiferCelebrationApi {
  /** Feed every confirmed detection through this. No-op if the species
   * is already in the baseline known-set, or if we haven't captured the
   * baseline yet (fail-closed so the very first visit doesn't fanfare
   * every species en masse). */
  consider: (detection: Detection) => void;
  /** The currently-showing item, or null. */
  current: LiferItem | null;
  /** How many more items are queued behind `current`. */
  pending: number;
  /** Advance to the next item (or clear, if the queue is empty). The
   * overlay calls this on auto-dismiss and on tap. */
  next: () => void;
}

export function useLiferCelebration({
  encountered,
}: {
  /** Device-persistent encountered map from useEncounteredSpecies. Null
   * while the IndexedDB hydrate is in flight. */
  encountered: Map<string, EncounteredSpecies> | null;
}): LiferCelebrationApi {
  const birdexEvent = useBirdexEvent();

  // Baseline of species known BEFORE this session started, keyed by
  // lower-cased scientific name. Lives in a ref because no consumer
  // needs to re-render when it lands — `consider` reads it
  // imperatively. The sentinel `null` means "not captured yet".
  const baselineRef = useRef<Set<string> | null>(null);

  // Session-level de-dupe: once we fanfare a species during this
  // session, don't fanfare it again even if `consider` fires again
  // (the accumulator can re-confirm a species after its cooldown).
  const celebratedRef = useRef<Set<string>>(new Set());

  // Queue of items waiting to display. `current` is the one on screen.
  const [current, setCurrent] = useState<LiferItem | null>(null);
  const queueRef = useRef<LiferItem[]>([]);
  const [pending, setPending] = useState(0);

  // Snapshot the baseline when both encountered (IndexedDB) and the
  // Birdex event (Nostr, if the user is logged in) are ready.
  //
  // "Ready" for the Birdex means: either the query has settled with a
  // result (event or null), or the user is logged out (query disabled).
  // `isLoading` is only true while an enabled query is in flight, so
  // checking `!isLoading` covers both.
  //
  // Ref-only write — no setState — so this effect doesn't trigger a
  // render chain. Consumers who need "are we armed yet?" can infer
  // it from the first non-no-op call to `consider`.
  useEffect(() => {
    if (baselineRef.current) return; // already captured
    if (encountered === null) return; // not hydrated
    if (birdexEvent.isLoading) return; // Nostr Birdex still loading

    const snapshot = new Set<string>();
    for (const key of encountered.keys()) {
      snapshot.add(key); // already lower-cased
    }
    for (const entry of birdexEvent.entries) {
      if (entry.scientificName) {
        snapshot.add(entry.scientificName.toLowerCase());
      }
    }
    baselineRef.current = snapshot;
  }, [encountered, birdexEvent.isLoading, birdexEvent.entries]);

  const consider = useCallback((detection: Detection) => {
    const snapshot = baselineRef.current;
    // Fail closed until the baseline is captured. The window between
    // first paint and baseline capture is rarely long enough for a
    // confirmation to land, but if it does we'd rather miss a fanfare
    // than show a false one for a bird the user already knows.
    if (!snapshot) return;

    const key = detection.scientificName.toLowerCase();
    if (snapshot.has(key)) return;
    if (celebratedRef.current.has(key)) return;
    celebratedRef.current.add(key);

    const item: LiferItem = {
      id: `lifer-${key}-${detection.timestamp}`,
      scientificName: detection.scientificName,
      commonName: detection.commonName,
      timestamp: detection.timestamp,
    };

    setCurrent((prev) => {
      if (prev) {
        queueRef.current.push(item);
        setPending(queueRef.current.length);
        return prev;
      }
      return item;
    });
  }, []);

  const next = useCallback(() => {
    const queue = queueRef.current;
    if (queue.length === 0) {
      setCurrent(null);
      setPending(0);
      return;
    }
    const [head, ...rest] = queue;
    queueRef.current = rest;
    setPending(rest.length);
    setCurrent(head);
  }, []);

  return { consider, current, pending, next };
}
