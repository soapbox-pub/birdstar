import { describe, it, expect } from 'vitest';
import {
  tierForHeardCount,
  BIRDEX_TIERS,
  UNLIMITED_TIER,
} from './useBirdex';

describe('tierForHeardCount', () => {
  it('starts at tier 1 with budget 10 for a fresh user', () => {
    expect(tierForHeardCount(0)).toEqual({ tier: 1, budget: 10 });
    expect(tierForHeardCount(9)).toEqual({ tier: 1, budget: 10 });
  });

  it('advances to tier 2 (budget 50) when tier 1 is cleared', () => {
    expect(tierForHeardCount(10)).toEqual({ tier: 2, budget: 50 });
    expect(tierForHeardCount(49)).toEqual({ tier: 2, budget: 50 });
  });

  it('advances to tier 3 (budget 150) when tier 2 is cleared', () => {
    expect(tierForHeardCount(50)).toEqual({ tier: 3, budget: 150 });
    expect(tierForHeardCount(149)).toEqual({ tier: 3, budget: 150 });
  });

  it('advances to tier 4 (budget 300) when tier 3 is cleared', () => {
    expect(tierForHeardCount(150)).toEqual({ tier: 4, budget: 300 });
    expect(tierForHeardCount(299)).toEqual({ tier: 4, budget: 300 });
  });

  it('returns the unlimited tier (Infinity budget) past 300', () => {
    expect(tierForHeardCount(300)).toEqual({
      tier: UNLIMITED_TIER,
      budget: Infinity,
    });
    expect(tierForHeardCount(9999)).toEqual({
      tier: UNLIMITED_TIER,
      budget: Infinity,
    });
  });

  it('UNLIMITED_TIER is exactly one past the configured ladder', () => {
    expect(UNLIMITED_TIER).toBe(BIRDEX_TIERS.length + 1);
  });

  it('BIRDEX_TIERS matches the product brief', () => {
    // This test exists specifically to catch accidental changes to the
    // tier ladder. The current 10/50/150/300 ladder was chosen
    // intentionally (household names → backyard birds → regional
    // regulars → "you know your area"); updating it is a UX call, not
    // a refactor.
    expect(BIRDEX_TIERS).toEqual([10, 50, 150, 300]);
  });
});
