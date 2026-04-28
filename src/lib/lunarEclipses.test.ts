import { describe, it, expect } from "vitest";
import {
  TOTAL_LUNAR_ECLIPSES,
  upcomingTotalLunarEclipses,
  formatLunarTotalityDuration,
} from "./lunarEclipses";

/**
 * Integrity checks for the bundled NASA lunar eclipse catalog and
 * its accessor helpers. The underlying data is hand-curated from
 * NASA/GSFC's Five Millennium Catalog, so the tests here mostly
 * guard against typos and accidental ordering breakage rather than
 * verifying the astronomy itself (which we trust NASA to have right).
 */

describe("TOTAL_LUNAR_ECLIPSES table", () => {
  it("is non-empty and strictly chronological", () => {
    expect(TOTAL_LUNAR_ECLIPSES.length).toBeGreaterThan(0);
    for (let i = 1; i < TOTAL_LUNAR_ECLIPSES.length; i++) {
      const prev = TOTAL_LUNAR_ECLIPSES[i - 1].date.getTime();
      const curr = TOTAL_LUNAR_ECLIPSES[i].date.getTime();
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("has plausible totality durations for every entry", () => {
    // Modern total lunar eclipses last 20 minutes to ~105 minutes
    // of total umbral phase. Anything outside 15m..110m would
    // indicate a data-entry error.
    for (const e of TOTAL_LUNAR_ECLIPSES) {
      expect(e.totalityDurationSeconds).toBeGreaterThan(15 * 60);
      expect(e.totalityDurationSeconds).toBeLessThan(110 * 60);
    }
  });

  it("has plausible umbral magnitudes (> 1.0 for every total)", () => {
    // A total lunar eclipse by definition has the full Moon within
    // Earth's umbra, which corresponds to an umbral magnitude of
    // at least 1.0. Anything below 1.0 would be a partial, not a
    // total — which would be a mis-typed row.
    for (const e of TOTAL_LUNAR_ECLIPSES) {
      expect(e.umbralMagnitude).toBeGreaterThan(1.0);
      // Deepest total lunar eclipse of the 21st century has
      // magnitude ~1.84; keep a comfortable upper bound.
      expect(e.umbralMagnitude).toBeLessThan(2.0);
    }
  });

  it("has plausible zenith-point coordinates", () => {
    for (const e of TOTAL_LUNAR_ECLIPSES) {
      expect(e.zenithLatitude).toBeGreaterThanOrEqual(-90);
      expect(e.zenithLatitude).toBeLessThanOrEqual(90);
      expect(e.zenithLongitude).toBeGreaterThanOrEqual(-180);
      expect(e.zenithLongitude).toBeLessThanOrEqual(180);
    }
  });

  it("has a non-empty visibility description for every entry", () => {
    for (const e of TOTAL_LUNAR_ECLIPSES) {
      expect(e.visibilityDescription.trim().length).toBeGreaterThan(0);
    }
  });

  it("puts 2025 March 14 at the expected moment (first entry)", () => {
    // The 2025-03-14 total lunar eclipse is the next total after
    // the 2022-11-08 one, greatest at 06:59 UT over the Pacific.
    // If this entry drifts, something's wrong with the whole table.
    const first = TOTAL_LUNAR_ECLIPSES[0];
    expect(first.date.toISOString()).toBe("2025-03-14T06:59:56.000Z");
    // Totality of ~65.4 minutes from NASA.
    expect(first.totalityDurationSeconds).toBeGreaterThanOrEqual(65 * 60);
    expect(first.totalityDurationSeconds).toBeLessThanOrEqual(66 * 60);
  });

  it("includes the 2029 Jun 26 century-longest eclipse", () => {
    // The 2029-06-26 total lunar eclipse is the longest total of
    // the 21st century, nearly 102 minutes of totality and an
    // umbral magnitude of ~1.84. Good anchor point for the table.
    const found = TOTAL_LUNAR_ECLIPSES.find(
      (e) => e.date.toISOString() === "2029-06-26T03:23:22.000Z",
    );
    expect(found).toBeDefined();
    expect(found!.totalityDurationSeconds).toBeGreaterThan(100 * 60);
    expect(found!.umbralMagnitude).toBeGreaterThan(1.8);
  });
});

describe("upcomingTotalLunarEclipses", () => {
  it("returns events strictly after the cutoff date", () => {
    const cutoff = new Date("2030-01-01T00:00:00Z");
    const got = upcomingTotalLunarEclipses(cutoff, 4);
    expect(got.length).toBe(4);
    for (const e of got) {
      expect(e.date.getTime()).toBeGreaterThan(cutoff.getTime());
    }
  });

  it("returns events in chronological order", () => {
    const got = upcomingTotalLunarEclipses(
      new Date("2025-01-01T00:00:00Z"),
      8,
    );
    for (let i = 1; i < got.length; i++) {
      expect(got[i].date.getTime()).toBeGreaterThan(got[i - 1].date.getTime());
    }
  });

  it("caps at `count` entries when the table has more", () => {
    const all = upcomingTotalLunarEclipses(
      new Date("2025-01-01T00:00:00Z"),
      100,
    );
    const three = upcomingTotalLunarEclipses(
      new Date("2025-01-01T00:00:00Z"),
      3,
    );
    expect(three.length).toBe(3);
    expect(all.length).toBeGreaterThan(three.length);
  });

  it("returns an empty array when the cutoff is past the last entry", () => {
    const last = TOTAL_LUNAR_ECLIPSES[TOTAL_LUNAR_ECLIPSES.length - 1];
    const afterLast = new Date(last.date.getTime() + 86400_000);
    expect(upcomingTotalLunarEclipses(afterLast, 4)).toHaveLength(0);
  });

  it("finds the 2025 March 14 eclipse as the first one in 2025", () => {
    const got = upcomingTotalLunarEclipses(
      new Date("2025-01-01T00:00:00Z"),
      1,
    );
    expect(got).toHaveLength(1);
    expect(got[0].date.toISOString()).toBe("2025-03-14T06:59:56.000Z");
  });
});

describe("formatLunarTotalityDuration", () => {
  it("pads seconds to two digits", () => {
    expect(formatLunarTotalityDuration(67)).toBe("1m07s");
    expect(formatLunarTotalityDuration(60)).toBe("1m00s");
  });

  it("handles large durations without padding the minutes field", () => {
    // 65.4 minutes → 3924 seconds → "65m24s".
    expect(formatLunarTotalityDuration(Math.round(65.4 * 60))).toBe("65m24s");
    // 101.9 minutes → 6114 seconds → "101m54s".
    expect(formatLunarTotalityDuration(Math.round(101.9 * 60))).toBe("101m54s");
  });

  it("handles sub-minute durations", () => {
    expect(formatLunarTotalityDuration(45)).toBe("0m45s");
  });
});
