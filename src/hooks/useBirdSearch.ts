import { useDeferredValue, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useBirdLabels } from '@/hooks/useBirdLabels';
import { useWikiBirdSearch } from '@/hooks/useWikiBirdSearch';
import { useKnownBirds } from '@/hooks/useKnownBirds';
import { searchBirdLabels, scoreNamePair } from '@/lib/birdSearch';
import { rememberKnownBirds } from '@/lib/wiki/knownBirdsStore';
import type { BirdexEntry } from '@/hooks/useBirdex';
import type { BirdLabel } from '@/lib/birdnet/labels';
import type { WikiBird } from '@/lib/wiki/wikiBirdSearch';

// Synthetic BirdNET label indices for non-BirdNET birds (Wikipedia hits
// and locally-remembered known birds). The real BirdNET label set uses
// indices 0..~6520; we assign these negative indices so they're
// guaranteed not to collide with a real label as a React key
// (`SpeciesCell` keys on `label.index`) and so any code that treats
// `index` as a model-output slot can cheaply tell a synthetic entry apart
// (index < 0 ⇒ "not in BirdNET, not detectable").
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

/** Build a synthetic {@link BirdLabel} for a non-BirdNET bird. Gets a
 *  stable negative index so it never collides with a real BirdNET label. */
function nonBirdNetLabel(scientificName: string, commonName: string): BirdLabel {
  return {
    index: syntheticLabelIndex(scientificName),
    scientificName,
    commonName,
    isBird: true,
  };
}

export interface UseBirdSearchResult {
  /** Matching entries, ranked by relevance, ready for SpeciesCell.
   *  BirdNET + locally-known matches first, then Wikipedia-only birds. */
  results: BirdexEntry[];
  /** True once the user has typed a usable query (≥ 2 chars). */
  active: boolean;
  /** True while labels are still loading (so the query can't run yet). */
  isLoading: boolean;
  /** True while the supplemental Wikipedia search is still in flight.
   *  Local (BirdNET + known-bird) results are already shown; this lets
   *  the UI hint that more (rarer / non-BirdNET) species may still
   *  appear. */
  isLoadingWikipedia: boolean;
}

/**
 * Search across three sources, projecting matches into {@link BirdexEntry}s:
 *
 *   1. The full BirdNET species list (instant, local).
 *   2. The local "known birds" index — species the user has confirmed,
 *      added to their Birdex, or previously found via Wikipedia (instant,
 *      local, works offline).
 *   3. A live Wikipedia search (network) for everything else, so
 *      rarities, recent splits, and regional specialties BirdNET can't
 *      detect are still findable.
 *
 * BirdNET matches reuse the heard/rare/unconfirmed state from the user's
 * existing birdex where available (so a searched-for bird the user has
 * already heard still shows its checkmark, glow, and play button).
 * De-duplication across all three sources is by lower-cased scientific
 * name, BirdNET winning over known-bird winning over Wikipedia.
 *
 * Wikipedia results are written back into the local known-birds index, so
 * the second time the user searches for the same bird it resolves
 * instantly from source #2 without touching the network.
 *
 * @param query           Raw user input. Trimmed/normalized internally;
 *                        queries shorter than 2 chars yield no results.
 * @param visibleEntries  The current `birdex.visible` list — used as the
 *                        authoritative source of per-species state for any
 *                        match the user has interacted with.
 */
export function useBirdSearch(
  query: string,
  visibleEntries: BirdexEntry[],
): UseBirdSearchResult {
  const queryClient = useQueryClient();
  const { data: labels, isLoading } = useBirdLabels();
  const { data: knownBirds } = useKnownBirds();

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
    if (!active) return [];

    // Track every scientific name already produced so later (lower-
    // priority) sources can't add a duplicate of one a higher-priority
    // source already covered.
    const seen = new Set<string>();
    const merged: BirdexEntry[] = [];

    const push = (label: BirdLabel) => {
      const name = label.scientificName.toLowerCase();
      if (seen.has(name)) return;
      seen.add(name);
      merged.push(entriesByName.get(name) ?? syntheticEntry(label));
    };

    // 1. BirdNET label matches (instant, already ranked).
    for (const label of searchBirdLabels(labels, deferredQuery)) {
      push(label);
    }

    // 2. Local known-birds index (instant, offline). Score with the same
    // tiers as BirdNET so they slot in sensibly; ranked among themselves
    // by score then recency.
    const knownMatches = (knownBirds ?? [])
      .map((b) => ({
        bird: b,
        score: scoreNamePair(b.commonName, b.scientificNameDisplay, deferredQuery),
      }))
      .filter((m) => m.score > 0)
      .sort(
        (a, b) => b.score - a.score || b.bird.lastSeenAt - a.bird.lastSeenAt,
      );
    for (const { bird } of knownMatches) {
      push(nonBirdNetLabel(bird.scientificNameDisplay, bird.commonName));
    }

    // 3. Wikipedia-only birds. The bird-category filter already restricts
    // these to bird articles; we keep Wikipedia's relevance order.
    for (const bird of wikiBirds ?? []) {
      push(nonBirdNetLabel(bird.scientificName, bird.commonName));
    }

    return merged;
  }, [active, labels, deferredQuery, entriesByName, knownBirds, wikiBirds]);

  // Persist Wikipedia results into the local known-birds index so the
  // next search for the same bird resolves instantly from source #2.
  // Fire-and-forget; invalidate the known-birds query so the new rows are
  // searchable without a reload.
  useEffect(() => {
    const birds = wikiBirds ?? [];
    if (birds.length === 0) return;
    void rememberKnownBirds(
      birds.map((b: WikiBird) => ({
        scientificName: b.scientificName,
        commonName: b.commonName,
        entityUri: b.entityUri,
      })),
    ).then(() => {
      queryClient.invalidateQueries({ queryKey: ['known-birds'] });
    });
  }, [wikiBirds, queryClient]);

  // Seed the known-birds index from the user's curated Birdex
  // (`visibleEntries`). These carry fully-resolved common + scientific
  // names, so a bird the user has confirmed — including a non-BirdNET one
  // they added — becomes locally searchable as soon as their Birdex
  // loads, even before they open it. Fire-and-forget, de-duped by the
  // store; only the heard/confirmed entries are worth indexing.
  //
  // `useBirdex` rebuilds its entry array on most renders, so we key the
  // effect on a stable signature of the heard species (their scientific
  // names) rather than the array identity — otherwise we'd re-write the
  // store on every unrelated render.
  const heardEntries = useMemo(
    () => visibleEntries.filter((e) => e.heard),
    [visibleEntries],
  );
  const heardSignature = heardEntries
    .map((e) => e.label.scientificName)
    .sort()
    .join('|');
  useEffect(() => {
    if (heardEntries.length === 0) return;
    void rememberKnownBirds(
      heardEntries.map((e) => ({
        scientificName: e.label.scientificName,
        commonName: e.label.commonName,
        entityUri: e.detection?.entityUri ?? null,
      })),
    );
    // heardEntries is recomputed alongside heardSignature; we depend on
    // the signature so the write only fires when the heard set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heardSignature]);

  return {
    results,
    active,
    isLoading,
    isLoadingWikipedia: active && isLoadingWikipedia,
  };
}
