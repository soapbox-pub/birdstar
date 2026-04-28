import { describe, it, expect } from 'vitest';
import {
  BAND_TO_DAMPING,
  BAND_TO_POPULARITY_BONUS,
  LOCAL_RADII_KM,
  coordKey,
  deserializeMap,
  distanceToBand,
  fetchLocalSpeciesBands,
  haversineKm,
  interpolateDamping,
  lookupLocal,
  serializeMap,
  type LocalSpeciesMap,
} from './localSpecies';

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm({ lat: 30, lon: -97 }, { lat: 30, lon: -97 })).toBe(0);
  });

  it('approximately matches 1° latitude ≈ 111 km at the equator', () => {
    const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    // Great-circle distance for 1° latitude is ~111.195 km regardless of longitude
    expect(d).toBeCloseTo(111.195, 0);
  });

  it('approximately matches Austin → Houston (~235 km)', () => {
    const austin = { lat: 30.27, lon: -97.74 };
    const houston = { lat: 29.76, lon: -95.37 };
    const d = haversineKm(austin, houston);
    expect(d).toBeGreaterThan(225);
    expect(d).toBeLessThan(245);
  });

  it('is symmetric', () => {
    const a = { lat: 52.52, lon: 13.4 };
    const b = { lat: -33.87, lon: 151.21 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe('distanceToBand', () => {
  it('assigns exact band boundaries to that band', () => {
    for (const radius of LOCAL_RADII_KM) {
      expect(distanceToBand(radius)).toBe(radius);
    }
  });

  it('assigns intermediate distances to the next-larger band', () => {
    expect(distanceToBand(0)).toBe(25);
    expect(distanceToBand(1)).toBe(25);
    expect(distanceToBand(26)).toBe(50);
    expect(distanceToBand(51)).toBe(100);
    expect(distanceToBand(150)).toBe(200);
    expect(distanceToBand(400)).toBe(500);
  });

  it('returns null beyond the outermost radius', () => {
    expect(distanceToBand(501)).toBeNull();
    expect(distanceToBand(10000)).toBeNull();
  });
});

describe('interpolateDamping', () => {
  it('anchors at each band boundary to its table value', () => {
    for (const radius of LOCAL_RADII_KM) {
      expect(interpolateDamping(radius)).toBeCloseTo(BAND_TO_DAMPING[radius], 10);
    }
  });

  it('clamps to the innermost band for distances <= first radius', () => {
    expect(interpolateDamping(0)).toBe(BAND_TO_DAMPING[LOCAL_RADII_KM[0]]);
    expect(interpolateDamping(10)).toBe(BAND_TO_DAMPING[LOCAL_RADII_KM[0]]);
  });

  it('clamps to the outermost band for distances >= last radius', () => {
    const last = LOCAL_RADII_KM[LOCAL_RADII_KM.length - 1];
    expect(interpolateDamping(last)).toBe(BAND_TO_DAMPING[last]);
    expect(interpolateDamping(5000)).toBe(BAND_TO_DAMPING[last]);
  });

  it('linearly interpolates between adjacent bands', () => {
    // Halfway between 25km (1.0) and 50km (0.85) should be ~0.925
    const mid25to50 = interpolateDamping(37.5);
    expect(mid25to50).toBeCloseTo(
      (BAND_TO_DAMPING[25] + BAND_TO_DAMPING[50]) / 2,
      6,
    );
    // Halfway between 50km (0.85) and 100km (0.70) should be ~0.775
    const mid50to100 = interpolateDamping(75);
    expect(mid50to100).toBeCloseTo(
      (BAND_TO_DAMPING[50] + BAND_TO_DAMPING[100]) / 2,
      6,
    );
  });

  it('returns 1 for invalid input (NaN / negative)', () => {
    expect(interpolateDamping(Number.NaN)).toBe(1);
    expect(interpolateDamping(-5)).toBe(1);
  });
});

describe('lookupLocal', () => {
  it('is case-insensitive on scientific name', () => {
    const map: LocalSpeciesMap = new Map([
      ['cardinalis cardinalis', { band: 25 as const, count: 42 }],
    ]);
    expect(lookupLocal(map, 'Cardinalis cardinalis')?.band).toBe(25);
    expect(lookupLocal(map, 'CARDINALIS CARDINALIS')?.band).toBe(25);
    expect(lookupLocal(map, 'cardinalis cardinalis')?.band).toBe(25);
  });

  it('returns undefined on miss or when the map is null/undefined', () => {
    const map: LocalSpeciesMap = new Map([
      ['cardinalis cardinalis', { band: 25 as const, count: 42 }],
    ]);
    expect(lookupLocal(map, 'Unknown bird')).toBeUndefined();
    expect(lookupLocal(null, 'Cardinalis cardinalis')).toBeUndefined();
    expect(lookupLocal(undefined, 'Cardinalis cardinalis')).toBeUndefined();
  });
});

describe('serialize / deserialize round trip', () => {
  it('preserves entries including nulls and all bands', () => {
    const original: LocalSpeciesMap = new Map([
      ['a. spp', { band: 25 as const, count: 10 }],
      ['b. spp', { band: 100 as const, count: 3 }],
      ['c. spp', { band: null, count: 0 }],
    ]);
    const serialized = serializeMap(original);
    const restored = deserializeMap(serialized);
    expect(restored.size).toBe(3);
    expect(restored.get('a. spp')).toEqual({ band: 25, count: 10 });
    expect(restored.get('b. spp')).toEqual({ band: 100, count: 3 });
    expect(restored.get('c. spp')).toEqual({ band: null, count: 0 });
  });

  it('drops malformed entries without crashing', () => {
    const restored = deserializeMap({
      good: { band: 50, count: 5 },
      'bad-band': { band: 999 as unknown as 25, count: 5 },
      'bad-count': { band: 25, count: 'oops' as unknown as number },
      // @ts-expect-error purposely malformed
      nil: null,
    });
    expect(restored.size).toBe(1);
    expect(restored.get('good')).toEqual({ band: 50, count: 5 });
  });
});

describe('coordKey', () => {
  it('produces a stable string key', () => {
    expect(coordKey(30, -97)).toBe('30,-97');
    expect(coordKey(-33, 151)).toBe('-33,151');
  });
});

describe('BAND_TO_POPULARITY_BONUS', () => {
  it('is strictly decreasing as band grows (closer = more bonus)', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const radius of LOCAL_RADII_KM) {
      const bonus = BAND_TO_POPULARITY_BONUS[radius];
      expect(bonus).toBeLessThan(prev);
      prev = bonus;
    }
  });
});

describe('BAND_TO_DAMPING', () => {
  it('is non-increasing as band grows (closer = less damping)', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const radius of LOCAL_RADII_KM) {
      const damp = BAND_TO_DAMPING[radius];
      expect(damp).toBeLessThanOrEqual(prev);
      prev = damp;
    }
  });

  it('innermost band is undamped (1.0)', () => {
    expect(BAND_TO_DAMPING[LOCAL_RADII_KM[0]]).toBe(1);
  });
});

describe('fetchLocalSpeciesBands (mocked fetch)', () => {
  it('assigns each species to its tightest band across nested radii', async () => {
    // Mock iNat responses per radius. Species "close_bird" appears at
    // 25 km; "mid_bird" at 100 km; "far_bird" at 500 km; "noise_bird"
    // nowhere (ignored by the fan-out).
    type MockResponse = {
      results: Array<{
        count: number;
        taxon: { id: number; name: string; rank: string };
      }>;
    };
    const byRadius: Record<number, MockResponse> = {
      25: {
        results: [
          { count: 500, taxon: { id: 1, name: 'Close_bird', rank: 'species' } },
        ],
      },
      50: {
        results: [
          { count: 510, taxon: { id: 1, name: 'Close_bird', rank: 'species' } },
        ],
      },
      100: {
        results: [
          { count: 600, taxon: { id: 1, name: 'Close_bird', rank: 'species' } },
          { count: 12, taxon: { id: 2, name: 'Mid_bird', rank: 'species' } },
        ],
      },
      200: {
        results: [
          { count: 700, taxon: { id: 1, name: 'Close_bird', rank: 'species' } },
          { count: 30, taxon: { id: 2, name: 'Mid_bird', rank: 'species' } },
        ],
      },
      500: {
        results: [
          { count: 1000, taxon: { id: 1, name: 'Close_bird', rank: 'species' } },
          { count: 60, taxon: { id: 2, name: 'Mid_bird', rank: 'species' } },
          { count: 3, taxon: { id: 3, name: 'Far_bird', rank: 'species' } },
          // Non-species rank should be skipped:
          { count: 99, taxon: { id: 4, name: 'Some genus', rank: 'genus' } },
        ],
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      const url = new URL(urlStr);
      const radius = Number(url.searchParams.get('radius'));
      const resp = byRadius[radius] ?? { results: [] };
      return new Response(JSON.stringify(resp), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const map = await fetchLocalSpeciesBands(30, -97);
      // Close_bird first seen at 25km → band 25.
      expect(map.get('close_bird')?.band).toBe(25);
      // Mid_bird first seen at 100km → band 100.
      expect(map.get('mid_bird')?.band).toBe(100);
      // Far_bird first seen at 500km → band 500.
      expect(map.get('far_bird')?.band).toBe(500);
      // Genus entry skipped.
      expect(map.has('some genus')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('tolerates fetch failures per-radius (silent fallback)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    try {
      const map = await fetchLocalSpeciesBands(30, -97);
      expect(map.size).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
