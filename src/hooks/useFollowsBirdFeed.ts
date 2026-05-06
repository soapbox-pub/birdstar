// Paginated feed of bird detections (kind 2473) authored by the
// logged-in user plus everyone on their NIP-02 follow list (kind 3).
//
// Complements `useFollowsBirdDetections` (transient live toasts, no
// history) and `useBirdHistory` (self-only, full cumulative history):
//
//   - `useBirdHistory`: self, bulk-fetched in one round trip, keyed
//     by species for the birdex grid.
//   - `useFollowsBirdDetections`: self-follows, streaming REQ from
//     "now", for toasts.
//   - `useFollowsBirdFeed` (this hook): self + follows, historical,
//     paginated, newest-first — drives the feed rendered under the
//     birdex.
//
// Design notes, mirroring Ditto's useFeed pattern at
// ~/Projects/ditto/src/hooks/useFeed.ts:
//
//   - `useInfiniteQuery` with a timestamp cursor: each page's
//     `until` is the oldest `created_at` from the previous page
//     minus one. Relays all speak `until` natively, so pagination
//     is handled server-side without any client-side bookkeeping
//     beyond the cursor.
//
//   - We pull kind 2473 AND kind 5 (NIP-09 deletions) in the same
//     filter so a single round-trip per page can hide retracted
//     detections without a follow-up query. A deletion is only
//     honored when its author matches the deleted event's author —
//     guaranteed here because the `authors` filter is identical for
//     both kinds.
//
//   - `followsReady` gates the query when logged in: we wait for
//     the kind-3 follow-list fetch to settle before firing so the
//     feed query sees the full author set on first attempt,
//     avoiding a re-query as soon as the follow list lands.
//
//   - Logged-out users get an explicit disabled state: there's no
//     author list to query, and the BirdFeed component hides the
//     whole section in that case anyway.
import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/hooks/useFollowList';

/** Canonical Wikidata entity URI shape per NIP.md §"Kind 2473". */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

/** Events per page. Matches Ditto's PAGE_SIZE to keep the feel
 *  consistent — large enough that the first page fills a reasonable
 *  viewport, small enough that a low-bandwidth relay round-trip
 *  doesn't stall the UI. */
const PAGE_SIZE = 20;

export interface BirdFeedItem {
  /** Stable key for React. */
  id: string;
  /** Source kind 2473 event. */
  event: NostrEvent;
  /** Author pubkey (convenience mirror of `event.pubkey`). */
  pubkey: string;
  /** Posix timestamp in ms (convenience mirror of `event.created_at * 1000`). */
  timestamp: number;
  /** Scientific name from the authoritative `n` tag (NIP.md §"Kind 2473"). */
  scientificName: string;
  /** Common name parsed from the NIP-31 `alt` tag. Empty when the
   *  event came from a client that uses a different alt style — the
   *  component then falls back to the scientific name. */
  commonName: string;
  /** Wikidata entity URI from the `i` tag. Always present for items
   *  we emit — events without a valid `i` tag are dropped. */
  entityUri: string;
}

interface FeedPage {
  items: BirdFeedItem[];
  /** The oldest `created_at` (seconds) in the raw query result,
   *  even for events we filtered out (deletions, malformed). Used as
   *  the pagination cursor — subtracting 1 from it prevents the next
   *  page from overlapping on the boundary event. */
  oldestCreatedAt: number | null;
  /** Number of raw events returned by the relay (any kind) before
   *  client-side filtering. When this is 0 we stop paginating; a
   *  non-zero raw count with 0 valid items just means the page was
   *  all deletions and we should keep going. */
  rawCount: number;
}

/** Parse the NIP-31 `alt` tag, shape: "Bird detection: American Robin (Turdus migratorius)". */
function parseAltTag(
  alt: string | undefined,
): { commonName: string; scientificName: string } | null {
  if (!alt) return null;
  const m = alt.match(/^Bird detection:\s*(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return null;
  return { commonName: m[1], scientificName: m[2] };
}

/** Convert a validated kind 2473 event into a feed item, or return
 *  null when required fields are missing / malformed. Mirrors the
 *  validation in `useBirdHistory.eventToDetection` so the feed and
 *  the birdex agree on what counts as a well-formed detection. */
function eventToFeedItem(event: NostrEvent): BirdFeedItem | null {
  if (event.kind !== 2473) return null;

  let entityUri = '';
  let nTagScientific = '';
  let altTag = '';
  for (const [name, value] of event.tags) {
    if (typeof value !== 'string') continue;
    if (name === 'i' && !entityUri) entityUri = value;
    else if (name === 'n' && !nTagScientific) nTagScientific = value;
    else if (name === 'alt' && !altTag) altTag = value;
  }

  // `i` is NIP.md-required; shape-check it as the trust boundary. The
  // `k` pairing is deliberately omitted by this app so we validate on
  // URL shape alone (same as useBirdHistory).
  if (!WIKIDATA_ENTITY_URI_RE.test(entityUri)) return null;

  const parsedAlt = parseAltTag(altTag);
  const scientificName = nTagScientific || parsedAlt?.scientificName || '';
  if (!scientificName) return null;

  // Common name is best-effort: events authored by other clients may
  // use a different alt format. Fall back to the scientific name so
  // the row still renders something meaningful.
  const commonName = parsedAlt?.commonName || scientificName;

  return {
    id: event.id,
    event,
    pubkey: event.pubkey,
    timestamp: event.created_at * 1000,
    scientificName,
    commonName,
    entityUri,
  };
}

export interface UseFollowsBirdFeedResult {
  items: BirdFeedItem[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  /** True only when the follow list has finished loading. Until
   *  then we render a skeleton rather than "no results" even though
   *  the feed query hasn't fired yet. */
  followsReady: boolean;
  error: Error | null;
}

/**
 * Paginated feed of bird detections authored by the current user plus
 * everyone they follow. Honors NIP-09 deletions within the same
 * author's history.
 */
export function useFollowsBirdFeed(): UseFollowsBirdFeedResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: follows, isLoading: followsLoading } = useFollowList();

  // Stable author list: self + everyone followed, sorted and
  // deduplicated. Sorting lets us build a deterministic cache key so
  // TanStack doesn't re-fetch when the follow Set is rebuilt with the
  // same contents.
  const authors = useMemo(() => {
    if (!user) return [] as string[];
    const set = new Set<string>(follows ?? []);
    set.add(user.pubkey);
    return [...set].sort();
  }, [follows, user]);

  const authorsKey = authors.join(',');

  // Match Ditto's `followsReady` gate: don't fire the feed query
  // until we know whether the user has a follow list at all.
  // `follows` is undefined until `useFollowList` settles; `null` is
  // only returned when the user is logged out.
  const followsReady = Boolean(user) && !followsLoading;

  const query = useInfiniteQuery<FeedPage, Error>({
    queryKey: ['bird-feed', user?.pubkey ?? '', authorsKey],
    enabled: followsReady && authors.length > 0,
    staleTime: 60 * 1000,
    // Don't refetch on window focus — the toast stream already
    // surfaces live events, and a silent refetch that shifts the
    // feed underneath the user mid-scroll is a worse UX than
    // slightly stale data.
    refetchOnWindowFocus: false,
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const filter: {
        kinds: number[];
        authors: string[];
        limit: number;
        until?: number;
      } = {
        kinds: [2473, 5],
        authors,
        limit: PAGE_SIZE,
      };
      if (typeof pageParam === 'number') filter.until = pageParam;

      const raw = await nostr.query([filter], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });

      if (raw.length === 0) {
        return { items: [], oldestCreatedAt: null, rawCount: 0 };
      }

      // NIP-09: an event is deleted if a kind 5 from the SAME author
      // references its id. We trust deletions only from the matching
      // author, built as `author -> Set<deleted event ids>`. The
      // authors filter already constrains both sides; this map just
      // makes the check O(1).
      const deletionsByAuthor = new Map<string, Set<string>>();
      for (const e of raw) {
        if (e.kind !== 5) continue;
        let bucket = deletionsByAuthor.get(e.pubkey);
        if (!bucket) {
          bucket = new Set();
          deletionsByAuthor.set(e.pubkey, bucket);
        }
        for (const [name, value] of e.tags) {
          if (name === 'e' && typeof value === 'string') bucket.add(value);
        }
      }

      const items: BirdFeedItem[] = [];
      let oldest: number | null = null;
      for (const e of raw) {
        // Track oldest across ALL raw events (even deletions) so the
        // cursor advances even when a page is entirely deletions —
        // otherwise we'd spin on the same `until` forever.
        oldest = oldest === null ? e.created_at : Math.min(oldest, e.created_at);

        if (e.kind !== 2473) continue;
        if (deletionsByAuthor.get(e.pubkey)?.has(e.id)) continue;

        const item = eventToFeedItem(e);
        if (item) items.push(item);
      }

      // Newest first, stable on tie (id break avoids flicker on
      // refetch when two events share a second).
      items.sort((a, b) => {
        if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
        return a.id.localeCompare(b.id);
      });

      return {
        items,
        oldestCreatedAt: oldest,
        rawCount: raw.length,
      };
    },
    getNextPageParam: (lastPage) => {
      // Relay returned nothing — we've reached the end of history.
      if (lastPage.rawCount === 0 || lastPage.oldestCreatedAt === null) {
        return undefined;
      }
      // Stop paginating when a page returns fewer raw events than
      // we asked for — the relay has nothing older to give us.
      if (lastPage.rawCount < PAGE_SIZE) return undefined;
      // -1 so the next page doesn't re-include the boundary event.
      return lastPage.oldestCreatedAt - 1;
    },
  });

  // Flatten pages and dedupe by event id — relays occasionally
  // include the same event across boundary pages if two events share
  // a `created_at` second. Preserves the first (newest) occurrence.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: BirdFeedItem[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }, [query.data]);

  return {
    items,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: () => {
      // Guard so callers from onScroll don't double-fire while a
      // fetch is already in flight.
      if (!query.isFetchingNextPage && query.hasNextPage) {
        void query.fetchNextPage();
      }
    },
    followsReady,
    error: query.error ?? null,
  };
}
