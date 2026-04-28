/**
 * Built-in zodiac (astrological) constellations.
 *
 * Starpoint already supports user-drawn constellations (kind 30621), but
 * this module ships the twelve traditional astrological signs as a
 * first-class built-in layer. Unlike custom constellations, zodiacs are:
 *
 *   - Rendered from the canonical d3-celestial stick-figure data so
 *     they stay consistent with every other reference/chart tool that
 *     uses the same source.
 *   - Attached to a stable external URL identifier (Wikipedia) so their
 *     comment threads (NIP-22 via `#I`) are shareable & long-lived.
 *   - Toggleable as a single "show zodiac signs" preference in Settings.
 *
 * Edge lists are **derived at module load** by `./zodiacLines.ts` from
 * `d3-celestial/data/constellations.lines.json`, so we never hand-maintain
 * HIP-pair arrays here. The only per-sign data we own is the astrological
 * metadata (glyph, date range, element, modality, ruling planet, blurb)
 * — none of which lives in an upstream star catalog.
 */

import { ZODIAC_EDGES } from "./zodiacLines";

/** Identifier for a built-in zodiac sign. */
export type ZodiacId =
  | "aries"
  | "taurus"
  | "gemini"
  | "cancer"
  | "leo"
  | "virgo"
  | "libra"
  | "scorpius"
  | "sagittarius"
  | "capricornus"
  | "aquarius"
  | "pisces";

/** Classical elemental grouping used in Western astrology. */
export type ZodiacElement = "fire" | "earth" | "air" | "water";

/** Modality (quality) used in Western astrology. */
export type ZodiacModality = "cardinal" | "fixed" | "mutable";

export interface ZodiacSign {
  id: ZodiacId;
  /** Display name of the sign (same as the constellation name for these). */
  name: string;
  /** Unicode zodiac glyph (e.g. "♈"). */
  glyph: string;
  /** Human-readable date range for the tropical zodiac. */
  dateRange: string;
  /** Classical element. */
  element: ZodiacElement;
  /** Classical modality. */
  modality: ZodiacModality;
  /** Traditional ruling planet. */
  rulingPlanet: string;
  /** Short astrological description (1-2 sentences). */
  blurb: string;
  /**
   * Edges of the stick figure, as pairs of Hipparcos catalog numbers.
   * Sourced from d3-celestial's canonical constellation line data so the
   * figure matches the rest of the astronomical ecosystem. Mirrors the
   * `edges` shape used by custom constellations so these overlays can be
   * rendered by the same SkyMap code path.
   */
  edges: ReadonlyArray<readonly [number, number]>;
}

/**
 * Per-sign astrology metadata. Keyed by `ZodiacId` so the combined
 * `ZODIAC_SIGNS` list below can zip this with the derived edge lists.
 */
type ZodiacMetadata = Omit<ZodiacSign, "edges">;

const ZODIAC_METADATA: readonly ZodiacMetadata[] = [
  {
    id: "aries",
    name: "Aries",
    glyph: "♈",
    dateRange: "Mar 21 – Apr 19",
    element: "fire",
    modality: "cardinal",
    rulingPlanet: "Mars",
    blurb:
      "The Ram. First sign of the zodiac, associated with initiative, action, and new beginnings.",
  },
  {
    id: "taurus",
    name: "Taurus",
    glyph: "♉",
    dateRange: "Apr 20 – May 20",
    element: "earth",
    modality: "fixed",
    rulingPlanet: "Venus",
    blurb:
      "The Bull. Associated with stability, persistence, sensuality, and the material world.",
  },
  {
    id: "gemini",
    name: "Gemini",
    glyph: "♊",
    dateRange: "May 21 – Jun 20",
    element: "air",
    modality: "mutable",
    rulingPlanet: "Mercury",
    blurb:
      "The Twins. Associated with communication, curiosity, duality, and quick intellect.",
  },
  {
    id: "cancer",
    name: "Cancer",
    glyph: "♋",
    dateRange: "Jun 21 – Jul 22",
    element: "water",
    modality: "cardinal",
    rulingPlanet: "Moon",
    blurb:
      "The Crab. Associated with nurturing, home, emotional depth, and protective instinct.",
  },
  {
    id: "leo",
    name: "Leo",
    glyph: "♌",
    dateRange: "Jul 23 – Aug 22",
    element: "fire",
    modality: "fixed",
    rulingPlanet: "Sun",
    blurb:
      "The Lion. Associated with confidence, leadership, creativity, and dramatic flair.",
  },
  {
    id: "virgo",
    name: "Virgo",
    glyph: "♍",
    dateRange: "Aug 23 – Sep 22",
    element: "earth",
    modality: "mutable",
    rulingPlanet: "Mercury",
    blurb:
      "The Maiden. Associated with analysis, service, craft, and a sharp eye for detail.",
  },
  {
    id: "libra",
    name: "Libra",
    glyph: "♎",
    dateRange: "Sep 23 – Oct 22",
    element: "air",
    modality: "cardinal",
    rulingPlanet: "Venus",
    blurb:
      "The Scales. Associated with balance, fairness, partnership, and aesthetic harmony.",
  },
  {
    id: "scorpius",
    name: "Scorpius",
    glyph: "♏",
    dateRange: "Oct 23 – Nov 21",
    element: "water",
    modality: "fixed",
    rulingPlanet: "Mars",
    blurb:
      "The Scorpion. Associated with intensity, transformation, mystery, and deep emotion.",
  },
  {
    id: "sagittarius",
    name: "Sagittarius",
    glyph: "♐",
    dateRange: "Nov 22 – Dec 21",
    element: "fire",
    modality: "mutable",
    rulingPlanet: "Jupiter",
    blurb:
      "The Archer. Associated with adventure, exploration, philosophy, and unbounded optimism.",
  },
  {
    id: "capricornus",
    name: "Capricornus",
    glyph: "♑",
    dateRange: "Dec 22 – Jan 19",
    element: "earth",
    modality: "cardinal",
    rulingPlanet: "Saturn",
    blurb:
      "The Sea-Goat. Associated with discipline, ambition, structure, and long-term mastery.",
  },
  {
    id: "aquarius",
    name: "Aquarius",
    glyph: "♒",
    dateRange: "Jan 20 – Feb 18",
    element: "air",
    modality: "fixed",
    rulingPlanet: "Saturn",
    blurb:
      "The Water-Bearer. Associated with innovation, humanitarianism, independence, and vision.",
  },
  {
    id: "pisces",
    name: "Pisces",
    glyph: "♓",
    dateRange: "Feb 19 – Mar 20",
    element: "water",
    modality: "mutable",
    rulingPlanet: "Jupiter",
    blurb:
      "The Fishes. Associated with intuition, empathy, imagination, and spiritual depth.",
  },
] as const;

/**
 * Canonical twelve zodiac signs. Edge lists come from the d3-celestial
 * `constellations.lines.json` at module load (via `./zodiacLines`), so
 * figures stay consistent with upstream reference data.
 */
export const ZODIAC_SIGNS: readonly ZodiacSign[] = ZODIAC_METADATA.map(
  (meta) => ({
    ...meta,
    edges: ZODIAC_EDGES[meta.id],
  }),
);

/** Fast lookup by id. */
const ZODIAC_BY_ID: ReadonlyMap<ZodiacId, ZodiacSign> = new Map(
  ZODIAC_SIGNS.map((s) => [s.id, s]),
);

export function zodiacById(id: string): ZodiacSign | undefined {
  return ZODIAC_BY_ID.get(id as ZodiacId);
}

/**
 * Map a 3-letter IAU constellation abbreviation (e.g. "Leo", "Sco") to
 * the corresponding zodiac id, if any. Only the twelve zodiac
 * constellations have a match; every other IAU code returns `null`.
 *
 * Used by the star detail view to conditionally link the constellation
 * code to its zodiac page — the other 76 IAU constellations have no
 * dedicated view in the app.
 */
export function iauCodeToZodiac(code: string): ZodiacId | null {
  // Hand-maintained because IAU codes don't always match our zodiac ids
  // (e.g. IAU uses "Sco" for Scorpius — we happen to use "scorpius";
  // IAU uses "Cap" for Capricornus — we use "capricornus"). Explicit
  // mapping avoids fragile string transforms.
  switch (code) {
    case "Ari": return "aries";
    case "Tau": return "taurus";
    case "Gem": return "gemini";
    case "Cnc": return "cancer";
    case "Leo": return "leo";
    case "Vir": return "virgo";
    case "Lib": return "libra";
    case "Sco": return "scorpius";
    case "Sgr": return "sagittarius";
    case "Cap": return "capricornus";
    case "Aqr": return "aquarius";
    case "Psc": return "pisces";
    default: return null;
  }
}

/**
 * Stable overlay id used for zodiac signs when they share the same
 * overlay channel as user-drawn constellations. Prefixed to guarantee
 * no collision with the `pubkey:d` format used by custom ones.
 */
export function zodiacOverlayId(id: ZodiacId): string {
  return `zodiac:${id}`;
}

/** Parse an overlay id back to a zodiac id, or null if it isn't one. */
export function parseZodiacOverlayId(overlayId: string): ZodiacId | null {
  if (!overlayId.startsWith("zodiac:")) return null;
  const id = overlayId.slice("zodiac:".length);
  return ZODIAC_BY_ID.has(id as ZodiacId) ? (id as ZodiacId) : null;
}

/**
 * Canonical external identifier used to anchor NIP-22 comment threads
 * for a zodiac sign. Uses the Wikipedia article URL for the astrological
 * sign (not the astronomy constellation) so comments tie to the topic
 * the feature advertises.
 *
 * Keeping this as a pure URL keeps threads portable: any other Nostr
 * client that supports NIP-22/NIP-73 `I`/`i` identifiers for URLs will
 * surface the same conversation.
 */
export function zodiacCommentUrl(id: ZodiacId): URL {
  // Wikipedia disambiguation convention for astrology sign pages.
  const slug: Record<ZodiacId, string> = {
    aries: "Aries_(astrology)",
    taurus: "Taurus_(astrology)",
    gemini: "Gemini_(astrology)",
    cancer: "Cancer_(astrology)",
    leo: "Leo_(astrology)",
    virgo: "Virgo_(astrology)",
    libra: "Libra_(astrology)",
    scorpius: "Scorpio_(astrology)",
    sagittarius: "Sagittarius_(astrology)",
    capricornus: "Capricorn_(astrology)",
    aquarius: "Aquarius_(astrology)",
    pisces: "Pisces_(astrology)",
  };
  return new URL(`https://en.wikipedia.org/wiki/${slug[id]}`);
}
