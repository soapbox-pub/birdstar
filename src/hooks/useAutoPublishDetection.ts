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
//
// ## Offline durability
//
// A detection must never be lost just because the network was down when
// the bird was heard. When a publish fails (offline, relay timeout, etc.)
// the raw detection is persisted to an IndexedDB queue (see
// birdQueueStore). `flushQueue()` replays queued detections through the
// same publish path — oldest heard-time first — and only removes an item
// once its kind 2473 event is actually on a relay; a repeated failure
// leaves it queued for the next attempt. Because the detection carries
// its original heard timestamp, the eventual event's `created_at` reflects
// when the bird was heard, not when the queue drained. Callers wire
// `flushQueue` to the browser coming back online (see useOnlineStatus).
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
import {
  enqueueDetection,
  getQueuedDetections,
  markAttempt,
  removeQueuedDetection,
  type QueuedDetection,
} from '@/lib/birdQueueStore';

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
   * cooldown window (either in this session or historically). On a publish
   * failure the detection is queued to IndexedDB and retried via
   * `flushQueue`.
   */
  consider: (detection: Detection) => void;
  /**
   * Drain the offline publish queue, replaying each queued detection
   * (oldest heard-time first) through the normal publish path. Items are
   * removed only once their kind 2473 event lands on a relay; anything
   * that fails again stays queued. Safe to call repeatedly and
   * concurrently — overlapping calls are coalesced. No-op when logged out.
   */
  flushQueue: () => Promise<void>;
}

/**
 * Distinguishes a publish/network failure (re-queue and retry) from a
 * resolution failure where the species genuinely has no Wikidata QID
 * (skip; nothing to publish).
 */
class PublishFailedError extends Error {
  constructor(cause: unknown) {
    super('Failed to publish bird detection event');
    this.name = 'PublishFailedError';
    this.cause = cause;
  }
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
  // session WHILE ONLINE. Once a species falls through both Wikipedia
  // lookups AND both Wikidata SPARQL fallbacks with a working
  // connection, repeating the whole chain on every subsequent detection
  // is pure network waste. We deliberately do NOT add a species here
  // when the lookup failed because we were offline — that would lose a
  // species whose QID simply couldn't be checked yet (it gets queued
  // instead and resolved at flush time). Cleared on page reload so a
  // transient outage doesn't permanently hide a species.
  const unresolvableSpeciesKeys = useRef<Set<string>>(new Set());

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // `publish` from useNostrPublish is itself a stable mutateAsync, but
  // mirror it through a ref so the long-lived callbacks below don't list
  // it as a dependency and churn.
  const publishRef = useRef(publish);
  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);

  /**
   * Build the kind 2473 tag set for a resolved detection. When `geohash`
   * is provided it's attached verbatim as the optional NIP-52 `g` tag
   * (used by the queue, which snapshots the geohash at detection time);
   * otherwise, for a live detection, we derive it from the current
   * publish-location toggle + coarse coord.
   */
  const buildDetectionTags = useCallback(
    (
      detection: { scientificName: string; commonName: string },
      entityUri: string,
      geohash: string | undefined,
    ): string[][] => {
      // Base tag set required by NIP.md §"Kind 2473":
      //   alt (NIP-31 summary), i (Wikidata URI), n (scientific name).
      const tags: string[][] = [
        [
          'alt',
          `Bird detection: ${detection.commonName} (${detection.scientificName})`,
        ],
        ['i', entityUri],
        ['n', detection.scientificName],
      ];
      if (geohash) {
        tags.push(['g', geohash]);
      }
      return tags;
    },
    [],
  );

  /**
   * Derive the optional length-3 geohash for a *live* detection from the
   * current "Publish location" toggle and coarse coordinate. Returns
   * undefined when location publishing is off, no coordinate is known, or
   * encoding fails. Captured at detection time so a later queue flush
   * keeps the location where the bird was actually heard.
   */
  const deriveLiveGeohash = useCallback((): string | undefined => {
    if (!publishLocationRef.current || !coarseRef.current) return undefined;
    // Re-coarsen defensively at the privacy boundary. The value from
    // `useUserRegion().coarse` is already 1°-rounded, but running it
    // through `coarsen()` here makes the boundary explicit to anyone
    // grepping the codebase for "calls that transmit location".
    const rounded = coarsen(coarseRef.current.lat, coarseRef.current.lon);
    if (!rounded) return undefined;
    try {
      return encodeGeohash(rounded.lat, rounded.lon, DETECTION_GEOHASH_PRECISION);
    } catch (err) {
      // Defensive: encoder throws on out-of-range input, which would mean
      // our upstream coord is corrupt. Publish without a geohash rather
      // than dropping the detection.
      console.warn('Failed to encode detection geohash', err);
      return undefined;
    }
  }, []);

  /**
   * Publish a fully-resolved detection: the kind 2473 event, then (if this
   * is a lifer) the kind 12473 Birdex republish. Shared by both the live
   * path and the queue-flush path.
   *
   * Throws `PublishFailedError` if the kind 2473 publish fails so the
   * caller can re-queue. The Birdex publish is best-effort: if it fails we
   * roll back the local Birdex state and swallow, because the underlying
   * 2473 detection is already on the network and the Birdex can be
   * reconstructed from history (and will retry on the next lifer).
   */
  const publishResolvedDetection = useCallback(
    async (params: {
      scientificName: string;
      commonName: string;
      timestamp: number;
      entityUri: string;
      geohash: string | undefined;
    }): Promise<void> => {
      const { scientificName, commonName, timestamp, entityUri, geohash } =
        params;

      try {
        await publishRef.current({
          kind: 2473,
          content: '',
          tags: buildDetectionTags({ scientificName, commonName }, entityUri, geohash),
          created_at: Math.floor(timestamp / 1000),
        });
      } catch (err) {
        throw new PublishFailedError(err);
      }

      // Record the in-session publish so the cooldown window covers
      // detections heard right after this one (live path), and so a flush
      // doesn't immediately re-consider the same species.
      sessionPublishedAt.current.set(entityUri, timestamp);

      // First-time species? Extend the Birdex (kind 12473) with this URI +
      // scientific name appended to the end and republish. We check the
      // session-local set AFTER the 2473 publish succeeded so a failed
      // detection publish doesn't leak an entry into the Birdex. We also
      // update the ref immediately to suppress duplicate Birdex publishes
      // in case a second detection for the same species races in.
      const isLifer = !birdexSetRef.current.has(entityUri);
      if (isLifer) {
        const newEntry: BirdexSpeciesEntry = { entityUri, scientificName };
        birdexSetRef.current.add(entityUri);
        const nextEntries = [...birdexEntriesRef.current, newEntry];
        birdexEntriesRef.current = nextEntries;

        const birdexTags: string[][] = [
          ['alt', `Birdex: ${nextEntries.length} species`],
        ];
        for (const entry of nextEntries) {
          birdexTags.push(['i', entry.entityUri]);
          // Omit the `n` tag entirely when we have no paired scientific
          // name (older events in history). Per NIP.md clients accept
          // unpaired `i` tags — better than emitting an empty string that
          // readers have to special-case.
          if (entry.scientificName) {
            birdexTags.push(['n', entry.scientificName]);
          }
        }

        try {
          await publishRef.current({
            kind: BIRDEX_KIND,
            content: '',
            tags: birdexTags,
            created_at: Math.floor(timestamp / 1000),
          });
          if (userRef.current) {
            queryClient.invalidateQueries({
              queryKey: ['birdex-event', userRef.current.pubkey],
            });
          }
        } catch (err) {
          // Roll back the local Birdex state so the next first-time
          // detection retries the publish. The underlying kind 2473
          // detection is already on the network, so the user's Birdex can
          // be reconstructed from history even if the replaceable event
          // temporarily lags.
          birdexSetRef.current.delete(entityUri);
          birdexEntriesRef.current = birdexEntriesRef.current.filter(
            (e) => e.entityUri !== entityUri,
          );
          console.warn('Failed to publish Birdex', err);
        }
      }

      // Invalidate so the history query eventually picks up the new event
      // and merges it back into `lastPublishedAt`.
      if (userRef.current) {
        queryClient.invalidateQueries({
          queryKey: ['bird-history', userRef.current.pubkey],
        });
      }
    },
    [buildDetectionTags, queryClient],
  );

  const consider = useCallback(
    (detection: Detection) => {
      if (!userRef.current) return; // logged-out: nothing to do

      const speciesKey = `${detection.scientificName}|${detection.commonName}`;
      if (inFlightSpeciesKeys.current.has(speciesKey)) return;
      if (unresolvableSpeciesKeys.current.has(speciesKey)) return;
      inFlightSpeciesKeys.current.add(speciesKey);

      // Snapshot the geohash NOW (at the heard moment) so that if the
      // publish fails and the detection is queued, it keeps the location
      // where the bird was actually heard rather than wherever the user
      // happens to be when the queue later drains.
      const geohash = deriveLiveGeohash();

      (async () => {
        try {
          // Consult the pregenerated scientificName → entityUri map first.
          // It's a bundled, service-worker-precached static file, so it
          // resolves the common case WITHOUT a network round-trip — which
          // also means most detections can be fully built (and published,
          // or correctly queued) while offline. Misses fall through to the
          // live Wikipedia + SPARQL chain.
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
            // Couldn't resolve a QID. If we're offline that's almost
            // certainly because the live fallback couldn't reach the
            // network — queue the raw detection so we can resolve it at
            // flush time. If we're online, the species genuinely has no
            // resolvable QID; remember the miss so we don't re-run the
            // whole chain on every subsequent chirp.
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
              await enqueueDetection({
                scientificName: detection.scientificName,
                commonName: detection.commonName,
                timestamp: detection.timestamp,
                geohash,
              });
            } else {
              unresolvableSpeciesKeys.current.add(speciesKey);
            }
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
            await publishResolvedDetection({
              scientificName: detection.scientificName,
              commonName: detection.commonName,
              timestamp: detection.timestamp,
              entityUri,
              geohash,
            });
          } catch (err) {
            // Publish failed (offline, relay timeout, …). Roll back the
            // session timestamp and persist the detection so it's retried
            // when the connection returns — the heard timestamp is
            // preserved, so the eventual event is correctly dated.
            sessionPublishedAt.current.delete(entityUri);
            await enqueueDetection({
              scientificName: detection.scientificName,
              commonName: detection.commonName,
              timestamp: detection.timestamp,
              geohash,
            });
            console.warn('Queued bird detection for later publish', err);
          }
        } finally {
          inFlightSpeciesKeys.current.delete(speciesKey);
        }
      })();
    },
    [deriveLiveGeohash, publishResolvedDetection],
  );

  // Guards against overlapping flushes (e.g. an `online` event firing while
  // a mount-time flush is still draining).
  const flushingRef = useRef(false);

  const flushOne = useCallback(
    async (item: QueuedDetection): Promise<void> => {
      if (item.id === undefined) return;

      // Resolve the QID now — at flush time we're (probably) online, so the
      // live fallback can fill gaps the bundled map missed.
      let entityUri = await lookupPregeneratedEntityUri(item.scientificName);
      if (!entityUri) {
        entityUri = await fetchWikidataEntityUri(
          item.scientificName,
          item.commonName,
        );
      }
      if (!entityUri) {
        // Still unresolvable. If we're offline again, leave it queued and
        // bump the attempt counter; if online, the species genuinely has no
        // QID and never will — drop it so the queue doesn't grow forever.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          await markAttempt(item.id);
        } else {
          console.warn(
            'Dropping queued detection with no resolvable Wikidata QID',
            item.scientificName,
          );
          await removeQueuedDetection(item.id);
        }
        return;
      }

      // Cooldown check against everything we know about this species so a
      // queued detection heard within 10 min of an already-published one
      // (or another queued one for the same species) doesn't duplicate.
      const historicalAt = historyRef.current.get(entityUri) ?? 0;
      const sessionAt = sessionPublishedAt.current.get(entityUri) ?? 0;
      const lastAt = Math.max(historicalAt, sessionAt);
      if (lastAt > 0 && item.timestamp - lastAt < REPUBLISH_COOLDOWN_MS) {
        // Within the cooldown of a more-recent publish — treat as a dup and
        // drop it. (We flush oldest-first, so `lastAt` here is from an
        // earlier-or-equal sighting that already represents this encounter.)
        await removeQueuedDetection(item.id);
        return;
      }

      try {
        await publishResolvedDetection({
          scientificName: item.scientificName,
          commonName: item.commonName,
          timestamp: item.timestamp,
          entityUri,
          geohash: item.geohash,
        });
        // Published — remove from the queue for good.
        await removeQueuedDetection(item.id);
      } catch (err) {
        if (err instanceof PublishFailedError) {
          // Network still down / relay rejected. Leave it queued; bump the
          // attempt counter and stop this flush pass so we don't hammer a
          // dead connection with the rest of the queue.
          sessionPublishedAt.current.delete(entityUri);
          await markAttempt(item.id);
          throw err;
        }
        // Non-publish error (shouldn't happen) — re-throw to abort the pass.
        throw err;
      }
    },
    [publishResolvedDetection],
  );

  const flushQueue = useCallback(async (): Promise<void> => {
    if (!userRef.current) return; // can't sign while logged out
    if (flushingRef.current) return; // a flush is already in progress
    flushingRef.current = true;
    try {
      const items = await getQueuedDetections(); // oldest heard-time first
      for (const item of items) {
        try {
          await flushOne(item);
        } catch {
          // A publish failure means the connection is (still) down. Abort
          // the rest of this pass; the next `online` event or mount will
          // retry the remaining items.
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [flushOne]);

  return { consider, flushQueue };
}
