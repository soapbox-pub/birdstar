import { describe, it, expect } from "vitest";
import {
  SOLAR_ECLIPSES,
  upcomingSolarEclipses,
  formatEclipseDuration,
  solarEclipseTypeLabel,
  solarEclipsePeakLabel,
  solarEclipseNasaCode,
} from "./solarEclipses";

/**
 * Integrity checks for the bundled NASA eclipse catalog and its
 * accessor helpers. The underlying data is hand-curated from
 * NASA/GSFC's Five Millennium Catalog, so the tests here mostly
 * guard against typos and accidental ordering breakage rather than
 * verifying the astronomy itself (which we trust NASA to have right).
 */

describe("SOLAR_ECLIPSES table", () => {
  it("is non-empty and strictly chronological", () => {
    expect(SOLAR_ECLIPSES.length).toBeGreaterThan(0);
    for (let i = 1; i < SOLAR_ECLIPSES.length; i++) {
      const prev = SOLAR_ECLIPSES[i - 1].date.getTime();
      const curr = SOLAR_ECLIPSES[i].date.getTime();
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("only contains total, annular, and hybrid types — no partials", () => {
    for (const e of SOLAR_ECLIPSES) {
      expect(["total", "annular", "hybrid"]).toContain(e.type);
    }
  });

  it("contains at least one eclipse of each surfaced type", () => {
    // The whole point of expanding past just totals is that the
    // other two types actually appear. If anyone accidentally
    // filters them out of the table this test will tell us.
    const types = new Set(SOLAR_ECLIPSES.map((e) => e.type));
    expect(types.has("total")).toBe(true);
    expect(types.has("annular")).toBe(true);
    expect(types.has("hybrid")).toBe(true);
  });

  it("has plausible durations for every entry", () => {
    // Modern central-eclipse durations:
    //   Totals:     up to ~7m30s at theoretical maximum.
    //   Annulars:   longer, up to ~12m30s.
    //   Hybrids:    typically < 2m.
    // A single generous 0s..13m envelope catches any grossly wrong
    // entry without false-positiving on legitimate edge cases. The
    // lower bound is 0 rather than a positive number because a few
    // entries in our window clock in around 21–22 seconds.
    for (const e of SOLAR_ECLIPSES) {
      expect(e.durationSeconds).toBeGreaterThan(0);
      expect(e.durationSeconds).toBeLessThan(13 * 60);
    }
  });

  it("has plausible greatest-eclipse coordinates", () => {
    for (const e of SOLAR_ECLIPSES) {
      expect(e.greatestLatitude).toBeGreaterThanOrEqual(-90);
      expect(e.greatestLatitude).toBeLessThanOrEqual(90);
      expect(e.greatestLongitude).toBeGreaterThanOrEqual(-180);
      expect(e.greatestLongitude).toBeLessThanOrEqual(180);
    }
  });

  it("has a non-empty path description for every entry", () => {
    for (const e of SOLAR_ECLIPSES) {
      expect(e.pathDescription.trim().length).toBeGreaterThan(0);
    }
  });

  it("puts 2024 April 8 at the expected moment (known reference eclipse)", () => {
    // The 2024-04-08 total solar eclipse is the best-known recent
    // event — greatest at 18:18 UT over central Mexico, with 4m28s
    // of totality. If this entry drifts, something's wrong with the
    // whole table.
    const first = SOLAR_ECLIPSES[0];
    expect(first.date.toISOString()).toBe("2024-04-08T18:18:29.000Z");
    expect(first.type).toBe("total");
    expect(first.durationSeconds).toBe(4 * 60 + 28);
  });

  it("includes the 2024 October 2 annular as the second entry", () => {
    // Sanity check that annulars are present, chronologically
    // correctly slotted, and carry the right type. The 2024-10-02
    // "ring of fire" over the South Pacific / southern South
    // America is the next central eclipse after 2024-04-08.
    const second = SOLAR_ECLIPSES[1];
    expect(second.date.toISOString()).toBe("2024-10-02T18:46:13.000Z");
    expect(second.type).toBe("annular");
  });
});

describe("upcomingSolarEclipses", () => {
  it("returns events strictly after the cutoff date", () => {
    const cutoff = new Date("2030-01-01T00:00:00Z");
    const got = upcomingSolarEclipses(cutoff, 4);
    expect(got.length).toBe(4);
    for (const e of got) {
      expect(e.date.getTime()).toBeGreaterThan(cutoff.getTime());
    }
  });

  it("returns events in chronological order", () => {
    const got = upcomingSolarEclipses(new Date("2024-01-01T00:00:00Z"), 10);
    for (let i = 1; i < got.length; i++) {
      expect(got[i].date.getTime()).toBeGreaterThan(got[i - 1].date.getTime());
    }
  });

  it("caps at `count` entries when the table has more", () => {
    const all = upcomingSolarEclipses(new Date("2024-01-01T00:00:00Z"), 200);
    const three = upcomingSolarEclipses(new Date("2024-01-01T00:00:00Z"), 3);
    expect(three.length).toBe(3);
    expect(all.length).toBeGreaterThan(three.length);
  });

  it("returns an empty array when the cutoff is past the last entry", () => {
    const last = SOLAR_ECLIPSES[SOLAR_ECLIPSES.length - 1];
    const afterLast = new Date(last.date.getTime() + 86400_000);
    expect(upcomingSolarEclipses(afterLast, 4)).toHaveLength(0);
  });

  it("finds the 2026 Feb 17 annular as the first one after 2025", () => {
    // Spot-check that the next central eclipse after the 2025
    // partials (which we don't list) is the 2026 Feb 17 annular
    // over Antarctica / southern Indian Ocean.
    const got = upcomingSolarEclipses(new Date("2025-11-01T00:00:00Z"), 1);
    expect(got).toHaveLength(1);
    expect(got[0].date.toISOString()).toBe("2026-02-17T12:13:06.000Z");
    expect(got[0].type).toBe("annular");
  });

  it("interleaves types correctly around the 2031 hybrid", () => {
    // The 2031 Nov 14 hybrid is one of only a handful in our
    // 2024–2060 window; make sure it appears at the expected slot.
    const got = upcomingSolarEclipses(new Date("2031-06-01T00:00:00Z"), 2);
    expect(got).toHaveLength(2);
    expect(got[0].date.toISOString()).toBe("2031-11-14T21:07:31.000Z");
    expect(got[0].type).toBe("hybrid");
  });
});

describe("formatEclipseDuration", () => {
  it("pads seconds to two digits", () => {
    expect(formatEclipseDuration(67)).toBe("1m07s");
    expect(formatEclipseDuration(60)).toBe("1m00s");
  });

  it("handles durations above a minute without padding the minutes field", () => {
    expect(formatEclipseDuration(4 * 60 + 28)).toBe("4m28s");
    expect(formatEclipseDuration(10 * 60 + 27)).toBe("10m27s");
  });

  it("handles sub-minute durations", () => {
    expect(formatEclipseDuration(59)).toBe("0m59s");
    expect(formatEclipseDuration(22)).toBe("0m22s");
  });
});

describe("label helpers", () => {
  it("returns distinct human labels for each type", () => {
    expect(solarEclipseTypeLabel("total")).toBe("Total solar eclipse");
    expect(solarEclipseTypeLabel("annular")).toBe("Annular solar eclipse");
    expect(solarEclipseTypeLabel("hybrid")).toBe("Hybrid solar eclipse");
  });

  it("returns distinct peak labels for each type", () => {
    expect(solarEclipsePeakLabel("total")).toBe("Totality");
    expect(solarEclipsePeakLabel("annular")).toBe("Annularity");
    expect(solarEclipsePeakLabel("hybrid")).toBe("Peak");
  });

  it("returns NASA URL codes matching their catalog suffix", () => {
    expect(solarEclipseNasaCode("total")).toBe("T");
    expect(solarEclipseNasaCode("annular")).toBe("A");
    expect(solarEclipseNasaCode("hybrid")).toBe("H");
  });
});
