import { useQuery } from "@tanstack/react-query";

export interface WikipediaSummary {
  title: string;
  displayTitle: string;
  description?: string;
  extract: string;
  extractHtml?: string;
  thumbnail?: {
    source: string;
    width: number;
    height: number;
  };
  originalImage?: {
    source: string;
    width: number;
    height: number;
  };
  pageUrl: string;
  canonicalUrl: string;
  /**
   * Wikidata entity Q-ID (e.g. "Q3409" for Sirius), if Wikipedia has
   * linked this article to a Wikidata item. Used as a language-neutral,
   * rename-stable identifier for cross-client interop — the canonical
   * Wikidata entity URI is `https://www.wikidata.org/entity/<Q-ID>`.
   */
  wikibaseItem?: string;
}

interface WikiApiResponse {
  type: string;
  title: string;
  displaytitle: string;
  description?: string;
  extract: string;
  extract_html?: string;
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
  content_urls: {
    desktop: { page: string };
  };
  wikibase_item?: string;
}

async function fetchSummary(title: string): Promise<WikipediaSummary> {
  // Wikipedia REST API summary endpoint (supports CORS)
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title,
  )}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Wikipedia lookup failed: ${res.status}`);
  }
  const data = (await res.json()) as WikiApiResponse;
  if (data.type === "disambiguation") {
    throw new Error("Disambiguation page");
  }
  const pageUrl = data.content_urls?.desktop?.page ??
    `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title.replace(/ /g, "_"))}`;
  return {
    title: data.title,
    displayTitle: data.displaytitle ?? data.title,
    description: data.description,
    extract: data.extract,
    extractHtml: data.extract_html,
    thumbnail: data.thumbnail,
    originalImage: data.originalimage,
    pageUrl,
    canonicalUrl: pageUrl,
    wikibaseItem: data.wikibase_item,
  };
}

/**
 * Look up a Wikipedia article, trying candidate titles in order until one succeeds.
 */
export function useWikipediaSummary(candidateTitles: string[]) {
  return useQuery<WikipediaSummary>({
    queryKey: ["wikipedia", candidateTitles],
    enabled: candidateTitles.length > 0,
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: false,
    queryFn: async () => {
      let lastErr: unknown = null;
      for (const title of candidateTitles) {
        try {
          const result = await fetchSummary(title);
          return result;
        } catch (err) {
          lastErr = err;
          // Try next candidate
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("No matching Wikipedia article");
    },
  });
}
