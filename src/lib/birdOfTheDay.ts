// Deterministic "bird of the day" picker, preferring species observed
// near the user when we have a local-species map to lean on.
//
// Picks one species per (local calendar day, coarse lat/lon) so:
//
//   - Two users in the same ~100 km square see the same bird today,
//     enabling shared conversation ("did you look up today's bird?").
//   - A user moving to a different region gets a fresh pick rather
//     than carrying their last area's bird with them.
//   - Without any geolocation signal we still render *something*
//     from the BirdNET roster instead of going blank.
//
// Ranking logic when a local-species map is available:
//
//   1. Find the tightest iNat distance band that actually contains
//      some roster species. A bird seen within 25 km beats a bird
//      seen within 500 km — we want "bird I could plausibly spot
//      today", not "bird observed somewhere on this continent".
//   2. Draw one species from that band, weighted by observation
//      count so a species with 12,000 nearby sightings is preferred
//      over one with 2. Weighting uses sqrt(count) to soften the
//      tail: without it the top-10 species would monopolize every
//      daily slot for months on end, and the whole point of a
//      "today's bird" is variety.
//
// The fallback path (no local map, or the map is empty — e.g.
// manual-picker users, marine areas, iNat down, first load) picks
// uniformly from the full `isBird: true` roster so the card still
// renders usefully.

import type { BirdLabel } from "./birdnet/labels";
import {
  lookupLocal,
  type LocalSpeciesEntry,
  type LocalSpeciesMap,
  type LocalRadiusKm,
  LOCAL_RADII_KM,
} from "./inat/localSpecies";
import type { CoarseLatLon } from "@/hooks/useUserRegion";
import { fnv1a, localDateKey, mulberry32 } from "./seededRandom";

/**
 * How the bird-of-the-day was chosen. Surfaced so the UI can render
 * a contextual label ("seen within 25 km" vs. "from the BirdNET
 * roster") — otherwise a user with no iNat map and a user surrounded
 * by iNat observations would see identical cards with no hint why.
 */
export type BirdOfTheDaySource =
  | { kind: "nearby"; band: LocalRadiusKm; count: number }
  | { kind: "fallback"; reason: "no-location" | "no-local-data" };

export interface BirdOfTheDay {
  label: BirdLabel;
  source: BirdOfTheDaySource;
  /** The date key the pick was seeded with. Useful for debugging and
   * for labelling the card with a stable "today" date string. */
  dateKey: string;
}

/** Build the stable string we seed the PRNG with. */
function seedKey(dateKey: string, coarse: CoarseLatLon | null): string {
  // Joining on a character that won't appear in any of the parts
  // makes the string unambiguously invertible, which matters only if
  // we ever hash-collide-debug in the future. lat/lon are already
  // integers in `CoarseLatLon` (1°-rounded) so no formatting needed.
  if (coarse) return `bird-of-the-day:${dateKey}:${coarse.lat}:${coarse.lon}`;
  return `bird-of-the-day:${dateKey}:noloc`;
}

/**
 * Pick the tightest radius at which at least one species from our
 * roster was actually observed. Looking at map keys alone isn't
 * enough — iNat returns species that aren't in the BirdNET labels
 * file (rare hybrids, taxonomic splits, etc.), and we can't offer
 * those as "today's bird" because they wouldn't resolve in the Birds
 * dialog. So we intersect: for each band, is there a roster species
 * that iNat put in this band or tighter?
 *
 * Returns the band plus the subset of labels that fall in it, or
 * null if no roster species was observed anywhere in the 25–500 km
 * window.
 */
function tightestBandWithSpecies(
  birds: readonly BirdLabel[],
  map: LocalSpeciesMap,
): { band: LocalRadiusKm; matches: { label: BirdLabel; entry: LocalSpeciesEntry }[] } | null {
  // Walk bands from tightest to loosest. First hit wins.
  for (const band of LOCAL_RADII_KM) {
    const matches: { label: BirdLabel; entry: LocalSpeciesEntry }[] = [];
    for (const label of birds) {
      const entry = lookupLocal(map, label.scientificName);
      if (!entry || entry.band === null) continue;
      // Tighter-or-equal band: a species seen at 25 km is also "in"
      // the 50/100/etc bands, but we only need to find it once.
      if (entry.band <= band) {
        matches.push({ label, entry });
      }
    }
    if (matches.length > 0) return { band, matches };
  }
  return null;
}

/**
 * Weighted-random pick from a list keyed by some weight. Uses a
 * running-total / inverse-CDF approach so a single PRNG draw is
 * sufficient — both cheaper and more deterministic than the
 * rejection-sampling alternative.
 */
function weightedPick<T>(
  items: readonly { value: T; weight: number }[],
  rand: () => number,
): T {
  let total = 0;
  for (const item of items) total += item.weight;
  // Degenerate case: all weights zero. Fall back to uniform over the
  // item indices so callers don't have to special-case empty weights.
  if (total <= 0) return items[Math.floor(rand() * items.length)].value;
  const target = rand() * total;
  let acc = 0;
  for (const item of items) {
    acc += item.weight;
    if (target < acc) return item.value;
  }
  // Floating-point slop at the very top of the range; the last item
  // is the mathematically correct fallback.
  return items[items.length - 1].value;
}

/**
 * Pick the bird-of-the-day for the given date and location.
 *
 * Returns null only when the labels list has no `isBird` entries,
 * which in practice means `useBirdLabels()` hasn't resolved yet.
 * Callers should render a skeleton in that case.
 *
 * @param labels  Full BirdNET label list from `useBirdLabels()`.
 * @param localMap iNat nearby-species map from `useLocalSpeciesBands()`.
 *                 Pass `null` when not available — the pick falls back
 *                 to a uniform draw over the full roster.
 * @param coarse  Coarse lat/lon from `useUserRegion()`. Pass `null`
 *                when the user hasn't shared location; the pick will
 *                still be deterministic per-day but not location-varying.
 * @param date    Normally `new Date()`; injectable for tests.
 */
export function birdOfTheDay(
  labels: readonly BirdLabel[],
  localMap: LocalSpeciesMap | null,
  coarse: CoarseLatLon | null,
  date: Date,
): BirdOfTheDay | null {
  const birds = labels.filter((l) => l.isBird);
  if (birds.length === 0) return null;

  const dateKey = localDateKey(date);
  const seed = fnv1a(seedKey(dateKey, coarse));
  const rand = mulberry32(seed);

  // Primary path: we have an iNat map and at least one roster species
  // was observed in the 25–500 km window.
  if (localMap) {
    const tightest = tightestBandWithSpecies(birds, localMap);
    if (tightest) {
      const picked = weightedPick(
        tightest.matches.map(({ label, entry }) => ({
          value: { label, entry },
          // sqrt(count) softens the long tail — a species with 10,000
          // sightings shouldn't dominate a species with 100 by a
          // factor of 100. Min weight of 1 keeps a rare-but-present
          // species in the draw.
          weight: Math.max(1, Math.sqrt(entry.count)),
        })),
        rand,
      );
      // `picked.entry.band` is the species's *own* tightest band,
      // which is always <= the enclosing `tightest.band`. Report the
      // species's own band on the card since that's the more
      // informative "seen within X km" statement.
      return {
        label: picked.label,
        source: {
          kind: "nearby",
          band: picked.entry.band as LocalRadiusKm,
          count: picked.entry.count,
        },
        dateKey,
      };
    }
  }

  // Fallback: no map, empty map, or no roster species observed in
  // range. Uniform draw from the full roster.
  const label = birds[Math.floor(rand() * birds.length)];
  return {
    label,
    source: {
      kind: "fallback",
      reason: localMap === null ? "no-location" : "no-local-data",
    },
    dateKey,
  };
}
