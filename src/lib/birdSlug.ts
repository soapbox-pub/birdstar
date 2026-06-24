import type { BirdLabel } from '@/lib/birdnet/labels';

/**
 * URL slug for a bird species, derived from its scientific name.
 *
 * The scientific name is the app's primary display/lookup key (see
 * AGENTS.md), is stable across the BirdNET label set, and is already
 * unique per species — so it makes a clean, human-readable shareable
 * identifier (e.g. `Cardinalis cardinalis` → `cardinalis-cardinalis`).
 *
 * The transform is intentionally lossy-but-reversible *enough*: we
 * never reverse the slug into a name directly. Instead callers resolve
 * a slug back to a `BirdLabel` by slugging every label's scientific
 * name and matching (see {@link findLabelBySlug}), so the only
 * requirement is that distinct species produce distinct slugs. Two
 * BirdNET scientific names that collide under this transform would be a
 * problem, but binomial Latin names don't differ only by punctuation in
 * practice.
 *
 * Diacritics are stripped (some scientific names carry them), the
 * result is lower-cased, and any run of non-alphanumeric characters
 * collapses to a single hyphen.
 */
export function birdSlug(scientificName: string): string {
  return scientificName
    .normalize('NFD')
    // Drop combining diacritical marks left by NFD decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve a URL slug back to its `BirdLabel` by slugging each label's
 * scientific name and comparing. Returns `null` when no label matches
 * (unknown / malformed slug) or when `labels` hasn't loaded yet.
 *
 * Linear scan over the (~6k entry) label list; cheap enough to run on
 * demand without memoizing a reverse map.
 */
export function findLabelBySlug(
  labels: BirdLabel[] | undefined,
  slug: string | undefined,
): BirdLabel | null {
  if (!labels || !slug) return null;
  const target = slug.toLowerCase();
  return labels.find((label) => birdSlug(label.scientificName) === target) ?? null;
}
