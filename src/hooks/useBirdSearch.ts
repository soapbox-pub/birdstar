import { useDeferredValue, useMemo } from 'react';

import { useBirdLabels } from '@/hooks/useBirdLabels';
import { searchBirdLabels } from '@/lib/birdSearch';
import type { BirdexEntry } from '@/hooks/useBirdex';
import type { BirdLabel } from '@/lib/birdnet/labels';

/**
 * Build a synthetic, not-yet-heard {@link BirdexEntry} for a label that
 * isn't present in the user's curated birdex (`birdex.visible`). The
 * fields mirror what `useBirdex` emits for an in-region unseen species
 * so `SpeciesCell` renders it identically to a normal unheard cell.
 */
function syntheticEntry(label: BirdLabel): BirdexEntry {
  return {
    label,
    heard: false,
    isRare: false,
    isUnconfirmed: false,
    popularity: 0,
    effectivePopularity: 0,
    localBand: undefined,
  };
}

export interface UseBirdSearchResult {
  /** Matching entries, ranked by relevance, ready for SpeciesCell. */
  results: BirdexEntry[];
  /** True once the user has typed a usable query (≥ 2 chars). */
  active: boolean;
  /** True while labels are still loading (so the query can't run yet). */
  isLoading: boolean;
}

/**
 * Search the full BirdNET species list and project matches into
 * {@link BirdexEntry}s, reusing the heard/rare/unconfirmed state from
 * the user's existing birdex where available so a searched-for bird the
 * user has already heard still shows its checkmark, glow, and play
 * button.
 *
 * @param query        Raw user input. Trimmed/normalized internally;
 *                     queries shorter than 2 chars yield no results.
 * @param visibleEntries  The current `birdex.visible` list — used as the
 *                     authoritative source of per-species state for any
 *                     match the user has interacted with.
 */
export function useBirdSearch(
  query: string,
  visibleEntries: BirdexEntry[],
): UseBirdSearchResult {
  const { data: labels, isLoading } = useBirdLabels();

  // React 19: defer the heavy label scan so typing stays responsive on
  // the ~6k-entry list without a manual debounce. The input itself
  // updates synchronously; the (potentially expensive) filtered grid
  // tracks a slightly stale value during fast typing.
  const deferredQuery = useDeferredValue(query);

  // Index the user's curated entries by lower-cased scientific name so
  // matches can inherit real heard/rare state instead of a synthetic
  // unheard stub.
  const entriesByName = useMemo(() => {
    const map = new Map<string, BirdexEntry>();
    for (const entry of visibleEntries) {
      map.set(entry.label.scientificName.toLowerCase(), entry);
    }
    return map;
  }, [visibleEntries]);

  const results = useMemo(() => {
    const labelMatches = searchBirdLabels(labels, deferredQuery);
    return labelMatches.map((label) => {
      const existing = entriesByName.get(label.scientificName.toLowerCase());
      return existing ?? syntheticEntry(label);
    });
  }, [labels, deferredQuery, entriesByName]);

  return {
    results,
    active: deferredQuery.trim().length >= 2,
    isLoading,
  };
}
