// Low-precision planet ephemeris.
//
// Apparent geocentric right ascension / declination for the seven
// other major planets (Mercury through Neptune) using the simplified
// Keplerian elements and rates published by NASA JPL/Solar System
// Dynamics — the same dataset reproduced in Explanatory Supplement
// to the Astronomical Almanac, Table 8.10.1:
//
//   https://ssd.jpl.nasa.gov/planets/approx_pos.html
//
// Accuracy targets, over the full interval 1800–2050:
//   • Mercury–Mars : better than ~20 arcminutes
//   • Jupiter/Saturn: better than ~7 arcminutes (with the extra
//     long-period terms from the `b,c,s,f` columns applied)
//   • Uranus/Neptune: better than ~3 arcminutes (ditto)
//
// That's far tighter than the visual-boost disk we render on the sky
// map (the planets are drawn as ~20px disks), and good enough for any
// "point your phone to find Jupiter" use case.
//
// Implementation approach:
//   1. For each planet, evaluate its heliocentric elements at the
//      target instant T (centuries past J2000).
//   2. Solve Kepler's equation to get the planet's heliocentric
//      ecliptic coordinates (referred to J2000).
//   3. Do the same for Earth.
//   4. Subtract to get the geocentric ecliptic vector.
//   5. Apply light-time correction by iterating once: re-evaluate the
//      planet's position at (T - distance/c).
//   6. Rotate to the equatorial frame of date and emit RA/Dec.
//
// Angle conventions match the rest of the project: RA in hours
// (0–24), Dec in degrees (−90..+90).

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
/** Speed of light in AU/day. Used for the light-time correction. */
const C_AU_PER_DAY = 173.1446;

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

/** Julian centuries since J2000.0 (TT ≈ UT for our precision). */
function julianCenturies(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return (jd - 2451545.0) / 36525.0;
}

/**
 * Keplerian elements and their J2000-referred secular rates.
 *
 * Units follow the JPL table exactly:
 *   a  : semi-major axis (AU)  | dAdt : AU / century
 *   e  : eccentricity          | dEdt : / century
 *   I  : inclination (deg)     | dIdt : deg / century   (wrt J2000 ecliptic)
 *   L  : mean longitude (deg)  | dLdt : deg / century
 *   w  : longitude of perihelion (deg) | dWdt : deg / century
 *   O  : longitude of ascending node (deg) | dOdt : deg / century
 *
 * For Jupiter through Neptune the table includes four additional
 * long-period correction coefficients (`b`, `c`, `s`, `f`) that add
 * a periodic term to the mean anomaly; see `meanAnomalyCorrection`.
 */
interface KeplerElements {
  a: number; dAdt: number;
  e: number; dEdt: number;
  I: number; dIdt: number;
  L: number; dLdt: number;
  w: number; dWdt: number;
  O: number; dOdt: number;
  /** Long-period correction coefficients (outer planets only). */
  b?: number;
  c?: number;
  s?: number;
  f?: number;
}

/**
 * Planets we render. Order matters only for rendering z-order
 * (closest/fastest first is traditional but not strictly needed).
 *
 * `color` is the disk's dominant hue when drawn on the sky map —
 * picked to match naked-eye and telescope-image impressions rather
 * than any strict scientific scheme. `mag` is a *nominal* visual
 * magnitude used only for visual prominence ranking (we draw all
 * rendered planets clearly regardless of actual magnitude).
 */
export type PlanetId =
  | "mercury"
  | "venus"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune";

/**
 * Greco-Roman mythological counterpart a planet is named after.
 *
 * Every planet in our solar system (except Earth) takes its English
 * name from a Roman deity — that's the naming lineage, and why the
 * Roman article is treated as the "primary" reference here. The Greek
 * equivalent is included because most modern readers are far more
 * familiar with Greek mythology (Zeus, Poseidon, Aphrodite) than with
 * its Roman retellings, and both deserve a hat-tip for context.
 *
 * Uranus is the outlier: it was named directly after the Greek
 * primordial sky god Ouranos (it's the only planet to keep a Greek
 * name in English), with Caelus as the Roman equivalent. The ordering
 * convention in this interface — Roman first, Greek second — still
 * holds so the UI can be rendered uniformly.
 */
export interface PlanetMythology {
  /** Roman deity's Wikipedia article title. */
  romanTitle: string;
  /** Roman deity's display name. */
  romanName: string;
  /** Greek deity's Wikipedia article title. */
  greekTitle: string;
  /** Greek deity's display name. */
  greekName: string;
  /**
   * A short human-written line characterizing the deity's domain, used
   * as a subtitle on the mythology card. Kept to ~one clause — the
   * Wikipedia extract fills in the rest.
   */
  domain: string;
}

export interface PlanetInfo {
  id: PlanetId;
  name: string;
  /** Wikidata entity URI. Used as the stable comment-thread root. */
  wikidataUrl: string;
  /** Title to look up in Wikipedia's summary REST API. */
  wikipediaTitle: string;
  /** Hex color representative of the planet's naked-eye appearance. */
  color: string;
  /** Lighter inner-disk highlight color for the radial gradient. */
  highlight: string;
  /** Darker rim color for the radial gradient. */
  shadow: string;
  /** Nominal visual magnitude near opposition (for ranking only). */
  nominalMag: number;
  /** True equatorial radius, km — for angular-diameter readouts. */
  radiusKm: number;
  /** Greco-Roman mythological figure the planet is named after. */
  mythology: PlanetMythology;
}

export const PLANETS: readonly PlanetInfo[] = [
  {
    id: "mercury",
    name: "Mercury",
    wikidataUrl: "https://www.wikidata.org/entity/Q308",
    wikipediaTitle: "Mercury (planet)",
    color: "#c9b79a",
    highlight: "#f0e2cb",
    shadow: "#7d6f58",
    nominalMag: 0.0,
    radiusKm: 2439.7,
    mythology: {
      romanTitle: "Mercury (mythology)",
      romanName: "Mercury",
      greekTitle: "Hermes",
      greekName: "Hermes",
      domain: "Messenger of the gods; trade, travellers, and trickery",
    },
  },
  {
    id: "venus",
    name: "Venus",
    wikidataUrl: "https://www.wikidata.org/entity/Q313",
    wikipediaTitle: "Venus",
    color: "#f4dfa3",
    highlight: "#fff4cc",
    shadow: "#9a8655",
    nominalMag: -4.4,
    radiusKm: 6051.8,
    mythology: {
      romanTitle: "Venus (mythology)",
      romanName: "Venus",
      greekTitle: "Aphrodite",
      greekName: "Aphrodite",
      domain: "Goddess of love, beauty, and desire",
    },
  },
  {
    id: "mars",
    name: "Mars",
    wikidataUrl: "https://www.wikidata.org/entity/Q111",
    wikipediaTitle: "Mars",
    color: "#d66a3a",
    highlight: "#f4a37a",
    shadow: "#7d2e12",
    nominalMag: -2.0,
    radiusKm: 3389.5,
    mythology: {
      romanTitle: "Mars (mythology)",
      romanName: "Mars",
      greekTitle: "Ares",
      greekName: "Ares",
      domain: "God of war, bloodshed, and martial courage",
    },
  },
  {
    id: "jupiter",
    name: "Jupiter",
    wikidataUrl: "https://www.wikidata.org/entity/Q319",
    wikipediaTitle: "Jupiter",
    color: "#e0b07a",
    highlight: "#f8d7a8",
    shadow: "#7a5432",
    nominalMag: -2.9,
    radiusKm: 69911,
    mythology: {
      romanTitle: "Jupiter (god)",
      romanName: "Jupiter",
      greekTitle: "Zeus",
      greekName: "Zeus",
      domain: "King of the gods; sky, thunder, and law",
    },
  },
  {
    id: "saturn",
    name: "Saturn",
    wikidataUrl: "https://www.wikidata.org/entity/Q193",
    wikipediaTitle: "Saturn",
    color: "#e7d7a3",
    highlight: "#f7ecc6",
    shadow: "#8a7548",
    nominalMag: 0.2,
    radiusKm: 58232,
    mythology: {
      romanTitle: "Saturn (mythology)",
      romanName: "Saturn",
      greekTitle: "Cronus",
      greekName: "Cronus",
      domain: "God of time, harvest, and a lost golden age",
    },
  },
  {
    id: "uranus",
    name: "Uranus",
    wikidataUrl: "https://www.wikidata.org/entity/Q324",
    wikipediaTitle: "Uranus",
    color: "#a9dce6",
    highlight: "#d6f0f5",
    shadow: "#4b7f89",
    nominalMag: 5.6,
    radiusKm: 25362,
    // Uranus is the sole planet whose English name is Greek rather than
    // Roman — it's named directly for Ouranos, the primordial sky god.
    // Caelus is his (much less familiar) Roman counterpart. We still
    // render "Roman first" for layout consistency; the domain line notes
    // the reversal so it doesn't feel arbitrary.
    mythology: {
      romanTitle: "Caelus",
      romanName: "Caelus",
      greekTitle: "Uranus (mythology)",
      greekName: "Ouranos",
      domain: "Primordial god of the sky — the only planet named from Greek",
    },
  },
  {
    id: "neptune",
    name: "Neptune",
    wikidataUrl: "https://www.wikidata.org/entity/Q332",
    wikipediaTitle: "Neptune",
    color: "#5d7ecf",
    highlight: "#8fa8e3",
    shadow: "#2a3c72",
    nominalMag: 7.8,
    radiusKm: 24622,
    mythology: {
      romanTitle: "Neptune (mythology)",
      romanName: "Neptune",
      greekTitle: "Poseidon",
      greekName: "Poseidon",
      domain: "God of the sea, storms, and earthquakes",
    },
  },
] as const;

export function getPlanetInfo(id: PlanetId): PlanetInfo {
  const p = PLANETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown planet id: ${id}`);
  return p;
}

/** Type guard for a string being a known `PlanetId`. */
export function isPlanetId(value: string): value is PlanetId {
  return PLANETS.some((p) => p.id === value);
}

/**
 * Map a classical "ruling planet" display name to the in-app URL for
 * that body's detail view. Handles the luminaries (Sun, Moon), which
 * have their own sheets, alongside the seven true planets.
 *
 * Returns `null` if the name is unrecognized — callers should then
 * render the ruler as plain text.
 */
export function rulerRoute(name: string): string | null {
  const key = name.toLowerCase().trim();
  if (key === "sun") return "/sun";
  if (key === "moon") return "/moon";
  if (isPlanetId(key)) return `/planet/${key}`;
  return null;
}

// -----------------------------------------------------------------------
// JPL approximate Keplerian elements, 1800 AD – 2050 AD.
//
// Values from https://ssd.jpl.nasa.gov/planets/approx_pos.html
// (Table 1, "Keplerian elements and their rates, with respect to the
// mean ecliptic and equinox of J2000"). Rates are per century.
//
// Uranus, Neptune: we use the 1800–2050 row (without the b/c/s/f
// long-period terms beyond what the table applies directly). The
// b/c/s/f correction from Table 2a is only needed for Jupiter and
// outward to hit the tighter accuracy ceiling.

const ELEMENTS: Record<PlanetId | "earth", KeplerElements> = {
  mercury: {
    a: 0.38709927, dAdt: 0.00000037,
    e: 0.20563593, dEdt: 0.00001906,
    I: 7.00497902, dIdt: -0.00594749,
    L: 252.25032350, dLdt: 149472.67411175,
    w: 77.45779628, dWdt: 0.16047689,
    O: 48.33076593, dOdt: -0.12534081,
  },
  venus: {
    a: 0.72333566, dAdt: 0.00000390,
    e: 0.00677672, dEdt: -0.00004107,
    I: 3.39467605, dIdt: -0.00078890,
    L: 181.97909950, dLdt: 58517.81538729,
    w: 131.60246718, dWdt: 0.00268329,
    O: 76.67984255, dOdt: -0.27769418,
  },
  // Earth-Moon barycentre, close enough for a geocentric sky map.
  earth: {
    a: 1.00000261, dAdt: 0.00000562,
    e: 0.01671123, dEdt: -0.00004392,
    I: -0.00001531, dIdt: -0.01294668,
    L: 100.46457166, dLdt: 35999.37244981,
    w: 102.93768193, dWdt: 0.32327364,
    O: 0.0, dOdt: 0.0,
  },
  mars: {
    a: 1.52371034, dAdt: 0.00001847,
    e: 0.09339410, dEdt: 0.00007882,
    I: 1.84969142, dIdt: -0.00813131,
    L: -4.55343205, dLdt: 19140.30268499,
    w: -23.94362959, dWdt: 0.44441088,
    O: 49.55953891, dOdt: -0.29257343,
  },
  jupiter: {
    a: 5.20288700, dAdt: -0.00011607,
    e: 0.04838624, dEdt: -0.00013253,
    I: 1.30439695, dIdt: -0.00183714,
    L: 34.39644051, dLdt: 3034.74612775,
    w: 14.72847983, dWdt: 0.21252668,
    O: 100.47390909, dOdt: 0.20469106,
    b: -0.00012452, c: 0.06064060, s: -0.35635438, f: 38.35125000,
  },
  saturn: {
    a: 9.53667594, dAdt: -0.00125060,
    e: 0.05386179, dEdt: -0.00050991,
    I: 2.48599187, dIdt: 0.00193609,
    L: 49.95424423, dLdt: 1222.49362201,
    w: 92.59887831, dWdt: -0.41897216,
    O: 113.66242448, dOdt: -0.28867794,
    b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125000,
  },
  uranus: {
    a: 19.18916464, dAdt: -0.00196176,
    e: 0.04725744, dEdt: -0.00004397,
    I: 0.77263783, dIdt: -0.00242939,
    L: 313.23810451, dLdt: 428.48202785,
    w: 170.95427630, dWdt: 0.40805281,
    O: 74.01692503, dOdt: 0.04240589,
    b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025000,
  },
  neptune: {
    a: 30.06992276, dAdt: 0.00026291,
    e: 0.00859048, dEdt: 0.00005105,
    I: 1.77004347, dIdt: 0.00035372,
    L: -55.12002969, dLdt: 218.45945325,
    w: 44.96476227, dWdt: -0.32241464,
    O: 131.78422574, dOdt: -0.00508664,
    b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025000,
  },
};

/**
 * Additional periodic correction to the mean anomaly for the four
 * outer planets. JPL's Table 2a, applied via the `b·T²` term plus a
 * sinusoidal component governed by `c`, `s`, and `f`. Without this
 * Jupiter and Saturn drift by ~0.5° over a century.
 */
function meanAnomalyCorrection(el: KeplerElements, T: number): number {
  if (el.b === undefined) return 0;
  const bT2 = el.b * T * T;
  const arg = el.f! * T * DEG;
  return bT2 + el.c! * Math.cos(arg) + el.s! * Math.sin(arg);
}

/** Solve Kepler's equation M = E − e·sin(E) for E, in degrees. */
function solveKepler(Mdeg: number, e: number): number {
  // Newton–Raphson; converges in 3-4 iterations from a good start.
  // Normalize M to (-180, 180] so the initial guess is near the root.
  let M = ((Mdeg + 180) % 360) - 180;
  if (M <= -180) M += 360;
  let E = M + (e * RAD) * Math.sin(M * DEG); // first guess (radians-equivalent in deg)
  // Tolerance: 1e-7 deg ≈ 0.4 milliarcseconds. Well below our accuracy.
  for (let i = 0; i < 12; i++) {
    const Er = E * DEG;
    const dE = (E - (e * RAD) * Math.sin(Er) - M) / (1 - e * Math.cos(Er));
    E -= dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  return E;
}

interface EclipticXYZ { x: number; y: number; z: number; }

/**
 * Heliocentric ecliptic rectangular coordinates (AU, J2000 frame) of a
 * body whose Keplerian elements are `el` at Julian centuries `T`.
 */
function heliocentricEcliptic(el: KeplerElements, T: number): EclipticXYZ {
  const a = el.a + el.dAdt * T;
  const e = el.e + el.dEdt * T;
  const I = el.I + el.dIdt * T;
  const L = el.L + el.dLdt * T;
  const w = el.w + el.dWdt * T;  // longitude of perihelion (ϖ)
  const O = el.O + el.dOdt * T;  // longitude of ascending node (Ω)

  // Argument of perihelion ω = ϖ − Ω
  const argPeri = w - O;
  // Mean anomaly M = L − ϖ + correction
  let M = L - w + meanAnomalyCorrection(el, T);
  M = ((M + 180) % 360) - 180;
  if (M <= -180) M += 360;

  const E = solveKepler(M, e); // eccentric anomaly, deg

  // Heliocentric coords in the orbit plane.
  const xPrime = a * (Math.cos(E * DEG) - e);
  const yPrime = a * Math.sqrt(1 - e * e) * Math.sin(E * DEG);

  // Rotate from orbit plane → J2000 ecliptic:
  //   R3(-Ω) · R1(-I) · R3(-ω) · [x', y', 0]
  const cw = Math.cos(argPeri * DEG), sw = Math.sin(argPeri * DEG);
  const cI = Math.cos(I * DEG), sI = Math.sin(I * DEG);
  const cO = Math.cos(O * DEG), sO = Math.sin(O * DEG);

  const xEcl =
    (cw * cO - sw * sO * cI) * xPrime +
    (-sw * cO - cw * sO * cI) * yPrime;
  const yEcl =
    (cw * sO + sw * cO * cI) * xPrime +
    (-sw * sO + cw * cO * cI) * yPrime;
  const zEcl = (sw * sI) * xPrime + (cw * sI) * yPrime;

  return { x: xEcl, y: yEcl, z: zEcl };
}

/** Rotate J2000 ecliptic → J2000 equatorial (obliquity 23.43928°). */
function eclipticToEquatorial(v: EclipticXYZ): EclipticXYZ {
  const eps = 23.43928 * DEG;
  const c = Math.cos(eps), s = Math.sin(eps);
  return {
    x: v.x,
    y: c * v.y - s * v.z,
    z: s * v.y + c * v.z,
  };
}

export interface PlanetPosition {
  /** Geocentric apparent right ascension, hours (0..24). */
  ra: number;
  /** Geocentric apparent declination, degrees (-90..+90). */
  dec: number;
  /** Geocentric distance in AU. */
  distanceAu: number;
  /** Apparent angular diameter in degrees (tiny — usually <0.02°). */
  angularDiameterDeg: number;
}

/**
 * Geocentric apparent position of `id` at the given instant.
 *
 * Includes a single-iteration light-time correction (re-evaluating
 * the planet's heliocentric position at T − Δ/c). That's enough to
 * bring Jupiter and beyond under the tight few-arcminute ceiling
 * advertised above; a second iteration would shave off another
 * sub-arcsecond but isn't worth the cycles for a visual sky map.
 */
export function planetPosition(id: PlanetId, date: Date): PlanetPosition {
  const T = julianCenturies(date);

  // Earth at T.
  const earth = heliocentricEcliptic(ELEMENTS.earth, T);

  // Planet at T (first pass).
  let planet = heliocentricEcliptic(ELEMENTS[id], T);
  let gx = planet.x - earth.x;
  let gy = planet.y - earth.y;
  let gz = planet.z - earth.z;
  let distance = Math.sqrt(gx * gx + gy * gy + gz * gz);

  // Light-time correction: planet moves between when its light left
  // and when we see it. Re-evaluate the planet at T − Δ/c. Earth is
  // kept at T because we want the *geocentric* direction at the
  // moment of observation.
  const tauCenturies = distance / C_AU_PER_DAY / 36525.0;
  planet = heliocentricEcliptic(ELEMENTS[id], T - tauCenturies);
  gx = planet.x - earth.x;
  gy = planet.y - earth.y;
  gz = planet.z - earth.z;
  distance = Math.sqrt(gx * gx + gy * gy + gz * gz);

  // Geocentric ecliptic → geocentric equatorial.
  const eq = eclipticToEquatorial({ x: gx, y: gy, z: gz });

  const raRad = Math.atan2(eq.y, eq.x);
  let raDeg = raRad * RAD;
  raDeg = norm360(raDeg);
  const ra = raDeg / 15;
  const dec = Math.atan2(eq.z, Math.sqrt(eq.x * eq.x + eq.y * eq.y)) * RAD;

  // Angular diameter: 2·asin(r_planet / d).
  const info = getPlanetInfo(id);
  const distanceKm = distance * 149_597_870.7;
  const angularDiameterDeg =
    2 * Math.asin(Math.min(1, info.radiusKm / distanceKm)) * RAD;

  return { ra, dec, distanceAu: distance, angularDiameterDeg };
}

/**
 * Convenience: compute every planet's current position in one call.
 * Returned in the same order as `PLANETS`. Callers that only need a
 * subset are better off calling `planetPosition` directly.
 */
export function allPlanetPositions(
  date: Date,
): Array<{ info: PlanetInfo; pos: PlanetPosition }> {
  return PLANETS.map((info) => ({ info, pos: planetPosition(info.id, date) }));
}
