// Low-precision Sun ephemeris.
//
// Implements the simplified solar position formula from Jean Meeus,
// "Astronomical Algorithms" (2nd ed.), Chapter 25. Accurate to better
// than 0.01° in position for the next few centuries — more than
// enough for a visual sky map where the Sun is drawn half a degree
// across.
//
// Unlike the Moon the Sun has no phase and its angular diameter barely
// changes through the year (~0.5245° at aphelion to ~0.5420° at
// perihelion), so the returned shape is simpler. We still report it
// so the renderer can scale the disk the same way it scales the Moon.
//
// Angle conventions match the rest of the project: right ascension in
// hours (0–24), declination in degrees (−90 to +90).
//
// Eclipse prediction lives in a separate file (`./solarEclipses.ts`)
// because it's a hand-curated NASA table rather than a computation.

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

export interface SunPosition {
  /** Geocentric apparent right ascension in hours (0..24). */
  ra: number;
  /** Geocentric apparent declination in degrees (-90..90). */
  dec: number;
  /** Apparent ecliptic longitude in degrees (0..360). */
  eclipticLon: number;
  /** Earth–Sun distance in AU. */
  distanceAu: number;
  /** Earth–Sun distance in km. */
  distanceKm: number;
  /**
   * Apparent angular diameter of the Sun in degrees as seen from
   * Earth's centre. Varies slightly through the year (~0.524°–0.542°).
   */
  angularDiameterDeg: number;
}

/**
 * Geocentric apparent position of the Sun at the given instant
 * (Meeus Ch. 25, low-precision formula).
 *
 * This is the short series good to ~0.01° through the whole modern
 * era — we don't need the full VSOP87 apparatus here. Nutation and
 * aberration are both folded into the final apparent longitude, so
 * the returned RA/Dec are suitable for drawing directly on the sky
 * map without further correction.
 */
export function sunPosition(date: Date): SunPosition {
  const T = julianCenturies(date);

  // Meeus 25.2 — geometric mean longitude of the Sun.
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);

  // Meeus 25.3 — mean anomaly of the Sun.
  const M = norm360(
    357.52911 + 35999.05029 * T - 0.0001537 * T * T,
  );

  // Meeus 25.4 — eccentricity of Earth's orbit.
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  // Meeus p.164 — equation of the centre.
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M) +
    (0.019993 - 0.000101 * T) * sind(2 * M) +
    0.000289 * sind(3 * M);

  /** True longitude of the Sun (degrees). */
  const trueLon = L0 + C;
  /** True anomaly of the Sun (degrees). */
  const trueAnom = M + C;

  // Meeus 25.5 — radius vector in AU.
  const R =
    (1.000001018 * (1 - e * e)) /
    (1 + e * cosd(trueAnom));

  // Meeus p.164 — apparent longitude, applying the nutation + aberration
  // correction. Ω is the Moon's ascending-node longitude (needed by the
  // nutation term here even though we're computing the Sun's position).
  const Omega = 125.04 - 1934.136 * T;
  const apparentLon = trueLon - 0.00569 - 0.00478 * sind(Omega);

  // Meeus 22.2 — mean obliquity of the ecliptic, plus the small
  // nutation term to get the "apparent" obliquity used for converting
  // apparent ecliptic coordinates to equatorial.
  const epsMean =
    23.439291 -
    0.0130042 * T -
    0.00000016 * T * T +
    0.000000504 * T * T * T;
  const epsApparent = epsMean + 0.00256 * cosd(Omega);

  // Ecliptic → equatorial. The Sun's ecliptic latitude is essentially
  // zero (below 1 arcsecond at this precision), so we set β = 0.
  const sinLon = sind(apparentLon);
  const cosLon = cosd(apparentLon);
  const sinEps = sind(epsApparent);
  const cosEps = cosd(epsApparent);

  const sinDec = sinEps * sinLon;
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec))) * RAD;

  let raDeg = Math.atan2(cosEps * sinLon, cosLon) * RAD;
  raDeg = norm360(raDeg);
  const ra = raDeg / 15; // hours

  // Distance in kilometres. 1 AU = 149,597,870.7 km (IAU 2012).
  const distanceKm = R * 149_597_870.7;

  // Apparent angular diameter: the Sun's physical radius is 695,700 km,
  // so the diameter subtends 2·asin(R☉/d). Over the year this runs
  // about 0.524°–0.542°.
  const angularDiameterDeg = 2 * Math.asin(695_700 / distanceKm) * RAD;

  return {
    ra,
    dec,
    eclipticLon: norm360(apparentLon),
    distanceAu: R,
    distanceKm,
    angularDiameterDeg,
  };
}
