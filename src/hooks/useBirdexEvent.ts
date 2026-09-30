// Loads the current user's Birdex (kind 12473) — their Nostr-persisted
// cumulative set of every confirmed bird species they've ever
// published.
//
// The Birdex is a replaceable event (see NIP.md §"Kind 12473 —
// Birdex") so at most one lives on the network per author. It exists
// as an index over the user's kind 2473 detections: each species
// appears as an `i` tag pointing at its Wikidata entity URI,
// immediately followed by a positional `n` tag carrying the
// scientific name. This hook walks that tag array in order, pairs
// each `i` with its adjacent `n`, and exposes both the ordered entry
// list (for re-emitting on append) and a Set keyed by URI (for
// O(1) membership checks during auto-publishing).
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
import { useNostrStorage } from '@/hooks/useNostrStorage';
import { useCacheFirstSeed } from '@/hooks/useCacheFirstSeed';

/** Canonical Wikidata entity URI shape per NIP.md. Shared with
 *  useBirdHistory — duplicated here to keep the hook self-contained. */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

export const BIRDEX_KIND = 12473;

export interface BirdexSpeciesEntry {
  /** Wikidata entity URI — the canonical species identifier. */
  entityUri: string;
  /** Scientific (binomial) name carried by the paired `n` tag.
   * Empty string when the source event omitted the `n` tag (older
   * Birdstar events, or events authored by other tools that predate
   * the name-pairing convention). */
  scientificName: string;
}

export interface BirdexEventResult {
  /** The raw kind 12473 event, or null if the user has not published
   * one yet (or is logged out). Preserved so callers can use its
   * `created_at` when deciding whether a republish is warranted. */
  event: NostrEvent | null;
  /** Species entries in chronological first-seen order, as stored in
   * the event's tag array. Each entry carries both the Wikidata URI
   * and the scientific name paired to it positionally. */
  entries: BirdexSpeciesEntry[];
  /** Fast-membership set for "is this species already on the Birdex?"
   * checks during auto-publishing. Keyed by Wikidata URI. */
  entityUriSet: Set<string>;
  isLoading: boolean;
}

/**
 * Walk the tags of a kind 12473 event in order, pairing each valid
 * `i` tag with the immediately-following `n` tag (if any) to produce
 * a `BirdexSpeciesEntry`.
 *
 * Pairing is positional: the `n` tag is accepted as this species'
 * scientific name only when it is the very next entry in the tag
 * array. An `i` tag not followed by an `n` yields an entry with an
 * empty `scientificName` — still useful for membership checks and
 * for re-emitting the URI on republish.
 *
 * Per NIP.md §"Kind 12473 — Birdex", the `k` tag that NIP-73 normally
 * pairs with `i` is deliberately omitted — the kind contract already
 * guarantees that every valid `i` is a Wikidata entity URI. The URL-
 * shape regex is the trust boundary.
 *
 * Deduplication keeps the first occurrence so the chronological order
 * is preserved even if a malformed event somehow contains duplicate
 * Wikidata URIs.
 */
export function parseBirdexEvent(event: NostrEvent): BirdexSpeciesEntry[] {
  const seen = new Set<string>();
  const entries: BirdexSpeciesEntry[] = [];
  const tags = event.tags;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (tag[0] !== 'i') continue;
    const uri = tag[1];
    if (typeof uri !== 'string') continue;
    if (!WIKIDATA_ENTITY_URI_RE.test(uri)) continue;
    if (seen.has(uri)) continue;
    seen.add(uri);

    const next = tags[i + 1];
    const scientificName =
      next && next[0] === 'n' && typeof next[1] === 'string' ? next[1] : '';

    entries.push({ entityUri: uri, scientificName });
  }
  return entries;
}

export function useBirdexEvent(): BirdexEventResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { store } = useNostrStorage();
  const pubkey = user?.pubkey;

  // Seed the query from the local event store so a returning user's Birdex
  // renders instantly, before the network round-trip resolves. The Birdex is a
  // replaceable event, so the cache holds at most one per author. The network
  // query below stays authoritative and overwrites this when it lands.
  useCacheFirstSeed<NostrEvent | null>({
    queryKey: pubkey ? ['birdex-event', pubkey] : undefined,
    filter: { kinds: [BIRDEX_KIND], authors: pubkey ? [pubkey] : [] },
    toData: (event) => event,
    getEvent: (data) => data ?? undefined,
  });

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

      // The locally cached Birdex. Used both as a relay-miss fallback and,
      // crucially, as a floor: a replaceable event is uniquely identified by
      // (kind, pubkey), so the one with the highest `created_at` is canonical.
      // Relays don't all agree — some lag behind, and a few don't enforce
      // replaceable semantics and will hand back a stale version. Reading a
      // newer event into cache and then letting an older one from a laggy
      // relay overwrite it is exactly how a recently-added species (and its
      // grid cell) blinks out after load. Reconcile newest-wins against the
      // cache so a stale relay can never downgrade the Birdex.
      const [cached] = await store.query([
        { kinds: [BIRDEX_KIND], authors: [pubkey] },
      ]);

      // Relay miss — fall back to the locally cached Birdex rather than
      // treating it as empty. A miss is almost always a transient relay
      // hiccup, not an intentional erasure, and wiping the Birdex would
      // make the dex look reset until the next successful fetch.
      if (events.length === 0) {
        return cached ?? null;
      }

      const latestFromRelay = events.reduce<NostrEvent>(
        (acc, e) => (e.created_at > acc.created_at ? e : acc),
        events[0],
      );

      // Newest of {relay result, local cache} wins. Without this floor, a
      // laggy/non-compliant relay returning an older replaceable version
      // would silently roll the Birdex back.
      const latest =
        cached && cached.created_at > latestFromRelay.created_at
          ? cached
          : latestFromRelay;

      // Persist the fresh event to the local store (fire-and-forget). Only
      // worth writing when it actually came from the network — re-persisting
      // the cached event is a no-op the store would dedupe anyway.
      if (latest === latestFromRelay) {
        void store.event(latest);
      }
      return latest;
    },
  });

  return useMemo<BirdexEventResult>(() => {
    const event = query.data ?? null;
    const entries = event ? parseBirdexEvent(event) : [];
    const entityUriSet = new Set(entries.map((e) => e.entityUri));
    return {
      event,
      entries,
      entityUriSet,
      // "Loading" means "no value to render yet from ANY source", not "the
      // network round-trip is still in flight". `useCacheFirstSeed` populates
      // `query.data` straight from IndexedDB, so a returning user clears this
      // the moment the cache read lands — without waiting on the relay (or its
      // 5s timeout) to confirm. The background network query keeps running and
      // refines `data` when it resolves; it never re-raises this flag.
      isLoading: Boolean(pubkey) && query.data === undefined,
    };
  }, [query.data, pubkey]);
}
