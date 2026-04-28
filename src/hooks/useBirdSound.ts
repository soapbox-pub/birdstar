// Fetches a reference recording of a bird's song so the user can
// preview what the species sounds like before going out to find it
// in the field. Used by the "Listen for its song" section of
// BirdInfoDialog.
//
// Two-tier lookup:
//   1. Wikipedia/Wikimedia Commons first — bird species articles
//      carry editorially-curated, mostly Xeno-Canto-sourced
//      recordings of high quality. See `useWikipediaSound.ts` for
//      the details. Covers the vast majority of common and
//      moderately-uncommon species.
//   2. iNaturalist fallback — only consulted when Wikipedia has no
//      usable recording (obscure tropical/insular species whose
//      enwiki article either doesn't exist or carries only images).
//      iNat has broader coverage but variable quality: we pick the
//      highest-voted research-grade observation with a sound via
//      `order_by=votes`, since votes are a decent community signal
//      for "clean, single-species, well-labeled recording."
//
// Why not Xeno-Canto directly? Xeno-Canto's v3 API requires a
// per-account key (v2 was deprecated in 2024), which would force us
// to either ship a key in the SPA bundle (publicly scrapable) or run
// a proxy. Using Wikipedia-curated XC recordings gets us XC quality
// without the auth headache; iNat fills the gap for species XC lacks.
//
// Both providers are CORS-open and cached for 24h via TanStack Query;
// repeated opens of the same species dialog are free after the first.
// Returns null when no usable recording is found from either
// provider. The UI should hide the audio player entirely in that
// case rather than showing a broken <audio> element.
import { useQuery } from '@tanstack/react-query';
import { fetchInatTaxonId } from '@/hooks/useInatTaxonId';
import { fetchWikipediaSound } from '@/hooks/useWikipediaSound';

export interface BirdSound {
  /** Direct URL to the audio file (mp3, ogg, m4a, or wav). For
   *  Wikipedia OGG sources we deliberately pick the MediaWiki-
   *  generated MP3 transcode to preserve Safari/iOS compat. */
  audioUrl: string;
  /** Permalink to the recording's source page — an iNat observation
   *  or a Commons file-description page — so curious users can see
   *  the uploader, locality, and waveform, and so license-compliant
   *  attribution has a clickable verification target. */
  observationUrl: string;
  /** Human-readable attribution line ("© Jane Doe, CC BY-SA 3.0") so
   *  we can credit the recordist in the UI. Wikipedia and iNat both
   *  report this in a compatible free-form shape. */
  attribution: string;
  /** Which provider supplied the recording. UI uses this to label
   *  the "View source" link differently (Commons vs iNaturalist)
   *  and may eventually use it to prefer Wikipedia-sourced
   *  recordings in analytics. */
  source: 'wikipedia' | 'inaturalist';
}

interface InatSound {
  file_url?: string;
  attribution?: string;
  license_code?: string;
}

interface InatObservation {
  id: number;
  sounds?: InatSound[];
  user?: { login?: string; name?: string | null };
}

async function fetchBestInatSound(taxonId: number): Promise<BirdSound | null> {
  // `order_by=votes` surfaces the community's favorite recordings
  // first — these tend to be clean, single-species, well-labeled
  // songs rather than dawn-chorus mixes or alarm calls. We over-fetch
  // a few so we can skip records where the sound URL is missing
  // (happens occasionally for recently uploaded files still being
  // transcoded).
  const url = new URL('https://api.inaturalist.org/v1/observations');
  url.searchParams.set('taxon_id', String(taxonId));
  url.searchParams.set('sounds', 'true');
  url.searchParams.set('quality_grade', 'research');
  url.searchParams.set('order_by', 'votes');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', '5');

  const res = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: InatObservation[] };
  const results = data.results ?? [];

  for (const obs of results) {
    const sound = obs.sounds?.find((s) => Boolean(s.file_url));
    if (!sound?.file_url) continue;
    return {
      audioUrl: sound.file_url,
      observationUrl: `https://www.inaturalist.org/observations/${obs.id}`,
      attribution:
        sound.attribution ??
        `Recording courtesy of iNaturalist observation #${obs.id}`,
      source: 'inaturalist',
    };
  }
  return null;
}

async function fetchInatSound(
  scientificName: string,
): Promise<BirdSound | null> {
  const taxonId = await fetchInatTaxonId(scientificName);
  if (taxonId == null) return null;
  return fetchBestInatSound(taxonId);
}

/**
 * Resolve a reference recording for a species.
 *
 * Tries Wikipedia/Commons first, iNaturalist second. The two
 * providers share a single React Query cache entry keyed on the
 * scientific name, so the cascade is transparent to callers: one
 * `isLoading`, one `data`, one 24h cache. The `commonName` is an
 * optional tiebreaker passed through to the Wikipedia lookup (used
 * when the article lives under the common name, e.g. "Northern
 * cardinal" vs scientific "Cardinalis cardinalis"), but the cache
 * key deliberately excludes it — a species' preferred recording
 * shouldn't depend on which display name happens to be in scope.
 */
export function useBirdSound(
  scientificName: string | null,
  commonName: string | null = null,
) {
  return useQuery<BirdSound | null>({
    queryKey: ['bird-sound', scientificName],
    enabled: Boolean(scientificName),
    // Recordings don't change often; caching hard keeps the dialog
    // instant on repeat opens and avoids hammering the public APIs.
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    queryFn: async () => {
      if (!scientificName) return null;
      const wiki = await fetchWikipediaSound(scientificName, commonName);
      if (wiki) return wiki;
      return fetchInatSound(scientificName);
    },
  });
}
