import type { BirdLabel } from '@/lib/birdnet/labels';

/**
 * Normalize a string for accent- and case-insensitive substring
 * matching: lower-case and strip combining diacritics. Mirrors the
 * normalization in `birdSlug` so a user typing "nabegel" or "Nägel"
 * matches the same way, but keeps spaces/punctuation (unlike the slug)
 * so multi-word queries still work intuitively.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** A scored search hit. Higher `score` ranks first. */
export interface BirdSearchMatch {
  label: BirdLabel;
  score: number;
}

// Relevance tiers, highest first. A prefix match on the common name is
// the strongest signal ("car" → "Cardinal"); a mid-word match is
// weaker but still useful ("inal" → "Cardinal").
const SCORE_COMMON_EXACT = 100;
const SCORE_COMMON_PREFIX = 80;
const SCORE_SCIENTIFIC_PREFIX = 60;
const SCORE_COMMON_WORD_PREFIX = 50;
const SCORE_COMMON_SUBSTRING = 30;
const SCORE_SCIENTIFIC_SUBSTRING = 20;

/**
 * Score a single label against a pre-normalized query. Returns 0 when
 * the query appears in neither the common nor scientific name (i.e. no
 * match). The score blends the relevance tier with a small popularity-
 * agnostic tiebreaker so shorter names (closer-length matches) edge
 * out longer ones at the same tier.
 */
function scoreLabel(label: BirdLabel, query: string): number {
  const common = normalizeForSearch(label.commonName);
  const scientific = normalizeForSearch(label.scientificName);

  const tier = tierFor(common, scientific, query);
  if (tier === 0) return 0;

  // Tiebreaker within a tier: prefer names whose length is closest to
  // the query (a tighter match). Kept small so it never crosses tiers.
  const lengthPenalty = Math.min(common.length, scientific.length) / 1000;
  return tier - lengthPenalty;
}

/** Relevance tier for a (common, scientific) pair against a query. 0 = no match. */
function tierFor(common: string, scientific: string, query: string): number {
  if (common === query) return SCORE_COMMON_EXACT;
  if (common.startsWith(query)) return SCORE_COMMON_PREFIX;
  if (scientific.startsWith(query)) return SCORE_SCIENTIFIC_PREFIX;
  // Matches the start of any word in a multi-word common name, e.g.
  // "robin" → "American Robin".
  if (common.split(' ').some((word) => word.startsWith(query))) {
    return SCORE_COMMON_WORD_PREFIX;
  }
  if (common.includes(query)) return SCORE_COMMON_SUBSTRING;
  if (scientific.includes(query)) return SCORE_SCIENTIFIC_SUBSTRING;
  return 0;
}

/**
 * Search the BirdNET label set for species matching `rawQuery`,
 * ranked by relevance. Non-bird classes (noise, mammals, frogs) are
 * excluded. Returns at most `limit` matches.
 *
 * Pure function — no React — so it's unit-testable in isolation. The
 * `useBirdSearch` hook wraps it with memoization.
 */
export function searchBirdLabels(
  labels: BirdLabel[] | undefined,
  rawQuery: string,
  limit = 60,
): BirdLabel[] {
  const query = normalizeForSearch(rawQuery);
  if (!labels || query.length < 2) return [];

  const matches: BirdSearchMatch[] = [];
  for (const label of labels) {
    if (!label.isBird) continue;
    const score = scoreLabel(label, query);
    if (score > 0) matches.push({ label, score });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable alphabetical fallback for equal scores so results don't
    // jitter between renders.
    return a.label.commonName.localeCompare(b.label.commonName);
  });

  return matches.slice(0, limit).map((m) => m.label);
}
