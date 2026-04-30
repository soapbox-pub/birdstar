// Birdex hook for the checklist home page.
//
// Combines the BirdNET labels, the species-regions place table, the
// user's resolved location, their kind-2473 history, AND the durable
// "encountered species" store into one sorted list ready to render:
//
//   visible     — every cell the grid should show, in render order.
//                 A flat list of tagged entries (`isRare`,
//                 `isUnconfirmed`) — no separate buckets, no tier
//                 gates. Order:
//                   1. Confirmed heard birds (newest first), with
//                      any out-of-region ones flagged `isRare` but
//                      mixed right in rather than shunted to a
//                      separate section.
//                   2. Encountered-but-unconfirmed species (newest
//                      encounter first). These have produced a
//                      qualifying prediction at some point but never
//                      accumulated enough evidence to promote to a
//                      full detection. Flagged `isUnconfirmed` so
//                      the cell can render a "?" badge.
//                   3. Starter set — the top-STARTER_VISIBLE in-region
//                      popular species that are neither confirmed nor
//                      unconfirmed yet. Guarantees the grid has at
//                      least 10 targets to listen for on day one,
//                      even before the user has heard anything.
//
// Design shift from the old tiered model:
//   - No auto-unlocking of swaths of species at 10/50/150/300 heard.
//     The world feels small: you see the 10 household names on day
//     one and grow the grid one bird at a time from there.
//   - "Rare finds" are no longer a separate section; out-of-region
//     heard birds are just normal confirmed cells with the rare
//     badge.
//   - Range filtering is minimal: we only use it to tag heard birds
//     as `isRare` (for the badge) and to choose starter-set
//     candidates. We do NOT prune unconfirmed entries by range —
//     if BirdNET produced a qualifying hit for a species, it goes
//     into the unconfirmed bucket regardless of whether it "should"
//     be here. The user knows what they heard.
//
// Heard-status matching is by case-folded scientific name — the
// kind-2473 event's `alt` tag carries `(Scientific name)` which
// history decodes into `detection.scientificName`. The encountered
// store keys on the same lower-cased scientific name.

import { useMemo } from 'react';
import type { BirdLabel } from '@/lib/birdnet/labels';
import { classifySpeciesInRegion } from '@/lib/birdnet/speciesRegions';
import type { UserPlaceSet } from '@/lib/geo/continent';
import type { Detection } from '@/components/BirdCard';
import { useBirdLabels } from '@/hooks/useBirdLabels';
import { useSpeciesRegions } from '@/hooks/useSpeciesRegions';
import type { EncounteredSpecies } from '@/lib/encounteredSpeciesStore';
import {
  BAND_TO_POPULARITY_BONUS,
  POPULARITY_BONUS_SCALE,
  lookupLocal,
  type LocalSpeciesMap,
} from '@/lib/inat/localSpecies';

/**
 * How many popular in-region species to show as a starter set on top
 * of whatever the user has confirmed or encountered. Chosen so day-
 * one users always have a concrete list of "common birds near me" to
 * listen for, even before the mic has picked up anything.
 */
export const STARTER_VISIBLE = 10;

export interface BirdexEntry {
  label: BirdLabel;
  /** The matching Nostr/session detection, if the user has heard this
   * species. Undefined for unconfirmed and starter entries. */
  detection?: Detection;
  /** True when a confirmed detection exists (in-region OR rare). */
  heard: boolean;
  /** True when the confirmed detection is for a species whose known
   * range excludes the user's location. Used by the cell to show the
   * "Rare" badge. Only meaningful when `heard` is also true. */
  isRare: boolean;
  /** True when BirdNET has produced a qualifying prediction for this
   * species (at or above MIN_RAW_CONFIDENCE, logged in the durable
   * encountered-species store) but accumulation never promoted it to
   * a confirmed sighting. Mutually exclusive with `heard`. */
  isUnconfirmed: boolean;
  /** Log-scaled Wikipedia-pageview popularity score (from BRN3). Higher
   * is more popular; 0 means "unknown". Used only for starter-set
   * selection; not surfaced in the cell. */
  popularity: number;
  /** Effective popularity after any iNat-local-observation bonus has
   * been blended in. Used for sorting the starter set; equal to
   * `popularity` when no local-species map is available. */
  effectivePopularity: number;
  /** The iNat distance band the species was observed in near the user,
   * if any. `null` means no map available or species absent from all
   * 5 radii. Included on every entry so the UI can optionally show a
   * "seen near you" hint. */
  localBand: import('@/lib/inat/localSpecies').LocalBand | undefined;
}

export interface Birdex {
  /** Flat render-order list of every cell the grid should display.
   * Confirmed first (newest first), then unconfirmed (newest
   * encounter first), then the starter popular set. */
  visible: BirdexEntry[];
  /** Total distinct species heard, across all sessions. Surfaced so
   * any header UI that cares can display progress. */
  heardCount: number;
  /** Total distinct species encountered (including heard ones). */
  encounteredCount: number;
  /** True when we know the user's place AND have loaded the range
   * table, so `isRare` classification is meaningful. */
  isRegionalized: boolean;
}

interface UseBirdexOptions {
  placeSet: UserPlaceSet | null;
  /** Detections from history + the live session, already deduped by
   * the caller. Used to flip `heard` status on the matching birdex
   * entries. */
  detections: Detection[];
  /** Durable map of every species that has ever produced a qualifying
   * BirdNET prediction on this device. Keyed by lower-cased
   * scientific name. Null while hydrating from IndexedDB. Species in
   * this map that AREN'T in `detections` become unconfirmed entries. */
  encountered: Map<string, EncounteredSpecies> | null;
  /** Optional iNat-derived local species map (from useLocalSpeciesBands).
   * When present, species observed near the user get a popularity
   * bonus so the starter set favors locally-abundant species over
   * globally-famous ones. */
  localSpeciesMap?: LocalSpeciesMap | null;
}

export function useBirdex({
  placeSet,
  detections,
  encountered,
  localSpeciesMap,
}: UseBirdexOptions): Birdex {
  const labelsQuery = useBirdLabels();
  const regionsQuery = useSpeciesRegions();

  const labels = labelsQuery.data;
  const regions = regionsQuery.data;

  return useMemo<Birdex>(() => {
    if (!labels) {
      return {
        visible: [],
        heardCount: 0,
        encounteredCount: 0,
        isRegionalized: false,
      };
    }

    // Index detections by lower-case scientific name. Multiple hits
    // for the same species keep only the newest.
    const detectionByName = new Map<string, Detection>();
    for (const d of detections) {
      const key = d.scientificName.toLowerCase();
      const existing = detectionByName.get(key);
      if (!existing || d.timestamp > existing.timestamp) {
        detectionByName.set(key, d);
      }
    }

    const isRegionalized = Boolean(placeSet && regions?.loaded);

    // Compute the (popularity, effectivePopularity, localBand) triple.
    // iNat local-observation presence is layered on top of the .bin
    // pageview score as an ADDITIVE bonus; absence is NEVER a
    // penalty, so species missing from the iNat map fall back to
    // pure .bin-based ordering. Keeps rural / under-covered areas
    // from losing birds that really are there.
    const computePopularity = (label: BirdLabel) => {
      const popularity = regions?.popularityFor(label.index) ?? 0;
      const local = lookupLocal(localSpeciesMap, label.scientificName);
      const band = local?.band ?? null;
      const bonus =
        band !== null
          ? BAND_TO_POPULARITY_BONUS[band] * POPULARITY_BONUS_SCALE
          : 0;
      return {
        popularity,
        effectivePopularity: popularity + bonus,
        localBand: band ?? undefined,
      };
    };

    // Single pass over every bird label produces three candidate
    // arrays. We defer ordering + starter-set selection until after
    // so the logic for each bucket stays local.
    const confirmed: BirdexEntry[] = [];
    const unconfirmed: BirdexEntry[] = [];
    const inRegionUnseen: BirdexEntry[] = []; // starter-set candidates

    for (const label of labels) {
      if (!label.isBird) continue;

      const key = label.scientificName.toLowerCase();
      const detection = detectionByName.get(key);
      const heard = Boolean(detection);
      const encounteredRow = encountered?.get(key);
      const { popularity, effectivePopularity, localBand } =
        computePopularity(label);

      if (heard) {
        // Heard birds are always shown. Range classification only
        // decides the `isRare` badge — it does NOT exclude the
        // bird from the grid. Even out-of-region sightings sit in
        // the main flow now.
        let isRare = false;
        if (isRegionalized && placeSet && regions) {
          const status = classifySpeciesInRegion(
            label.index,
            placeSet.places,
            regions,
          );
          isRare = status === 'out-of-region';
        }
        confirmed.push({
          label,
          detection,
          heard: true,
          isRare,
          isUnconfirmed: false,
          popularity,
          effectivePopularity,
          localBand,
        });
        continue;
      }

      if (encounteredRow) {
        // Encountered but never confirmed. These go in regardless of
        // range — if BirdNET thought it heard this species at least
        // once, the user should know.
        unconfirmed.push({
          label,
          heard: false,
          isRare: false,
          isUnconfirmed: true,
          popularity,
          effectivePopularity,
          localBand,
        });
        continue;
      }

      // Starter-set candidate. Only in-region species qualify —
      // we don't want to surface obscure vagrants as "birds near
      // you" before the user has shown any sign of being in a
      // region where they'd plausibly hear them.
      if (!isRegionalized || !placeSet || !regions) {
        // Pre-region: treat every bird as a candidate. The starter
        // slice below will just pick the N globally most popular.
        inRegionUnseen.push({
          label,
          heard: false,
          isRare: false,
          isUnconfirmed: false,
          popularity,
          effectivePopularity,
          localBand,
        });
        continue;
      }

      const status = classifySpeciesInRegion(
        label.index,
        placeSet.places,
        regions,
      );
      if (status === 'out-of-region') continue;
      inRegionUnseen.push({
        label,
        heard: false,
        isRare: false,
        isUnconfirmed: false,
        popularity,
        effectivePopularity,
        localBand,
      });
    }

    // Order confirmed birds newest-first by detection timestamp. Ties
    // broken by common name for determinism.
    confirmed.sort((a, b) => {
      const diff =
        (b.detection?.timestamp ?? 0) - (a.detection?.timestamp ?? 0);
      if (diff !== 0) return diff;
      return a.label.commonName.localeCompare(b.label.commonName);
    });

    // Order unconfirmed by the encounter store's lastSeenAt,
    // newest first. Falls back to common-name alphabetical when
    // timestamps tie (shouldn't happen in practice — timestamps
    // are ms precision).
    unconfirmed.sort((a, b) => {
      const aRow = encountered?.get(a.label.scientificName.toLowerCase());
      const bRow = encountered?.get(b.label.scientificName.toLowerCase());
      const diff = (bRow?.lastSeenAt ?? 0) - (aRow?.lastSeenAt ?? 0);
      if (diff !== 0) return diff;
      return a.label.commonName.localeCompare(b.label.commonName);
    });

    // Starter set: the top-N in-region unseen species by effective
    // popularity. Tie-break on raw popularity first (so a non-local
    // famous bird still beats a non-local obscure bird), then
    // alphabetical. This is the same ordering the old tier-1 list
    // used, just capped at a fixed 10 instead of the old 10/50/
    // 150/300 ladder.
    inRegionUnseen.sort((a, b) => {
      if (b.effectivePopularity !== a.effectivePopularity) {
        return b.effectivePopularity - a.effectivePopularity;
      }
      if (b.popularity !== a.popularity) return b.popularity - a.popularity;
      return a.label.commonName.localeCompare(b.label.commonName);
    });
    const starter = inRegionUnseen.slice(0, STARTER_VISIBLE);

    const visible = [...confirmed, ...unconfirmed, ...starter];

    return {
      visible,
      heardCount: confirmed.length,
      encounteredCount: confirmed.length + unconfirmed.length,
      isRegionalized,
    };
  }, [labels, regions, placeSet, detections, encountered, localSpeciesMap]);
}
