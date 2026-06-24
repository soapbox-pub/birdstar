import { useQuery } from '@tanstack/react-query';

import { searchWikiBirds, type WikiBird } from '@/lib/wiki/wikiBirdSearch';
import {
  readWikiBirdSearch,
  writeWikiBirdSearch,
  wikiSearchCacheKey,
} from '@/lib/wiki/wikiBirdSearchStore';

// Wikipedia search is a supplement to the instant local BirdNET scan, so
// we only reach for the network once the query is substantial enough to
// be worth the round-trip. Three chars filters out the noisiest, broadest
// searches ("ow", "te") while still catching short real names and
// prefixes ("owl", "jay", "tit", "sec…" → Secretarybird).
export const WIKI_SEARCH_MIN_LENGTH = 3;

/**
 * Search Wikipedia (filtered to articles Wikipedia categorizes as birds)
 * for the given query, cached in IndexedDB per normalized query so
 * repeated lookups cost zero network once warm.
 *
 * Returns confirmed bird species not necessarily present in BirdNET. The
 * caller (`useBirdSearch`) merges these with local matches, de-duplicates
 * by scientific name, and projects them into BirdexEntry cells.
 *
 * @param query  The (already deferred) search string. Pass `null`/empty
 *               to disable the query entirely — short queries are a
 *               no-op so we don't hammer Wikipedia on every keystroke.
 */
export function useWikiBirdSearch(query: string | null) {
  const trimmed = (query ?? '').trim();
  const enabled = trimmed.length >= WIKI_SEARCH_MIN_LENGTH;
  // Key on the normalized cache key so "Robin", "robin", and " robin "
  // share one TanStack Query entry as well as one IndexedDB row.
  const key = enabled ? wikiSearchCacheKey(trimmed) : '';

  return useQuery<WikiBird[]>({
    queryKey: ['wiki-bird-search', key],
    enabled,
    // The IndexedDB layer owns durable freshness (7-day TTL); in-memory
    // we keep results around for the session so flipping between queries
    // is instant.
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    queryFn: async ({ signal }) => {
      // 1. Durable cache first — a hit means zero network.
      const cached = await readWikiBirdSearch(trimmed);
      if (cached) return cached;

      // 2. Live Wikipedia search, then persist for next time.
      const birds = await searchWikiBirds(trimmed, signal);
      // Only persist non-aborted, successful runs. `searchWikiBirds`
      // already degrades network failures to `[]`; caching an empty
      // result is fine (and desirable) for genuine no-match queries, but
      // we skip the write if the request was aborted mid-flight.
      if (!signal?.aborted) {
        void writeWikiBirdSearch(trimmed, birds);
      }
      return birds;
    },
  });
}
