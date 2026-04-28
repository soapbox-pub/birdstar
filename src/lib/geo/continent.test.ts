import { describe, it, expect } from 'vitest';
import { REGION, regionToMask, resolveContinent } from './continent';

describe('resolveContinent', () => {
  it('resolves a handful of major cities to their continent', () => {
    // Each case: [label, lat, lon, expected]. Coordinates are intentionally
    // center-of-country rather than on contested borders.
    const cases: Array<[string, number, number, ReturnType<typeof resolveContinent>]> = [
      ['New York', 40.71, -74.01, 'NA'],
      ['Mexico City', 19.43, -99.13, 'NA'],
      ['Honolulu', 21.31, -157.86, 'NA'],
      ['São Paulo', -23.55, -46.63, 'SA'],
      ['Buenos Aires', -34.6, -58.38, 'SA'],
      ['London', 51.5, -0.13, 'EU'],
      ['Berlin', 52.52, 13.4, 'EU'],
      ['Reykjavík', 64.13, -21.82, 'EU'],
      ['Nairobi', -1.29, 36.82, 'AF'],
      ['Cairo', 30.04, 31.24, 'AF'],
      ['Tokyo', 35.68, 139.69, 'AS'],
      ['Mumbai', 19.08, 72.88, 'AS'],
      ['Sydney', -33.87, 151.21, 'OC'],
      ['Auckland', -36.85, 174.76, 'OC'],
      ['McMurdo', -77.85, 166.67, 'AN'],
    ];

    for (const [label, lat, lon, expected] of cases) {
      expect(resolveContinent(lat, lon), `${label}`).toBe(expected);
    }
  });

  it('returns null for invalid coordinates', () => {
    expect(resolveContinent(Number.NaN, 0)).toBeNull();
    expect(resolveContinent(0, Number.NaN)).toBeNull();
    expect(resolveContinent(91, 0)).toBeNull();
    expect(resolveContinent(-91, 0)).toBeNull();
  });

  it('handles longitudes wrapped outside [-180, 180]', () => {
    // 200° == -160°, which is mid-Pacific south of the equator.
    // Should still return some valid region, not null.
    const r = resolveContinent(-20, 200);
    expect(r).not.toBeNull();
  });
});

describe('regionToMask', () => {
  it('round-trips through REGION', () => {
    expect(regionToMask('NA')).toBe(REGION.NA);
    expect(regionToMask('AS')).toBe(REGION.AS);
    expect(regionToMask('MARINE')).toBe(REGION.MARINE);
  });

  it('produces distinct bits for every region', () => {
    const bits = Object.values(REGION);
    const unique = new Set(bits);
    expect(unique.size).toBe(bits.length);
    // All bits should be powers of two.
    for (const bit of bits) {
      expect(bit & (bit - 1)).toBe(0);
      expect(bit).toBeGreaterThan(0);
    }
  });
});
