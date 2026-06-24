import { useDeferredValue, useMemo } from 'react';

import { useBirdLabels } from '@/hooks/useBirdLabels';
import { useWikiBirdSearch } from '@/hooks/useWikiBirdSearch';
import { searchBirdLabels, normalizeForSearch } from '@/lib/birdSearch';
import type { BirdexEntry } from '@/hooks/useBirdex';
import type { BirdLabel } from '@/lib/birdnet/labels';
import type { WikiBird } from '@/lib/wiki/wikiBirdSearch';

// Synthetic BirdNET label indices for Wikipedia-only birds. The real
// BirdNET label set uses indices 0..~6520; we assign Wikipedia-sourced
// species negative indices so they're guaranteed not to collide with a
// real label as a React key (`SpeciesCell` keys on `label.index`) and so
// any code that treats `index` as a model-output slot can cheaply tell a
// synthetic entry apart (index < 0 ⇒ "not in BirdNET, not detectable").
let nextSyntheticIndex = -1;
const syntheticIndexByName = new Map<string, number>();

function syntheticLabelIndex(scientificName: string): number {
  const key = scientificName.toLowerCase();
  let index = syntheticIndexByName.get(key);
  if (index === undefined) {
    index = nextSyntheticIndex--;
    syntheticIndexByName.set(key, index);
  }
  return index;
}

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

/**
 * Build a synthetic {@link BirdLabel} for a Wikipedia-sourced bird that
 * BirdNET doesn't know about. Gets a stable negative index so it never
 * collides with a real BirdNET label.
 */
function wikiBirdLabel(bird: WikiBird): BirdLabel {
  return {
    index: syntheticLabelIndex(bird.scientificName),
    scientificName: bird.scientificName,
    commonName: bird.commonName,
    isBird: true,
  };
}

export interface UseBirdSearchResult {
  /** Matching entries, ranked by relevance, ready for SpeciesCell.
   *  BirdNET matches first, then Wikipedia-only birds. */
  results: BirdexEntry[];
  /** True once the user has typed a usable query (≥ 2 chars). */
  active: boolean;
  /** True while labels are still loading (so the query can't run yet). */
  isLoading: boolean;
  /** True while the supplemental Wikipedia search is still in flight.
   *  Local BirdNET results are already shown; this lets the UI hint
   *  that more (rarer / non-BirdNET) species may still appear. */
  isLoadingWikipedia: boolean;
}

/**
 * Search the full BirdNET species list AND Wikipedia (verified via
 * Wikidata as bird taxa), projecting matches into {@link BirdexEntry}s.
 *
 * BirdNET matches resolve instantly from the local label set and reuse
 * the heard/rare/unconfirmed state from the user's existing birdex where
 * available (so a searched-for bird the user has already heard still
 * shows its checkmark, glow, and play button). Wikipedia birds that
 * aren't already covered by BirdNET are appended afterwards as synthetic
 * unheard entries — these surface rarities, recent splits, and regional
 * specialties the on-device model can't detect. They're cached in
 * IndexedDB so repeated searches don't re-hit the network.
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
  const active = deferredQuery.trim().length >= 2;

  // Supplemental Wikipedia search. Disabled (no network) until the query
  // is long enough; results are merged in after the local matches.
  const { data: wikiBirds, isFetching: isLoadingWikipedia } = useWikiBirdSearch(
    active ? deferredQuery : null,
  );

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

    // Track every scientific name we've already produced (from the local
    // BirdNET matches) so Wikipedia can't add a duplicate of a species
    // BirdNET already covered.
    const seen = new Set<string>();
    const merged: BirdexEntry[] = [];

    for (const label of labelMatches) {
      const name = label.scientificName.toLowerCase();
      seen.add(name);
      const existing = entriesByName.get(name);
      merged.push(existing ?? syntheticEntry(label));
    }

    // Append Wikipedia-only birds. The Wikidata verifier already
    // restricts these to bird taxa with a real binomial name, but we
    // re-confirm the query actually appears in the name as a guard
    // against Wikipedia full-text hits that matched on article body
    // rather than the title (e.g. a bird mentioned in another bird's
    // article). This keeps the result list honest to what the user typed.
    const normQuery = normalizeForSearch(deferredQuery);
    for (const bird of wikiBirds ?? []) {
      const name = bird.scientificName.toLowerCase();
      if (seen.has(name)) continue;
      const haystack = `${normalizeForSearch(bird.commonName)} ${normalizeForSearch(bird.scientificName)}`;
      if (!haystack.includes(normQuery)) continue;
      seen.add(name);
      const existing = entriesByName.get(name);
      merged.push(existing ?? syntheticEntry(wikiBirdLabel(bird)));
    }

    return merged;
  }, [labels, deferredQuery, entriesByName, wikiBirds]);

  return {
    results,
    active,
    isLoading,
    isLoadingWikipedia: active && isLoadingWikipedia,
  };
}
