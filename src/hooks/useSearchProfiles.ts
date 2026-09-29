import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';

import { parseAuthorEvent, type AuthorResult } from '@/hooks/useAuthor';
import { useDebounce } from '@/hooks/useDebounce';
import { useFollowList } from '@/hooks/useFollowList';
import { PROFILE_SEARCH_RELAY } from '@/lib/appRelays';

export interface SearchProfile {
  pubkey: string;
  metadata: NostrMetadata;
  event: NostrEvent;
}

const MAX_RESULTS = 10;

/**
 * Rank a profile against the query so name matches beat nip05-only
 * matches. Lower is better. Without this a query like "primal" floats
 * every `someone@primal.net` above the account actually named Primal,
 * because the relay ranks nip05-domain hits as highly as names.
 */
function relevanceTier(metadata: NostrMetadata, q: string): number {
  const name = metadata.name?.toLowerCase() ?? '';
  const displayName = metadata.display_name?.toLowerCase() ?? '';
  const nip05 = metadata.nip05?.toLowerCase() ?? '';
  const nip05Local = nip05.replace(/^_@/, '').split('@')[0] ?? '';

  if (name === q || displayName === q) return 0;
  if (name.startsWith(q) || displayName.startsWith(q)) return 1;
  if (name.includes(q) || displayName.includes(q)) return 2;
  if (nip05Local.startsWith(q)) return 3;
  if (nip05.includes(q)) return 4;
  return 5;
}

function sortName(metadata: NostrMetadata): string {
  return (metadata.name || metadata.display_name || '').toLowerCase();
}

/**
 * Typeahead account search (ported from Ditto's `useSearchProfiles`).
 *
 * Runs a NIP-50 kind-0 search against {@link PROFILE_SEARCH_RELAY} and
 * merges in profiles already loaded this session (the `useAuthor` query
 * cache), so people you've seen in the feed turn up even if the relay
 * misses them. Results are ranked by match quality, then accounts you
 * already follow, then name, and capped at {@link MAX_RESULTS}.
 */
export function useSearchProfiles(query: string) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { data: follows } = useFollowList();

  const debounced = useDebounce(query.trim(), 300);

  const relayResults = useQuery<SearchProfile[]>({
    queryKey: ['search-profiles', debounced],
    queryFn: async ({ signal }) => {
      const events = await nostr.relay(PROFILE_SEARCH_RELAY).query(
        [{ kinds: [0], search: `${debounced} autocomplete:true sort:top`, limit: 20 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );

      const latest = new Map<string, SearchProfile>();
      for (const event of events) {
        const { metadata } = parseAuthorEvent(event);
        if (!metadata) continue;
        const existing = latest.get(event.pubkey);
        if (!existing || event.created_at > existing.event.created_at) {
          latest.set(event.pubkey, { pubkey: event.pubkey, metadata, event });
        }
      }

      // Seed the author cache so result rows (and the profile they open)
      // render instantly instead of re-fetching each kind 0.
      for (const profile of latest.values()) {
        const key = ['nostr', 'author', profile.pubkey];
        if (!queryClient.getQueryData<AuthorResult>(key)?.event) {
          queryClient.setQueryData<AuthorResult>(key, {
            event: profile.event,
            metadata: profile.metadata,
          });
        }
      }

      return [...latest.values()];
    },
    enabled: debounced.length >= 1,
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });

  const data = useMemo<SearchProfile[]>(() => {
    if (!debounced) return [];
    const q = debounced.toLowerCase();

    const merged = new Map<string, SearchProfile>();
    for (const profile of relayResults.data ?? []) {
      merged.set(profile.pubkey, profile);
    }

    // Profiles already loaded this session.
    for (const entry of queryClient.getQueryCache().findAll({ queryKey: ['nostr', 'author'] })) {
      const cached = entry.state.data as AuthorResult | undefined;
      if (!cached?.event || !cached.metadata || merged.has(cached.event.pubkey)) continue;
      if (relevanceTier(cached.metadata, q) < 5) {
        merged.set(cached.event.pubkey, {
          pubkey: cached.event.pubkey,
          metadata: cached.metadata,
          event: cached.event,
        });
      }
    }

    return [...merged.values()]
      .sort((a, b) => {
        const tier = relevanceTier(a.metadata, q) - relevanceTier(b.metadata, q);
        if (tier !== 0) return tier;
        const followed = Number(!follows?.has(a.pubkey)) - Number(!follows?.has(b.pubkey));
        if (followed !== 0) return followed;
        return sortName(a.metadata).localeCompare(sortName(b.metadata));
      })
      .slice(0, MAX_RESULTS);
  }, [debounced, relayResults.data, queryClient, follows]);

  return {
    data,
    /** True while the debounced query is in flight (or still debouncing). */
    isFetching: relayResults.isFetching || debounced !== query.trim(),
  };
}
