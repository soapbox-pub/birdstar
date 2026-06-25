// Bird detections (kind 2473) authored by a single pubkey, deduped by
// species and ordered newest-first. Powers the Birds-mode profile
// dialog opened from an `npub` / `nprofile` route — the bird-world
// analogue of the Stars-mode `useConstellationsByAuthor`.
//
// Where `useFollowsBirdFeed` is a paginated self+follows timeline, this
// hook is a one-shot snapshot of a single author's "life list": every
// distinct species they've published a detection for. We dedupe on
// scientific name (keeping the most recent detection per species) so a
// prolific birder's profile shows a clean species grid rather than the
// same robin twenty times.
//
// Author filtering is intrinsic here — the query is constrained to one
// `authors` pubkey — so the dialog only ever renders that user's own
// detections, satisfying the trust model for user-owned events.
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

/** Canonical Wikidata entity URI shape per NIP.md §"Kind 2473". */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

/** Upper bound on detections we pull for one profile. A heavy birder
 *  may have thousands of detection events but only a few hundred
 *  distinct species; this cap keeps the round-trip bounded while still
 *  comfortably covering a complete life list once deduped. */
const QUERY_LIMIT = 500;

export interface AuthorDetection {
  /** Stable React key — the source event id. */
  id: string;
  /** Posix timestamp in ms of the most recent detection of this species. */
  timestamp: number;
  /** Scientific name from the authoritative `n` tag (NIP.md §"Kind 2473"). */
  scientificName: string;
  /** Common name parsed from the NIP-31 `alt` tag, falling back to the
   *  scientific name when the authoring client used a different style. */
  commonName: string;
  /** Wikidata entity URI from the `i` tag. Always a valid URI for items
   *  we emit — events without one are dropped. */
  entityUri: string;
}

/** Parse the NIP-31 `alt` tag, shape:
 *  "Bird detection: American Robin (Turdus migratorius)". */
function parseAltTag(
  alt: string | undefined,
): { commonName: string; scientificName: string } | null {
  if (!alt) return null;
  const m = alt.match(/^Bird detection:\s*(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return null;
  return { commonName: m[1], scientificName: m[2] };
}

/** Convert a validated kind 2473 event into a detection, or null when
 *  required fields are missing / malformed. Mirrors the validation in
 *  `useFollowsBirdFeed.eventToFeedItem`. */
function eventToDetection(event: NostrEvent): AuthorDetection | null {
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
    timestamp: event.created_at * 1000,
    scientificName,
    commonName,
    entityUri,
  };
}

/**
 * Fetch the distinct bird species a single author has published
 * detections for, newest-first. `pubkey` may be undefined / null to
 * leave the query idle (e.g. while the route is not a profile route).
 */
export function useAuthorBirdDetections(pubkey: string | undefined | null) {
  const { nostr } = useNostr();

  return useQuery<AuthorDetection[]>({
    queryKey: ['author-bird-detections', pubkey ?? ''],
    enabled: !!pubkey,
    staleTime: 60 * 1000,
    queryFn: async ({ signal }) => {
      const raw = await nostr.query(
        [{ kinds: [2473], authors: [pubkey!], limit: QUERY_LIMIT }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) },
      );

      // Dedupe by scientific name, keeping the most recent detection per
      // species so the grid is a clean life list rather than a log.
      const bySpecies = new Map<string, AuthorDetection>();
      for (const event of raw) {
        const det = eventToDetection(event);
        if (!det) continue;
        const key = det.scientificName.toLowerCase();
        const prior = bySpecies.get(key);
        if (!prior || det.timestamp > prior.timestamp) {
          bySpecies.set(key, det);
        }
      }

      return [...bySpecies.values()].sort((a, b) => b.timestamp - a.timestamp);
    },
  });
}
