// Species counts from the Birdex (kind 12473) of the logged-in user and
// everyone they follow, for the Friends leaderboard.
//
// Each Birdex is one small replaceable event, so everyone is fetched in
// a single REQ (authors split across several filters so no one filter
// trips a relay's `authors` cap).
//
// Cache-first: the local event store answers first, and the leaderboard
// waits for that answer rather than rendering an unranked list that
// reshuffles a moment later. The relay query then refines it. Per
// author, the newest of the relay and cached copies wins, as in
// useBirdexEvent, so a laggy relay can't shrink someone's count.

import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { BIRDEX_KIND, parseBirdexEvent } from '@/hooks/useBirdexEvent';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/hooks/useFollowList';
import { useNostrStorage } from '@/hooks/useNostrStorage';

/** Authors per filter. Many relays reject filters with huge author lists. */
const AUTHORS_PER_FILTER = 250;

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
    const count = parseBirdexEvent(event).length;
    if (count > 0) sizes.set(pubkey, count);
  }
  return sizes;
}

export interface FollowsBirdexSizes {
  /** Pubkey → species on their Birdex, for you and everyone you follow.
   *  Accounts with an empty or missing Birdex are absent. */
  sizes: ReadonlyMap<string, number>;
  /** True until there's something worth ranking: the follow list and
   *  the local cache have loaded, and, when the cache had nothing, the
   *  relays have answered too. */
  isLoading: boolean;
}

const NO_SIZES: ReadonlyMap<string, number> = new Map();

export function useFollowsBirdexSizes(): FollowsBirdexSizes {
  const { nostr } = useNostr();
  const { store } = useNostrStorage();
  const { user } = useCurrentUser();
  const { data: follows, isLoading: followsLoading } = useFollowList();

  const pubkeys = useMemo(() => {
    const all = new Set(follows ?? []);
    if (user) all.add(user.pubkey);
    return [...all].sort();
  }, [follows, user]);
  const filters = useMemo(() => birdexFilters(pubkeys), [pubkeys]);
  const enabled = !followsLoading && pubkeys.length > 0;

  // `keepPreviousData` on both: when the follow list changes (the cached
  // copy giving way to the relay's, or a friend added from this dialog)
  // the query key changes, and the board should keep its last answer
  // instead of dropping back to a skeleton.
  const cached = useQuery({
    queryKey: ['follows-birdex-sizes', 'cache', pubkeys],
    enabled,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    queryFn: async () => toSizes(newestByAuthor(await store.query(filters))),
  });

  const fresh = useQuery({
    queryKey: ['follows-birdex-sizes', pubkeys],
    enabled,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
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

  if (followsLoading) return { sizes: NO_SIZES, isLoading: true };
  if (!enabled) return { sizes: NO_SIZES, isLoading: false };

  const sizes = fresh.data ?? cached.data;
  // An empty cache isn't an answer, just a first visit: wait for the
  // relays (or their timeout) before showing an unranked list.
  const cacheEmpty = cached.data !== undefined && cached.data.size === 0;
  const isLoading = cached.isPending || (cacheEmpty && fresh.isPending);
  return { sizes: sizes ?? NO_SIZES, isLoading };
}
