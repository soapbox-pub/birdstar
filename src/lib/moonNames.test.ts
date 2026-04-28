import { describe, it, expect } from "vitest";
import { nextPhase } from "./moon";
import {
  MONTHLY_FULL_MOON_NAMES,
  describeFullMoon,
  fullMoonsInSeason,
  isHarvestMoon,
  isHuntersMoon,
  isTraditionalBlueMoon,
  seasonMarkers,
  seasonOf,
} from "./moonNames";

/**
 * Tests for src/lib/moonNames.ts.
 *
 * We compute full-moon dates via `nextPhase` (Meeus Ch. 49) rather
 * than hard-coding dates, so tests validate the *rules* not the
 * underlying ephemeris. Known cultural cases are used as anchors.
 */

/** Convenience: find the first full moon on or after `iso`. */
function firstFullAfter(iso: string): Date {
  // Go back 1 ms so a caller asking for an exact full-moon instant
  // still gets that very moon (nextPhase itself is strict forward).
  return nextPhase(new Date(new Date(iso).getTime() - 86400_000), "full");
}

describe("seasonMarkers", () => {
  it("returns four markers in the correct calendar year", () => {
    const m = seasonMarkers(2024);
    expect(m.marchEquinox.getUTCFullYear()).toBe(2024);
    expect(m.juneSolstice.getUTCFullYear()).toBe(2024);
    expect(m.septemberEquinox.getUTCFullYear()).toBe(2024);
    expect(m.decemberSolstice.getUTCFullYear()).toBe(2024);
  });

  it("places the March equinox near March 20", () => {
    const { marchEquinox } = seasonMarkers(2024);
    expect(marchEquinox.getUTCMonth()).toBe(2); // March (zero-indexed)
    // Typically March 19–21.
    expect(marchEquinox.getUTCDate()).toBeGreaterThanOrEqual(19);
    expect(marchEquinox.getUTCDate()).toBeLessThanOrEqual(21);
  });

  it("places the September equinox near September 22", () => {
    const { septemberEquinox } = seasonMarkers(2024);
    expect(septemberEquinox.getUTCMonth()).toBe(8); // September
    expect(septemberEquinox.getUTCDate()).toBeGreaterThanOrEqual(21);
    expect(septemberEquinox.getUTCDate()).toBeLessThanOrEqual(24);
  });
});

describe("seasonOf", () => {
  it("classifies a Jul 4 date as summer (northern)", () => {
    const { season } = seasonOf(new Date("2024-07-04T00:00:00Z"));
    expect(season).toBe("summer");
  });

  it("classifies a Dec 25 date as winter", () => {
    const { season } = seasonOf(new Date("2024-12-25T00:00:00Z"));
    expect(season).toBe("winter");
  });

  it("has start < end for every season", () => {
    for (const iso of [
      "2024-01-15T00:00:00Z",
      "2024-04-15T00:00:00Z",
      "2024-07-15T00:00:00Z",
      "2024-10-15T00:00:00Z",
    ]) {
      const { start, end } = seasonOf(new Date(iso));
      expect(start.getTime()).toBeLessThan(end.getTime());
    }
  });
});

describe("MONTHLY_FULL_MOON_NAMES", () => {
  it("has an entry for each month 1..12", () => {
    for (let m = 1; m <= 12; m++) {
      expect(MONTHLY_FULL_MOON_NAMES[m]).toBeDefined();
      expect(MONTHLY_FULL_MOON_NAMES[m].name).toBeTruthy();
    }
  });

  it("uses the culturally-canonical primary names", () => {
    // Spot-check the well-known ones.
    expect(MONTHLY_FULL_MOON_NAMES[1].name).toBe("Wolf Moon");
    expect(MONTHLY_FULL_MOON_NAMES[7].name).toBe("Buck Moon");
    expect(MONTHLY_FULL_MOON_NAMES[10].name).toBe("Hunter's Moon");
    expect(MONTHLY_FULL_MOON_NAMES[11].name).toBe("Beaver Moon");
    expect(MONTHLY_FULL_MOON_NAMES[12].name).toBe("Cold Moon");
  });
});

describe("fullMoonsInSeason", () => {
  it("finds the four full moons of summer 2021 (a blue-moon season)", () => {
    // Summer 2021: Jun 24, Jul 24, Aug 22, Sep 20 — four full moons.
    const moons = fullMoonsInSeason(new Date("2021-08-22T12:00:00Z"));
    expect(moons).toHaveLength(4);
    const months = moons.map((d) => d.getUTCMonth() + 1);
    expect(months).toEqual([6, 7, 8, 9]);
  });

  it("finds three full moons in a normal season", () => {
    // Winter 2023-24 (Dec 21 2023 – Mar 20 2024): Dec 27, Jan 25,
    // Feb 24 — three full moons. Summer 2024 is actually a four-
    // full-moon season (hence Aug 19 2024 was a traditional Blue
    // Moon), so we pick a boring three-moon winter instead.
    const moons = fullMoonsInSeason(new Date("2024-01-25T12:00:00Z"));
    expect(moons).toHaveLength(3);
  });
});

describe("isTraditionalBlueMoon", () => {
  it("flags Aug 22 2021 as a traditional Blue Moon", () => {
    const aug22 = firstFullAfter("2021-08-22T00:00:00Z");
    expect(isTraditionalBlueMoon(aug22)).toBe(true);
  });

  it("does not flag the July 2021 full moon (first of four)", () => {
    const jul24 = firstFullAfter("2021-07-24T00:00:00Z");
    expect(isTraditionalBlueMoon(jul24)).toBe(false);
  });

  it("does not flag the Sep 2021 full moon (fourth of four)", () => {
    const sep20 = firstFullAfter("2021-09-20T00:00:00Z");
    expect(isTraditionalBlueMoon(sep20)).toBe(false);
  });

  it("does not flag a plain full moon in a 3-full-moon season", () => {
    // Summer 2024 has three full moons; none is a Blue Moon.
    const jul21 = firstFullAfter("2024-07-21T00:00:00Z");
    expect(isTraditionalBlueMoon(jul21)).toBe(false);
  });
});

describe("isHarvestMoon", () => {
  it("flags the Sep 2024 full moon as Harvest", () => {
    // 2024: September equinox is Sep 22. Full moon Sep 18 is closer
    // to the equinox than Oct 17, so it's Harvest.
    const sep18 = firstFullAfter("2024-09-18T00:00:00Z");
    expect(isHarvestMoon(sep18)).toBe(true);
  });

  it("does not flag the Oct 2024 full moon as Harvest", () => {
    const oct17 = firstFullAfter("2024-10-17T00:00:00Z");
    expect(isHarvestMoon(oct17)).toBe(false);
  });

  it("correctly identifies years when Harvest is in October", () => {
    // 2020: Sep 2 full moon is 20 days before equinox; Oct 1 full
    // moon is 9 days after. October is closer — 2020's Harvest.
    const oct1 = firstFullAfter("2020-10-01T00:00:00Z");
    expect(isHarvestMoon(oct1)).toBe(true);
    const sep2 = firstFullAfter("2020-09-02T00:00:00Z");
    expect(isHarvestMoon(sep2)).toBe(false);
  });
});

describe("isHuntersMoon", () => {
  it("flags the October 2024 full moon as Hunter's (Harvest was Sep)", () => {
    const oct17 = firstFullAfter("2024-10-17T00:00:00Z");
    expect(isHuntersMoon(oct17)).toBe(true);
  });

  it("does not flag September 2024 as Hunter's (it's Harvest)", () => {
    const sep18 = firstFullAfter("2024-09-18T00:00:00Z");
    expect(isHuntersMoon(sep18)).toBe(false);
  });
});

describe("describeFullMoon", () => {
  it("returns the monthly name for an ordinary full moon", () => {
    // January 2024 full moon — should be the Wolf Moon, no overrides.
    const jan = firstFullAfter("2024-01-25T00:00:00Z");
    const d = describeFullMoon(jan);
    expect(d.name).toBe("Wolf Moon");
    expect(d.isBlueMoon).toBe(false);
    expect(d.isHarvest).toBe(false);
    expect(d.isHunters).toBe(false);
  });

  it("names the 2024 September full moon 'Harvest Moon'", () => {
    const sep = firstFullAfter("2024-09-18T00:00:00Z");
    const d = describeFullMoon(sep);
    expect(d.name).toBe("Harvest Moon");
    expect(d.isHarvest).toBe(true);
    // The underlying 'Corn Moon' should appear in altNames.
    expect(d.altNames).toContain("Corn Moon");
  });

  it("names the 2024 October full moon 'Hunter's Moon'", () => {
    const oct = firstFullAfter("2024-10-17T00:00:00Z");
    const d = describeFullMoon(oct);
    expect(d.name).toBe("Hunter's Moon");
    expect(d.isHunters).toBe(true);
  });

  it("names the Aug 22 2021 full moon 'Blue Moon' (overrides monthly name)", () => {
    const aug = firstFullAfter("2021-08-22T00:00:00Z");
    const d = describeFullMoon(aug);
    expect(d.name).toBe("Blue Moon");
    expect(d.isBlueMoon).toBe(true);
    // Traditional Sturgeon name should appear as an alt.
    expect(d.altNames).toContain("Sturgeon Moon");
  });

  it("supplies a Wikipedia article title for every named moon", () => {
    for (let m = 1; m <= 12; m++) {
      // Pick a date in the given month of 2024 and find the full moon.
      // Some months of 2024 may or may not contain a full moon — skip
      // the lookup and just check the monthly table directly.
      expect(MONTHLY_FULL_MOON_NAMES[m].wikipediaTitle).toBeTruthy();
    }
  });
});
