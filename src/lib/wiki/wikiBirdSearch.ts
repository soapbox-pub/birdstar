// Wikipedia/Wikidata-backed bird search.
//
// BirdNET's label set (~6,500 species) is the primary, instant search
// corpus, but it's far from a complete list of the world's ~11,000 bird
// species — and it carries none of the rarities, recent splits, or
// regional specialties a curious birder might look up. This module
// supplements the local BirdNET search with a live Wikipedia search,
// keeping only results that Wikidata confirms are *bird taxa* so we
// never surface a city, person, or album that happens to share a name.
//
// The flow is two network hops, both batched:
//
//   1. Wikipedia search (`generator=search` + `prop=pageprops`) returns
//      candidate articles for the query along with each article's linked
//      Wikidata Q-id (`wikibase_item`) in a single request.
//   2. A single Wikidata SPARQL query takes all those Q-ids and, for the
//      ones that are birds (instance-of taxon AND in class Aves), returns
//      the canonical scientific name (`P225`) plus the English common
//      name label. Non-birds simply don't come back, which is how we
//      filter them out.
//
// Results are cached per normalized query in IndexedDB (see
// wikiBirdSearchStore.ts) so repeated searches — the same word typed,
// cleared, and retyped, or revisited across sessions — cost zero network
// once warm.
//
// Everything here is pure async data-fetching with no React; the
// `useWikiBirdSearch` hook wraps it with TanStack Query + the cache.

/** A bird species discovered via Wikipedia and confirmed via Wikidata. */
export interface WikiBird {
  /** Canonical scientific (binomial) name from Wikidata `P225`. Used as
   *  the app's primary species key, slug source, and image lookup. */
  scientificName: string;
  /** English common name (Wikidata label / Wikipedia title fallback). */
  commonName: string;
  /** Canonical Wikidata entity URI, e.g.
   *  `https://www.wikidata.org/entity/Q12345`. */
  entityUri: string;
}

// English Wikipedia API origin. We hit the action API (not the REST
// summary endpoint) so we can both search AND pull each hit's Wikidata
// Q-id in one request via `prop=pageprops`.
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

// How many Wikipedia candidates to consider per query. The Wikidata
// verification step discards non-birds, so we over-fetch a little to
// still surface a useful number of confirmed birds.
const WIKIPEDIA_SEARCH_LIMIT = 20;

interface WikipediaCandidate {
  title: string;
  qid: string;
  /** Wikipedia's relevance rank for this hit (lower = more relevant).
   *  Preserved so confirmed birds keep search-engine ordering, which
   *  the page-id-keyed response object otherwise scrambles. */
  order: number;
}

/**
 * Run the full Wikipedia → Wikidata bird search for a (already trimmed,
 * non-empty) query. Returns confirmed bird taxa only. Network or parse
 * failures degrade to an empty array rather than throwing, so a flaky
 * Wikipedia never breaks the local BirdNET search shown alongside it.
 */
export async function searchWikiBirds(
  query: string,
  signal?: AbortSignal,
): Promise<WikiBird[]> {
  const candidates = await searchWikipediaCandidates(query, signal);
  if (candidates.length === 0) return [];
  return verifyBirdTaxa(candidates, signal);
}

/**
 * Phase 1 — Wikipedia full-text search. Returns up to
 * WIKIPEDIA_SEARCH_LIMIT articles that have a linked Wikidata item,
 * each as `{ title, qid }`. Articles without a `wikibase_item` are
 * dropped because we can't verify them as birds.
 */
async function searchWikipediaCandidates(
  query: string,
  signal?: AbortSignal,
): Promise<WikipediaCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*', // enable CORS for the public API
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '0', // article namespace only
    gsrlimit: String(WIKIPEDIA_SEARCH_LIMIT),
    prop: 'pageprops',
    ppprop: 'wikibase_item',
  });

  let res: Response;
  try {
    res = await fetch(`${WIKIPEDIA_API}?${params}`, {
      headers: { accept: 'application/json' },
      signal,
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const pages = (data as { query?: { pages?: Record<string, unknown> } })
    ?.query?.pages;
  if (!pages || typeof pages !== 'object') return [];

  const candidates: WikipediaCandidate[] = [];
  const seenQids = new Set<string>();
  for (const page of Object.values(pages)) {
    const p = page as {
      title?: unknown;
      index?: unknown;
      pageprops?: { wikibase_item?: unknown };
    };
    const title = typeof p.title === 'string' ? p.title : null;
    const qid = p.pageprops?.wikibase_item;
    if (!title || typeof qid !== 'string' || !/^Q\d+$/.test(qid)) continue;
    if (seenQids.has(qid)) continue;
    seenQids.add(qid);
    // `index` preserves Wikipedia's relevance ordering, which the pages
    // map (keyed by page id) otherwise loses.
    const order = typeof p.index === 'number' ? p.index : candidates.length;
    candidates.push({ title, qid, order });
  }

  candidates.sort((a, b) => a.order - b.order);
  return candidates;
}

/**
 * Phase 2 — Wikidata verification. Given Wikipedia candidates, returns
 * only those whose Wikidata item is a bird taxon, enriched with the
 * canonical scientific name (P225) and English common name.
 *
 * A single SPARQL query filters the candidate Q-ids to:
 *   - instance of (P31) taxon (Q16521), AND
 *   - in the bird class — we test `wdt:P171* wd:Q5113` (parent-taxon
 *     transitive closure reaches the class Aves, Q5113). This is the
 *     authoritative "is a bird" test and excludes mammals, plants,
 *     places, people, etc.
 *
 * Bird candidates that lack a P225 scientific name are dropped (we need
 * a binomial name as the species key); this is rare for real taxa.
 */
async function verifyBirdTaxa(
  candidates: WikipediaCandidate[],
  signal?: AbortSignal,
): Promise<WikiBird[]> {
  const values = candidates.map((c) => `wd:${c.qid}`).join(' ');
  // `?item` constrained to the candidate set; require taxon + Aves
  // ancestry + a taxon name. We also grab the English label for a
  // common-name fallback when P225 is the only name on the item.
  const query = `SELECT ?item ?sci ?label WHERE {
    VALUES ?item { ${values} }
    ?item wdt:P31 wd:Q16521 .
    ?item wdt:P171* wd:Q5113 .
    ?item wdt:P225 ?sci .
    OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
  }`;

  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/sparql-results+json' },
      signal,
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }

  const bindings = (
    data as {
      results?: { bindings?: Array<Record<string, { value?: unknown }>> };
    }
  )?.results?.bindings;
  if (!Array.isArray(bindings)) return [];

  // Map qid → its position in the original (relevance-ordered) candidate
  // list so confirmed birds keep Wikipedia's ranking. Also map qid →
  // article title for a final common-name fallback.
  const orderByQid = new Map<string, number>();
  const titleByQid = new Map<string, string>();
  candidates.forEach((c, i) => {
    orderByQid.set(c.qid, i);
    titleByQid.set(c.qid, c.title);
  });

  const birds: Array<WikiBird & { order: number }> = [];
  const seen = new Set<string>();
  for (const row of bindings) {
    const itemUri = row.item?.value;
    const sci = row.sci?.value;
    if (typeof itemUri !== 'string' || typeof sci !== 'string') continue;
    const match = itemUri.match(/\/entity\/(Q\d+)$/);
    const qid = match?.[1];
    if (!qid || seen.has(qid)) continue;
    seen.add(qid);

    const scientificName = sci.trim();
    if (!scientificName) continue;

    // Prefer the English Wikidata label as the common name, but it's
    // often the scientific name for taxa; fall back to the Wikipedia
    // article title in that case (which is usually the common name).
    const labelValue =
      typeof row.label?.value === 'string' ? row.label.value.trim() : '';
    const title = titleByQid.get(qid) ?? scientificName;
    const commonName =
      labelValue && labelValue.toLowerCase() !== scientificName.toLowerCase()
        ? labelValue
        : title;

    birds.push({
      scientificName,
      commonName,
      entityUri: `https://www.wikidata.org/entity/${qid}`,
      order: orderByQid.get(qid) ?? birds.length,
    });
  }

  birds.sort((a, b) => a.order - b.order);
  return birds.map(({ order: _order, ...bird }) => bird);
}
