// Resolves a reference recording for a species from Wikipedia/Wikimedia
// Commons. Used as the preferred source by `useBirdSound` before falling
// back to iNaturalist.
//
// Why Wikipedia first? The audio files that appear on bird species
// articles are editorially curated — almost always clean, labeled,
// single-species recordings (frequently Xeno-Canto originals uploaded
// to Commons). iNat's `votes`-sorted research-grade observations are
// good but vary: you occasionally get dawn-chorus mixes or alarm calls
// rather than the textbook song. Preferring Wikipedia when it exists
// gives us higher average quality; falling back to iNat maintains
// coverage for obscure species with no English Wikipedia article.
//
// Lookup is two CORS-open calls:
//   1. REST `page/media-list/{title}` — every media file on the article
//      in render order, tagged by type ("audio" | "image" | "video")
//      and, for audio, `audio_type` ("generic" | "spoken"). We pick
//      the first `generic` audio item. Empirically this is reliably
//      the species song; non-song audio is limited to:
//        - Wikipedia "spoken article" recordings (filtered via
//          `audio_type === "spoken"`)
//        - Occasional pronunciation clips (no reliable tag; rare
//          enough to tolerate)
//   2. action API `prop=videoinfo` — returns the file's original URL
//      plus MediaWiki's auto-generated `audio/mpeg` transcode of OGG
//      sources, plus `extmetadata` for attribution (artist, license).
//      We prefer the MP3 derivative since OGG Vorbis doesn't play on
//      Safari/iOS `<audio>` elements. Files that are already MP3 or
//      WAV have no derivative and we use the top-level url.
//
// Scientific name is tried first (the article redirects transparently
// for species with taxonomic page titles — e.g. `Zenaida_macroura` →
// Mourning Dove). Common name is the fallback for species whose
// article is under the common name, matching the existing
// `useBirdInfo` resolution order.
//
// Returns null when no suitable recording is found so the orchestrator
// in `useBirdSound` can fall through to iNaturalist silently.
import type { BirdSound } from '@/hooks/useBirdSound';

interface MediaListItem {
  title: string;
  type?: 'audio' | 'image' | 'video';
  /** "generic" for field recordings, "spoken" for spoken-article
   *  narrations. We only want "generic". */
  audio_type?: 'generic' | 'spoken';
  section_id?: number;
}

interface MediaListResponse {
  items?: MediaListItem[];
}

interface VideoInfoDerivative {
  src: string;
  /** e.g. `audio/mpeg`, `audio/ogg; codecs="vorbis"` */
  type: string;
  transcodekey?: string;
}

interface ExtMetadataField {
  value: string;
  source?: string;
  hidden?: string;
}

interface VideoInfo {
  url: string;
  descriptionurl?: string;
  mime?: string;
  derivatives?: VideoInfoDerivative[];
  extmetadata?: {
    Artist?: ExtMetadataField;
    LicenseShortName?: ExtMetadataField;
    Credit?: ExtMetadataField;
    ImageDescription?: ExtMetadataField;
  };
}

interface VideoInfoResponse {
  query?: {
    pages?: Record<string, { videoinfo?: VideoInfo[] }>;
  };
}

/**
 * Fetch the first usable audio item on a species' enwiki article.
 * Returns the raw file title (e.g. `File:Foo_bar.ogg`) or null.
 */
async function fetchFirstAudioFile(title: string): Promise<string | null> {
  // Media-list endpoint redirects transparently for scientific-name
  // lookups, so we don't need a separate resolution step.
  const url = `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(
    title.replace(/\s+/g, '_'),
  )}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as MediaListResponse;
  const items = data.items ?? [];
  for (const item of items) {
    if (item.type !== 'audio') continue;
    // Drop Wikipedia spoken-article recordings — these are
    // encyclopaedia narrations, not bird songs. Everything else
    // ("generic" or missing audio_type) is a real field recording.
    if (item.audio_type === 'spoken') continue;
    return item.title;
  }
  return null;
}

/**
 * Look up `videoinfo` for a Commons file title and build a
 * {@link BirdSound}. The name of the action API endpoint is a legacy
 * artifact — `videoinfo` is the unified property for any
 * transcodable media, including audio.
 */
async function fetchFileSound(fileTitle: string): Promise<BirdSound | null> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('prop', 'videoinfo');
  url.searchParams.set('viprop', 'url|mime|derivatives|extmetadata');
  url.searchParams.set('titles', fileTitle);
  // `origin=*` unlocks CORS for anonymous cross-origin browser
  // requests against the action API (REST API enables it by default;
  // the action API requires this opt-in).
  url.searchParams.set('origin', '*');

  const res = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as VideoInfoResponse;
  const pages = data.query?.pages;
  if (!pages) return null;
  // The API returns pages keyed by pageid (or "-1" for missing). We
  // always requested one title, so there's one entry either way.
  const page = Object.values(pages)[0];
  const info = page?.videoinfo?.[0];
  if (!info) return null;

  // Prefer the MP3 transcode for Safari/iOS compat. Fall back to the
  // original URL when no derivative exists (already-MP3 or WAV
  // sources don't get transcoded).
  const mp3 = info.derivatives?.find((d) => d.type.startsWith('audio/mpeg'));
  const audioUrl = mp3?.src ?? info.url;
  if (!audioUrl) return null;

  const artist = htmlToText(info.extmetadata?.Artist?.value);
  const license = htmlToText(info.extmetadata?.LicenseShortName?.value);
  const credit = htmlToText(info.extmetadata?.Credit?.value);
  const attribution = buildAttribution(artist, license, credit);

  // `descriptionurl` is the Commons file-description page — shown
  // in the dialog as the "Wikimedia Commons recording" link so
  // users can verify the recordist and license.
  const observationUrl =
    info.descriptionurl ??
    `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`;

  return {
    audioUrl,
    observationUrl,
    attribution,
    source: 'wikipedia',
  };
}

/**
 * Strip HTML tags from an extmetadata value. These fields sometimes
 * carry wiki-generated `<a>` links (e.g. Artist = "<a href=...>Jane
 * Doe</a>"), which look terrible when rendered as-is in a plaintext
 * attribution line. DOMParser is available everywhere we run (browsers
 * + jsdom in tests) and correctly decodes entities.
 */
function htmlToText(html: string | undefined): string | null {
  if (!html) return null;
  if (typeof DOMParser === 'undefined') {
    // SSR / non-DOM environments: crude tag strip. Doesn't need to
    // be perfect; this code path doesn't run in production.
    const stripped = html.replace(/<[^>]*>/g, '').trim();
    return stripped || null;
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = (doc.body.textContent ?? '').trim();
  return text || null;
}

/**
 * Compose a single attribution string in roughly the same shape as
 * iNat's (`© Recordist Name, License`) so the two providers look
 * uniform in the dialog's sources line.
 *
 * Preference order:
 *   - "© {artist}, {license}" when both are present
 *   - artist alone
 *   - license alone
 *   - credit (a catch-all field containing e.g. the Xeno-Canto URL
 *     for many bird recordings)
 *   - generic "Wikimedia Commons" as last resort — at least the link
 *     still points to the source.
 */
function buildAttribution(
  artist: string | null,
  license: string | null,
  credit: string | null,
): string {
  if (artist && license) return `© ${artist}, ${license}`;
  if (artist) return `© ${artist}`;
  if (license) return license;
  if (credit) return credit;
  return 'Wikimedia Commons';
}

export async function fetchWikipediaSound(
  scientificName: string | null,
  commonName: string | null,
): Promise<BirdSound | null> {
  const titles: string[] = [];
  if (scientificName) titles.push(scientificName);
  if (commonName && commonName !== scientificName) titles.push(commonName);

  for (const title of titles) {
    const file = await fetchFirstAudioFile(title);
    if (!file) continue;
    const sound = await fetchFileSound(file);
    if (sound) return sound;
  }
  return null;
}
