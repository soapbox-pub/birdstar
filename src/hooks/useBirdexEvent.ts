// Loads the current user's Birdex (kind 12473) — their Nostr-persisted
// life list of every confirmed bird species they've ever published.
//
// The Birdex is a replaceable event (see NIP.md §"Kind 12473 — Birdex
// (Bird Life List)") so at most one lives on the network per author. It
// exists as an index over the user's kind 2473 detections: each species
// appears as an `i` / `k` pair pointing at its Wikidata entity URI, in
// chronological order of first detection. This hook parses that tag
// array into an ordered list of URIs plus a Set for fast membership
// checks during auto-publishing.
//
// Separate from useBirdHistory (which paginates kind 2473 detections
// for rendering) because the Birdex is one small replaceable event and
// a single round-trip is enough — we don't want to couple its loading
// latency to the detection-history fetch.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/** Canonical Wikidata entity URI shape per NIP.md. Shared with
 *  useBirdHistory — duplicated here to keep the hook self-contained. */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

export const BIRDEX_KIND = 12473;

export interface BirdexEventResult {
  /** The raw kind 12473 event, or null if the user has not published
   * one yet (or is logged out). Preserved so callers can use its
   * `created_at` when deciding whether a republish is warranted and so
   * the publisher can read back the existing species list in tag
   * order. */
  event: NostrEvent | null;
  /** Species URIs in their original (chronological first-seen) order,
   * as stored in the event's tag array. Oldest first. */
  entityUris: string[];
  /** Fast-membership set for "is this species already on the life
   * list?" checks during auto-publishing. */
  entityUriSet: Set<string>;
  isLoading: boolean;
}

/**
 * Walk the tags of a kind 12473 event in order, pairing each `i` tag
 * that matches the Wikidata URI shape with the NEXT tag in the array
 * when that next tag is `["k", "web"]`. This matches the publishing
 * convention (emit `i` immediately followed by its `k`) and rejects
 * half-specified entries whose `k` is missing or wrong.
 *
 * Deduplication keeps the first occurrence so the chronological order
 * is preserved even if a malformed event somehow contains duplicate
 * Wikidata URIs.
 */
function parseBirdexEvent(event: NostrEvent): string[] {
  const seen = new Set<string>();
  const uris: string[] = [];
  const tags = event.tags;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (tag[0] !== 'i') continue;
    const value = tag[1];
    if (typeof value !== 'string') continue;
    if (!WIKIDATA_ENTITY_URI_RE.test(value)) continue;
    const next = tags[i + 1];
    if (!next || next[0] !== 'k' || next[1] !== 'web') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    uris.push(value);
  }
  return uris;
}

export function useBirdexEvent(): BirdexEventResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  const query = useQuery({
    queryKey: ['birdex-event', pubkey],
    enabled: Boolean(pubkey),
    // The Birdex changes only when the user hears a new species, so
    // staleness is measured in minutes rather than seconds. Still
    // re-fetches on window focus (TanStack default) so a cross-device
    // update lands quickly.
    staleTime: 1000 * 60,
    queryFn: async ({ signal }) => {
      if (!pubkey) return null;
      const events = await nostr.query(
        [{ kinds: [BIRDEX_KIND], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      // Relays may return 0 events (new user) or 1 (the current
      // replaceable). If multiple slipped through we trust the newest
      // by created_at — relays are supposed to dedupe but clients
      // should be defensive.
      if (events.length === 0) return null;
      return events.reduce<NostrEvent>(
        (acc, e) => (e.created_at > acc.created_at ? e : acc),
        events[0],
      );
    },
  });

  return useMemo<BirdexEventResult>(() => {
    const event = query.data ?? null;
    const entityUris = event ? parseBirdexEvent(event) : [];
    const entityUriSet = new Set(entityUris);
    return {
      event,
      entityUris,
      entityUriSet,
      isLoading: Boolean(pubkey) && query.isLoading,
    };
  }, [query.data, query.isLoading, pubkey]);
}
