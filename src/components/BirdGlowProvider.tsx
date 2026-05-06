// Provider for {@link BirdGlowContext}. Maintains an in-memory map
// of currently-decaying bird scores and drives a single rAF loop
// that notifies subscribers as intensities change.
//
// Why a ref-backed store (not useState)?
//
//   A naive `useState<Map<string, Entry>>` would force the whole
//   provider subtree to re-render every ~16ms while anything is
//   decaying, defeating the entire purpose of the selective-
//   subscription design. Instead, the store is a plain JS Map held
//   in a ref; changes are broadcast to listeners via a hand-rolled
//   subscribe/notify pair, and consumers use `useSyncExternalStore`
//   to pull their own species' intensity. React only re-renders
//   components whose returned snapshot actually changed.
//
// The decay loop runs ONLY while at least one species is above
// zero. It stops itself the moment the map empties, so an idle
// grid (no birds detected) burns no CPU / battery. It also
// honours `prefers-reduced-motion` indirectly: the intensity
// numbers still update, but the consumer (SpeciesCell) is the one
// that decides whether to animate — a static shadow driven by a
// decaying number is still "motion", so the cell gates its
// rendered style on the media query.

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  BirdGlowContext,
  type BirdGlowContextValue,
  type GlowEntry,
} from '@/contexts/BirdGlowContext';

/** Total ms a peak score takes to decay linearly to zero. BirdNET
 *  produces a chunk every ~2s (see `predictEveryMs: 2000` in
 *  BirdsIndex), so 2.5s keeps the cell visibly lit across the gap
 *  between chunks and fades naturally when a bird stops calling. */
const DEFAULT_DECAY_MS = 2500;

/** Below this intensity we treat the entry as dead and drop it.
 *  Prevents the map from accumulating a long tail of near-zero
 *  entries that would each still notify on every tick. */
const DEAD_THRESHOLD = 0.01;

/** Floor for what we bother storing at all. Matches the
 *  `MIN_RAW_CONFIDENCE` in useDetectionAccumulator — scores this
 *  weak don't feed the accumulator either, so they shouldn't drive
 *  the glow. */
const MIN_PUBLISH_SCORE = 0.2;

function normaliseKey(scientificName: string): string {
  return scientificName.toLowerCase();
}

/** Linear decay. `t` is ms elapsed since `producedAt`. */
function liveIntensity(entry: GlowEntry, now: number): number {
  const elapsed = now - entry.producedAt;
  if (elapsed <= 0) return entry.score;
  if (elapsed >= entry.decayMs) return 0;
  return entry.score * (1 - elapsed / entry.decayMs);
}

interface BirdGlowProviderProps {
  children: ReactNode;
  /** Optional override for tests. Defaults to {@link DEFAULT_DECAY_MS}. */
  decayMs?: number;
}

export function BirdGlowProvider({
  children,
  decayMs = DEFAULT_DECAY_MS,
}: BirdGlowProviderProps) {
  // Map-of-refs pattern: the entries map and listeners set both
  // live outside React state, so writes never trigger provider
  // re-renders. The only thing that re-renders is individual
  // subscribers, one at a time, keyed on their own snapshot.
  const entriesRef = useRef<Map<string, GlowEntry>>(new Map());
  const listenersRef = useRef<Set<() => void>>(new Set());
  const rafRef = useRef<number | null>(null);

  const notify = useCallback(() => {
    // Snapshot the listener set before iterating — a listener that
    // unsubscribes synchronously inside its own callback (e.g.
    // because the component unmounts during notification) would
    // otherwise mutate the Set mid-iteration.
    const snapshot = Array.from(listenersRef.current);
    for (const listener of snapshot) listener();
  }, []);

  // rAF-driven decay pump. Runs only while there's at least one
  // live entry. Drops dead entries (intensity <= DEAD_THRESHOLD)
  // and stops the loop when the map empties.
  //
  // `tick` self-references to schedule the next frame, so we
  // stash it in a ref and read it back through the ref instead
  // of capturing the callback in its own closure (which would be
  // a stale-closure / self-reference lint violation).
  const tickRef = useRef<() => void>(() => {});
  const tick = useCallback(() => {
    const now = Date.now();
    const entries = entriesRef.current;
    if (entries.size === 0) {
      rafRef.current = null;
      return;
    }

    let changed = false;
    for (const [key, entry] of entries) {
      const intensity = liveIntensity(entry, now);
      if (intensity <= DEAD_THRESHOLD) {
        entries.delete(key);
        changed = true;
      }
    }

    // Even without deletions, live entries' intensities have
    // changed since the last tick (linear decay). Notify on every
    // tick while anything is alive — consumers short-circuit via
    // useSyncExternalStore snapshot equality if their own species'
    // rounded intensity hasn't changed.
    if (!changed) changed = entries.size > 0;

    if (changed) notify();

    rafRef.current =
      entries.size > 0 ? requestAnimationFrame(tickRef.current) : null;
  }, [notify]);

  // Keep the ref in sync with the latest `tick` closure. We can't
  // assign during render (React warns because refs mutated in
  // render can desync with concurrent rendering), so do it in a
  // layout effect — fires synchronously after the commit, before
  // any paint or subsequent rAF frame could fire.
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const ensureTicking = useCallback(() => {
    if (rafRef.current != null) return;
    if (entriesRef.current.size === 0) return;
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, []);

  // Clean up any scheduled rAF on unmount. No need to clear
  // entries/listeners — the refs themselves get GC'd with the
  // provider — but a stray rAF callback firing after unmount is
  // a classic "warning: setState on unmounted component" source.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const publish = useCallback<BirdGlowContextValue['publish']>(
    (predictions) => {
      if (predictions.length === 0) return;
      const now = Date.now();
      const entries = entriesRef.current;
      let anyWritten = false;

      for (const { scientificName, score } of predictions) {
        if (!scientificName) continue;
        if (score <= 0 || score < MIN_PUBLISH_SCORE) continue;

        const key = normaliseKey(scientificName);
        const existing = entries.get(key);
        if (existing) {
          // Replace when either: (a) the new score is at least as
          // high, so a stronger reading always wins, or (b) the
          // existing entry is past its halfway mark, so sustained
          // callers stay lit between chunks. Case (b) matters
          // because a bird calling steadily will produce a mix of
          // ~0.3–0.8 readings chunk-to-chunk; without it, a 0.8
          // followed by a 0.4 would freeze the glow at the
          // lingering 0.8 and never reflect the continued calling.
          const currentIntensity = liveIntensity(existing, now);
          const pastHalfway = currentIntensity < existing.score * 0.5;
          if (score >= currentIntensity || pastHalfway) {
            entries.set(key, { score, producedAt: now, decayMs });
            anyWritten = true;
          }
        } else {
          entries.set(key, { score, producedAt: now, decayMs });
          anyWritten = true;
        }
      }

      if (anyWritten) {
        notify();
        ensureTicking();
      }
    },
    [decayMs, ensureTicking, notify],
  );

  const subscribe = useCallback<BirdGlowContextValue['subscribe']>(
    (listener) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const getIntensity = useCallback<BirdGlowContextValue['getIntensity']>(
    (scientificName) => {
      if (!scientificName) return 0;
      const entry = entriesRef.current.get(normaliseKey(scientificName));
      if (!entry) return 0;
      return liveIntensity(entry, Date.now());
    },
    [],
  );

  const value = useMemo<BirdGlowContextValue>(
    () => ({ publish, subscribe, getIntensity }),
    [publish, subscribe, getIntensity],
  );

  return (
    <BirdGlowContext.Provider value={value}>
      {children}
    </BirdGlowContext.Provider>
  );
}
