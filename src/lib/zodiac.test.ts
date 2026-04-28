import { describe, it, expect } from "vitest";

import { STARS_BY_HIP } from "./stars";
import { ZODIAC_SIGNS } from "./zodiac";
import { ZODIAC_EDGES } from "./zodiacLines";

/**
 * Expected IAU 3-letter constellation code for each zodiac sign.
 * Used to verify that every HIP referenced in a zodiac's edge list
 * actually sits inside the matching IAU constellation — otherwise we
 * know the upstream line data picked up the wrong star.
 */
const EXPECTED_CONSTELLATION: Record<string, string> = {
  aries: "Ari",
  taurus: "Tau",
  gemini: "Gem",
  cancer: "Cnc",
  leo: "Leo",
  virgo: "Vir",
  libra: "Lib",
  scorpius: "Sco",
  sagittarius: "Sgr",
  capricornus: "Cap",
  aquarius: "Aqr",
  pisces: "Psc",
};

/**
 * A small set of stars we expect every plausible stick figure of the
 * given sign to reference. These are the canonical brightest/alpha
 * stars: if one of these drops out we want a loud test failure, not a
 * silent visual regression.
 */
const MUST_INCLUDE: Record<string, number[]> = {
  aries: [9884], // Hamal (α Ari)
  taurus: [21421, 25428], // Aldebaran (α), Elnath (β)
  gemini: [36850, 37826], // Castor (α), Pollux (β)
  cancer: [40526], // Tarf (β Cnc) — brightest in Cancer
  leo: [49669, 57632], // Regulus (α), Denebola (β)
  virgo: [65474], // Spica (α)
  libra: [72622, 74785], // Zubenelgenubi (α²), Zubeneschamali (β)
  scorpius: [80763, 85927], // Antares (α), Shaula (λ)
  sagittarius: [90185, 92855], // Kaus Australis (ε), Nunki (σ)
  capricornus: [107556], // Deneb Algedi (δ) — brightest in Capricornus
  aquarius: [106278, 109074], // Sadalsuud (β), Sadalmelik (α)
  pisces: [9487], // Alrescha (α Psc) — the knot between the fishes
};

describe("zodiac edges derived from d3-celestial", () => {
  it("defines edges for all 12 zodiac signs", () => {
    for (const sign of ZODIAC_SIGNS) {
      expect(sign.edges.length, `${sign.id} has no edges`).toBeGreaterThan(0);
    }
    expect(Object.keys(ZODIAC_EDGES)).toHaveLength(12);
  });

  it("references only stars that exist in the catalog", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const [a, b] of sign.edges) {
        expect(
          STARS_BY_HIP.get(a),
          `${sign.id}: HIP ${a} not in catalog`,
        ).toBeDefined();
        expect(
          STARS_BY_HIP.get(b),
          `${sign.id}: HIP ${b} not in catalog`,
        ).toBeDefined();
      }
    }
  });

  it("references only stars inside the matching IAU constellation", () => {
    // The canonical zodiac line figures are entirely within their own
    // constellation — no stars borrowed from neighbouring regions
    // (unlike, say, Pegasus/Andromeda which share Alpheratz). If this
    // ever starts failing, the upstream line data has been changed to
    // reach into another constellation and we need to decide whether
    // to accept that.
    for (const sign of ZODIAC_SIGNS) {
      const expected = EXPECTED_CONSTELLATION[sign.id];
      for (const [a, b] of sign.edges) {
        for (const hip of [a, b]) {
          const star = STARS_BY_HIP.get(hip);
          expect(star, `${sign.id}: HIP ${hip} missing`).toBeDefined();
          expect(
            star?.constellation,
            `${sign.id}: HIP ${hip} (${star?.name ?? star?.bayer}) is in ${star?.constellation}, expected ${expected}`,
          ).toBe(expected);
        }
      }
    }
  });

  it("has no self-loops or duplicate edges", () => {
    for (const sign of ZODIAC_SIGNS) {
      const seen = new Set<string>();
      for (const [a, b] of sign.edges) {
        expect(a, `${sign.id}: self-loop on HIP ${a}`).not.toBe(b);
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        expect(
          seen.has(key),
          `${sign.id}: duplicate edge ${a}-${b}`,
        ).toBe(false);
        seen.add(key);
      }
    }
  });

  it("produces a connected figure (allowing a small number of components)", () => {
    // A real stick figure should be essentially connected; a handful of
    // signs (Pisces especially, with its circlet + cord + northern fish)
    // legitimately have up to ~3 components in the canonical data, but
    // more than that suggests something is broken.
    for (const sign of ZODIAC_SIGNS) {
      const adj = new Map<number, Set<number>>();
      for (const [a, b] of sign.edges) {
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
      const visited = new Set<number>();
      let components = 0;
      for (const node of adj.keys()) {
        if (visited.has(node)) continue;
        components += 1;
        const stack = [node];
        while (stack.length > 0) {
          const n = stack.pop()!;
          if (visited.has(n)) continue;
          visited.add(n);
          for (const m of adj.get(n) ?? []) stack.push(m);
        }
      }
      expect(
        components,
        `${sign.id}: ${components} disjoint components (edges may be broken)`,
      ).toBeLessThanOrEqual(3);
    }
  });

  it("includes the canonical brightest/alpha stars of each sign", () => {
    for (const sign of ZODIAC_SIGNS) {
      const referenced = new Set<number>();
      for (const [a, b] of sign.edges) {
        referenced.add(a);
        referenced.add(b);
      }
      for (const hip of MUST_INCLUDE[sign.id] ?? []) {
        expect(
          referenced.has(hip),
          `${sign.id}: canonical star HIP ${hip} missing from figure`,
        ).toBe(true);
      }
    }
  });
});
