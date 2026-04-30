// Fetches a Wikipedia summary card for a bird. We prefer the scientific name
// because English common names are sometimes ambiguous or point to
// disambiguation pages (e.g. "Crane"). If the scientific name has no
// dedicated page, we fall back to the common name.
import { useQuery } from '@tanstack/react-query';

export interface BirdInfo {
  title: string;
  extract: string;
  imageUrl: string | null;
  wikiUrl: string;
  /**
   * Canonical Wikidata entity URI (e.g. `https://www.wikidata.org/entity/Q12345`)
   * derived from the Wikipedia summary response's `wikibase_item`. Null when
   * the article has no linked Wikidata item — rare for taxa, but possible.
   * Used as a stable per-species identifier for things like comment threads
   * that should aggregate across every user who's heard (or browsed) this bird.
   */
  entityUri: string | null;
}

async function fetchSummary(title: string): Promise<BirdInfo | null> {
  // The REST summary endpoint returns 404 for missing pages and a JSON body
  // with type=="disambiguation" for disambig pages. Both we treat as "miss".
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/\s+/g, '_'),
  )}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.type === 'disambiguation') return null;
  if (!data.extract) return null;
  // `wikibase_item` is a Q-id like "Q12345". Normalize to the canonical
  // entity URI shape required by NIP.md §"Kind 2473" so the same string
  // can seed both detection events and per-species comment threads.
  const qid = typeof data.wikibase_item === 'string' ? data.wikibase_item : null;
  const entityUri = qid && /^Q\d+$/.test(qid)
    ? `https://www.wikidata.org/entity/${qid}`
    : null;
  return {
    title: data.title ?? title,
    extract: data.extract,
    imageUrl: data.thumbnail?.source ?? data.originalimage?.source ?? null,
    wikiUrl:
      data.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
    entityUri,
  };
}

export function useBirdInfo(scientificName: string | null, commonName: string | null) {
  return useQuery<BirdInfo | null>({
    queryKey: ['bird-info', scientificName, commonName],
    enabled: Boolean(scientificName || commonName),
    staleTime: 1000 * 60 * 60 * 24, // 24 hours — species info doesn't change
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    queryFn: async () => {
      if (scientificName) {
        const byScientific = await fetchSummary(scientificName);
        if (byScientific) return byScientific;
      }
      if (commonName) {
        const byCommon = await fetchSummary(commonName);
        if (byCommon) return byCommon;
      }
      return null;
    },
  });
}
