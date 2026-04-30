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

/**
 * Resolve the Wikidata entity URI for a species. Returns the normalized
 * entity URI `https://www.wikidata.org/entity/Q<id>`, or null if no
 * suitable match can be found.
 *
 * Resolution order (each step is skipped if it returns nothing):
 *
 *   1. English Wikipedia REST summary by scientific name — the article's
 *      `wikibase_item` is the Q-id. Fast, Wikipedia-cached, and handles
 *      redirects (e.g. taxonomic renamings) server-side.
 *   2. Same lookup by common name. Covers species whose Wikipedia article
 *      is indexed under the English common name.
 *   3. Wikidata SPARQL by `P225` (taxon name) on the scientific name.
 *      Covers species that have a Wikidata taxon entity but no English
 *      Wikipedia article yet — very common for recent IOC splits and for
 *      less-charismatic taxa.
 *   4. Wikidata SPARQL for a taxon whose English label or alias exactly
 *      matches the common name. Last-chance fallback for the rare case
 *      where BirdNET's scientific name is stale but the common name
 *      still resolves.
 *
 * We try Wikipedia first because it's lower-latency and less rate-limited
 * than query.wikidata.org, and catches the vast majority of species in
 * one hop. The SPARQL fallback only fires when Wikipedia has no article.
 */
async function fetchWikidataEntityUri(
  scientificName: string,
  commonName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (scientificName) {
    const viaWikipedia = await lookupViaWikipedia(scientificName, signal);
    if (viaWikipedia) return viaWikipedia;
  }
  if (commonName) {
    const viaWikipedia = await lookupViaWikipedia(commonName, signal);
    if (viaWikipedia) return viaWikipedia;
  }
  if (scientificName) {
    const viaSparql = await lookupTaxonByScientificName(scientificName, signal);
    if (viaSparql) return viaSparql;
  }
  if (commonName) {
    const viaSparql = await lookupTaxonByCommonName(commonName, signal);
    if (viaSparql) return viaSparql;
  }
  return null;
}

/**
 * Look up a Wikipedia article by title and extract its linked Wikidata
 * Q-id from the REST summary response. Returns null for missing pages,
 * disambiguation pages, or articles with no `wikibase_item`.
 */
async function lookupViaWikipedia(
  title: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/\s+/g, '_'),
  )}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  // Disambiguation pages don't identify a single taxon, so we can't
  // honestly stamp a Q-id on the detection — skip.
  if (data.type === 'disambiguation') return null;
  const qid: unknown = data.wikibase_item;
  if (typeof qid !== 'string') return null;
  return buildWikidataEntityUri(qid);
}

/**
 * SPARQL-based fallback: find a Wikidata item whose taxon name
 * statement (`P225`) matches the given scientific name exactly.
 *
 * `P225` is the structured, authoritative scientific name — far more
 * reliable than label matching because it's populated from IOC / GBIF /
 * ITIS imports rather than free-form user input.
 */
async function lookupTaxonByScientificName(
  scientificName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const query = `SELECT ?item WHERE { ?item wdt:P225 ${sparqlString(scientificName)} . } LIMIT 1`;
  return runWikidataTaxonQuery(query, signal);
}

/**
 * SPARQL-based fallback: find a Wikidata taxon (`P31 wd:Q16521`) whose
 * English label or alias exactly matches the given common name.
 *
 * The `P31 wd:Q16521` filter is crucial — Wikidata has plenty of
 * non-taxon entities sharing common-name labels (paintings, sculptures,
 * books) and stamping one of those as a bird detection would be a bug.
 */
async function lookupTaxonByCommonName(
  commonName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const literal = `${sparqlString(commonName)}@en`;
  // UNION over rdfs:label and skos:altLabel because Wikidata's English
  // label for a taxon is usually the scientific name, with common names
  // stored as aliases.
  const query = `SELECT DISTINCT ?item WHERE {
    ?item wdt:P31 wd:Q16521 .
    { ?item rdfs:label ${literal} } UNION { ?item skos:altLabel ${literal} }
  } LIMIT 2`;
  return runWikidataTaxonQuery(query, signal, { rejectIfAmbiguous: true });
}

/**
 * Execute a SPARQL query against the Wikidata Query Service and return
 * the first `?item` binding as a normalized entity URI, or null. When
 * `rejectIfAmbiguous` is set, queries returning more than one row are
 * discarded — for label-based common-name lookups where a unique hit is
 * the only safe outcome.
 */
async function runWikidataTaxonQuery(
  query: string,
  signal: AbortSignal | undefined,
  { rejectIfAmbiguous = false }: { rejectIfAmbiguous?: boolean } = {},
): Promise<string | null> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/sparql-results+json' },
      signal,
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  const bindings: unknown = data?.results?.bindings;
  if (!Array.isArray(bindings) || bindings.length === 0) return null;
  if (rejectIfAmbiguous && bindings.length > 1) return null;
  const first = bindings[0] as { item?: { value?: unknown } } | undefined;
  const entityUri = first?.item?.value;
  if (typeof entityUri !== 'string') return null;
  // Extract the Q-id from either the http or https URI form Wikidata
  // returns and rebuild the canonical https URI required by NIP.md.
  const match = entityUri.match(/\/entity\/(Q\d+)$/);
  return match ? buildWikidataEntityUri(match[1]) : null;
}

/** Escape a string as a SPARQL string literal, quoting and escaping `\` and `"`. */
function sparqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Build the canonical Wikidata entity URI for a Q-id and validate it
 * against NIP.md's required shape. Returns null if the input isn't a
 * well-formed Q-id.
 */
function buildWikidataEntityUri(qid: string): string | null {
  if (!/^Q\d+$/.test(qid)) return null;
  return `https://www.wikidata.org/entity/${qid}`;
}

/**
 * How long to wait before re-publishing a detection of the same species.
 * Re-hearing the same bird within this window is treated as a single
 * ongoing event and not re-announced to relays; after the window elapses
 * a fresh hearing gets its own event.
 */
const REPUBLISH_COOLDOWN_MS = 10 * 60 * 1000;

export interface UseAutoPublishDetectionOptions {
  /**
   * For each Wikidata entity URI this user has previously published, the
   * timestamp (ms) of the most recent publish. A species is eligible to
   * be re-published once more than REPUBLISH_COOLDOWN_MS has elapsed
   * since that timestamp.
   */
  lastPublishedAt: Map<string, number>;
  /**
   * The author's current Birdex (kind 12473) species URIs, in
   * chronological order of first detection. Used to decide whether a
   * newly-confirmed species is a lifer (not yet on the Birdex →
   * triggers a republish) or a known species (no Birdex change).
   */
  birdexEntityUris: string[];
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
  birdexEntityUris,
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

  // Mirror the Birdex species URIs + membership set behind refs for the
  // same reason. `birdexUrisRef` preserves chronological order so we
  // can rebuild the replaceable event with new entries appended to the
  // end; `birdexSetRef` gives O(1) "already on the Birdex?" checks.
  const birdexUrisRef = useRef<string[]>(birdexEntityUris);
  const birdexSetRef = useRef<Set<string>>(new Set(birdexEntityUris));
  useEffect(() => {
    birdexUrisRef.current = birdexEntityUris;
    birdexSetRef.current = new Set(birdexEntityUris);
  }, [birdexEntityUris]);

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
          const entityUri = await fetchWikidataEntityUri(
            detection.scientificName,
            detection.commonName,
          );
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
            await publish({
              kind: 2473,
              content: '',
              tags: [
                [
                  'alt',
                  `Bird detection: ${detection.commonName} (${detection.scientificName})`,
                ],
                ['i', entityUri],
              ],
              created_at: Math.floor(detection.timestamp / 1000),
            });

            // First-time species? Extend the Birdex (kind 12473) with
            // this URI appended to the end and republish. We check the
            // session-local set AFTER the 2473 publish succeeded so a
            // failed detection publish doesn't leak an entry into the
            // Birdex. We also update the ref immediately to suppress
            // duplicate Birdex publishes in case a second detection
            // for the same species races in before the Nostr query
            // refetches.
            const isLifer = !birdexSetRef.current.has(entityUri);
            if (isLifer) {
              birdexSetRef.current.add(entityUri);
              const nextUris = [...birdexUrisRef.current, entityUri];
              birdexUrisRef.current = nextUris;

              const birdexTags: string[][] = [
                ['alt', `Birdex: ${nextUris.length} species`],
              ];
              for (const uri of nextUris) {
                birdexTags.push(['i', uri]);
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
                birdexUrisRef.current = birdexUrisRef.current.filter(
                  (u) => u !== entityUri,
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
