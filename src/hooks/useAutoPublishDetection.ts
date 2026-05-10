// Resolves the Wikidata entity URI for a bird detection and publishes a
// kind 2473 event — once per species, ever. History comes from
// useBirdHistory, and an in-memory set tracks species already published
// during this session so we don't spam relays on every chirp.
//
// On each *first-time* species confirmation this hook also republishes
// the author's Birdex (kind 12473) — a replaceable event holding the
// cumulative set of species the author has ever detected, in
// chronological order. See NIP.md §"Kind 12473 — Birdex" for the
// schema.
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { BIRDEX_KIND } from '@/hooks/useBirdexEvent';
import type { Detection } from '@/components/BirdCard';
import type { CoarseLatLon } from '@/hooks/useUserRegion';
import { coarsen } from '@/lib/geo/coarsen';
import { encodeGeohash } from '@/lib/geo/geohash';
import { fetchWikidataEntityUri } from '@/lib/birdnet/wikidata';
import { lookupPregeneratedEntityUri } from '@/lib/birdnet/wikidataMap';

/**
 * Length of the geohash attached to the optional `g` tag when the user
 * has enabled "Publish location" in Settings. Three characters maps to
 * roughly 156 km × 156 km cells — the coarsest precision still useful
 * for region-scale aggregation and the natural cap given that the
 * upstream lat/lon is stored 1°-rounded (~111 km). Any finer would
 * imply more accuracy than the source coordinate actually carries.
 */
const DETECTION_GEOHASH_PRECISION = 3;

/**
 * How long to wait before re-publishing a detection of the same species.
 * Re-hearing the same bird within this window is treated as a single
 * ongoing event and not re-announced to relays; after the window elapses
 * a fresh hearing gets its own event.
 */
const REPUBLISH_COOLDOWN_MS = 10 * 60 * 1000;

export interface BirdexSpeciesEntry {
  /** Wikidata entity URI — the canonical species identifier. */
  entityUri: string;
  /** Scientific (binomial) name paired with the URI on the wire via
   * positional `n`-tag adjacency. Empty string when the source event
   * omitted the `n` tag (older Birdstar events). */
  scientificName: string;
}

export interface UseAutoPublishDetectionOptions {
  /**
   * For each Wikidata entity URI this user has previously published, the
   * timestamp (ms) of the most recent publish. A species is eligible to
   * be re-published once more than REPUBLISH_COOLDOWN_MS has elapsed
   * since that timestamp.
   */
  lastPublishedAt: Map<string, number>;
  /**
   * The author's current Birdex (kind 12473) species entries, in
   * chronological order of first detection. Used to decide whether a
   * newly-confirmed species is a lifer (not yet on the Birdex →
   * triggers a republish) or a known species (no Birdex change), and
   * to re-emit the `i`/`n` pairs verbatim when appending.
   */
  birdexEntries: BirdexSpeciesEntry[];
  /**
   * When true, attach an optional NIP-52 `g` tag (length-3 geohash)
   * derived from `coarse` to each published kind 2473 event. Opt-in
   * only — driven by the "Publish location" toggle in the Birds-mode
   * Settings sheet. Off by default; flipping the toggle only affects
   * detections published after the change. The Birdex (kind 12473)
   * NEVER receives a `g` tag regardless of this setting — it's an
   * aggregate index, not an observation event.
   */
  publishLocation?: boolean;
  /**
   * The user's coarse (1°-rounded) lat/lon, if resolved. Read only
   * when `publishLocation` is true; ignored otherwise. When the
   * toggle is on but `coarse` is null (geolocation denied /
   * unavailable / still resolving), detections are published without
   * a `g` tag rather than blocking the publish — the user explicitly
   * asked to include location "when available", not to suppress the
   * detection when location is missing.
   */
  coarse?: CoarseLatLon | null;
}

export interface AutoPublishApi {
  /**
   * Submit a detection for possible auto-publishing. No-op if the user is
   * logged out, or the species has been published within the recent
   * cooldown window (either in this session or historically).
   */
  consider: (detection: Detection) => void;
}

export function useAutoPublishDetection({
  lastPublishedAt,
  birdexEntries,
  publishLocation = false,
  coarse = null,
}: UseAutoPublishDetectionOptions): AutoPublishApi {
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  // Keep the latest history timestamps in a ref so the `consider`
  // callback is stable — detections arrive frequently and we don't want
  // to re-create it on every render.
  const historyRef = useRef(lastPublishedAt);
  useEffect(() => {
    historyRef.current = lastPublishedAt;
  }, [lastPublishedAt]);

  // Mirror publish-location state + coarse coord behind refs for the
  // same stability reasons. Toggling "Publish location" or having the
  // user's geolocation resolve mid-session should take effect on the
  // NEXT detection without rebuilding `consider`.
  const publishLocationRef = useRef(publishLocation);
  useEffect(() => {
    publishLocationRef.current = publishLocation;
  }, [publishLocation]);
  const coarseRef = useRef<CoarseLatLon | null>(coarse);
  useEffect(() => {
    coarseRef.current = coarse;
  }, [coarse]);

  // Mirror the Birdex entries + membership set behind refs for the
  // same reason. `birdexEntriesRef` preserves chronological order AND
  // the paired scientific names so we can re-emit `i`/`n` pairs
  // verbatim when appending; `birdexSetRef` gives O(1) "already on
  // the Birdex?" checks keyed by Wikidata URI.
  const birdexEntriesRef = useRef<BirdexSpeciesEntry[]>(birdexEntries);
  const birdexSetRef = useRef<Set<string>>(
    new Set(birdexEntries.map((e) => e.entityUri)),
  );
  useEffect(() => {
    birdexEntriesRef.current = birdexEntries;
    birdexSetRef.current = new Set(birdexEntries.map((e) => e.entityUri));
  }, [birdexEntries]);

  // In-session publish timestamps keyed by Wikidata entity URI.
  // Complements `historyRef`, which only updates when the Nostr query
  // refetches; this ref is the source of truth for the immediate
  // cooldown window.
  const sessionPublishedAt = useRef<Map<string, number>>(new Map());
  // Species currently having their Wikidata URI looked up / being
  // published. Keyed by `scientific|common` so rapid-fire detections of
  // the same species don't race each other into the network.
  const inFlightSpeciesKeys = useRef<Set<string>>(new Set());
  // Species we've already confirmed have no resolvable Q-id this
  // session. Once a species falls through both Wikipedia lookups AND
  // both Wikidata SPARQL fallbacks, repeating the whole chain on every
  // subsequent detection is pure network waste. Cleared on page reload
  // so a transient outage doesn't permanently hide a species.
  const unresolvableSpeciesKeys = useRef<Set<string>>(new Set());

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const consider = useCallback(
    (detection: Detection) => {
      if (!userRef.current) return; // logged-out: nothing to do

      const speciesKey = `${detection.scientificName}|${detection.commonName}`;
      if (inFlightSpeciesKeys.current.has(speciesKey)) return;
      if (unresolvableSpeciesKeys.current.has(speciesKey)) return;
      inFlightSpeciesKeys.current.add(speciesKey);

      (async () => {
        try {
          // Consult the pregenerated scientificName → entityUri map first.
          // It covers every BirdNET-supported species we've successfully
          // resolved at build time, so the common case skips ALL of
          // Wikipedia + SPARQL on the hot path. Misses (a stale map, a
          // species genuinely unresolvable, or a transient build outage)
          // fall through to the live chain below — same behavior as
          // before this map existed.
          let entityUri = await lookupPregeneratedEntityUri(
            detection.scientificName,
          );
          if (!entityUri) {
            entityUri = await fetchWikidataEntityUri(
              detection.scientificName,
              detection.commonName,
            );
          }
          if (!entityUri) {
            // Remember the miss so we don't re-run the full Wikipedia +
            // SPARQL chain on every subsequent chirp of this species.
            unresolvableSpeciesKeys.current.add(speciesKey);
            return;
          }

          // Compare against the most recent publish we know about, whether
          // it came from the persisted history or from this session.
          const historicalAt = historyRef.current.get(entityUri) ?? 0;
          const sessionAt = sessionPublishedAt.current.get(entityUri) ?? 0;
          const lastAt = Math.max(historicalAt, sessionAt);
          if (lastAt > 0 && detection.timestamp - lastAt < REPUBLISH_COOLDOWN_MS) {
            return;
          }

          // Reserve the slot before awaiting publish so rapid duplicates
          // don't race past this check. We store the detection's own
          // timestamp so the cooldown is measured from the *heard* moment
          // rather than the relay round-trip.
          sessionPublishedAt.current.set(entityUri, detection.timestamp);

          try {
            // Base tag set required by NIP.md §"Kind 2473":
            //   alt (NIP-31 summary), i (Wikidata URI), n (scientific name).
            const detectionTags: string[][] = [
              [
                'alt',
                `Bird detection: ${detection.commonName} (${detection.scientificName})`,
              ],
              ['i', entityUri],
              ['n', detection.scientificName],
            ];

            // Optional NIP-52 `g` tag — only when the user opted in via
            // Settings → "Publish location" AND we actually have a
            // coarse coordinate to geohash. If the toggle is on but
            // the coord is missing (geolocation denied / still
            // resolving) we publish without it rather than stalling
            // the detection; the user asked to include location when
            // available, not to suppress publishing when it isn't.
            if (publishLocationRef.current && coarseRef.current) {
              // Re-coarsen defensively at the privacy boundary. The
              // value from `useUserRegion().coarse` is already 1°-
              // rounded, but running it through `coarsen()` here
              // makes the boundary explicit to anyone grepping the
              // codebase for "calls that transmit location" — this
              // file, `src/lib/inat/localSpecies.ts`, and
              // `useNearestObservation` are the three places.
              const rounded = coarsen(
                coarseRef.current.lat,
                coarseRef.current.lon,
              );
              if (rounded) {
                try {
                  const geohash = encodeGeohash(
                    rounded.lat,
                    rounded.lon,
                    DETECTION_GEOHASH_PRECISION,
                  );
                  detectionTags.push(['g', geohash]);
                } catch (err) {
                  // Defensive: encoder throws on out-of-range input,
                  // which would mean our upstream coord is corrupt.
                  // Swallow and publish without a geohash rather than
                  // dropping the detection entirely.
                  console.warn('Failed to encode detection geohash', err);
                }
              }
            }

            await publish({
              kind: 2473,
              content: '',
              tags: detectionTags,
              created_at: Math.floor(detection.timestamp / 1000),
            });

            // First-time species? Extend the Birdex (kind 12473) with
            // this URI + scientific name appended to the end and
            // republish. We check the session-local set AFTER the
            // 2473 publish succeeded so a failed detection publish
            // doesn't leak an entry into the Birdex. We also update
            // the ref immediately to suppress duplicate Birdex
            // publishes in case a second detection for the same
            // species races in before the Nostr query refetches.
            const isLifer = !birdexSetRef.current.has(entityUri);
            if (isLifer) {
              const newEntry: BirdexSpeciesEntry = {
                entityUri,
                scientificName: detection.scientificName,
              };
              birdexSetRef.current.add(entityUri);
              const nextEntries = [...birdexEntriesRef.current, newEntry];
              birdexEntriesRef.current = nextEntries;

              const birdexTags: string[][] = [
                ['alt', `Birdex: ${nextEntries.length} species`],
              ];
              for (const entry of nextEntries) {
                birdexTags.push(['i', entry.entityUri]);
                // Omit the `n` tag entirely when we have no paired
                // scientific name (older events in history). Per
                // NIP.md clients accept unpaired `i` tags — better
                // than emitting an empty string that readers have to
                // special-case.
                if (entry.scientificName) {
                  birdexTags.push(['n', entry.scientificName]);
                }
              }

              try {
                await publish({
                  kind: BIRDEX_KIND,
                  content: '',
                  tags: birdexTags,
                  created_at: Math.floor(detection.timestamp / 1000),
                });
                if (userRef.current) {
                  queryClient.invalidateQueries({
                    queryKey: ['birdex-event', userRef.current.pubkey],
                  });
                }
              } catch (err) {
                // Roll back the local Birdex state so the next first-
                // time detection retries the publish. The underlying
                // kind 2473 detection is already on the network, so
                // the user's Birdex can be reconstructed from history
                // even if the replaceable event temporarily lags.
                birdexSetRef.current.delete(entityUri);
                birdexEntriesRef.current = birdexEntriesRef.current.filter(
                  (e) => e.entityUri !== entityUri,
                );
                console.warn('Failed to publish Birdex', err);
              }
            }

            // Invalidate so the history query eventually picks up the new
            // event and merges it back into `lastPublishedAt`.
            if (userRef.current) {
              queryClient.invalidateQueries({
                queryKey: ['bird-history', userRef.current.pubkey],
              });
            }
          } catch (err) {
            // Publish failed — roll back the session timestamp so we'll
            // try again for the next detection of this species.
            sessionPublishedAt.current.delete(entityUri);
            console.warn('Failed to publish bird detection', err);
          }
        } finally {
          inFlightSpeciesKeys.current.delete(speciesKey);
        }
      })();
    },
    [publish, queryClient],
  );

  return { consider };
}
