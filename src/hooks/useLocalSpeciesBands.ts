// Hook that produces the user's local-species map (scientific name →
// distance band) either from the IndexedDB cache or by firing the 5-
// nested-radii iNat fan-out described in lib/inat/localSpecies.ts.
//
// Shape chosen to be as close to zero-cost as possible for consumers:
//
//   - Returns a plain `map` reference (not wrapped in a query object)
//     because downstream hooks (useBirdex, useDetectionAccumulator's
//     locationAdjuster) just want to do case-insensitive lookups and
//     don't care about fetch status.
//   - Returns `isLoading` so the birdex can optionally show a stable
//     "personalizing" hint on the very first cold load, and so tests
//     can verify the hook doesn't block when the user hasn't granted
//     geolocation.
//   - `map` is stable by reference: we return the same Map instance
//     for the lifetime of a fetched blob, so consumers can rely on
//     reference equality for memoization without extra keying.
//
// Caching policy:
//
//   - On mount with a valid `coarse` coord: read the cache. If a
//     FRESH entry exists (expiresAt > now), surface it synchronously
//     — no network. If a STALE entry exists, surface it
//     IMMEDIATELY and kick off a background refresh that swaps in
//     the fresh map when done. If nothing exists, fall back to
//     TanStack Query's queryFn, which fetches from iNat.
//   - The cache is authoritative across tabs/sessions; TanStack
//     Query's memory cache is a convenience on top.
//
// Failure handling:
//
//   - A failed fan-out fetch just resolves to `null` — consumers see
//     "no local map available" and fall through to .bin-only
//     behavior. We deliberately don't throw; nothing about this hook
//     should surface an error state in the UI.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  fetchLocalSpeciesBands,
  type LocalSpeciesMap,
} from '@/lib/inat/localSpecies';
import {
  readLocalSpecies,
  writeLocalSpecies,
} from '@/lib/inat/localSpeciesStore';
import type { CoarseLatLon } from '@/hooks/useUserRegion';

const QUERY_KEY_PREFIX = 'local-species-bands';

export interface UseLocalSpeciesBandsResult {
  /** The merged local species map. Null until the first fetch/cache-read
   * completes, or permanently null if no coarse coord is available or
   * the fetch failed. */
  map: LocalSpeciesMap | null;
  /** True while the first-ever fetch for this coord is in flight
   * (i.e. no stale entry was available to serve). Consumers usually
   * DON'T need to gate on this; the birdex renders fine without a
   * local map. */
  isLoading: boolean;
  /** True if the currently-served map came from an expired cache
   * entry (and a refresh is running in the background). */
  isStale: boolean;
}

export function useLocalSpeciesBands(
  coarse: CoarseLatLon | null,
): UseLocalSpeciesBandsResult {
  // Seed state from the synchronous-looking path: we try the cache on
  // mount and surface whatever we find before the network call even
  // starts. This avoids a "flash of unranked birdex" on warm loads.
  const [cachedMap, setCachedMap] = useState<LocalSpeciesMap | null>(null);
  const [cacheRead, setCacheRead] = useState(false);
  const [cacheWasStale, setCacheWasStale] = useState(false);

  // Track the last coord we attempted a cache read for so we don't
  // thrash if the coord object identity changes without the lat/lon
  // actually changing.
  const lastCoordRef = useRef<string | null>(null);

  useEffect(() => {
    if (!coarse) {
      setCachedMap(null);
      setCacheRead(true);
      setCacheWasStale(false);
      lastCoordRef.current = null;
      return;
    }
    const key = `${coarse.lat},${coarse.lon}`;
    if (lastCoordRef.current === key) return;
    lastCoordRef.current = key;

    let cancelled = false;
    setCacheRead(false);
    setCacheWasStale(false);
    (async () => {
      const result = await readLocalSpecies(coarse.lat, coarse.lon);
      if (cancelled) return;
      if (result) {
        setCachedMap(result.map);
        setCacheWasStale(result.isStale);
      } else {
        setCachedMap(null);
        setCacheWasStale(false);
      }
      setCacheRead(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [coarse]);

  // Fire the network fetch when either (a) we don't have a cached
  // entry at all or (b) the cached entry is stale. TanStack Query
  // dedupes and memoizes by key.
  const shouldFetch =
    !!coarse && cacheRead && (cachedMap === null || cacheWasStale);

  const query = useQuery<LocalSpeciesMap | null>({
    queryKey: [QUERY_KEY_PREFIX, coarse?.lat, coarse?.lon],
    enabled: shouldFetch,
    // A single successful fetch is good for the full TTL; refetching
    // more often wastes API budget for zero user-facing benefit.
    staleTime: 1000 * 60 * 60 * 24 * 7,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    retry: 1,
    queryFn: async () => {
      if (!coarse) return null;
      const map = await fetchLocalSpeciesBands(coarse.lat, coarse.lon);
      // Empty maps can happen in marine areas or bad network
      // conditions; cache them anyway so we don't re-fire on every
      // render, but briefer so a retry happens sooner.
      await writeLocalSpecies(coarse.lat, coarse.lon, map);
      return map;
    },
  });

  // Prefer the fresh network result once it arrives; otherwise serve
  // the cached map (potentially stale).
  const map = (query.data as LocalSpeciesMap | null) ?? cachedMap ?? null;

  return {
    map,
    // Only flag loading when we have NO map at all — a stale cache is
    // still better than nothing and consumers shouldn't show a
    // loading state just because a background refresh is running.
    isLoading: shouldFetch && query.isLoading && !cachedMap,
    isStale: cacheWasStale && !query.isSuccess,
  };
}
