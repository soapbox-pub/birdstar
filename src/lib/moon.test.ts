import { describe, it, expect } from "vitest";
import {
  moonPhase,
  moonPosition,
  nextPhase,
  upcomingPhases,
  type PrincipalPhase,
} from "./moon";

/**
 * Tests for the Moon ephemeris + phase-time computations in `./moon.ts`.
 *
 * The `nextPhase` / `upcomingPhases` tests below compare our output
 * against published principal-phase times from the U.S. Naval
 * Observatory's Astronomical Almanac. Our low-precision Meeus
 * implementation targets ~1 minute accuracy, so we allow 5 minutes
 * of slack to account for dropped higher-order corrections and the
 * UT1–TT offset we don't apply.
 */

/** Helper: assert two dates agree within `toleranceMinutes`. */
function expectWithinMinutes(
  actual: Date,
  expected: Date,
  toleranceMinutes: number,
) {
  const diffMs = Math.abs(actual.getTime() - expected.getTime());
  const diffMin = diffMs / 60_000;
  expect(
    diffMin,
    `Expected ${actual.toISOString()} to be within ${toleranceMinutes} min of ${expected.toISOString()}, was ${diffMin.toFixed(2)} min off`,
  ).toBeLessThanOrEqual(toleranceMinutes);
}

describe("moonPosition", () => {
  it("returns RA in [0, 24) and Dec in [-90, 90]", () => {
    const p = moonPosition(new Date("2026-04-26T00:00:00Z"));
    expect(p.ra).toBeGreaterThanOrEqual(0);
    expect(p.ra).toBeLessThan(24);
    expect(p.dec).toBeGreaterThanOrEqual(-90);
    expect(p.dec).toBeLessThanOrEqual(90);
  });

  it("places the Moon at a physically plausible distance", () => {
    // Earth–Moon distance varies between ~356,500 km (perigee) and
    // ~406,700 km (apogee). Some slack for the low-precision formula.
    const p = moonPosition(new Date("2026-04-26T00:00:00Z"));
    expect(p.distanceKm).toBeGreaterThan(355_000);
    expect(p.distanceKm).toBeLessThan(410_000);
  });

  it("gives an apparent diameter near half a degree", () => {
    const p = moonPosition(new Date("2026-04-26T00:00:00Z"));
    expect(p.angularDiameterDeg).toBeGreaterThan(0.48);
    expect(p.angularDiameterDeg).toBeLessThan(0.57);
  });
});

describe("moonPhase", () => {
  it("returns illumination in [0, 1]", () => {
    const p = moonPhase(new Date("2026-04-26T00:00:00Z"));
    expect(p.illumination).toBeGreaterThanOrEqual(0);
    expect(p.illumination).toBeLessThanOrEqual(1);
  });

  it("places new moon near zero illumination", () => {
    // 2026-01-18 19:52 UT: published new-moon time.
    const p = moonPhase(new Date("2026-01-18T19:52:00Z"));
    expect(p.illumination).toBeLessThan(0.01);
  });

  it("places full moon near full illumination", () => {
    // 2026-01-03 10:03 UT: published full-moon time.
    const p = moonPhase(new Date("2026-01-03T10:03:00Z"));
    expect(p.illumination).toBeGreaterThan(0.99);
  });

  it("marks a waxing moon between new and full", () => {
    // One week after new moon in Jan 2026: should be waxing gibbous-ish.
    const p = moonPhase(new Date("2026-01-25T12:00:00Z"));
    expect(p.waxing).toBe(true);
    expect(p.illumination).toBeGreaterThan(0.2);
    expect(p.illumination).toBeLessThan(0.8);
  });
});

describe("nextPhase", () => {
  it("finds a new moon that matches USNO to within 5 minutes", () => {
    // USNO: 2026 Jan 18 at 19:52 UT
    const after = new Date("2026-01-10T00:00:00Z");
    const got = nextPhase(after, "new");
    expectWithinMinutes(got, new Date("2026-01-18T19:52:00Z"), 5);
  });

  it("finds a full moon that matches USNO to within 5 minutes", () => {
    // USNO: 2026 Jan 3 at 10:03 UT
    const after = new Date("2025-12-25T00:00:00Z");
    const got = nextPhase(after, "full");
    expectWithinMinutes(got, new Date("2026-01-03T10:03:00Z"), 5);
  });

  it("finds a first quarter that matches USNO to within 5 minutes", () => {
    // USNO: 2026 Jan 26 at 04:47 UT
    const after = new Date("2026-01-20T00:00:00Z");
    const got = nextPhase(after, "first-quarter");
    expectWithinMinutes(got, new Date("2026-01-26T04:47:00Z"), 5);
  });

  it("finds a last quarter that matches USNO to within 5 minutes", () => {
    // USNO: 2026 Jan 10 at 15:48 UT
    const after = new Date("2026-01-05T00:00:00Z");
    const got = nextPhase(after, "last-quarter");
    expectWithinMinutes(got, new Date("2026-01-10T15:48:00Z"), 5);
  });

  it("always returns a date strictly after the `after` argument", () => {
    // A date that happens to be exactly at a new moon shouldn't return
    // that same new moon — it should return the next one (~29.5 d later).
    const exactNew = new Date("2026-01-18T19:52:00Z");
    const phases: PrincipalPhase[] = [
      "new",
      "first-quarter",
      "full",
      "last-quarter",
    ];
    for (const p of phases) {
      const got = nextPhase(exactNew, p);
      expect(got.getTime()).toBeGreaterThan(exactNew.getTime());
    }
  });

  it("handles dates far from J2000 without blowing up", () => {
    // Well past the J2000 epoch, the corrections are still under a few
    // minutes — confirm we don't introduce any sign errors at the edges.
    const future = new Date("2100-07-04T00:00:00Z");
    const got = nextPhase(future, "full");
    expect(got.getTime()).toBeGreaterThan(future.getTime());
    expect(got.getTime() - future.getTime()).toBeLessThan(40 * 86400_000); // <40 d
  });
});

describe("upcomingPhases", () => {
  it("returns phases in strictly increasing chronological order", () => {
    const phases = upcomingPhases(new Date("2026-04-26T00:00:00Z"), 8);
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].date.getTime()).toBeGreaterThan(
        phases[i - 1].date.getTime(),
      );
    }
  });

  it("returns exactly the requested number of phases", () => {
    expect(upcomingPhases(new Date("2026-04-26T00:00:00Z"), 4)).toHaveLength(4);
    expect(upcomingPhases(new Date("2026-04-26T00:00:00Z"), 8)).toHaveLength(8);
  });

  it("covers one full lunation within its first four entries", () => {
    const phases = upcomingPhases(new Date("2026-04-26T00:00:00Z"), 4);
    // The four principal phases span one lunation (~29.5 days), so the
    // gap from first to last of the four should be under ~30 days.
    const gap =
      phases[phases.length - 1].date.getTime() - phases[0].date.getTime();
    expect(gap).toBeLessThan(30 * 86400_000);
    // And includes all four distinct phase kinds.
    const kinds = new Set(phases.map((p) => p.phase));
    expect(kinds.size).toBe(4);
  });
});
