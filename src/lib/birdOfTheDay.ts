// Deterministic "bird of the day" picker, one bird per zodiac sign.
//
// The bird is an extension of the horoscope. The horoscope already
// produces a per-sign lucky number; that number picks the bird by
// indexing into a ranked list of candidate species. So two signs on
// the same day almost always see different birds (their lucky
// numbers differ and index into different slots), and a given sign
// sees a new bird each day because its lucky number changes.
//
// Candidate list:
//
//   When we have an iNat nearby-species map from `useLocalSpeciesBands`,
//   the candidates are roster species actually observed near the user,
//   sorted by tightest distance band first, then by observation count
//   descending. This means low lucky numbers pick the most-local,
//   most-abundant birds and higher lucky numbers reach into rarer or
//   farther-afield species. The list is truncated to a reasonable cap
//   so the modulus doesn't end up revisiting the same top bird under
//   a different name.
//
//   When no map is available (no location shared, marine/remote area,
//   iNat down, first load before fan-out completes) the candidates are
//   the full `isBird` roster sorted by scientific name — still
//   deterministic, still per-sign, just location-blind.
//
// The PRNG primitive used elsewhere in this project isn't needed here:
// `luckyNumber % candidates.length` is already a uniform-ish draw and
// keeps the "lucky number picks the bird" story simple and honest.

import type { BirdLabel } from "./birdnet/labels";
import type { ZodiacId } from "./zodiac";
import {
  lookupLocal,
  type LocalSpeciesEntry,
  type LocalSpeciesMap,
  LOCAL_RADII_KM,
} from "./inat/localSpecies";

/**
 * Metadata about how the bird was picked. Surfaced so a caller that
 * wants to annotate the card ("seen within 25 km") has the raw
 * information without re-computing it; the current UI deliberately
 * does NOT render this, but it's useful for tests and for future
 * iterations that might want to distinguish local from fallback
 * picks visually.
 */
export type BirdOfTheDaySource =
  | { kind: "nearby"; entry: LocalSpeciesEntry }
  | { kind: "fallback" };

export interface BirdOfTheDay {
  /** The chosen species from the BirdNET roster. */
  label: BirdLabel;
  /** The sign the pick is for. */
  sign: ZodiacId;
  /** Provenance of the pick (nearby vs. fallback roster draw). */
  source: BirdOfTheDaySource;
}

/**
 * How many candidates we keep in the nearby-path ranked list before
 * modding the lucky number. Chosen to be larger than the maximum
 * luckyNumber (99) so the modulus can reach every slot, and small
 * enough that the list is dominated by species a birder could
 * plausibly encounter rather than dragged down by 1-observation
 * rarities at the 500 km edge.
 */
const NEARBY_CANDIDATE_CAP = 200;

/**
 * Rank local candidates by tightest band first, then by observation
 * count descending, then alphabetically by scientific name as a
 * tiebreaker. The alphabetic tiebreaker is what makes the ranking
 * fully deterministic — two species with identical band and count
 * would otherwise depend on the map's iteration order, which is
 * effectively iNat's response order and not something we want to
 * depend on.
 */
function rankNearby(
  birds: readonly BirdLabel[],
  map: LocalSpeciesMap,
): { label: BirdLabel; entry: LocalSpeciesEntry }[] {
  const rows: { label: BirdLabel; entry: LocalSpeciesEntry }[] = [];
  for (const label of birds) {
    const entry = lookupLocal(map, label.scientificName);
    // Null-band entries mean the species wasn't seen within the
    // outermost radius. We exclude them from the nearby path — if the
    // whole map is null bands the fallback path will kick in anyway.
    if (!entry || entry.band === null) continue;
    rows.push({ label, entry });
  }
  rows.sort((a, b) => {
    // `band` is a LocalRadiusKm number here (null excluded above).
    const aBand = a.entry.band as (typeof LOCAL_RADII_KM)[number];
    const bBand = b.entry.band as (typeof LOCAL_RADII_KM)[number];
    if (aBand !== bBand) return aBand - bBand;
    if (a.entry.count !== b.entry.count) return b.entry.count - a.entry.count;
    return a.label.scientificName.localeCompare(b.label.scientificName);
  });
  return rows.slice(0, NEARBY_CANDIDATE_CAP);
}

/**
 * Pick the bird-of-the-day for one zodiac sign.
 *
 * @param labels      Full BirdNET label list from `useBirdLabels()`.
 * @param localMap    iNat nearby-species map from `useLocalSpeciesBands()`.
 *                    Pass `null` when not available — the pick falls
 *                    back to a uniform pass over the full roster sorted
 *                    by scientific name.
 * @param sign        The zodiac sign being rendered.
 * @param luckyNumber The sign's lucky number for today, from
 *                    `horoscopeFor(sign, date).luckyNumber`. This is
 *                    the selector — the bird is
 *                    `candidates[luckyNumber % candidates.length]`.
 *
 * Returns null only when the roster has no `isBird` entries, which
 * in practice means `useBirdLabels()` hasn't resolved yet. Callers
 * should render a skeleton in that case.
 */
export function birdOfTheDay(
  labels: readonly BirdLabel[],
  localMap: LocalSpeciesMap | null,
  sign: ZodiacId,
  luckyNumber: number,
): BirdOfTheDay | null {
  const birds = labels.filter((l) => l.isBird);
  if (birds.length === 0) return null;

  // Primary path: we have an iNat map with at least one roster
  // species observed in the 25–500 km window.
  if (localMap) {
    const ranked = rankNearby(birds, localMap);
    if (ranked.length > 0) {
      const picked = ranked[luckyNumber % ranked.length];
      return {
        label: picked.label,
        sign,
        source: { kind: "nearby", entry: picked.entry },
      };
    }
  }

  // Fallback: no map, empty map, or no roster species observed in
  // range. Sort by scientific name for a stable pass (we can't index
  // into the raw labels array because its file order isn't guaranteed
  // stable across BirdNET label revisions).
  const sorted = birds
    .slice()
    .sort((a, b) => a.scientificName.localeCompare(b.scientificName));
  const label = sorted[luckyNumber % sorted.length];
  return {
    label,
    sign,
    source: { kind: "fallback" },
  };
}
