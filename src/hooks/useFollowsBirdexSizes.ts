// Species counts from the Birdex (kind 12473) of everyone the logged-in
// user follows, for ranking the Friends list like a leaderboard.
//
// Each Birdex is one small replaceable event, so the whole follow list
// is fetched in a single REQ (authors split across several filters so
// no one filter trips a relay's `authors` cap). As in useBirdexEvent,
// the local event store is both an instant first answer and a floor:
// per author, the newest of the relay and cached copies wins, so a
// laggy relay can't shrink someone's count.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { BIRDEX_KIND, parseBirdexEvent } from '@/hooks/useBirdexEvent';
import { useFollowList } from '@/hooks/useFollowList';
import { useNostrStorage } from '@/hooks/useNostrStorage';

/** Authors per filter. Many relays reject filters with huge author lists. */
const AUTHORS_PER_FILTER = 250;

const NO_SIZES: ReadonlyMap<string, number> = new Map();

function birdexFilters(pubkeys: string[]): NostrFilter[] {
  const filters: NostrFilter[] = [];
  for (let i = 0; i < pubkeys.length; i += AUTHORS_PER_FILTER) {
    const authors = pubkeys.slice(i, i + AUTHORS_PER_FILTER);
    filters.push({ kinds: [BIRDEX_KIND], authors, limit: authors.length });
  }
  return filters;
}

/** Newest event per author. */
function newestByAuthor(events: Iterable<NostrEvent>): Map<string, NostrEvent> {
  const byAuthor = new Map<string, NostrEvent>();
  for (const event of events) {
    const existing = byAuthor.get(event.pubkey);
    if (!existing || event.created_at > existing.created_at) {
      byAuthor.set(event.pubkey, event);
    }
  }
  return byAuthor;
}

function toSizes(byAuthor: Map<string, NostrEvent>): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const [pubkey, event] of byAuthor) {
    sizes.set(pubkey, parseBirdexEvent(event).length);
  }
  return sizes;
}

/**
 * Map of followed pubkey → number of species on their Birdex. Accounts
 * with no Birdex are absent from the map. `undefined` until the follow
 * list and at least the cached Birdexes have loaded.
 */
export function useFollowsBirdexSizes(): ReadonlyMap<string, number> | undefined {
  const { nostr } = useNostr();
  const { store } = useNostrStorage();
  const { data: follows } = useFollowList();

  const pubkeys = useMemo(() => [...(follows ?? [])].sort(), [follows]);
  const filters = useMemo(() => birdexFilters(pubkeys), [pubkeys]);

  // Instant answer from the local store; the relay query below refines it.
  const cached = useQuery({
    queryKey: ['follows-birdex-sizes', 'cache', pubkeys],
    enabled: pubkeys.length > 0,
    staleTime: Infinity,
    queryFn: async () => toSizes(newestByAuthor(await store.query(filters))),
  });

  const fresh = useQuery({
    queryKey: ['follows-birdex-sizes', pubkeys],
    enabled: pubkeys.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const [relayEvents, cachedEvents] = await Promise.all([
        nostr.query(filters, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) }),
        store.query(filters),
      ]);
      const relayNewest = newestByAuthor(relayEvents);
      const byAuthor = newestByAuthor([...relayNewest.values(), ...cachedEvents]);

      // Persist what came from the network (fire-and-forget).
      for (const event of byAuthor.values()) {
        if (relayNewest.get(event.pubkey) === event) void store.event(event);
      }
      return toSizes(byAuthor);
    },
  });

  if (follows && pubkeys.length === 0) return NO_SIZES;
  return fresh.data ?? cached.data;
}
