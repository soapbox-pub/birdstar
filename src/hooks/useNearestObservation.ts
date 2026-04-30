// Lazy per-species distance refinement for graded confidence damping.
//
// The bulk useLocalSpeciesBands gives us a 5-way distance band for
// every species observed within 500 km; that's enough to drive
// birdex ranking. For CONFIDENCE DAMPING though, we often want
// finer granularity — a species whose nearest observation is 35 km
// away (inside the 50 km band) shouldn't get quite the same damping
// treatment as one at 5 km (inside the 25 km band). This hook
// lets the accumulator's damper request an exact distance for a
// single species on demand.
//
// Flow:
//
//   1. Called with (scientificName, inatTaxonId) for a species
//      actively accumulating toward confirmation.
//   2. Check the IndexedDB nearest-obs cache (7-day TTL) — if we
//      already resolved this species at this coord, return the
//      cached distance.
//   3. Otherwise fire fetchNearestObservationDistance and cache
//      the result (including nulls, so we don't re-query species
//      that genuinely have no nearby observations).
//   4. In-flight dedupe: two concurrent calls for the same species
//      share one network round-trip.
//
// Expected volume: the accumulator only calls this when a species
// is actually in the detection pipeline — a few per session at most,
// regardless of how many species are in the BirdNET label table.
// One resolution per species per week per coord is well within
// iNat's rate limits.
//
// Returns a stable callable `resolve(scientificName, inatTaxonId)`
// that memoizes concurrent calls. Consumers keep the function in a
// ref (via useRef) so they can call it from hot-path callbacks
// without re-identifying them on every render.

import { useCallback, useRef } from 'react';
import type { CoarseLatLon } from '@/hooks/useUserRegion';
import { fetchNearestObservationDistance } from '@/lib/inat/localSpecies';
import {
  readNearest,
  writeNearest,
} from '@/lib/inat/localSpeciesStore';

export interface UseNearestObservationApi {
  /**
   * Resolve (and cache) the nearest-observation distance for one
   * species at the current coarse coord. Returns null if we don't
   * have a coord, if the species isn't resolvable, if no observation
   * was found within the outer radius, or on any network error.
   */
  resolve: (inatTaxonId: number) => Promise<number | null>;
  /**
   * Synchronous lookup into an in-memory cache populated by completed
   * `resolve` calls during this session. Used by the accumulator's
   * damper to avoid awaiting on the hot path — if the entry isn't
   * here yet, the damper falls through to the band-level signal and
   * fires `resolve` in the background to warm the cache for next
   * time.
   */
  peek: (inatTaxonId: number) => number | null | undefined;
}

export function useNearestObservation(
  coarse: CoarseLatLon | null,
): UseNearestObservationApi {
  // In-memory cache so the damper can look up a distance
  // synchronously after a successful resolve. Key is inatTaxonId;
  // reset whenever the coarse coord changes.
  //
  // Value encoding:
  //   number → known distance in km
  //   null   → resolved as "no observation found"
  //   undefined (i.e. key absent) → not resolved yet
  const memoryCache = useRef<Map<number, number | null>>(new Map());

  // Track in-flight requests so concurrent calls dedupe.
  const inFlight = useRef<Map<number, Promise<number | null>>>(new Map());

  // Track the last coord so we can clear the memory cache on move.
  // Storing the serialized form keeps the dependency array stable.
  const lastCoordKey = useRef<string | null>(null);
  const coordKeyStr = coarse ? `${coarse.lat},${coarse.lon}` : null;
  if (lastCoordKey.current !== coordKeyStr) {
    memoryCache.current = new Map();
    inFlight.current = new Map();
    lastCoordKey.current = coordKeyStr;
  }

  const resolve = useCallback<UseNearestObservationApi['resolve']>(
    async (inatTaxonId) => {
      if (!coarse) return null;

      // In-memory hit.
      const mem = memoryCache.current.get(inatTaxonId);
      if (mem !== undefined) return mem;

      // In-flight dedupe.
      const existing = inFlight.current.get(inatTaxonId);
      if (existing) return existing;

      const task = (async () => {
        // IndexedDB cache hit.
        const cached = await readNearest(coarse.lat, coarse.lon, inatTaxonId);
        if (cached) {
          memoryCache.current.set(inatTaxonId, cached.distanceKm);
          return cached.distanceKm;
        }

        // Network.
        const distance = await fetchNearestObservationDistance(
          inatTaxonId,
          coarse.lat,
          coarse.lon,
        );
        memoryCache.current.set(inatTaxonId, distance);
        // Persist even null results so we don't retry an empty
        // answer on every session.
        await writeNearest(coarse.lat, coarse.lon, inatTaxonId, distance);
        return distance;
      })();

      inFlight.current.set(inatTaxonId, task);
      try {
        return await task;
      } finally {
        inFlight.current.delete(inatTaxonId);
      }
    },
    [coarse],
  );

  const peek = useCallback<UseNearestObservationApi['peek']>((inatTaxonId) => {
    const v = memoryCache.current.get(inatTaxonId);
    return v;
  }, []);

  return { resolve, peek };
}
