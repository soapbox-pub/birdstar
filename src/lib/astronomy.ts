// Astronomical coordinate conversions
// Converts equatorial coordinates (RA, Dec) to horizontal (Alt, Az)
// Based on standard formulas from "Astronomical Algorithms" by Jean Meeus

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Julian Date from JS Date */
export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Greenwich Mean Sidereal Time in hours (0–24) */
export function gmst(date: Date): number {
  const jd = julianDate(date);
  const T = (jd - 2451545.0) / 36525.0;
  // Meeus formula 12.4
  let gmstDeg =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    T * T * 0.000387933 -
    (T * T * T) / 38710000;
  gmstDeg = ((gmstDeg % 360) + 360) % 360;
  return gmstDeg / 15; // hours
}

/** Local Sidereal Time in hours (0–24) */
export function lst(date: Date, longitudeDeg: number): number {
  const l = gmst(date) + longitudeDeg / 15;
  return ((l % 24) + 24) % 24;
}

export interface HorizontalCoord {
  alt: number; // degrees, -90..90 (above horizon > 0)
  az: number;  // degrees, 0..360 (0 = North, 90 = East)
}

/**
 * Convert equatorial (RA in hours, Dec in degrees) to horizontal (alt/az in degrees)
 * for an observer at the given lat/lon and time.
 */
export function equatorialToHorizontal(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  date: Date,
): HorizontalCoord {
  const LST = lst(date, lonDeg); // hours
  const H = (LST - raHours) * 15; // hour angle in degrees
  const Hr = H * DEG;
  const dr = decDeg * DEG;
  const lr = latDeg * DEG;

  const sinAlt = Math.sin(dr) * Math.sin(lr) + Math.cos(dr) * Math.cos(lr) * Math.cos(Hr);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const y = -Math.cos(dr) * Math.cos(lr) * Math.sin(Hr);
  // actually Meeus: sin A = -sin H cos δ / cos alt
  // Using atan2 for robust quadrant:
  const cosA = (Math.sin(dr) - Math.sin(alt) * Math.sin(lr)) / (Math.cos(alt) * Math.cos(lr));
  const sinA = -Math.sin(Hr) * Math.cos(dr) / Math.cos(alt);
  let az = Math.atan2(sinA, cosA) * RAD;
  az = ((az % 360) + 360) % 360;
  void y;

  return { alt: alt * RAD, az };
}

/** A 3D unit vector from alt/az (az from north clockwise) */
export function altAzToVector(altDeg: number, azDeg: number): [number, number, number] {
  const a = altDeg * DEG;
  const z = azDeg * DEG;
  // Convention: x = east, y = north, z = up
  const x = Math.cos(a) * Math.sin(z);
  const y = Math.cos(a) * Math.cos(z);
  const zz = Math.sin(a);
  return [x, y, zz];
}

/**
 * Inverse of `altAzToVector`. Returns alt in [-90, 90] and az in [0, 360).
 * Exactly at the poles (|alt| = 90°) the azimuth is undefined; we return 0
 * so the caller can keep any previous azimuth of their choosing by
 * checking for that case before applying.
 */
export function vectorToAltAz(
  v: [number, number, number],
): { alt: number; az: number } {
  const [x, y, z] = v;
  const len = Math.hypot(x, y, z) || 1;
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;
  const alt = Math.asin(Math.max(-1, Math.min(1, nz))) * RAD;
  // atan2(east, north) gives 0° at north, +90° at east — matches the
  // convention in `altAzToVector`.
  let az = Math.atan2(nx, ny) * RAD;
  az = ((az % 360) + 360) % 360;
  return { alt, az };
}
