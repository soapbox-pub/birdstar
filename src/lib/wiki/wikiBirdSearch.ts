// Wikipedia-backed bird search.
//
// BirdNET's label set (~6,500 species) is the primary, instant search
// corpus, but it's far from a complete list of the world's ~11,000 bird
// species — it carries none of the rarities, recent splits, or regional
// specialties a curious birder might look up (the Secretarybird, say).
// This module supplements the local BirdNET search with a live Wikipedia
// search, keeping only pages Wikipedia's own taxonomy categorizes as
// birds so we never surface a city, person, racehorse, or album that
// happens to share a name.
//
// Design notes — why NOT Wikidata SPARQL:
//
//   The obvious "is this a bird" test is a Wikidata taxonomy walk
//   (`?item wdt:P171* wd:Q5113` — ancestry reaches class Aves). It is
//   authoritative but *pathologically slow*: the unbounded transitive
//   property path routinely takes 10–70s on query.wikidata.org and often
//   times out. That was the root cause of search "taking forever".
//
//   Instead we use a fast, CDN-cached signal that's already on every
//   article: its Wikipedia categories. Real bird articles are reliably
//   filed under categories containing the word "bird" — "Birds described
//   in 1779", "Birds of prey", "Endemic birds of New Zealand",
//   "Flightless birds", "Seabirds", etc. Checking for that token is a
//   single sub-second request and needs no graph traversal.
//
// Matching strategy — why TWO searches:
//
//   Wikipedia full-text search (`generator=search`) ranks by article
//   prominence, so a partial query like "secretar" buries the
//   Secretarybird under politicians and racehorses, and a whole-word
//   match is effectively required. Title prefix search
//   (`generator=prefixsearch`) fixes incremental matching — "secretar"
//   surfaces "Secretarybird" directly — but misses birds whose common
//   name doesn't start with the query. We run BOTH in parallel and merge,
//   so partial-word and full-text relevance both work.
//
// Results are cached per normalized query in IndexedDB (see
// wikiBirdSearchStore.ts) so repeated searches cost zero network once
// warm.
//
// Everything here is pure async data-fetching with no React; the
// `useWikiBirdSearch` hook wraps it with TanStack Query + the cache.

/** A bird species discovered via Wikipedia. */
export interface WikiBird {
  /** Scientific (binomial) name when we can extract it from the page's
   *  short description / title; otherwise falls back to the article
   *  title. Used as the app's species key, slug source, and the primary
   *  key for the Wikipedia image/sound lookups in SpeciesCell. */
  scientificName: string;
  /** English common name — the (redirect-resolved) Wikipedia article
   *  title. */
  commonName: string;
  /** Canonical Wikidata entity URI, e.g.
   *  `https://www.wikidata.org/entity/Q12345`, when the article has a
   *  linked Wikidata item; null otherwise. */
  entityUri: string | null;
}

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

// How many candidates to pull from EACH search generator. Kept modest so
// the response stays small (categories balloon the payload) and parsing
// is cheap; the bird-category filter then narrows to the real hits.
const SEARCH_LIMIT = 20;

interface WikipediaPage {
  pageid: number;
  title: string;
  index: number;
  qid: string | null;
  categories: string[];
}

/**
 * Run the Wikipedia bird search for a (trimmed, non-empty) query.
 * Returns confirmed-by-category bird articles only, de-duplicated and
 * ranked. Network or parse failures degrade to an empty array rather
 * than throwing, so a flaky Wikipedia never breaks the local BirdNET
 * search shown alongside it.
 */
export async function searchWikiBirds(
  query: string,
  signal?: AbortSignal,
): Promise<WikiBird[]> {
  // Prefix search (incremental / partial-word) and full-text search
  // (relevance) in parallel; merge so both behaviours work.
  const [prefixPages, fullTextPages] = await Promise.all([
    fetchSearchPages('prefixsearch', query, signal),
    fetchSearchPages('search', query, signal),
  ]);

  // Merge keeping the best (lowest) rank per page. Prefix hits are
  // weighted slightly ahead of full-text hits at the same index because
  // a title-prefix match is the stronger "you typed the start of this
  // bird's name" signal.
  const byId = new Map<number, { page: WikipediaPage; rank: number }>();
  const consider = (page: WikipediaPage, rank: number) => {
    const existing = byId.get(page.pageid);
    if (!existing || rank < existing.rank) byId.set(page.pageid, { page, rank });
  };
  for (const p of prefixPages) consider(p, p.index);
  for (const p of fullTextPages) consider(p, p.index + 0.5);

  const ranked = [...byId.values()].sort((a, b) => a.rank - b.rank);

  const birds: WikiBird[] = [];
  const seenNames = new Set<string>();
  for (const { page } of ranked) {
    if (!isBirdByCategory(page.categories)) continue;
    const commonName = page.title;
    const scientificName = extractScientificName(page) ?? commonName;
    const key = scientificName.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    birds.push({
      scientificName,
      commonName,
      entityUri: page.qid
        ? `https://www.wikidata.org/entity/${page.qid}`
        : null,
    });
  }
  return birds;
}

/**
 * One Wikipedia action-API request driven by the given search generator
 * (`prefixsearch` for title-prefix matching, `search` for full text).
 * Pulls each hit's Wikidata Q-id (`pageprops`) and categories in the same
 * request, and resolves redirects so a search hit like "Kakapo" lands on
 * the real "Kākāpō" article (whose categories carry the bird signal).
 */
async function fetchSearchPages(
  generator: 'prefixsearch' | 'search',
  query: string,
  signal?: AbortSignal,
): Promise<WikipediaPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*', // enable CORS for the public API
    redirects: '1',
    generator,
    prop: 'pageprops|categories',
    ppprop: 'wikibase_item',
    cllimit: '500',
  });
  if (generator === 'prefixsearch') {
    params.set('gpssearch', query);
    params.set('gpslimit', String(SEARCH_LIMIT));
  } else {
    params.set('gsrsearch', query);
    params.set('gsrnamespace', '0'); // article namespace only
    params.set('gsrlimit', String(SEARCH_LIMIT));
  }

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

  const out: WikipediaPage[] = [];
  for (const raw of Object.values(pages)) {
    const p = raw as {
      pageid?: unknown;
      title?: unknown;
      index?: unknown;
      pageprops?: { wikibase_item?: unknown };
      categories?: Array<{ title?: unknown }>;
    };
    const pageid = typeof p.pageid === 'number' ? p.pageid : null;
    const title = typeof p.title === 'string' ? p.title : null;
    if (pageid === null || !title) continue;
    const qidRaw = p.pageprops?.wikibase_item;
    const qid =
      typeof qidRaw === 'string' && /^Q\d+$/.test(qidRaw) ? qidRaw : null;
    const categories = Array.isArray(p.categories)
      ? p.categories
          .map((c) => (typeof c.title === 'string' ? c.title : ''))
          .filter(Boolean)
      : [];
    out.push({
      pageid,
      title,
      index: typeof p.index === 'number' ? p.index : out.length,
      qid,
      categories,
    });
  }
  return out;
}

// Category titles are namespaced ("Category:Birds of prey"). Determining
// "is this article about a bird?" purely from categories — no slow
// Wikidata taxonomy walk — needs two complementary signals, because
// neither alone is reliable:
//
//   • Species/genus articles are filed under categories that literally
//     contain the word "bird": "Birds described in 1766", "Birds of
//     Canada", "Seabirds", "Flightless birds".
//   • Higher taxa (family/order pages like "Kingfisher") often carry NO
//     "bird" category at all — only the scientific clade names
//     ("Alcedinidae", "Coraciiformes"). For those we match the bird
//     ORDER name, since the ~44 extant bird orders are a small, stable,
//     complete set and one of them reliably appears as a category on any
//     bird taxon page.
//
// A false-positive guard excludes pop-culture categories ("Songs about
// birds", "Hummingbirds in popular culture", "Fictional birds") that
// contain "bird" but describe songs, comics, etc. — those are filtered
// out unless the page ALSO looks like a real taxon (see isTaxonPage).

// The word "bird" as a standalone-ish token in a category name.
const BIRD_WORD_RE = /\bbirds?\b/i;

// Pop-culture / non-taxonomic categories that mention birds but don't
// make the article a bird. Checked to suppress false positives like the
// song "Hummingbird Heartbeat" ("Songs about birds").
const NON_TAXON_CATEGORY_RE =
  /popular culture|fictional|songs about|albums|films|in art|mascots|sports|given names|surnames|video games|comics/i;

// "Articles with 'species' microformats" / "Taxonbar…" / "Taxa named by…"
// are emitted by Wikipedia's taxonomy infoboxes and reliably mark a page
// as an actual taxon (present on every bird species AND family page,
// absent from songs/comics/people/places).
const TAXON_MARKER_RE = /species' microformats|taxonbar|taxa named by/i;

// The 44 extant bird orders (Clements/IOC). A category equal to one of
// these is a definitive "this is a bird taxon" signal — it catches
// family/order pages that carry no "bird"-word category (e.g.
// "Kingfisher" → "Coraciiformes").
const BIRD_ORDERS = new Set(
  [
    'Struthioniformes',
    'Rheiformes',
    'Casuariiformes',
    'Apterygiformes',
    'Tinamiformes',
    'Anseriformes',
    'Galliformes',
    'Phoenicopteriformes',
    'Podicipediformes',
    'Columbiformes',
    'Mesitornithiformes',
    'Pterocliformes',
    'Otidiformes',
    'Musophagiformes',
    'Cuculiformes',
    'Caprimulgiformes',
    'Apodiformes',
    'Opisthocomiformes',
    'Gruiformes',
    'Charadriiformes',
    'Eurypygiformes',
    'Phaethontiformes',
    'Gaviiformes',
    'Sphenisciformes',
    'Procellariiformes',
    'Ciconiiformes',
    'Suliformes',
    'Pelecaniformes',
    'Cathartiformes',
    'Accipitriformes',
    'Strigiformes',
    'Coliiformes',
    'Leptosomiformes',
    'Trogoniformes',
    'Bucerotiformes',
    'Coraciiformes',
    'Piciformes',
    'Cariamiformes',
    'Falconiformes',
    'Psittaciformes',
    'Passeriformes',
  ].map((o) => o.toLowerCase()),
);

/** True when the page's categories mark it as an actual taxon (vs. a
 *  song/comic/person/place that merely mentions a bird). */
function isTaxonPage(categories: string[]): boolean {
  return categories.some((c) => TAXON_MARKER_RE.test(c));
}

function isBirdByCategory(categories: string[]): boolean {
  const taxon = isTaxonPage(categories);
  for (const raw of categories) {
    const name = raw.replace(/^Category:/i, '');
    // Bird order name (e.g. "Coraciiformes") — definitive for any taxon.
    if (BIRD_ORDERS.has(name.toLowerCase())) return true;
    // A "bird"-word category, unless it's a pop-culture mention on a
    // non-taxon page (suppresses the song/comic false positives).
    if (BIRD_WORD_RE.test(name)) {
      if (taxon || !NON_TAXON_CATEGORY_RE.test(name)) return true;
    }
  }
  return false;
}

/**
 * Best-effort scientific-name extraction without a second network hop.
 * We detect when the article title IS already the binomial (e.g. someone
 * searched "Sagittarius serpentarius"): a capitalized genus + lowercase
 * species epithet, exactly two tokens. Returns null otherwise — callers
 * fall back to the common-name title, and the per-cell Wikipedia lookups
 * still resolve imagery from the common name.
 */
function extractScientificName(page: WikipediaPage): string | null {
  // Title is itself a binomial: "Genus species" (genus capitalized,
  // species epithet lowercase, exactly two tokens).
  const titleBinomial = page.title.match(/^([A-Z][a-z]+)\s([a-z]+)$/);
  if (titleBinomial) return page.title;
  return null;
}
