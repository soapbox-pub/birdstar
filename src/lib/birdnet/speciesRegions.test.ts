import { describe, it, expect } from 'vitest';
import {
  isSpeciesInRegion,
  classifySpeciesInRegion,
  parseTable,
  type SpeciesRegionsTable,
} from './speciesRegions';

/**
 * Build a synthetic BRN3 buffer for testing. `labels` is a list of
 * (places, popularity) tuples for each label index. Places may be empty
 * ("range unknown"); popularity defaults to 0 ("pageviews unknown").
 */
function makeTable(
  labels: ReadonlyArray<readonly [readonly string[], number?]>,
): SpeciesRegionsTable {
  // Build dictionary in first-seen order.
  const dict: string[] = [];
  const dictIndex = new Map<string, number>();
  for (const [places] of labels) {
    for (const p of places) {
      if (!dictIndex.has(p)) {
        dictIndex.set(p, dict.length);
        dict.push(p);
      }
    }
  }

  const offsets: number[] = [0];
  const ids: number[] = [];
  for (const [places] of labels) {
    for (const p of places) ids.push(dictIndex.get(p)!);
    offsets.push(ids.length);
  }

  const encoder = new TextEncoder();
  const dictBytes = dict.map((s) => encoder.encode(s));
  const dictByteLen = dictBytes.reduce((a, b) => a + 1 + b.length, 0);
  const totalLen =
    4 + 4 + 2 + dictByteLen + (labels.length + 1) * 4 + ids.length * 2 +
    labels.length * 2;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x52; buf[2] = 0x4e; buf[3] = 0x33;
  view.setUint32(4, labels.length, true);
  view.setUint16(8, dict.length, true);
  let off = 10;
  for (const bytes of dictBytes) {
    buf[off] = bytes.length;
    off += 1;
    buf.set(bytes, off);
    off += bytes.length;
  }
  for (const o of offsets) {
    view.setUint32(off, o, true);
    off += 4;
  }
  for (const id of ids) {
    view.setUint16(off, id, true);
    off += 2;
  }
  for (const [, pop] of labels) {
    view.setUint16(off, pop ?? 0, true);
    off += 2;
  }

  const parsed = parseTable(buf.buffer as ArrayBuffer, labels.length);
  if (!parsed) throw new Error('parseTable returned null');
  return parsed;
}

const EMPTY_TABLE: SpeciesRegionsTable = {
  loaded: false,
  labelCount: 0,
  placesForLabel: () => [],
  labelsMatchingAny: () => [],
  popularityFor: () => 0,
};

describe('isSpeciesInRegion', () => {
  it('treats every species as in-range when the table is not loaded', () => {
    expect(isSpeciesInRegion(0, new Set(['NA']), EMPTY_TABLE)).toBe(true);
    expect(isSpeciesInRegion(9999, new Set(['AS']), EMPTY_TABLE)).toBe(true);
  });

  it('treats an out-of-bounds label index as in-range', () => {
    const table = makeTable([[['NA']], [['AF']]]);
    expect(isSpeciesInRegion(2, new Set(['AS']), table)).toBe(true);
    expect(isSpeciesInRegion(-1, new Set(['AS']), table)).toBe(true);
  });

  it('treats an empty place list ("unknown range") as in-range everywhere', () => {
    const table = makeTable([[[]]]);
    expect(isSpeciesInRegion(0, new Set(['NA']), table)).toBe(true);
    expect(isSpeciesInRegion(0, new Set(['AN']), table)).toBe(true);
  });

  it('treats MARINE-flagged species as in-range everywhere', () => {
    const table = makeTable([[['MARINE']]]);
    expect(isSpeciesInRegion(0, new Set(['NA']), table)).toBe(true);
    expect(isSpeciesInRegion(0, new Set(['AN']), table)).toBe(true);
    expect(isSpeciesInRegion(0, new Set(['OC']), table)).toBe(true);
  });

  it('matches on any place in the user set', () => {
    // Species 0: NA only. Species 1: EU + AF.
    const table = makeTable([[['NA']], [['EU', 'AF']]]);
    expect(isSpeciesInRegion(0, new Set(['NA']), table)).toBe(true);
    expect(isSpeciesInRegion(0, new Set(['EU']), table)).toBe(false);
    expect(isSpeciesInRegion(0, new Set(['AS']), table)).toBe(false);

    expect(isSpeciesInRegion(1, new Set(['EU']), table)).toBe(true);
    expect(isSpeciesInRegion(1, new Set(['AF']), table)).toBe(true);
    expect(isSpeciesInRegion(1, new Set(['NA']), table)).toBe(false);
    expect(isSpeciesInRegion(1, new Set(['OC']), table)).toBe(false);
  });

  it('matches hierarchical place sets (state ⊂ country ⊂ continent)', () => {
    // The place lists below mirror the rules the scraper emits:
    //   * Narrow-ecoregion categories ("Native birds of the SE US") do
    //     NOT expand upward to the country/continent; only the
    //     ecoregion hierarchy under them.
    //   * Country-wide categories ("Birds of the United States") DO
    //     include the continent.
    //   * Continent-only categories are a pure top-level tag.
    const table = makeTable([
      [['US-SE', 'US-E']],   // species 0: native to the Southeastern US
      [['US', 'NA']],        // species 1: country-wide
      [['NA']],              // species 2: continent-wide
    ]);
    const austinUser = new Set(['US-SE', 'US-MW', 'US-SW', 'US', 'NA']);
    const seattleUser = new Set(['US-NW', 'US-WC', 'US-W', 'US', 'NA']);
    const parisUser = new Set(['FR', 'EU']);

    // Austin user gets all three: direct SE match, country match,
    // and continent match.
    expect(isSpeciesInRegion(0, austinUser, table)).toBe(true);
    expect(isSpeciesInRegion(1, austinUser, table)).toBe(true);
    expect(isSpeciesInRegion(2, austinUser, table)).toBe(true);

    // Seattle user misses species 0 (tagged only with SE ecoregions —
    // no 'US' bit to fall back on) but gets the broader two.
    expect(isSpeciesInRegion(0, seattleUser, table)).toBe(false);
    expect(isSpeciesInRegion(1, seattleUser, table)).toBe(true);
    expect(isSpeciesInRegion(2, seattleUser, table)).toBe(true);

    // Paris user gets none.
    expect(isSpeciesInRegion(0, parisUser, table)).toBe(false);
    expect(isSpeciesInRegion(1, parisUser, table)).toBe(false);
    expect(isSpeciesInRegion(2, parisUser, table)).toBe(false);
  });
});

describe('classifySpeciesInRegion', () => {
  it('distinguishes unknown from out-of-region', () => {
    const table = makeTable([[['NA']], [[]]]);
    const euUser = new Set(['EU']);
    // Species 0 has data but no match → out-of-region.
    expect(classifySpeciesInRegion(0, euUser, table)).toBe('out-of-region');
    // Species 1 has no data at all → unknown.
    expect(classifySpeciesInRegion(1, euUser, table)).toBe('unknown');
  });

  it('returns in-region on a hit', () => {
    const table = makeTable([[['NA']]]);
    expect(classifySpeciesInRegion(0, new Set(['NA']), table)).toBe('in-region');
  });
});

describe('popularityFor', () => {
  it('returns 0 for unknown / out-of-range indices', () => {
    const table = makeTable([[['NA'], 12345], [['AF'], 0]]);
    expect(table.popularityFor(1)).toBe(0);
    expect(table.popularityFor(-1)).toBe(0);
    expect(table.popularityFor(2)).toBe(0);
  });

  it('preserves the baked-in popularity score per label', () => {
    const table = makeTable([
      [['NA'], 20000], // popular bird
      [['NA'], 500],   // obscure bird
      [['NA']],        // unknown
    ]);
    expect(table.popularityFor(0)).toBe(20000);
    expect(table.popularityFor(1)).toBe(500);
    expect(table.popularityFor(2)).toBe(0);
  });
});
