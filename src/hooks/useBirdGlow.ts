// Consumer hooks for the BirdGlow context. Split from the context
// file so components can import just what they need:
//
//   - `useBirdGlowPublisher()` — returns the `publish` function.
//     Used by the BirdNET detection loop in BirdsIndex to
//     broadcast raw top-K scores on every chunk.
//   - `useBirdGlowIntensity(scientificName)` — reactive subscription
//     that returns the live decayed intensity in [0, 1] for a
//     single species. Used by `SpeciesCell` to drive its glow
//     layer without busting the aggressive React.memo comparison
//     on the cell itself.
//
// The intensity hook uses `useSyncExternalStore` so updates bypass
// React's normal render scheduling and drive only the subscribed
// cell. Because the store's `subscribe` callback fires on every
// rAF tick while anything is decaying, we bucket the snapshot to a
// coarse integer (0–100) — two consecutive sub-percent changes
// collapse to the same snapshot, and `useSyncExternalStore` skips
// the re-render automatically. Consumers convert back to a float
// in [0, 1] before applying to styles.

import { useContext, useMemo, useSyncExternalStore } from 'react';
import { BirdGlowContext } from '@/contexts/BirdGlowContext';

export function useBirdGlowPublisher() {
  return useContext(BirdGlowContext).publish;
}

/**
 * Live glow intensity for a single species, in [0, 1]. Returns 0
 * when the species has never been detected, has fully decayed, or
 * when no provider is mounted. Safe to call with `null` /
 * `undefined` / empty string — all collapse to 0 with no work.
 *
 * The returned value is bucketed to 0.01 precision internally to
 * avoid re-rendering the consuming component on every sub-percent
 * frame of decay. That precision is plenty for a visual glow —
 * the human eye can't distinguish a drop shadow's opacity
 * changing by less than ~1%.
 */
export function useBirdGlowIntensity(scientificName: string | null | undefined): number {
  const store = useContext(BirdGlowContext);

  // Memoise subscribe/getSnapshot per species so
  // useSyncExternalStore treats them as stable — otherwise every
  // render would look like a fresh subscription and drop us out
  // of the snapshot-equality fast path.
  const { subscribe, getSnapshot } = useMemo(() => {
    const key = scientificName ?? '';
    return {
      subscribe: (listener: () => void) => store.subscribe(listener),
      getSnapshot: () => {
        if (!key) return 0;
        // Round to centipercent so snapshot equality fires on
        // meaningful changes only. A raw 0.7342 on one tick and
        // 0.7338 on the next both collapse to 73 → no re-render.
        const raw = store.getIntensity(key);
        return Math.round(raw * 100);
      },
    };
  }, [store, scientificName]);

  const bucketed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return bucketed / 100;
}
