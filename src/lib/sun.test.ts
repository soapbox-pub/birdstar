import { describe, it, expect } from "vitest";
import { sunPosition } from "./sun";

/**
 * Tests for the Sun ephemeris in `./sun.ts`. Expected values come
 * from the U.S. Naval Observatory's Astronomical Almanac / NASA
 * factsheet; the Meeus Ch. 25 algorithm is good to ~0.01°.
 */

describe("sunPosition", () => {
  it("returns RA in [0, 24) and Dec in [-90, 90]", () => {
    const p = sunPosition(new Date("2026-04-26T00:00:00Z"));
    expect(p.ra).toBeGreaterThanOrEqual(0);
    expect(p.ra).toBeLessThan(24);
    expect(p.dec).toBeGreaterThanOrEqual(-90);
    expect(p.dec).toBeLessThanOrEqual(90);
  });

  it("bounds declination by the obliquity of the ecliptic (~±23.44°)", () => {
    // Sample the Sun's declination across a full year; it should
    // always be within the obliquity limits with a hair of slack.
    const start = new Date("2026-01-01T00:00:00Z");
    let minDec = 90;
    let maxDec = -90;
    for (let d = 0; d < 366; d++) {
      const t = new Date(start.getTime() + d * 86400000);
      const dec = sunPosition(t).dec;
      if (dec < minDec) minDec = dec;
      if (dec > maxDec) maxDec = dec;
    }
    expect(maxDec).toBeGreaterThan(23.0);
    expect(maxDec).toBeLessThan(23.6);
    expect(minDec).toBeLessThan(-23.0);
    expect(minDec).toBeGreaterThan(-23.6);
  });

  it("places the Sun at a physically plausible distance (~1 AU)", () => {
    // Earth-Sun distance varies between ~0.9833 AU (perihelion) and
    // ~1.0167 AU (aphelion). Allow a hair of slack for the low-
    // precision series.
    const p = sunPosition(new Date("2026-04-26T00:00:00Z"));
    expect(p.distanceAu).toBeGreaterThan(0.98);
    expect(p.distanceAu).toBeLessThan(1.02);
  });

  it("gives an apparent diameter near half a degree", () => {
    const p = sunPosition(new Date("2026-04-26T00:00:00Z"));
    expect(p.angularDiameterDeg).toBeGreaterThan(0.52);
    expect(p.angularDiameterDeg).toBeLessThan(0.55);
  });

  it("puts the Sun near Dec 0 around the equinoxes", () => {
    // 2026 March equinox: March 20. The Sun's declination crosses
    // zero northward within a few hours of the event.
    const p = sunPosition(new Date("2026-03-20T14:45:00Z"));
    expect(Math.abs(p.dec)).toBeLessThan(0.05); // <3 arcminutes
  });

  it("peaks near Dec +23.4° at the June solstice", () => {
    const p = sunPosition(new Date("2026-06-21T08:24:00Z"));
    expect(p.dec).toBeGreaterThan(23.3);
    expect(p.dec).toBeLessThan(23.5);
  });
});
