// Loads the current user's past bird detections (kind 2473) from Nostr so
// they persist across page refreshes. Returns a list of Detection-shaped
// objects ready to render in the UI, plus the Set of Wikidata entity URIs
// they cover — used elsewhere to dedupe auto-publishing.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
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
  const pubkey = user?.pubkey;

  const query = useQuery({
    // Keep history keyed on pubkey so switching accounts re-fetches.
    queryKey: ['bird-history', pubkey],
    enabled: Boolean(pubkey),
    staleTime: 1000 * 60, // 1 minute — history changes rarely mid-session
    queryFn: async ({ signal }) => {
      if (!pubkey) return [] as NostrEvent[];
      // Fetch the user's detections and any deletion requests they've
      // issued in a single query — combining kinds is cheaper for the
      // relay than two round-trips.
      const events = await nostr.query(
        [{ kinds: [2473, 5], authors: [pubkey], limit: MAX_HISTORY }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      return events;
    },
  });

  return useMemo<HistoryResult>(() => {
    const events = query.data ?? [];

    // NIP-09: collect the set of event ids this user has asked to delete
    // so we can hide the corresponding detections below. We only trust
    // deletion requests authored by the same pubkey as the events, which
    // is guaranteed here because the query filters by `authors: [pubkey]`.
    const deletedIds = new Set<string>();
    for (const event of events) {
      if (event.kind !== 5) continue;
      for (const [name, value] of event.tags) {
        if (name === 'e' && typeof value === 'string') {
          deletedIds.add(value);
        }
      }
    }

    // Newest event per species wins, so the displayed timestamp reflects
    // the most recent hearing. The same map is used to expose an
    // entity-URI -> most-recent-timestamp lookup for re-publish rate
    // limiting.
    const byUri = new Map<string, Detection & { entityUri: string }>();
    for (const event of events) {
      if (event.kind !== 2473) continue;
      if (deletedIds.has(event.id)) continue;
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
      isLoading: Boolean(pubkey) && query.isLoading,
    };
  }, [query.data, query.isLoading, pubkey]);
}
