import { describe, it, expect } from 'vitest';

import { normalizeForSearch, searchBirdLabels } from './birdSearch';
import type { BirdLabel } from './birdnet/labels';

function label(
  index: number,
  scientificName: string,
  commonName: string,
  isBird = true,
): BirdLabel {
  return { index, scientificName, commonName, isBird };
}

const LABELS: BirdLabel[] = [
  label(0, 'Cardinalis cardinalis', 'Northern Cardinal'),
  label(1, 'Turdus migratorius', 'American Robin'),
  label(2, 'Corvus corax', 'Common Raven'),
  label(3, 'Cyanocitta cristata', 'Blue Jay'),
  label(4, 'Erithacus rubecula', 'European Robin'),
  label(5, 'Noise', 'Noise', false),
  label(6, 'Canis latrans', 'Coyote', false),
];

describe('normalizeForSearch', () => {
  it('lowercases, trims, and strips diacritics', () => {
    expect(normalizeForSearch('  Phylloscopus  ')).toBe('phylloscopus');
    expect(normalizeForSearch('trochiloïdes')).toBe('trochiloides');
  });

  it('keeps internal spaces (unlike a slug)', () => {
    expect(normalizeForSearch('Northern Cardinal')).toBe('northern cardinal');
  });
});

describe('searchBirdLabels', () => {
  it('returns nothing for queries shorter than 2 chars', () => {
    expect(searchBirdLabels(LABELS, '')).toEqual([]);
    expect(searchBirdLabels(LABELS, 'c')).toEqual([]);
  });

  it('returns nothing when labels are not loaded', () => {
    expect(searchBirdLabels(undefined, 'robin')).toEqual([]);
  });

  it('matches common names by prefix', () => {
    const results = searchBirdLabels(LABELS, 'card');
    expect(results.map((l) => l.commonName)).toEqual(['Northern Cardinal']);
  });

  it('matches the start of any word in a multi-word common name', () => {
    const results = searchBirdLabels(LABELS, 'robin');
    // Both robins match; order is by relevance then alphabetical.
    expect(results.map((l) => l.commonName)).toEqual([
      'American Robin',
      'European Robin',
    ]);
  });

  it('matches scientific names', () => {
    const results = searchBirdLabels(LABELS, 'corvus');
    expect(results.map((l) => l.commonName)).toEqual(['Common Raven']);
  });

  it('is case- and accent-insensitive', () => {
    expect(searchBirdLabels(LABELS, 'CARDINAL').map((l) => l.index)).toEqual([
      0,
    ]);
  });

  it('excludes non-bird classes (noise, mammals)', () => {
    expect(searchBirdLabels(LABELS, 'noise')).toEqual([]);
    expect(searchBirdLabels(LABELS, 'coyote')).toEqual([]);
    expect(searchBirdLabels(LABELS, 'canis')).toEqual([]);
  });

  it('ranks an exact common-name match above a partial one', () => {
    const withExact: BirdLabel[] = [
      label(10, 'Genus species', 'Cardinal Something'),
      label(11, 'Cardinalis cardinalis', 'Cardinal'),
    ];
    const results = searchBirdLabels(withExact, 'cardinal');
    // Exact "Cardinal" should win over the prefix "Cardinal Something".
    expect(results[0].commonName).toBe('Cardinal');
  });

  it('respects the result limit', () => {
    const many: BirdLabel[] = Array.from({ length: 100 }, (_, i) =>
      label(i, `Genus species${i}`, `Warbler ${i}`),
    );
    expect(searchBirdLabels(many, 'warbler', 10)).toHaveLength(10);
  });

  it('returns stable alphabetical order for equal-score matches', () => {
    const results = searchBirdLabels(LABELS, 'robin');
    const names = results.map((l) => l.commonName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
