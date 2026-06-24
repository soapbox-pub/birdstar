import { describe, it, expect } from 'vitest';

import { birdSlug, findLabelBySlug } from './birdSlug';
import type { BirdLabel } from './birdnet/labels';

/**
 * Tests for the `/bird/:slug` shareable-URL identifier helpers.
 *
 * The critical invariant is round-trip safety: every label's
 * scientific name slugifies to something `findLabelBySlug` can resolve
 * back to that exact label, and distinct species produce distinct
 * slugs.
 */
describe('birdSlug', () => {
  it('lowercases and hyphenates a binomial scientific name', () => {
    expect(birdSlug('Cardinalis cardinalis')).toBe('cardinalis-cardinalis');
    expect(birdSlug('Turdus migratorius')).toBe('turdus-migratorius');
  });

  it('strips diacritics', () => {
    // Some scientific names carry accented characters.
    expect(birdSlug('Phylloscopus trochiloïdes')).toBe(
      'phylloscopus-trochiloides',
    );
  });

  it('collapses runs of punctuation/whitespace to a single hyphen', () => {
    expect(birdSlug('Geothlypis  trichas')).toBe('geothlypis-trichas');
    expect(birdSlug("Larus (Larus) argentatus")).toBe('larus-larus-argentatus');
  });

  it('trims leading and trailing hyphens', () => {
    expect(birdSlug('  Corvus corax  ')).toBe('corvus-corax');
    expect(birdSlug('!Corvus corax!')).toBe('corvus-corax');
  });
});

describe('findLabelBySlug', () => {
  const labels: BirdLabel[] = [
    {
      index: 0,
      scientificName: 'Cardinalis cardinalis',
      commonName: 'Northern Cardinal',
      isBird: true,
    },
    {
      index: 1,
      scientificName: 'Turdus migratorius',
      commonName: 'American Robin',
      isBird: true,
    },
  ];

  it('resolves a slug back to its label', () => {
    expect(findLabelBySlug(labels, 'cardinalis-cardinalis')).toBe(labels[0]);
    expect(findLabelBySlug(labels, 'turdus-migratorius')).toBe(labels[1]);
  });

  it('round-trips every label through birdSlug', () => {
    for (const label of labels) {
      expect(findLabelBySlug(labels, birdSlug(label.scientificName))).toBe(
        label,
      );
    }
  });

  it('is case-insensitive on the incoming slug', () => {
    expect(findLabelBySlug(labels, 'Cardinalis-Cardinalis')).toBe(labels[0]);
  });

  it('returns null for an unknown slug', () => {
    expect(findLabelBySlug(labels, 'nonexistent-bird')).toBeNull();
  });

  it('returns null when labels or slug are missing', () => {
    expect(findLabelBySlug(undefined, 'cardinalis-cardinalis')).toBeNull();
    expect(findLabelBySlug(labels, undefined)).toBeNull();
    expect(findLabelBySlug(labels, '')).toBeNull();
  });
});
