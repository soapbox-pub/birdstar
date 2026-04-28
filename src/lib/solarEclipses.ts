// Upcoming solar eclipses — hardcoded from NASA's Five Millennium
// Catalog of Solar Eclipses (Espenak / GSFC). We deliberately use a
// curated table rather than computing eclipse circumstances from a
// lunar ephemeris: the canonical catalog includes path geometry and
// duration values that can't be derived without a substantial
// dedicated algorithm, and NASA's tabulated values are the reference
// everyone else compares against.
//
// Source: https://eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html
// "Eclipse Predictions by Fred Espenak (NASA's GSFC)"
//
// Scope:
//   * All three "travel-worthy" central eclipse types — Total (T),
//     Annular (A), and Hybrid (H). Partial eclipses (type P) are
//     deliberately excluded: they're geometrically common, visually
//     far less impressive, and don't belong on a list framed around
//     "pack a bag and go see it".
//   * Central eclipses with two limits only. A handful of non-central
//     / single-limit edge-case eclipses in the 2024–2060 window are
//     skipped (2043 Apr 09 T+, 2043 Oct 03 A-, 2044 Feb 28 As) —
//     they have no tabulated central-line duration and their "paths"
//     are grazing arcs that don't map cleanly to a country list.
//   * 2024 through 2060, inclusive — ~36 years of forward coverage.
//     Extend the table as needed; data through year 2100 is
//     available from the source link.
//
// Times are the "TD of greatest eclipse" (Terrestrial Time, the
// instant the Moon's shadow axis passes closest to Earth's centre).
// For modern dates the TD–UTC offset ΔT is about 69–95 seconds over
// this window — well below any relevance for a "when's the next one"
// readout.

/**
 * The three central eclipse types we surface. Matches NASA's one-
 * letter classification:
 *
 *   - "total":   Moon's umbral shadow touches Earth; the solar disc
 *                is completely covered along the central path.
 *   - "annular": Moon's antumbral shadow touches Earth; the Moon is
 *                too far from Earth to fully cover the Sun, leaving
 *                a bright "ring of fire" along the central path.
 *   - "hybrid":  The eclipse is total along some parts of the path
 *                and annular along others. Very rare (~3% of solar
 *                eclipses).
 *
 * Partial eclipses are intentionally *not* modelled here.
 */
export type SolarEclipseType = "total" | "annular" | "hybrid";

/**
 * A single central solar eclipse, distilled from the NASA catalog.
 */
export interface SolarEclipse {
  /**
   * Instant of greatest eclipse (UTC, approximating TD without the
   * ~70–95-second ΔT correction — see file header).
   */
  date: Date;
  /** Central-eclipse type. See `SolarEclipseType`. */
  type: SolarEclipseType;
  /**
   * Maximum duration of the central-line event, in seconds. For
   * totals this is the duration of totality; for annulars it is
   * the duration of annularity (the "ring of fire" visibility
   * window). For hybrids it is the duration at the point of
   * greatest eclipse — which may itself be either total or
   * annular depending on where along the path greatest eclipse
   * falls, but in every case is "the most an observer at one fixed
   * site will experience". Actual duration for any single viewer
   * is at most this value.
   */
  durationSeconds: number;
  /**
   * Short human-readable description of the geographic regions the
   * central path crosses. Drawn from the NASA map for each eclipse;
   * intentionally coarse (country / region level) because the sheet
   * is a planning-overview view, not a trip planner.
   */
  pathDescription: string;
  /** Latitude of greatest eclipse (degrees, north positive). */
  greatestLatitude: number;
  /** Longitude of greatest eclipse (degrees, east positive). */
  greatestLongitude: number;
  /**
   * Saros series number — the 18-year-11-day cycle this eclipse
   * belongs to. Included for astronomy enthusiasts; not surfaced
   * in the default UI.
   */
  saros: number;
}

/**
 * The full table. Ordered chronologically. All times are UTC; the
 * constructor-style `Date.UTC` + `new Date(...)` pattern keeps the
 * timestamps independent of the runtime's local timezone.
 */
export const SOLAR_ECLIPSES: SolarEclipse[] = [
  {
    date: new Date(Date.UTC(2024, 3, 8, 18, 18, 29)),
    type: "total",
    durationSeconds: 4 * 60 + 28,
    pathDescription: "Mexico, central USA, eastern Canada",
    greatestLatitude: 25,
    greatestLongitude: -104,
    saros: 139,
  },
  {
    date: new Date(Date.UTC(2024, 9, 2, 18, 46, 13)),
    type: "annular",
    durationSeconds: 7 * 60 + 25,
    pathDescription: "Southern Chile, southern Argentina, South Pacific",
    greatestLatitude: -22,
    greatestLongitude: -114,
    saros: 144,
  },
  {
    date: new Date(Date.UTC(2026, 1, 17, 12, 13, 6)),
    type: "annular",
    durationSeconds: 2 * 60 + 20,
    pathDescription: "Antarctica, southern Indian Ocean",
    greatestLatitude: -65,
    greatestLongitude: 87,
    saros: 121,
  },
  {
    date: new Date(Date.UTC(2026, 7, 12, 17, 47, 6)),
    type: "total",
    durationSeconds: 2 * 60 + 18,
    pathDescription: "Greenland, Iceland, northern Spain",
    greatestLatitude: 65,
    greatestLongitude: -25,
    saros: 126,
  },
  {
    date: new Date(Date.UTC(2027, 1, 6, 16, 0, 48)),
    type: "annular",
    durationSeconds: 7 * 60 + 51,
    pathDescription: "Southeast Pacific, southern Chile, Argentina, South Atlantic",
    greatestLatitude: -31,
    greatestLongitude: -48,
    saros: 131,
  },
  {
    date: new Date(Date.UTC(2027, 7, 2, 10, 7, 50)),
    type: "total",
    durationSeconds: 6 * 60 + 23,
    pathDescription: "Southern Spain, North Africa, Egypt, Saudi Arabia",
    greatestLatitude: 26,
    greatestLongitude: 33,
    saros: 136,
  },
  {
    date: new Date(Date.UTC(2028, 0, 26, 15, 8, 59)),
    type: "annular",
    durationSeconds: 10 * 60 + 27,
    pathDescription: "Pacific, northern South America, Portugal, Spain",
    greatestLatitude: 3,
    greatestLongitude: -52,
    saros: 141,
  },
  {
    date: new Date(Date.UTC(2028, 6, 22, 2, 56, 40)),
    type: "total",
    durationSeconds: 5 * 60 + 10,
    pathDescription: "Australia, New Zealand",
    greatestLatitude: -16,
    greatestLongitude: 127,
    saros: 146,
  },
  {
    date: new Date(Date.UTC(2030, 5, 1, 6, 29, 13)),
    type: "annular",
    durationSeconds: 5 * 60 + 21,
    pathDescription: "Northern Africa, Greece, Turkey, Russia, northern Japan",
    greatestLatitude: 57,
    greatestLongitude: 80,
    saros: 128,
  },
  {
    date: new Date(Date.UTC(2030, 10, 25, 6, 51, 37)),
    type: "total",
    durationSeconds: 3 * 60 + 44,
    pathDescription: "Southern Africa, southern Indian Ocean, southern Australia",
    greatestLatitude: -44,
    greatestLongitude: 71,
    saros: 133,
  },
  {
    date: new Date(Date.UTC(2031, 4, 21, 7, 16, 4)),
    type: "annular",
    durationSeconds: 5 * 60 + 26,
    pathDescription: "Central Africa, India, Southeast Asia, Indonesia",
    greatestLatitude: 9,
    greatestLongitude: 72,
    saros: 138,
  },
  {
    date: new Date(Date.UTC(2031, 10, 14, 21, 7, 31)),
    type: "hybrid",
    durationSeconds: 1 * 60 + 8,
    pathDescription: "Central Pacific (narrow path, mostly over open ocean)",
    greatestLatitude: -1,
    greatestLongitude: -138,
    saros: 143,
  },
  {
    date: new Date(Date.UTC(2032, 4, 9, 13, 26, 42)),
    type: "annular",
    durationSeconds: 22,
    pathDescription: "South Atlantic, Antarctic coast",
    greatestLatitude: -51,
    greatestLongitude: -7,
    saros: 148,
  },
  {
    date: new Date(Date.UTC(2033, 2, 30, 18, 2, 36)),
    type: "total",
    durationSeconds: 2 * 60 + 37,
    pathDescription: "Russian Far East, Alaska, Arctic Ocean",
    greatestLatitude: 71,
    greatestLongitude: -156,
    saros: 120,
  },
  {
    date: new Date(Date.UTC(2034, 2, 20, 10, 18, 45)),
    type: "total",
    durationSeconds: 4 * 60 + 9,
    pathDescription: "West Africa, Sahel, Saudi Arabia, Iran, western China",
    greatestLatitude: 16,
    greatestLongitude: 22,
    saros: 130,
  },
  {
    date: new Date(Date.UTC(2034, 8, 12, 16, 19, 28)),
    type: "annular",
    durationSeconds: 2 * 60 + 58,
    pathDescription: "Eastern Pacific, South America (Chile to Brazil)",
    greatestLatitude: -18,
    greatestLongitude: -73,
    saros: 135,
  },
  {
    date: new Date(Date.UTC(2035, 2, 9, 23, 5, 54)),
    type: "annular",
    durationSeconds: 48,
    pathDescription: "South Pacific (most of path over open ocean)",
    greatestLatitude: -29,
    greatestLongitude: -155,
    saros: 140,
  },
  {
    date: new Date(Date.UTC(2035, 8, 2, 1, 56, 46)),
    type: "total",
    durationSeconds: 2 * 60 + 54,
    pathDescription: "Central China, Korea, Japan, North Pacific",
    greatestLatitude: 29,
    greatestLongitude: 158,
    saros: 145,
  },
  {
    date: new Date(Date.UTC(2037, 6, 13, 2, 40, 36)),
    type: "total",
    durationSeconds: 3 * 60 + 58,
    pathDescription: "Australia, South Pacific, southern Chile",
    greatestLatitude: -25,
    greatestLongitude: 139,
    saros: 127,
  },
  {
    date: new Date(Date.UTC(2038, 0, 5, 13, 47, 11)),
    type: "annular",
    durationSeconds: 3 * 60 + 18,
    pathDescription: "Central Atlantic, West Africa, Gabon, DR Congo",
    greatestLatitude: 2,
    greatestLongitude: -25,
    saros: 132,
  },
  {
    date: new Date(Date.UTC(2038, 6, 2, 13, 32, 55)),
    type: "annular",
    durationSeconds: 60,
    pathDescription: "North Atlantic, Iceland, Arctic Ocean",
    greatestLatitude: 25,
    greatestLongitude: -22,
    saros: 137,
  },
  {
    date: new Date(Date.UTC(2038, 11, 26, 1, 0, 10)),
    type: "total",
    durationSeconds: 2 * 60 + 18,
    pathDescription: "Southern Indian Ocean, Australia, Tasman Sea",
    greatestLatitude: -40,
    greatestLongitude: 164,
    saros: 142,
  },
  {
    date: new Date(Date.UTC(2039, 5, 21, 17, 12, 54)),
    type: "annular",
    durationSeconds: 4 * 60 + 5,
    pathDescription: "Northern Canada, Greenland, Norway, Russian Arctic",
    greatestLatitude: 79,
    greatestLongitude: -102,
    saros: 147,
  },
  {
    date: new Date(Date.UTC(2039, 11, 15, 16, 23, 46)),
    type: "total",
    durationSeconds: 1 * 60 + 51,
    pathDescription: "Antarctica (central continent, near South Pole)",
    greatestLatitude: -81,
    greatestLongitude: 173,
    saros: 152,
  },
  {
    date: new Date(Date.UTC(2041, 3, 30, 11, 52, 21)),
    type: "total",
    durationSeconds: 1 * 60 + 51,
    pathDescription: "Equatorial Africa: Angola, DR Congo, Uganda, Kenya, Somalia",
    greatestLatitude: -10,
    greatestLongitude: 12,
    saros: 129,
  },
  {
    date: new Date(Date.UTC(2041, 9, 25, 1, 36, 22)),
    type: "annular",
    durationSeconds: 6 * 60 + 7,
    pathDescription: "Eastern China, Korea, Japan, western Pacific",
    greatestLatitude: 10,
    greatestLongitude: 163,
    saros: 134,
  },
  {
    date: new Date(Date.UTC(2042, 3, 20, 2, 17, 30)),
    type: "total",
    durationSeconds: 4 * 60 + 51,
    pathDescription: "Southeast Asia: Malaysia, Indonesia, Philippines",
    greatestLatitude: 27,
    greatestLongitude: 137,
    saros: 139,
  },
  {
    date: new Date(Date.UTC(2042, 9, 14, 2, 0, 42)),
    type: "annular",
    durationSeconds: 7 * 60 + 44,
    pathDescription: "Indonesia, Papua New Guinea, South Pacific",
    greatestLatitude: -24,
    greatestLongitude: 138,
    saros: 144,
  },
  {
    date: new Date(Date.UTC(2044, 7, 23, 1, 17, 2)),
    type: "total",
    durationSeconds: 2 * 60 + 4,
    pathDescription: "Greenland, Nunavut, northern Canada, Montana / Dakotas",
    greatestLatitude: 64,
    greatestLongitude: -120,
    saros: 126,
  },
  {
    date: new Date(Date.UTC(2045, 1, 16, 23, 56, 7)),
    type: "annular",
    durationSeconds: 7 * 60 + 47,
    pathDescription: "South Pacific, southern South America, South Atlantic",
    greatestLatitude: -28,
    greatestLongitude: -166,
    saros: 131,
  },
  {
    date: new Date(Date.UTC(2045, 7, 12, 17, 42, 39)),
    type: "total",
    durationSeconds: 6 * 60 + 6,
    pathDescription: "Western USA, Florida, Caribbean, northern South America",
    greatestLatitude: 26,
    greatestLongitude: -79,
    saros: 136,
  },
  {
    date: new Date(Date.UTC(2046, 1, 5, 23, 6, 26)),
    type: "annular",
    durationSeconds: 9 * 60 + 42,
    pathDescription: "Central Pacific, Mexico, Cuba, Atlantic",
    greatestLatitude: 5,
    greatestLongitude: -171,
    saros: 141,
  },
  {
    date: new Date(Date.UTC(2046, 7, 2, 10, 21, 13)),
    type: "total",
    durationSeconds: 4 * 60 + 51,
    pathDescription: "Southern Atlantic, Angola, DR Congo, Mozambique",
    greatestLatitude: -13,
    greatestLongitude: 15,
    saros: 146,
  },
  {
    date: new Date(Date.UTC(2048, 5, 11, 12, 58, 53)),
    type: "annular",
    durationSeconds: 4 * 60 + 58,
    pathDescription: "Arctic Ocean, Greenland, northern Europe, Russia",
    greatestLatitude: 64,
    greatestLongitude: -12,
    saros: 128,
  },
  {
    date: new Date(Date.UTC(2048, 11, 5, 15, 35, 27)),
    type: "total",
    durationSeconds: 3 * 60 + 28,
    pathDescription: "South Pacific, southern Chile, southern Argentina",
    greatestLatitude: -46,
    greatestLongitude: -56,
    saros: 133,
  },
  {
    date: new Date(Date.UTC(2049, 4, 31, 13, 59, 59)),
    type: "annular",
    durationSeconds: 4 * 60 + 45,
    pathDescription: "North Atlantic, West Africa, Sahel, Sudan, Ethiopia",
    greatestLatitude: 15,
    greatestLongitude: -30,
    saros: 138,
  },
  {
    date: new Date(Date.UTC(2049, 10, 25, 5, 33, 48)),
    type: "hybrid",
    durationSeconds: 38,
    pathDescription: "Equatorial Atlantic, narrow path through central Africa",
    greatestLatitude: -4,
    greatestLongitude: 95,
    saros: 143,
  },
  {
    date: new Date(Date.UTC(2050, 4, 20, 20, 42, 50)),
    type: "hybrid",
    durationSeconds: 21,
    pathDescription: "South Pacific (almost entirely over open ocean)",
    greatestLatitude: -40,
    greatestLongitude: -124,
    saros: 148,
  },
  {
    date: new Date(Date.UTC(2052, 2, 30, 18, 31, 53)),
    type: "total",
    durationSeconds: 4 * 60 + 8,
    pathDescription: "Mexico, southeastern USA, Atlantic",
    greatestLatitude: 22,
    greatestLongitude: -103,
    saros: 130,
  },
  {
    date: new Date(Date.UTC(2052, 8, 22, 23, 39, 10)),
    type: "annular",
    durationSeconds: 2 * 60 + 51,
    pathDescription: "South Pacific, southern South America, South Atlantic",
    greatestLatitude: -26,
    greatestLongitude: 175,
    saros: 135,
  },
  {
    date: new Date(Date.UTC(2053, 2, 20, 7, 8, 19)),
    type: "annular",
    durationSeconds: 50,
    pathDescription: "Southern Indian Ocean, Antarctic coast",
    greatestLatitude: -23,
    greatestLongitude: 83,
    saros: 140,
  },
  {
    date: new Date(Date.UTC(2053, 8, 12, 9, 34, 9)),
    type: "total",
    durationSeconds: 3 * 60 + 4,
    pathDescription: "Saudi Arabia, Yemen, Horn of Africa",
    greatestLatitude: 21,
    greatestLongitude: 42,
    saros: 145,
  },
  {
    date: new Date(Date.UTC(2055, 6, 24, 9, 57, 50)),
    type: "total",
    durationSeconds: 3 * 60 + 17,
    pathDescription: "Central & southern Africa, Madagascar",
    greatestLatitude: -33,
    greatestLongitude: 26,
    saros: 127,
  },
  {
    date: new Date(Date.UTC(2056, 0, 16, 22, 16, 45)),
    type: "annular",
    durationSeconds: 2 * 60 + 52,
    pathDescription: "Central Pacific, Mexico, southern USA, Atlantic",
    greatestLatitude: 4,
    greatestLongitude: -154,
    saros: 132,
  },
  {
    date: new Date(Date.UTC(2056, 6, 12, 20, 21, 59)),
    type: "annular",
    durationSeconds: 1 * 60 + 26,
    pathDescription: "Eastern Pacific, western North America",
    greatestLatitude: 19,
    greatestLongitude: -124,
    saros: 137,
  },
  {
    date: new Date(Date.UTC(2057, 0, 5, 9, 47, 52)),
    type: "total",
    durationSeconds: 2 * 60 + 29,
    pathDescription: "Southern Indian Ocean, crossing south of Africa",
    greatestLatitude: -39,
    greatestLongitude: 35,
    saros: 142,
  },
  {
    date: new Date(Date.UTC(2057, 6, 1, 23, 40, 15)),
    type: "annular",
    durationSeconds: 4 * 60 + 22,
    pathDescription: "Arctic Ocean, northern Canada, Greenland",
    greatestLatitude: 71,
    greatestLongitude: -176,
    saros: 147,
  },
  {
    date: new Date(Date.UTC(2057, 11, 26, 1, 14, 35)),
    type: "total",
    durationSeconds: 1 * 60 + 50,
    pathDescription: "Antarctica, southern Indian Ocean",
    greatestLatitude: -85,
    greatestLongitude: 22,
    saros: 152,
  },
  {
    date: new Date(Date.UTC(2059, 4, 11, 19, 22, 16)),
    type: "total",
    durationSeconds: 2 * 60 + 23,
    pathDescription: "Eastern Pacific, Central America, northern South America",
    greatestLatitude: -11,
    greatestLongitude: -100,
    saros: 129,
  },
  {
    date: new Date(Date.UTC(2059, 10, 5, 9, 18, 15)),
    type: "annular",
    durationSeconds: 7 * 60,
    pathDescription: "North Africa, Saudi Arabia, Iran, India, Indonesia",
    greatestLatitude: 9,
    greatestLongitude: 47,
    saros: 134,
  },
  {
    date: new Date(Date.UTC(2060, 3, 30, 10, 10, 0)),
    type: "total",
    durationSeconds: 5 * 60 + 15,
    pathDescription: "North Africa, Middle East, Central Asia",
    greatestLatitude: 28,
    greatestLongitude: 21,
    saros: 139,
  },
  {
    date: new Date(Date.UTC(2060, 9, 24, 9, 24, 10)),
    type: "annular",
    durationSeconds: 8 * 60 + 6,
    pathDescription: "South Atlantic, southern Africa, Indian Ocean, Australia",
    greatestLatitude: -26,
    greatestLongitude: 28,
    saros: 144,
  },
];

/**
 * Return the next `count` solar eclipses strictly after `after`, in
 * chronological order. Includes total, annular, and hybrid eclipses.
 * If the table runs out (i.e. `after` is close to or past the last
 * tabulated eclipse) the returned array is shorter than `count`.
 *
 * Callers should inspect the returned length and surface an "update
 * the table" hint if the list is empty — otherwise the UI will
 * silently look broken deep in the 2060s. A short fallback message
 * is easier to notice than silence.
 */
export function upcomingSolarEclipses(
  after: Date,
  count = 4,
): SolarEclipse[] {
  const afterMs = after.getTime();
  const out: SolarEclipse[] = [];
  for (const e of SOLAR_ECLIPSES) {
    if (e.date.getTime() <= afterMs) continue;
    out.push(e);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Format a duration given in seconds as a compact `MmSSs` string —
 * e.g. 388 → "6m28s", 67 → "1m07s". Used in the sheet's upcoming-
 * eclipses list. Minutes are never padded (durations in our table
 * span 0m21s to ~10m27s), but seconds are zero-padded so the column
 * reads cleanly with a tabular-nums font.
 *
 * Applies uniformly to totality, annularity, or hybrid-peak
 * duration — the formatting concern is identical.
 */
export function formatEclipseDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

/**
 * Human-readable label for a solar-eclipse type, capitalised for use
 * as a section-row descriptor (e.g. "Total solar eclipse"). The
 * trailing " solar eclipse" keeps the label self-contained so rows
 * can be read out of context.
 */
export function solarEclipseTypeLabel(type: SolarEclipseType): string {
  switch (type) {
    case "total":
      return "Total solar eclipse";
    case "annular":
      return "Annular solar eclipse";
    case "hybrid":
      return "Hybrid solar eclipse";
  }
}

/**
 * Short label describing what an observer on the central line sees
 * for the peak-duration readout: "Totality", "Annularity", or "Peak"
 * (for hybrids, which can be either along different parts of the
 * path and where "peak" avoids overcommitting).
 */
export function solarEclipsePeakLabel(type: SolarEclipseType): string {
  switch (type) {
    case "total":
      return "Totality";
    case "annular":
      return "Annularity";
    case "hybrid":
      return "Peak";
  }
}

/**
 * Trailing letter in NASA's stable per-eclipse URL slug. For any
 * given date NASA publishes:
 *
 *   https://eclipse.gsfc.nasa.gov/SEgoogle/SEgoogle2001/SE<YYYY><Mon><DD><X>google.html
 *
 * …where <X> is T for total, A for annular, and H for hybrid. Partial
 * eclipses use P but are not in our table.
 */
export function solarEclipseNasaCode(type: SolarEclipseType): "T" | "A" | "H" {
  switch (type) {
    case "total":
      return "T";
    case "annular":
      return "A";
    case "hybrid":
      return "H";
  }
}
