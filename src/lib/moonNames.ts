// Cultural names for the full moons of the year.
//
// Naming here follows the American / Old Farmer's Almanac tradition —
// drawn from Algonquin, Colonial American, and European folk sources —
// as summarised in the Wikipedia article "Full moon § Full moon names".
// This is the list most English-speaking users will recognise.
//
// Two special cases override the plain month mapping:
//
//   * Harvest Moon — the full moon nearest the September equinox. Most
//     years this is the September full moon; occasionally (about once
//     every four years) it's the October full moon instead, in which
//     case the September full moon takes the "Corn" name and October
//     is Harvest.
//   * Blue Moon — the *third* full moon in a season that contains four
//     full moons. This is the traditional rule (Maine Farmers' Almanac
//     ~1937); the "second full moon in a calendar month" rule is a
//     1946 misinterpretation that's easier to compute but historically
//     inaccurate. We use the traditional rule here because the user
//     specifically requested it.
//
// The special-case Hunter's Moon tag is also applied: it's the full
// moon immediately following Harvest.

import { nextPhase, type PrincipalPhase } from "./moon";

// ────────────────────────────────────────────────────────────────────
// Month-based full-moon names
// ────────────────────────────────────────────────────────────────────

/**
 * Cultural name assigned to a full moon, with optional extras. `name`
 * is the primary label to render; alternate names are tracked for
 * trivia. `wikipediaTitle`, when present, points to a real dedicated
 * Wikipedia article for that named moon — useful because every named
 * moon has its own article, unlike the phases themselves.
 */
export interface FullMoonName {
  /** Month the name is assigned to (1..12). */
  month: number;
  /** Primary name, e.g. "Wolf Moon". */
  name: string;
  /** Alternate / folk names for the same moon. */
  altNames: string[];
  /**
   * Title of the dedicated Wikipedia article for this named moon, if
   * one exists. Not every month has a dedicated article; when absent
   * the caller should fall back to the generic "Full moon" article.
   */
  wikipediaTitle?: string;
}

/**
 * Month → named-moon mapping. Ordered 1..12. Exported for use in a
 * calendar / overview view as well as in the per-date lookup below.
 */
export const MONTHLY_FULL_MOON_NAMES: Record<number, FullMoonName> = {
  1: {
    month: 1,
    name: "Wolf Moon",
    altNames: ["Old Moon", "Ice Moon"],
    wikipediaTitle: "Wolf Moon",
  },
  2: {
    month: 2,
    name: "Snow Moon",
    altNames: ["Hunger Moon", "Storm Moon"],
    wikipediaTitle: "Snow Moon",
  },
  3: {
    month: 3,
    name: "Worm Moon",
    altNames: ["Crow Moon", "Sap Moon", "Lenten Moon"],
    wikipediaTitle: "Worm Moon",
  },
  4: {
    month: 4,
    name: "Pink Moon",
    altNames: ["Sprouting Grass Moon", "Egg Moon", "Fish Moon"],
    wikipediaTitle: "Pink Moon",
  },
  5: {
    month: 5,
    name: "Flower Moon",
    altNames: ["Milk Moon", "Corn Planting Moon"],
    wikipediaTitle: "Flower Moon",
  },
  6: {
    month: 6,
    name: "Strawberry Moon",
    altNames: ["Rose Moon", "Hot Moon"],
    wikipediaTitle: "Strawberry Moon",
  },
  7: {
    month: 7,
    name: "Buck Moon",
    altNames: ["Thunder Moon", "Hay Moon"],
    wikipediaTitle: "Buck Moon",
  },
  8: {
    month: 8,
    name: "Sturgeon Moon",
    altNames: ["Red Moon", "Green Corn Moon"],
    wikipediaTitle: "Sturgeon Moon",
  },
  9: {
    month: 9,
    // Usually "Harvest Moon" (it's the full moon nearest the autumnal
    // equinox) but occasionally the October full moon wins that title
    // and September's becomes "Corn Moon". Resolved at lookup time.
    name: "Corn Moon",
    altNames: ["Harvest Moon"],
    wikipediaTitle: "Corn Moon",
  },
  10: {
    month: 10,
    name: "Hunter's Moon",
    altNames: ["Blood Moon", "Travel Moon"],
    wikipediaTitle: "Hunter's Moon",
  },
  11: {
    month: 11,
    name: "Beaver Moon",
    altNames: ["Frost Moon", "Mourning Moon"],
    wikipediaTitle: "Beaver Moon",
  },
  12: {
    month: 12,
    name: "Cold Moon",
    altNames: ["Long Nights Moon", "Oak Moon"],
    wikipediaTitle: "Cold Moon (December)",
  },
};

// ────────────────────────────────────────────────────────────────────
// Equinoxes & solstices — needed for the traditional Blue Moon rule
// and for Harvest Moon resolution.
// ────────────────────────────────────────────────────────────────────

/**
 * Approximate Gregorian date (UT) of the four seasonal markers for a
 * given year. Based on the mean terms of Meeus eqn 27.1 (2nd ed.) —
 * accurate to ~15 minutes across the 1800–2100 range, more than good
 * enough to assign a full moon to a season or to find the equinox the
 * Harvest Moon should be closest to.
 */
export interface SeasonMarkers {
  marchEquinox: Date;
  juneSolstice: Date;
  septemberEquinox: Date;
  decemberSolstice: Date;
}

/** Internal: JDE → JS Date (UT). */
function jdeToDate(jde: number): Date {
  return new Date((jde - 2440587.5) * 86400000);
}

/**
 * Mean JDE of a seasonal marker, per Meeus Table 27.A (2000–2999).
 * Parameters: `which` picks the marker; `year` is the Gregorian year.
 * Returns the uncorrected "mean" time — we skip the periodic terms
 * (S) because 15 minutes of wobble doesn't affect the logic here.
 */
function meanSeasonalJDE(
  which: "march" | "june" | "september" | "december",
  year: number,
): number {
  const Y = (year - 2000) / 1000;
  const Y2 = Y * Y;
  const Y3 = Y2 * Y;
  const Y4 = Y3 * Y;

  // Meeus 27.A, 2000–2999.
  switch (which) {
    case "march":
      return (
        2451623.80984 +
        365242.37404 * Y +
        0.05169 * Y2 -
        0.00411 * Y3 -
        0.00057 * Y4
      );
    case "june":
      return (
        2451716.56767 +
        365241.62603 * Y +
        0.00325 * Y2 +
        0.00888 * Y3 -
        0.0003 * Y4
      );
    case "september":
      return (
        2451810.21715 +
        365242.01767 * Y -
        0.11575 * Y2 +
        0.00337 * Y3 +
        0.00078 * Y4
      );
    case "december":
      return (
        2451900.05952 +
        365242.74049 * Y -
        0.06223 * Y2 -
        0.00823 * Y3 +
        0.00032 * Y4
      );
  }
}

/** All four seasonal markers for the given Gregorian year. */
export function seasonMarkers(year: number): SeasonMarkers {
  return {
    marchEquinox: jdeToDate(meanSeasonalJDE("march", year)),
    juneSolstice: jdeToDate(meanSeasonalJDE("june", year)),
    septemberEquinox: jdeToDate(meanSeasonalJDE("september", year)),
    decemberSolstice: jdeToDate(meanSeasonalJDE("december", year)),
  };
}

// ────────────────────────────────────────────────────────────────────
// Season lookup for a given full moon
// ────────────────────────────────────────────────────────────────────

/**
 * Meteorological-astronomical season a date falls into, using the
 * astronomical definition (equinoxes/solstices as boundaries). Needed
 * for the traditional Blue Moon rule, which counts full moons within
 * a season and flags the third of any four.
 */
export type Season = "winter" | "spring" | "summer" | "autumn";

/**
 * Which season the given date falls into. The northern-hemisphere
 * convention is used throughout (this is a Western naming tradition
 * anyway — southern-hemisphere seasons are 6 months offset from these
 * labels, but the Blue Moon rule doesn't care about labels, only
 * boundaries).
 */
export function seasonOf(date: Date): {
  season: Season;
  start: Date;
  end: Date;
} {
  // Candidates: this year's and last year's December solstice (which
  // starts winter), plus this year's three other markers. We find
  // which two consecutive markers bracket `date`.
  const y = date.getUTCFullYear();
  const m = seasonMarkers(y);
  const prevDec = jdeToDate(meanSeasonalJDE("december", y - 1));
  const nextDec = m.decemberSolstice;

  if (date < m.marchEquinox)
    return { season: "winter", start: prevDec, end: m.marchEquinox };
  if (date < m.juneSolstice)
    return { season: "spring", start: m.marchEquinox, end: m.juneSolstice };
  if (date < m.septemberEquinox)
    return { season: "summer", start: m.juneSolstice, end: m.septemberEquinox };
  if (date < nextDec)
    return { season: "autumn", start: m.septemberEquinox, end: nextDec };
  // Past this year's December solstice → next year's winter.
  const nextMarch = jdeToDate(meanSeasonalJDE("march", y + 1));
  return { season: "winter", start: nextDec, end: nextMarch };
}

/**
 * Full moons that fall within the season containing `date`, in
 * chronological order. Used to implement the traditional Blue Moon
 * rule (three full moons is normal; four means the third is Blue).
 *
 * Starts from one day before the season boundary (so boundary-hugging
 * full moons aren't lost to floating-point) and walks `nextPhase`
 * forward full-moon at a time until we cross the end boundary.
 */
export function fullMoonsInSeason(date: Date): Date[] {
  const { start, end } = seasonOf(date);
  const result: Date[] = [];
  let cursor = new Date(start.getTime() - 86400_000);
  while (true) {
    const m = nextPhase(cursor, "full");
    if (m.getTime() >= end.getTime()) break;
    if (m.getTime() >= start.getTime()) result.push(m);
    cursor = m;
  }
  return result;
}

/**
 * True iff `date` is the *third* full moon in a season that contains
 * four of them — the traditional ("Maine Farmers' Almanac") Blue
 * Moon. A tolerance of one hour is applied to compensate for the low
 * precision of our own phase/season computation.
 */
export function isTraditionalBlueMoon(fullMoonDate: Date): boolean {
  const moons = fullMoonsInSeason(fullMoonDate);
  if (moons.length !== 4) return false;
  const diffMs = Math.abs(
    moons[2].getTime() - fullMoonDate.getTime(),
  );
  return diffMs < 60 * 60 * 1000;
}

// ────────────────────────────────────────────────────────────────────
// Harvest / Hunter's Moon resolution
// ────────────────────────────────────────────────────────────────────

/**
 * True iff `fullMoonDate` is the full moon closest to the September
 * equinox of its year. This is the Harvest Moon, which is usually
 * September's full moon but sometimes October's.
 */
export function isHarvestMoon(fullMoonDate: Date): boolean {
  // The Harvest Moon is the full moon of the year with the smallest
  // |t − equinox|. Scan the 3-4 full moons within ±45 days of the
  // equinox and pick the minimum.
  const y = fullMoonDate.getUTCFullYear();
  const equinox = jdeToDate(meanSeasonalJDE("september", y));

  const windowStart = new Date(equinox.getTime() - 45 * 86400_000);
  const windowEnd = new Date(equinox.getTime() + 45 * 86400_000);
  const fulls: Date[] = [];
  let cursor = windowStart;
  while (true) {
    const m = nextPhase(cursor, "full");
    if (m.getTime() > windowEnd.getTime()) break;
    fulls.push(m);
    cursor = m;
  }
  if (fulls.length === 0) return false;

  let best = fulls[0];
  let bestGap = Math.abs(best.getTime() - equinox.getTime());
  for (const d of fulls) {
    const gap = Math.abs(d.getTime() - equinox.getTime());
    if (gap < bestGap) {
      bestGap = gap;
      best = d;
    }
  }
  return Math.abs(best.getTime() - fullMoonDate.getTime()) < 60 * 60 * 1000;
}

/**
 * True iff `fullMoonDate` is the Hunter's Moon — the first full moon
 * *after* the Harvest Moon. Usually October, occasionally November
 * (in years when the Harvest Moon is in October).
 */
export function isHuntersMoon(fullMoonDate: Date): boolean {
  // Walk back from the candidate and check: was the previous full
  // moon the Harvest? Harvest Moons are within ~15 days of the
  // September equinox, so scan ~45 days back.
  const scan = new Date(fullMoonDate.getTime() - 45 * 86400_000);
  const prevFull = nextPhase(scan, "full");
  // `prevFull` is the first full moon after `scan`; we want the last
  // one *before* `fullMoonDate`. Step forward full-moons until the
  // next one would be ≥ fullMoonDate.
  let cursor = prevFull;
  while (true) {
    const step = nextPhase(cursor, "full");
    if (step.getTime() >= fullMoonDate.getTime() - 60 * 60 * 1000) break;
    cursor = step;
  }
  return isHarvestMoon(cursor);
}

// ────────────────────────────────────────────────────────────────────
// Public: describe the full moon on a given date
// ────────────────────────────────────────────────────────────────────

/** Full descriptor for a full moon on a particular date. */
export interface NamedFullMoon {
  /** Primary display name, e.g. "Harvest Moon" or "Blue Moon". */
  name: string;
  /** Alternate / folk names worth surfacing. */
  altNames: string[];
  /**
   * Wikipedia article title for this specific named moon, if one
   * exists — used as the first candidate in `useWikipediaSummary`.
   */
  wikipediaTitle?: string;
  /** True iff this is the traditional third-of-four-in-a-season Blue Moon. */
  isBlueMoon: boolean;
  /** True iff the full moon nearest the September equinox. */
  isHarvest: boolean;
  /** True iff the full moon immediately following the Harvest Moon. */
  isHunters: boolean;
}

/**
 * Resolve the cultural name of the full moon on `date`. Applies the
 * special overrides in priority order: Blue Moon (rarest, takes
 * precedence), then Harvest/Hunter, then the plain month mapping.
 * Note that Harvest/Hunter don't disable the underlying month label
 * — they replace it, because that's how the tradition works.
 */
export function describeFullMoon(date: Date): NamedFullMoon {
  const month = date.getUTCMonth() + 1; // 1..12
  const base = MONTHLY_FULL_MOON_NAMES[month];

  const blue = isTraditionalBlueMoon(date);
  const harvest = isHarvestMoon(date);
  const hunters = !harvest && isHuntersMoon(date);

  if (blue) {
    return {
      name: "Blue Moon",
      altNames: [base.name, ...base.altNames],
      wikipediaTitle: "Blue moon",
      isBlueMoon: true,
      isHarvest: harvest,
      isHunters: hunters,
    };
  }

  if (harvest) {
    // Include the month's primary name as an alternate — e.g. "Corn
    // Moon" when the Harvest Moon falls in September. When the
    // month's primary is already "Harvest Moon" (impossible today,
    // but guards against future table edits) we just use its alts.
    const alts =
      base.name === "Harvest Moon"
        ? base.altNames
        : [base.name, ...base.altNames.filter((n) => n !== "Harvest Moon")];
    return {
      name: "Harvest Moon",
      altNames: alts,
      wikipediaTitle: "Harvest Moon",
      isBlueMoon: false,
      isHarvest: true,
      isHunters: false,
    };
  }

  if (hunters) {
    // When Hunter's is the October (normal) full moon the base name
    // IS already "Hunter's Moon"; pick the base in that case so we
    // don't list "Hunter's Moon" twice.
    if (base.name === "Hunter's Moon") {
      return {
        name: base.name,
        altNames: base.altNames,
        wikipediaTitle: base.wikipediaTitle,
        isBlueMoon: false,
        isHarvest: false,
        isHunters: true,
      };
    }
    return {
      name: "Hunter's Moon",
      altNames: [base.name, ...base.altNames],
      wikipediaTitle: "Hunter's Moon",
      isBlueMoon: false,
      isHarvest: false,
      isHunters: true,
    };
  }

  return {
    name: base.name,
    altNames: base.altNames,
    wikipediaTitle: base.wikipediaTitle,
    isBlueMoon: false,
    isHarvest: false,
    isHunters: false,
  };
}

// Re-export for convenience — callers often want both sides together.
export type { PrincipalPhase };
