// Resolves the Wikidata entity URI for a bird species.
//
// Returns the normalized entity URI `https://www.wikidata.org/entity/Q<id>`,
// or null if no suitable match can be found. The same chain is used at
// runtime (by useAutoPublishDetection, with live network calls) and at
// build time (by scripts/generate-wikidata-map.ts, to pregenerate the
// scientificName → entityUri lookup table shipped in
// public/birdnet/wikidata.json).
//
// Resolution order (each step is skipped if it returns nothing):
//
//   1. English Wikipedia REST summary by scientific name — the article's
//      `wikibase_item` is the Q-id. Fast, Wikipedia-cached, and handles
//      redirects (e.g. taxonomic renamings) server-side.
//   2. Same lookup by common name. Covers species whose Wikipedia article
//      is indexed under the English common name.
//   3. Wikidata SPARQL by `P225` (taxon name) on the scientific name.
//      Covers species that have a Wikidata taxon entity but no English
//      Wikipedia article yet — very common for recent IOC splits and for
//      less-charismatic taxa.
//   4. Wikidata SPARQL for a taxon whose English label or alias exactly
//      matches the common name. Last-chance fallback for the rare case
//      where BirdNET's scientific name is stale but the common name
//      still resolves.
//
// We try Wikipedia first because it's lower-latency and less rate-limited
// than query.wikidata.org, and catches the vast majority of species in
// one hop. The SPARQL fallback only fires when Wikipedia has no article.

export async function fetchWikidataEntityUri(
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
