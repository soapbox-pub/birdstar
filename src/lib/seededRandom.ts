// Small deterministic-random primitives shared across features that
// need stable "pick one of many" results keyed by something like a
// calendar day + subject. Consolidated here so we don't triplicate
// the same FNV-1a + Mulberry32 pair across `horoscope.ts`,
// `ConstellationPreview.tsx`, and the bird-of-the-day picker.

/**
 * Returns the ISO `YYYY-MM-DD` date key in the user's local timezone.
 *
 * Local (not UTC) is deliberate: date-keyed features read as "today"
 * to the reader, and a user flipping past midnight local time should
 * see a new value even if UTC hasn't rolled over yet.
 */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * FNV-1a 32-bit hash of a string. Small, dependency-free, and stable
 * across platforms — which is all we need for seeding the PRNG.
 */
export function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 PRNG. Same generator used by `ConstellationPreview.tsx`
 * and the daily horoscope so the codebase has one deterministic-random
 * primitive rather than several subtly-different ones.
 */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a deterministic element from an array using a seeded PRNG. */
export function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}
