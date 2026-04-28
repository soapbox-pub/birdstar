// Upcoming total lunar eclipses — hardcoded from NASA's Five
// Millennium Catalog of Lunar Eclipses (Espenak & Meeus / GSFC).
// Mirrors the approach used for solar eclipses: a curated table
// rather than a computed ephemeris, because the canonical NASA
// catalog is the reference everyone compares against and it
// carries the totality-duration figure and visibility geometry
// that can't be derived without a substantial dedicated algorithm.
//
// Source: https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html
// "Eclipse Predictions by Fred Espenak and Jean Meeus (NASA's GSFC)"
//
// Scope:
//   * Type = T (total, a.k.a. "blood moon") only — no partial or
//     penumbral lunar eclipses. This matches how the Sun page
//     surfaces only central solar eclipses: the "blood moon" is
//     the travel-worthy spectacle of the three lunar-eclipse
//     classes, and listing the less dramatic types would dilute
//     the "rare and worth watching" framing.
//   * 2024 through 2060, inclusive — ~36 years of forward
//     coverage. Extend the table as needed; data through year
//     2100 is available from the source link.
//
// Times are the "TD of greatest eclipse" (Terrestrial Time). For
// modern dates the TD–UTC offset ΔT is ~74–110 seconds over this
// window — well below any relevance for a "when's the next one"
// readout.
//
// Unlike solar eclipses, a lunar eclipse is visible from *every*
// observer on the Moon-facing half of Earth at the moment of
// greatest eclipse. There is no narrow "path" to travel to: if
// the Moon is above your local horizon, you can see the whole
// event. The `visibilityDescription` field therefore names the
// continents / oceans that fall on the night side for each
// eclipse, rather than a central-line path.

/**
 * A single total lunar eclipse, distilled from the NASA catalog.
 */
export interface TotalLunarEclipse {
  /**
   * Instant of greatest eclipse (UTC, approximating TD without
   * the ~74–110-second ΔT correction — see file header).
   */
  date: Date;
  /**
   * Duration of totality — the Moon's traversal through Earth's
   * umbra, during which it takes on the characteristic
   * copper / "blood moon" colour — in seconds. NASA's catalog
   * lists this as "Total" phase duration in the "Phase
   * Durations" column.
   */
  totalityDurationSeconds: number;
  /**
   * Short human-readable description of the geographic regions
   * from which the eclipse is visible. Derived from the "greatest
   * in zenith" coordinates: the eclipse is visible wherever the
   * Moon is above the horizon, which is roughly the hemisphere
   * centred on the zenith point. Intentionally coarse (continent
   * / ocean scale).
   */
  visibilityDescription: string;
  /**
   * Latitude where the Moon is in the zenith at greatest eclipse
   * (degrees, north positive). Not surfaced in the UI but kept
   * for completeness / future map rendering.
   */
  zenithLatitude: number;
  /**
   * Longitude where the Moon is in the zenith at greatest eclipse
   * (degrees, east positive).
   */
  zenithLongitude: number;
  /**
   * Umbral magnitude (fraction of the Moon's diameter immersed
   * in the umbra at greatest eclipse). Values > 1.0 mean the
   * entire lunar disc is inside the umbra; the highest values
   * in our window (~1.85) mark the deepest, longest-totality
   * events of the century. Kept for astronomy enthusiasts /
   * future tooltip use; not surfaced in the default UI.
   */
  umbralMagnitude: number;
  /**
   * Saros series number — the 18-year-11-day cycle this eclipse
   * belongs to. Included for astronomy enthusiasts; not
   * surfaced in the default UI.
   */
  saros: number;
}

/**
 * The full table. Ordered chronologically. All times are UTC; the
 * constructor-style `Date.UTC` + `new Date(...)` pattern keeps
 * the timestamps independent of the runtime's local timezone.
 */
export const TOTAL_LUNAR_ECLIPSES: TotalLunarEclipse[] = [
  {
    date: new Date(Date.UTC(2025, 2, 14, 6, 59, 56)),
    totalityDurationSeconds: Math.round(65.4 * 60),
    visibilityDescription: "Americas, Pacific, western Europe and Africa",
    zenithLatitude: 3,
    zenithLongitude: -102,
    umbralMagnitude: 1.1784,
    saros: 123,
  },
  {
    date: new Date(Date.UTC(2025, 8, 7, 18, 12, 58)),
    totalityDurationSeconds: Math.round(82.1 * 60),
    visibilityDescription: "Europe, Africa, Asia, Australia, western Pacific",
    zenithLatitude: -6,
    zenithLongitude: 87,
    umbralMagnitude: 1.3619,
    saros: 128,
  },
  {
    date: new Date(Date.UTC(2026, 2, 3, 11, 34, 52)),
    totalityDurationSeconds: Math.round(58.3 * 60),
    visibilityDescription: "Pacific, East Asia, Australia, western Americas",
    zenithLatitude: 6,
    zenithLongitude: -171,
    umbralMagnitude: 1.1507,
    saros: 133,
  },
  {
    date: new Date(Date.UTC(2028, 11, 31, 16, 53, 15)),
    totalityDurationSeconds: Math.round(71.3 * 60),
    visibilityDescription: "Europe, Africa, Asia, Australia",
    zenithLatitude: 23,
    zenithLongitude: 108,
    umbralMagnitude: 1.2463,
    saros: 125,
  },
  {
    date: new Date(Date.UTC(2029, 5, 26, 3, 23, 22)),
    totalityDurationSeconds: Math.round(101.9 * 60),
    // This is the longest total lunar eclipse between 2025 and 2060 —
    // nearly 102 minutes of totality, with an umbral magnitude of
    // 1.84 (deepest of the century). Worth watching closely.
    visibilityDescription: "Americas, western Europe, western Africa",
    zenithLatitude: -23,
    zenithLongitude: -50,
    umbralMagnitude: 1.8436,
    saros: 130,
  },
  {
    date: new Date(Date.UTC(2029, 11, 20, 22, 43, 12)),
    totalityDurationSeconds: Math.round(53.7 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: 23,
    zenithLongitude: 19,
    umbralMagnitude: 1.1174,
    saros: 135,
  },
  {
    date: new Date(Date.UTC(2032, 3, 25, 15, 14, 51)),
    totalityDurationSeconds: Math.round(65.5 * 60),
    visibilityDescription: "Asia, Australia, western Pacific, east Africa",
    zenithLatitude: -14,
    zenithLongitude: 131,
    umbralMagnitude: 1.1913,
    saros: 122,
  },
  {
    date: new Date(Date.UTC(2032, 9, 18, 19, 3, 40)),
    totalityDurationSeconds: Math.round(47.1 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: 10,
    zenithLongitude: 71,
    umbralMagnitude: 1.1028,
    saros: 127,
  },
  {
    date: new Date(Date.UTC(2033, 3, 14, 19, 13, 51)),
    totalityDurationSeconds: Math.round(49.2 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: -9,
    zenithLongitude: 72,
    umbralMagnitude: 1.0944,
    saros: 132,
  },
  {
    date: new Date(Date.UTC(2033, 9, 8, 10, 56, 23)),
    totalityDurationSeconds: Math.round(78.8 * 60),
    visibilityDescription: "Pacific, Americas, East Asia, Australia",
    zenithLatitude: 6,
    zenithLongitude: -167,
    umbralMagnitude: 1.3497,
    saros: 137,
  },
  {
    date: new Date(Date.UTC(2036, 1, 11, 22, 13, 6)),
    totalityDurationSeconds: Math.round(74.5 * 60),
    visibilityDescription: "Europe, Africa, western Asia, Americas",
    zenithLatitude: 14,
    zenithLongitude: 31,
    umbralMagnitude: 1.2995,
    saros: 124,
  },
  {
    date: new Date(Date.UTC(2036, 7, 7, 2, 52, 32)),
    totalityDurationSeconds: Math.round(95.3 * 60),
    visibilityDescription: "Americas, western Europe, western Africa",
    zenithLatitude: -16,
    zenithLongitude: -41,
    umbralMagnitude: 1.4544,
    saros: 129,
  },
  {
    date: new Date(Date.UTC(2037, 0, 31, 14, 1, 38)),
    totalityDurationSeconds: Math.round(63.7 * 60),
    visibilityDescription: "Asia, Australia, western Pacific",
    zenithLatitude: 18,
    zenithLongitude: 153,
    umbralMagnitude: 1.2074,
    saros: 134,
  },
  {
    date: new Date(Date.UTC(2040, 4, 26, 11, 46, 22)),
    totalityDurationSeconds: Math.round(92.2 * 60),
    visibilityDescription: "Pacific, Australia, East Asia, western Americas",
    zenithLatitude: -21,
    zenithLongitude: -177,
    umbralMagnitude: 1.5348,
    saros: 131,
  },
  {
    date: new Date(Date.UTC(2040, 10, 18, 19, 4, 40)),
    totalityDurationSeconds: Math.round(87.8 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: 20,
    zenithLongitude: 70,
    umbralMagnitude: 1.3974,
    saros: 136,
  },
  {
    date: new Date(Date.UTC(2043, 2, 25, 14, 32, 4)),
    totalityDurationSeconds: Math.round(53.4 * 60),
    visibilityDescription: "Asia, Australia, western Pacific, eastern Africa",
    zenithLatitude: -2,
    zenithLongitude: 144,
    umbralMagnitude: 1.1142,
    saros: 123,
  },
  {
    date: new Date(Date.UTC(2043, 8, 19, 1, 51, 50)),
    totalityDurationSeconds: Math.round(71.7 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: -2,
    zenithLongitude: -29,
    umbralMagnitude: 1.2556,
    saros: 128,
  },
  {
    date: new Date(Date.UTC(2044, 2, 13, 19, 38, 33)),
    totalityDurationSeconds: Math.round(66.4 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: 2,
    zenithLongitude: 68,
    umbralMagnitude: 1.2031,
    saros: 133,
  },
  {
    date: new Date(Date.UTC(2044, 8, 7, 11, 20, 44)),
    totalityDurationSeconds: Math.round(33.9 * 60),
    visibilityDescription: "Pacific, East Asia, Australia, western Americas",
    zenithLatitude: -5,
    zenithLongitude: -171,
    umbralMagnitude: 1.0456,
    saros: 138,
  },
  {
    date: new Date(Date.UTC(2047, 0, 12, 1, 26, 14)),
    totalityDurationSeconds: Math.round(70.0 * 60),
    visibilityDescription: "Europe, Africa, western Asia, Americas",
    zenithLatitude: 22,
    zenithLongitude: -19,
    umbralMagnitude: 1.2341,
    saros: 125,
  },
  {
    date: new Date(Date.UTC(2047, 6, 7, 10, 35, 45)),
    totalityDurationSeconds: Math.round(100.8 * 60),
    visibilityDescription: "Pacific, Americas, East Asia, Australia",
    zenithLatitude: -23,
    zenithLongitude: -157,
    umbralMagnitude: 1.7513,
    saros: 130,
  },
  {
    date: new Date(Date.UTC(2048, 0, 1, 6, 53, 55)),
    totalityDurationSeconds: Math.round(55.9 * 60),
    visibilityDescription: "Europe, Africa, eastern Americas, western Asia",
    zenithLatitude: 23,
    zenithLongitude: -102,
    umbralMagnitude: 1.1280,
    saros: 135,
  },
  {
    date: new Date(Date.UTC(2050, 4, 6, 22, 32, 2)),
    totalityDurationSeconds: Math.round(43.2 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: -17,
    zenithLongitude: 21,
    umbralMagnitude: 1.0767,
    saros: 122,
  },
  {
    date: new Date(Date.UTC(2050, 9, 30, 3, 21, 47)),
    totalityDurationSeconds: Math.round(34.5 * 60),
    visibilityDescription: "Americas, western Europe, western Africa",
    zenithLatitude: 14,
    zenithLongitude: -54,
    umbralMagnitude: 1.0538,
    saros: 127,
  },
  {
    date: new Date(Date.UTC(2051, 3, 26, 2, 16, 28)),
    totalityDurationSeconds: Math.round(69.6 * 60),
    visibilityDescription: "Europe, Africa, western Asia, eastern Americas",
    zenithLatitude: -13,
    zenithLongitude: -34,
    umbralMagnitude: 1.2022,
    saros: 132,
  },
  {
    date: new Date(Date.UTC(2051, 9, 19, 19, 11, 50)),
    totalityDurationSeconds: Math.round(83.6 * 60),
    visibilityDescription: "Europe, Africa, Asia, Australia",
    zenithLatitude: 10,
    zenithLongitude: 69,
    umbralMagnitude: 1.4118,
    saros: 137,
  },
  {
    date: new Date(Date.UTC(2054, 1, 22, 6, 51, 27)),
    totalityDurationSeconds: Math.round(72.1 * 60),
    visibilityDescription: "Americas, Pacific, western Europe and Africa",
    zenithLatitude: 10,
    zenithLongitude: -99,
    umbralMagnitude: 1.2769,
    saros: 124,
  },
  {
    date: new Date(Date.UTC(2054, 7, 18, 9, 26, 30)),
    totalityDurationSeconds: Math.round(82.9 * 60),
    visibilityDescription: "Pacific, Americas, East Asia, Australia",
    zenithLatitude: -13,
    zenithLongitude: -140,
    umbralMagnitude: 1.3062,
    saros: 129,
  },
  {
    date: new Date(Date.UTC(2055, 1, 11, 22, 46, 17)),
    totalityDurationSeconds: Math.round(66.0 * 60),
    visibilityDescription: "Europe, Africa, western Asia, Americas",
    zenithLatitude: 14,
    zenithLongitude: 22,
    umbralMagnitude: 1.2246,
    saros: 134,
  },
  {
    date: new Date(Date.UTC(2058, 5, 6, 19, 15, 48)),
    totalityDurationSeconds: Math.round(97.3 * 60),
    visibilityDescription: "Europe, Africa, Asia, Australia",
    zenithLatitude: -23,
    zenithLongitude: 71,
    umbralMagnitude: 1.6611,
    saros: 131,
  },
  {
    date: new Date(Date.UTC(2058, 10, 30, 3, 16, 18)),
    totalityDurationSeconds: Math.round(89.7 * 60),
    visibilityDescription: "Americas, western Europe, western Africa",
    zenithLatitude: 22,
    zenithLongitude: -52,
    umbralMagnitude: 1.4260,
    saros: 136,
  },
];

/**
 * Return the next `count` total lunar eclipses strictly after
 * `after`, in chronological order. If the table runs out (i.e.
 * `after` is close to or past the last tabulated eclipse) the
 * returned array is shorter than `count`.
 *
 * Callers should inspect the returned length and surface an
 * "update the table" hint if the list is empty — otherwise the
 * UI will silently look broken deep in the 2060s. A short
 * fallback message is easier to notice than silence.
 */
export function upcomingTotalLunarEclipses(
  after: Date,
  count = 4,
): TotalLunarEclipse[] {
  const afterMs = after.getTime();
  const out: TotalLunarEclipse[] = [];
  for (const e of TOTAL_LUNAR_ECLIPSES) {
    if (e.date.getTime() <= afterMs) continue;
    out.push(e);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Format a totality duration (given in seconds) as a compact
 * `MmSSs` string — e.g. 3924 → "65m24s", 6114 → "101m54s". Used
 * in the Moon sheet's upcoming-eclipses list. Minutes are never
 * padded (lunar totality durations span ~25–105 min in our
 * table, all two- or three-digit), but seconds are zero-padded
 * so the column reads cleanly with a tabular-nums font.
 *
 * Deliberately a separate helper from the solar one: while the
 * formatting rules are identical, their natural units differ —
 * solar eclipses are "minutes and seconds of totality", lunar
 * eclipses are "tens of minutes to nearly two hours". Having
 * dedicated functions keeps the call sites self-documenting.
 */
export function formatLunarTotalityDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}
