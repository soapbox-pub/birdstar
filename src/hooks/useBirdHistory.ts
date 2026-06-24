// Loads the current user's past bird detections (kind 2473) from Nostr so
// they persist across page refreshes. Returns a list of Detection-shaped
// objects ready to render in the UI, plus the Set of Wikidata entity URIs
// they cover — used elsewhere to dedupe auto-publishing.
import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrStorage } from '@/hooks/useNostrStorage';
import type { Detection } from '@/components/BirdCard';

const MAX_HISTORY = 200;

/** Canonical Wikidata entity URI shape per NIP.md. */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

/**
 * Parse the NIP-31 `alt` tag produced by this app, which looks like:
 *   "Bird detection: American Robin (Turdus migratorius)"
 * Returns null if it doesn't match that pattern — the caller should fall
 * back to whatever data it has.
 */
function parseAltTag(alt: string | undefined): {
  commonName: string;
  scientificName: string;
} | null {
  if (!alt) return null;
  const m = alt.match(/^Bird detection:\s*(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return null;
  return { commonName: m[1], scientificName: m[2] };
}

function eventToDetection(
  event: NostrEvent,
): (Detection & { entityUri: string }) | null {
  const tagMap = new Map<string, string>();
  for (const [name, value] of event.tags) {
    if (!tagMap.has(name) && typeof value === 'string') tagMap.set(name, value);
  }

  // Must carry a NIP-73 `i` tag pointing at a Wikidata entity — that's
  // the canonical species identity per NIP.md. The `k` tag that NIP-73
  // normally pairs with `i` is deliberately omitted by this app (see
  // NIP.md §"Kind 2473"), so we validate on URL shape alone.
  const entityUri = tagMap.get('i');
  if (!entityUri) return null;
  if (!WIKIDATA_ENTITY_URI_RE.test(entityUri)) return null;

  // Scientific name comes from the `n` tag when present (the
  // authoritative field per NIP.md §"Kind 2473 — Bird Detection"); we
  // fall back to parsing the `alt` tag for events authored before the
  // `n` tag was added, so older detections in the user's history still
  // render.
  //
  // The common name still lives only in the `alt` tag — `n` is
  // scientific-only. If `alt` is missing or malformed AND `n` is
  // missing we drop the event, since a bare Q-id gives us nothing
  // meaningful to show the user.
  const parsedAlt = parseAltTag(tagMap.get('alt'));
  const scientificName = tagMap.get('n') ?? parsedAlt?.scientificName;
  const commonName = parsedAlt?.commonName;
  if (!scientificName || !commonName) return null;

  return {
    id: `history-${event.id}`,
    eventId: event.id,
    scientificName,
    commonName,
    timestamp: event.created_at * 1000,
    entityUri,
  };
}

export interface HistoryResult {
  /** Past detections, newest-first, deduped by Wikidata entity URI. */
  detections: (Detection & { entityUri: string })[];
  /**
   * For each Wikidata entity URI this user has ever published, the
   * timestamp (ms since epoch) of the most recent publish. Used to
   * rate-limit re-publishing when the same species is heard again.
   */
  lastPublishedAt: Map<string, number>;
  isLoading: boolean;
}

export function useBirdHistory(): HistoryResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { store } = useNostrStorage();
  const queryClient = useQueryClient();
  const pubkey = user?.pubkey;

  // Seed the query from the local event store so a returning user's history
  // renders instantly, before the network round-trip (and its 5s timeout)
  // resolves. Unlike the Birdex this is a list of regular events, so we read
  // the whole cached set rather than a single replaceable event and seed it as
  // the query's data. The network query below stays authoritative and
  // overwrites this when it lands; the seed never clobbers data that's already
  // present (a network result that beat the cache read).
  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    void (async () => {
      const cached = await store.query([
        { kinds: [2473], authors: [pubkey], limit: MAX_HISTORY },
      ]);
      if (cancelled || cached.length === 0) return;
      const key = ['bird-history', pubkey];
      if (queryClient.getQueryData<NostrEvent[]>(key) !== undefined) return;
      queryClient.setQueryData<NostrEvent[]>(key, cached);
    })();
    return () => {
      cancelled = true;
    };
  }, [pubkey, store, queryClient]);

  const query = useQuery({
    // Keep history keyed on pubkey so switching accounts re-fetches.
    queryKey: ['bird-history', pubkey],
    enabled: Boolean(pubkey),
    staleTime: 1000 * 60, // 1 minute — history changes rarely mid-session
    queryFn: async ({ signal }) => {
      if (!pubkey) return [] as NostrEvent[];
      // Fetch only the user's detections. We deliberately do NOT pull in
      // their kind 5 deletion requests: NIP-09 deletion is already enforced
      // relay-side (a deleted 2473 won't be returned) and by the local
      // NIndexedDB cache's kind-5 handling, so re-fetching them here is
      // wasted bandwidth. Worse, a user with many deletions would have them
      // crowd out actual detections within the shared `limit`, making
      // recently-heard species vanish from the dex.
      const events = await nostr.query(
        [{ kinds: [2473], authors: [pubkey], limit: MAX_HISTORY }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      return events;
    },
  });

  return useMemo<HistoryResult>(() => {
    const events = query.data ?? [];

    // Newest event per species wins, so the displayed timestamp reflects
    // the most recent hearing. The same map is used to expose an
    // entity-URI -> most-recent-timestamp lookup for re-publish rate
    // limiting.
    const byUri = new Map<string, Detection & { entityUri: string }>();
    for (const event of events) {
      if (event.kind !== 2473) continue;
      const det = eventToDetection(event);
      if (!det) continue;
      const existing = byUri.get(det.entityUri);
      if (!existing || det.timestamp > existing.timestamp) {
        byUri.set(det.entityUri, det);
      }
    }

    const detections = Array.from(byUri.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    const lastPublishedAt = new Map<string, number>();
    for (const [uri, det] of byUri) {
      lastPublishedAt.set(uri, det.timestamp);
    }

    return {
      detections,
      lastPublishedAt,
      // "Loading" means "no value to render yet from ANY source", not "the
      // network round-trip is still in flight". The cache-seed effect above
      // populates `query.data` straight from IndexedDB, so a returning user
      // clears this the moment the cache read lands — without waiting on the
      // relay (or its 5s timeout). The background network query refines `data`
      // when it resolves and never re-raises this flag.
      isLoading: Boolean(pubkey) && query.data === undefined,
    };
  }, [query.data, pubkey]);
}
