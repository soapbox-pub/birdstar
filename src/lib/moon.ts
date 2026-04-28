// Low-precision Moon ephemeris.
//
// Implements the simplified lunar theory from Jean Meeus, "Astronomical
// Algorithms" (2nd ed.), Chapter 47. Accurate to roughly 10' in position
// and better than 0.001 AU in distance across the next few decades — far
// better than needed for a visual sky map where the Moon is drawn half a
// degree across.
//
// All angles are returned in the conventions already used elsewhere in
// this project: right ascension in hours (0–24), declination in degrees
// (−90 to +90).

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Normalize an angle to [0, 360). */
function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function sind(x: number): number {
  return Math.sin(x * DEG);
}
function cosd(x: number): number {
  return Math.cos(x * DEG);
}

/** Julian centuries since J2000.0 (TT, but UT ≈ TT for this precision). */
function julianCenturies(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (jd - 2451545.0) / 36525.0;
}

export interface MoonPosition {
  /** Geocentric apparent right ascension in hours (0..24). */
  ra: number;
  /** Geocentric apparent declination in degrees (-90..90). */
  dec: number;
  /** Apparent ecliptic longitude in degrees (0..360). */
  eclipticLon: number;
  /** Apparent ecliptic latitude in degrees. */
  eclipticLat: number;
  /** Earth–Moon distance in km. */
  distanceKm: number;
  /**
   * Apparent angular diameter of the Moon in degrees, as seen from Earth's
   * center. (Topocentric correction is negligible visually.)
   */
  angularDiameterDeg: number;
}

/**
 * Geocentric position of the Moon at the given instant.
 *
 * This is the classic Meeus low-precision formula: a handful of the
 * largest periodic terms in longitude, latitude, and distance. Enough
 * terms to place the Moon well inside its own disk at any realistic zoom.
 */
export function moonPosition(date: Date): MoonPosition {
  const T = julianCenturies(date);

  // Fundamental arguments (Meeus Ch. 47, simplified).
  const Lp = norm360(218.3164477 + 481267.88123421 * T);                   // Moon's mean longitude
  const D = norm360(297.8501921 + 445267.1114034 * T);                     // Mean elongation
  const M = norm360(357.5291092 + 35999.0502909 * T);                      // Sun's mean anomaly
  const Mp = norm360(134.9633964 + 477198.8675055 * T);                    // Moon's mean anomaly
  const F = norm360(93.2720950 + 483202.0175233 * T);                      // Moon's argument of latitude

  // Leading periodic terms. Arguments are in degrees; coefficients give
  // output directly in degrees (longitude & latitude) and kilometres
  // (distance).
  //
  // Longitude: dominated by the 6.289° "evection-free" equation of the
  // centre (sin Mp). The other terms correct for solar perturbations,
  // evection, and variation — these are the big ones you'd notice with
  // the naked eye.
  const dLon =
    6.289 * sind(Mp) +
    1.274 * sind(2 * D - Mp) +
    0.658 * sind(2 * D) +
    0.214 * sind(2 * Mp) +
    -0.186 * sind(M) +
    -0.059 * sind(2 * D - 2 * Mp) +
    -0.057 * sind(2 * D - M - Mp) +
    0.053 * sind(2 * D + Mp) +
    0.046 * sind(2 * D - M) +
    -0.041 * sind(M - Mp);

  const lon = norm360(Lp + dLon);

  // Latitude: dominated by the 5.128° sin F term (the inclination of the
  // Moon's orbit to the ecliptic).
  const lat =
    5.128 * sind(F) +
    0.281 * sind(Mp + F) +
    0.278 * sind(Mp - F) +
    0.173 * sind(2 * D - F) +
    0.055 * sind(2 * D + F - Mp) +
    0.046 * sind(2 * D - F - Mp) +
    0.033 * sind(2 * D + F) +
    0.017 * sind(2 * Mp + F);

  // Distance to the Moon in kilometres. The 385,000.56 km constant is
  // the mean Earth–Moon distance; the periodic terms take it between
  // ~356,500 km (perigee) and ~406,700 km (apogee).
  const distanceKm =
    385000.56 +
    -20905.355 * cosd(Mp) +
    -3699.111 * cosd(2 * D - Mp) +
    -2955.968 * cosd(2 * D) +
    -569.925 * cosd(2 * Mp) +
    246.158 * cosd(2 * D - 2 * Mp) +
    -204.586 * cosd(2 * D - M - Mp) +
    -170.733 * cosd(2 * D + Mp);

  // Obliquity of the ecliptic (simplified; enough precision for drawing).
  const eps = 23.43929 - 0.0130042 * T;

  // Ecliptic → equatorial.
  const sinLat = sind(lat);
  const cosLat = cosd(lat);
  const sinLon = sind(lon);
  const cosLon = cosd(lon);
  const sinEps = sind(eps);
  const cosEps = cosd(eps);

  const sinDec = sinLat * cosEps + cosLat * sinEps * sinLon;
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec))) * RAD;

  const y = sinLon * cosEps - (sinLat / cosLat) * sinEps;
  const x = cosLon;
  let raDeg = Math.atan2(y, x) * RAD;
  raDeg = norm360(raDeg);
  const ra = raDeg / 15; // hours

  // Apparent angular diameter: the Moon's physical radius is 1737.4 km,
  // so the diameter subtends 2 * asin(R / d). Over its range this goes
  // from about 0.49° (apogee) to 0.56° (perigee).
  const angularDiameterDeg = 2 * Math.asin(1737.4 / distanceKm) * RAD;

  return {
    ra,
    dec,
    eclipticLon: lon,
    eclipticLat: lat,
    distanceKm,
    angularDiameterDeg,
  };
}

/**
 * Low-precision geocentric ecliptic longitude of the Sun (degrees).
 * Used here only to compute the Moon's phase — not published elsewhere,
 * so we keep it private.
 */
function sunEclipticLongitude(date: Date): number {
  const T = julianCenturies(date);
  const L0 = norm360(280.46646 + 36000.76983 * T);
  const M = norm360(357.52911 + 35999.05029 * T);
  const C =
    (1.914602 - 0.004817 * T) * sind(M) +
    (0.019993 - 0.000101 * T) * sind(2 * M) +
    0.000289 * sind(3 * M);
  return norm360(L0 + C);
}

export interface MoonPhase {
  /**
   * Illuminated fraction of the Moon's disk, 0..1. 0 at new moon,
   * 1 at full moon.
   */
  illumination: number;
  /**
   * Phase angle in degrees: the Sun-Moon-Earth angle (Meeus' i).
   * 0° = full, 180° = new.
   */
  phaseAngleDeg: number;
  /**
   * Position angle of the bright limb in degrees — the direction from
   * the center of the Moon's disk to the midpoint of its illuminated
   * limb, measured eastward from celestial north. See Meeus Ch. 48.
   * Useful for orienting the crescent when drawing the Moon.
   */
  brightLimbAngleDeg: number;
  /**
   * Age of the Moon in days since the previous new moon (0..~29.53).
   * Derived from the elongation so it stays consistent with the
   * illumination fraction.
   */
  ageDays: number;
  /**
   * True if the Moon is waxing (elongation increasing toward full),
   * false if waning. Controls which limb is lit when drawing.
   */
  waxing: boolean;
}

/**
 * Compute the Moon's phase at the given instant: illuminated fraction,
 * phase angle, and bright-limb position angle (for terminator orientation).
 */
export function moonPhase(date: Date, moon?: MoonPosition): MoonPhase {
  const m = moon ?? moonPosition(date);
  const sunLon = sunEclipticLongitude(date);

  // Elongation (angular distance Moon-Sun as seen from Earth), Meeus 48.2.
  // Using spherical law of cosines on the two ecliptic positions;
  // assuming the Sun's latitude is zero is accurate to <1'.
  const cosElong = cosd(m.eclipticLat) * cosd(m.eclipticLon - sunLon);
  const elongation = Math.acos(Math.max(-1, Math.min(1, cosElong))) * RAD;

  // Earth-Sun distance in km for the phase-angle calculation. Low precision:
  // use the mean value — the resulting error in illuminated fraction is
  // far below visual threshold.
  const earthSunKm = 149_597_870.7; // 1 AU

  // Meeus eqn 48.3: phase angle i.
  // tan i = R sin ψ / (Δ − R cos ψ)
  const sinPsi = Math.sin(elongation * DEG);
  const cosPsi = Math.cos(elongation * DEG);
  const i =
    Math.atan2(earthSunKm * sinPsi, m.distanceKm - earthSunKm * cosPsi) * RAD;

  // Illuminated fraction (Meeus 48.1).
  const illumination = (1 + Math.cos(i * DEG)) / 2;

  // Bright-limb position angle χ (Meeus 48.5). Requires Sun's equatorial
  // position too; derive RA/Dec from ecliptic longitude.
  const eps = 23.43929 - 0.0130042 * julianCenturies(date);
  const sunRa =
    Math.atan2(sind(sunLon) * cosd(eps), cosd(sunLon)) * RAD;
  const sunDec = Math.asin(sind(sunLon) * sind(eps)) * RAD;

  const moonRaDeg = m.ra * 15;
  const dRa = (sunRa - moonRaDeg) * DEG;
  const moonDecRad = m.dec * DEG;
  const sunDecRad = sunDec * DEG;
  const chi =
    Math.atan2(
      Math.cos(sunDecRad) * Math.sin(dRa),
      Math.sin(sunDecRad) * Math.cos(moonDecRad) -
        Math.cos(sunDecRad) * Math.sin(moonDecRad) * Math.cos(dRa),
    ) * RAD;

  // Waxing / waning determined by the signed elongation: if the Moon is
  // east of the Sun in ecliptic longitude (λ_moon − λ_sun in (0, 180)),
  // it's waxing; otherwise waning. Keeping this simple saves having to
  // inspect time derivatives and is stable near new/full moon.
  const dLon = norm360(m.eclipticLon - sunLon);
  const waxing = dLon < 180;

  // Synodic period for age-in-days.
  const SYNODIC = 29.530588861;
  const ageDays = (dLon / 360) * SYNODIC;

  return {
    illumination,
    phaseAngleDeg: i,
    brightLimbAngleDeg: norm360(chi),
    ageDays,
    waxing,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Principal phase times (Meeus "Astronomical Algorithms" 2nd ed., Ch. 49)
// ─────────────────────────────────────────────────────────────────────────

/**
 * One of the four principal lunar phases. Corresponds to Meeus' lunation
 * index offset k mod 1:
 *   0    → new moon
 *   0.25 → first quarter
 *   0.5  → full moon
 *   0.75 → last quarter
 */
export type PrincipalPhase = "new" | "first-quarter" | "full" | "last-quarter";

const PHASE_K_OFFSET: Record<PrincipalPhase, number> = {
  "new": 0,
  "first-quarter": 0.25,
  "full": 0.5,
  "last-quarter": 0.75,
};

const PHASE_ORDER: PrincipalPhase[] = [
  "new",
  "first-quarter",
  "full",
  "last-quarter",
];

/** Convert a Julian Day number (UT) back to a JS Date. */
function jdToDate(jd: number): Date {
  return new Date((jd - 2440587.5) * 86400000);
}

/**
 * Decimal year for k-seeding, per Meeus eqn 49.2:
 *   year = Y + (M - 0.5) / 12 + day / 365.25   (approximate)
 * We use the Date's UTC timestamp for a robust, leap-year-aware answer.
 */
function decimalYear(date: Date): number {
  const y = date.getUTCFullYear();
  const startOfYear = Date.UTC(y, 0, 1);
  const startOfNext = Date.UTC(y + 1, 0, 1);
  const frac = (date.getTime() - startOfYear) / (startOfNext - startOfYear);
  return y + frac;
}

/**
 * Julian Ephemeris Day of the principal phase identified by `k`, where
 * k is the Meeus lunation index (integer for new moon, +0.25 / +0.5 /
 * +0.75 for the quarters and full moon). Accurate to ~1 minute for
 * dates within a few centuries of J2000.
 */
function phaseJDE(k: number): number {
  // Centuries since J2000 (eqn 49.3).
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  // Mean JDE of the phase (eqn 49.1).
  let jde =
    2451550.09766 +
    29.530588861 * k +
    0.00015437 * T2 -
    0.000000150 * T3 +
    0.00000000073 * T4;

  // Fundamental arguments for the correction series (all in degrees).
  const E = 1 - 0.002516 * T - 0.0000074 * T2; // Earth orbit eccentricity factor
  const M = norm360(2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3);           // Sun's mean anomaly
  const Mp = norm360(201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4); // Moon's mean anomaly
  const F = norm360(160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4);  // Moon's argument of latitude
  const Omega = norm360(124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3);      // Longitude of ascending node

  // Which phase are we correcting? Recover from k's fractional part.
  const frac = ((k % 1) + 1) % 1;
  const isNew = Math.abs(frac - 0) < 1e-6;
  const isFull = Math.abs(frac - 0.5) < 1e-6;
  const isQuarter = Math.abs(frac - 0.25) < 1e-6 || Math.abs(frac - 0.75) < 1e-6;

  // Periodic corrections. Meeus gives two tables — one for new/full
  // (Table 49.A), one for quarters (49.B) — plus a common planetary-
  // argument table (49.C / final paragraph). Only the largest terms are
  // included; the dropped terms are below 0.0001 d ≈ 9 seconds.
  let corr = 0;
  if (isNew || isFull) {
    // Shared leading series for new and full moon, with a couple of
    // sign flips on the M-dependent terms between the two phases.
    const sign = isNew ? -0.40720 : -0.40614;
    corr =
      sign * sind(Mp) +
      0.17241 * E * sind(M) +
      0.01608 * sind(2 * Mp) +
      0.01039 * sind(2 * F) +
      0.00739 * E * sind(Mp - M) +
      -0.00514 * E * sind(Mp + M) +
      0.00208 * E * E * sind(2 * M) +
      -0.00111 * sind(Mp - 2 * F) +
      -0.00057 * sind(Mp + 2 * F) +
      0.00056 * E * sind(2 * Mp + M) +
      -0.00042 * sind(3 * Mp) +
      0.00042 * E * sind(M + 2 * F) +
      0.00038 * E * sind(M - 2 * F) +
      -0.00024 * E * sind(2 * Mp - M) +
      -0.00017 * sind(Omega) +
      -0.00007 * sind(Mp + 2 * M) +
      0.00004 * sind(2 * Mp - 2 * F) +
      0.00004 * sind(3 * M) +
      0.00003 * sind(Mp + M - 2 * F) +
      0.00003 * sind(2 * Mp + 2 * F) +
      -0.00003 * sind(Mp + M + 2 * F) +
      0.00003 * sind(Mp - M + 2 * F) +
      -0.00002 * sind(Mp - M - 2 * F) +
      -0.00002 * sind(3 * Mp + M) +
      0.00002 * sind(4 * Mp);
  } else if (isQuarter) {
    // First/last quarter share a series (Meeus 49.B).
    corr =
      -0.62801 * sind(Mp) +
      0.17172 * E * sind(M) +
      -0.01183 * E * sind(Mp + M) +
      0.00862 * sind(2 * Mp) +
      0.00804 * sind(2 * F) +
      0.00454 * E * sind(Mp - M) +
      0.00204 * E * E * sind(2 * M) +
      -0.00180 * sind(Mp - 2 * F) +
      -0.00070 * sind(Mp + 2 * F) +
      -0.00040 * sind(3 * Mp) +
      -0.00034 * E * sind(2 * Mp - M) +
      0.00032 * E * sind(M + 2 * F) +
      0.00032 * E * sind(M - 2 * F) +
      -0.00028 * E * E * sind(Mp + 2 * M) +
      0.00027 * E * sind(2 * Mp + M) +
      -0.00017 * sind(Omega);

    // Additional "W" correction: add +0.00306 for first quarter,
    // subtract it for last quarter.
    const W =
      0.00306 -
      0.00038 * E * cosd(M) +
      0.00026 * cosd(Mp) -
      0.00002 * cosd(Mp - M) +
      0.00002 * cosd(Mp + M) +
      0.00002 * cosd(2 * F);
    corr += Math.abs(frac - 0.25) < 1e-6 ? W : -W;
  }

  jde += corr;
  return jde;
}

/**
 * Find the first occurrence of the given principal phase strictly after
 * `after`. Uses Meeus' lunation-index seeding (eqn 49.2) and then walks
 * forward over the small set of candidate k values.
 */
export function nextPhase(after: Date, which: PrincipalPhase): Date {
  // Seed k from the target decimal year (eqn 49.2). This gives a value
  // within a lunation of the true answer; we snap to the correct
  // fractional offset and then step forward in integer increments of k
  // until the resulting JDE is strictly after `after`.
  const kSeed = (decimalYear(after) - 2000) * 12.3685;
  const offset = PHASE_K_OFFSET[which];
  // Snap down to the nearest k with the correct fractional part.
  let k = Math.floor(kSeed - offset) + offset;

  const afterJd = after.getTime() / 86400000 + 2440587.5;
  // Require a strict forward step of at least a few seconds. This
  // prevents the loop from returning `after` itself when `after` is
  // the exact output of a previous call (jdToDate → getTime → jd
  // doesn't always round-trip bit-identically).
  const minAdvanceJd = 1 / 86400; // one second

  // At most a handful of forward steps are ever needed.
  for (let i = 0; i < 4; i++) {
    const jde = phaseJDE(k);
    if (jde > afterJd + minAdvanceJd) return jdToDate(jde);
    k += 1;
  }
  // Safety net — shouldn't reach here.
  return jdToDate(phaseJDE(k));
}

/**
 * The next `count` principal phases after `after`, in chronological
 * order. Default is 4 (one full lunation's worth: new, first quarter,
 * full, last quarter). `count > 4` walks into the next lunation(s).
 */
export function upcomingPhases(
  after: Date,
  count = 4,
): Array<{ phase: PrincipalPhase; date: Date }> {
  // Maintain a four-entry priority queue: the next upcoming occurrence
  // of each phase kind. On each iteration pick the earliest, emit it,
  // then replenish that slot with its successor (one synodic period
  // later). All four kinds are always represented so the pick is a
  // trivial min over four entries.
  const queue: Record<PrincipalPhase, Date> = {
    "new": nextPhase(after, "new"),
    "first-quarter": nextPhase(after, "first-quarter"),
    "full": nextPhase(after, "full"),
    "last-quarter": nextPhase(after, "last-quarter"),
  };

  const result: Array<{ phase: PrincipalPhase; date: Date }> = [];
  while (result.length < count) {
    // Find the earliest entry currently in the queue.
    let best: PrincipalPhase = "new";
    let bestTime = queue.new.getTime();
    for (const p of PHASE_ORDER) {
      const t = queue[p].getTime();
      if (t < bestTime) {
        best = p;
        bestTime = t;
      }
    }
    result.push({ phase: best, date: queue[best] });
    // Replenish: next occurrence of *this* phase kind, after the one
    // we just emitted.
    queue[best] = nextPhase(queue[best], best);
  }
  return result;
}
