// Recent kind 2473 detections of a specific species, authored by the
// logged-in user plus everyone they follow (NIP-02 kind 3). Powers the
// "Recent sightings" section inside `BirdInfoDialog` so users can see
// when they and their friends have heard *this* bird.
//
// Relationship to the other bird-feed hooks:
//
//   - `useBirdHistory`: self-only, bulk, full history, keyed per
//     species for the birdex grid.
//   - `useFollowsBirdDetections`: self+follows, live REQ stream from
//     "now", drives toasts.
//   - `useFollowsBirdFeed`: self+follows, historical, paginated,
//     newest-first, un-filtered — drives the feed rendered under the
//     birdex.
//   - `useSpeciesSightings` (this hook): self+follows, historical,
//     single bounded page, filtered server-side to a single Wikidata
//     entity URI — drives the per-species section inside the bird
//     detail dialog.
//
// Design notes:
//
//   - Relays index single-letter tags, so we filter by `'#i':
//     [entityUri]` at the relay. No client-side species filtering is
//     necessary — the relay returns only events for this species.
//
//   - We pull kind 2473 AND kind 5 (NIP-09 deletions) in the same
//     round-trip so a deletion from the same author hides the
//     detection without a follow-up query. A deletion is only
//     honored when its author matches the deleted event's author.
//     Note: kind 5 events don't carry the `i` tag, so filtering by
//     `#i` alongside `kinds: [2473, 5]` would drop every deletion on
//     the floor. We issue two parallel filters in a single
//     `nostr.query` call instead — the deletion filter is
//     author+kind-scoped, and we cross-check `e` tags against the
//     2473 ids we actually fetched.
//
//   - `followsReady` gates the query when logged in: wait for kind 3
//     to settle so the first fetch sees the full author set.
//
//   - Logged-out users get an explicit disabled state. The dialog
//     hides the section in that case anyway.
//
//   - This is a single `useQuery` (not infinite) — the dialog slot is
//     bounded and a flat list of up to `PAGE_SIZE` recent sightings
//     is plenty. If we ever want "load more" we can swap to
//     `useInfiniteQuery` following the `useFollowsBirdFeed` pattern.
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/hooks/useFollowList';

/** Canonical Wikidata entity URI shape per NIP.md §"Kind 2473". */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

/** Upper bound on detection events we fetch for one species. The
 *  consumer (`SpeciesSightingsSection`) renders the *deduped* set of
 *  friends who have heard this bird, not the raw event stream, so a
 *  single friend who posts the same species many times shouldn't
 *  push others past the cap. 100 comfortably covers realistic follow
 *  lists — a user with hundreds of follows, each having heard the
 *  bird once, would still be fully represented — while keeping the
 *  request bounded. Relays can't dedupe by author for us, so we
 *  over-fetch a little and dedupe in JS below. */
const PAGE_SIZE = 100;

export interface SpeciesSightingItem {
  /** Stable key for React. */
  id: string;
  /** Source kind 2473 event. */
  event: NostrEvent;
  /** Author pubkey (mirror of `event.pubkey`). */
  pubkey: string;
  /** Posix timestamp in ms (mirror of `event.created_at * 1000`). */
  timestamp: number;
  /** Scientific name from the authoritative `n` tag. */
  scientificName: string;
  /** Common name parsed from the NIP-31 `alt` tag; may fall back to
   *  the scientific name if the author used a non-matching alt. */
  commonName: string;
  /** Wikidata entity URI from the `i` tag. Always present. */
  entityUri: string;
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

/** Convert a validated kind 2473 event into a sighting, or null when
 *  required fields are missing / malformed. Mirrors the validators in
 *  the other bird-feed hooks so all three agree on what counts as a
 *  well-formed detection. */
function eventToSighting(event: NostrEvent): SpeciesSightingItem | null {
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

  if (!WIKIDATA_ENTITY_URI_RE.test(entityUri)) return null;

  const parsedAlt = parseAltTag(altTag);
  const scientificName = nTagScientific || parsedAlt?.scientificName || '';
  if (!scientificName) return null;
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

export interface UseSpeciesSightingsResult {
  items: SpeciesSightingItem[];
  isLoading: boolean;
  /** True only when the follow list has finished loading. Until
   *  then we render a skeleton rather than "no sightings". */
  followsReady: boolean;
  error: Error | null;
}

/**
 * Recent detections of a given species from the current user + their
 * follows. Honors NIP-09 deletions from the same author.
 *
 * @param entityUri Wikidata entity URI (e.g.
 *   `https://www.wikidata.org/entity/Q25481`). Null disables the
 *   query — use when the dialog is closed or the species has no
 *   Wikidata link.
 */
export function useSpeciesSightings(
  entityUri: string | null,
): UseSpeciesSightingsResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: follows, isLoading: followsLoading } = useFollowList();

  // Stable, sorted author list = self + follows. Sorting lets
  // TanStack Query reuse the cache when the underlying Set is
  // rebuilt with identical contents.
  const authors = useMemo(() => {
    if (!user) return [] as string[];
    const set = new Set<string>(follows ?? []);
    set.add(user.pubkey);
    return [...set].sort();
  }, [follows, user]);

  const authorsKey = authors.join(',');

  // Match the gating used by `useFollowsBirdFeed`: wait for the
  // follow list to settle so the first fetch sees the full author
  // set. `follows` is undefined while loading; `null` only when
  // logged out.
  const followsReady = Boolean(user) && !followsLoading;

  // Only validate the entity URI shape; the query gate also checks
  // non-null. A malformed URI would just yield an empty result from
  // the relay, but guarding here avoids a useless round-trip.
  const validEntity =
    entityUri && WIKIDATA_ENTITY_URI_RE.test(entityUri) ? entityUri : null;

  const query = useQuery<SpeciesSightingItem[], Error>({
    queryKey: [
      'species-sightings',
      validEntity ?? '',
      user?.pubkey ?? '',
      authorsKey,
    ],
    enabled: followsReady && authors.length > 0 && Boolean(validEntity),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (!validEntity) return [];

      // Two filters in one call:
      //   1. kind 2473 for this species authored by self+follows.
      //   2. kind 5 deletions by the same authors — not scoped by
      //      `#i` because deletions reference the deleted event via
      //      `e`, not by species. We intersect in JS below.
      const [detections, deletions] = await Promise.all([
        nostr.query(
          [
            {
              kinds: [2473],
              authors,
              '#i': [validEntity],
              limit: PAGE_SIZE,
            },
          ],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
        ),
        nostr.query(
          [
            {
              kinds: [5],
              authors,
              // Cap to a sensible number so a noisy deleter doesn't
              // blow up the response. Deletions are rare relative
              // to detections; PAGE_SIZE * 2 is plenty.
              limit: PAGE_SIZE * 2,
            },
          ],
          { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
        ),
      ]);

      // Build author -> Set<deleted event ids>. Only deletions whose
      // author matches the deleted event's author are honored, which
      // is guaranteed by the identical `authors` filter on both
      // sides AND by the per-author bucketing below.
      const deletionsByAuthor = new Map<string, Set<string>>();
      for (const e of deletions) {
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

      const items: SpeciesSightingItem[] = [];
      for (const e of detections) {
        if (deletionsByAuthor.get(e.pubkey)?.has(e.id)) continue;
        const item = eventToSighting(e);
        if (item) items.push(item);
      }

      // Newest first, stable tie-break so refetches don't reorder
      // rows that share a `created_at` second.
      items.sort((a, b) => {
        if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
        return a.id.localeCompare(b.id);
      });

      return items;
    },
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    followsReady,
    error: query.error ?? null,
  };
}
