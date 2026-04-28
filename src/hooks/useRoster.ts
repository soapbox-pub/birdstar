// Roster hook for the checklist home page.
//
// Combines the BirdNET labels, the species-regions place table, the user's
// resolved location (continent + country + subdivision), and their
// kind-2473 history into four sorted lists ready to render:
//
//   visible     — current-tier's top-N in-region species by Wikipedia-
//                 pageview popularity, plus every heard bird (heard >
//                 unheard even when the heard bird isn't in the popular
//                 set). This is what the user sees by default.
//   hidden      — the rest of the in-region roster (obscure, range-
//                 tagged, but not popular enough to show at the current
//                 tier). Species that cross into `visible` when the
//                 user advances a tier come out of this bucket.
//   rareFinds   — birds the user has heard whose known range excludes
//                 their location (out-of-region "vagrant" finds).
//   unknownRange— birds with no range data in the table. Joined to
//                 `hidden` by default (rather than visible) because
//                 they'd dilute the "popular species first" UX without
//                 a popularity score of their own.
//
// Progressive tiers: the visible budget steps up as the user hears
// more *distinct birds ever*:
//
//   10 heard  → reveal tier 2, budget = 50
//   50 heard  → reveal tier 3, budget = 150
//   150 heard → reveal tier 4, budget = 300
//   300 heard → full roster (locked tile vanishes)
//
// The count that drives advancement is `heardCount` — just total
// distinct species heard across all sessions, period. Rare finds
// (out-of-region vagrants) count. In-region obscure birds count.
// The simple rule is the point: "hear 10 more birds" in the UI
// means exactly that. Because kind-2473 events carry no location by
// design, the count can't be scoped to a region — it's necessarily
// global to the user's history. Moving from Austin to Paris doesn't
// reset progress (you *did* hear those Austin birds).
//
// Heard-status matching is by case-folded scientific name — the kind-2473
// event's `alt` tag carries `(Scientific name)` which history decodes into
// `detection.scientificName`.
//
// Ordering inside each bucket:
//   - Heard birds first, newest-heard first.
//   - Unheard birds after, sorted by EFFECTIVE popularity in `visible`,
//     alphabetical by common name in `hidden`.
// The `rareFinds` bucket only contains heard birds by definition.
//
// Effective popularity = raw Wikipedia-pageview score +
// iNaturalist-local-observation bonus (see BAND_TO_POPULARITY_BONUS
// in lib/inat/localSpecies.ts). The bonus is additive: species with
// recent nearby observations outrank globally famous species that
// don't actually occur in the user's area, without ever penalizing
// species absent from the iNat signal (iNat coverage gaps would
// otherwise hide real birds in rural areas). When no local map is
// supplied (manual-picker users, offline, pre-fetch), effective
// popularity equals raw popularity — behavior is identical to
// pre-iNat-integration.

import { useMemo } from 'react';
import type { BirdLabel } from '@/lib/birdnet/labels';
import { classifySpeciesInRegion } from '@/lib/birdnet/speciesRegions';
import type { UserPlaceSet } from '@/lib/geo/continent';
import type { Detection } from '@/components/BirdCard';
import { useBirdLabels } from '@/hooks/useBirdLabels';
import { useSpeciesRegions } from '@/hooks/useSpeciesRegions';
import {
  BAND_TO_POPULARITY_BONUS,
  POPULARITY_BONUS_SCALE,
  lookupLocal,
  type LocalSpeciesMap,
} from '@/lib/inat/localSpecies';

/**
 * Progressive visibility tiers. Each entry is the total number of
 * distinct species the user must have heard to advance INTO that
 * tier. Tier 1 (budget 10) is the default starting point; after
 * hearing 10 birds they enter tier 2 (budget 50); etc.
 *
 * Chosen to feel like a gentle on-ramp: 10 is "just the household
 * names", 50 is "common backyard birds", 150 is "regional regulars",
 * 300 is "you know your area". Beyond 300 we stop auto-advancing.
 */
export const ROSTER_TIERS: readonly number[] = [10, 50, 150, 300];

/**
 * The tier reached when the user has heard every bird in tier 4 (300).
 * `budget = Infinity` expresses "no auto-cap; every in-region species
 * is visible at this point".
 */
export const UNLIMITED_TIER = ROSTER_TIERS.length + 1;

/**
 * Compute the active tier + budget from a count of distinct heard
 * birds. Pure function so the toast side effect in Index.tsx can
 * invoke it against a tracked previous value without re-running the
 * roster memo.
 */
export function tierForHeardCount(heardTotal: number): {
  /** 1-indexed tier number. 1..ROSTER_TIERS.length, or UNLIMITED_TIER
   * when the user has cleared the final tier. */
  tier: number;
  /** Visible budget for unheard popular species in this tier. Equal to
   * `ROSTER_TIERS[tier-1]` for ordinary tiers; `Infinity` for
   * `UNLIMITED_TIER` (no auto-cap; every in-region species is shown). */
  budget: number;
} {
  for (let i = 0; i < ROSTER_TIERS.length; i++) {
    if (heardTotal < ROSTER_TIERS[i]) {
      return { tier: i + 1, budget: ROSTER_TIERS[i] };
    }
  }
  return { tier: UNLIMITED_TIER, budget: Infinity };
}

export interface RosterEntry {
  label: BirdLabel;
  /** The matching Nostr/session detection, if the user has heard this
   * species. Undefined for not-yet-heard entries. */
  detection?: Detection;
  heard: boolean;
  /** Log-scaled Wikipedia-pageview popularity score (from BRN3). Higher
   * is more popular; 0 means "unknown". Used to drive the visible vs.
   * hidden split. */
  popularity: number;
  /** Effective popularity after any iNat-local-observation bonus has
   * been blended in. Used for sorting; `popularity` is retained for
   * consumers that want the raw .bin score. Equal to `popularity`
   * when no local-species map is available. */
  effectivePopularity: number;
  /** The iNat distance band the species was observed in near the user,
   * if any. `null` means no map available or species absent from all
   * 5 radii. Included on every entry so the UI can optionally show a
   * "seen near you" hint. */
  localBand: import('@/lib/inat/localSpecies').LocalBand | undefined;
}

export interface Roster {
  /** The default-visible roster: the current tier's top-N in-region
   * species by popularity, UNIONED with every heard bird (regardless
   * of rank or region). Heard birds surface first (newest-first); the
   * top-N popular set always renders in full below, even if the user
   * has heard 0 of them. This guarantees there are at least N popular
   * cells on screen to look at + listen for. */
  visible: RosterEntry[];
  /** In-region species that are neither heard nor in the current
   * tier's top-N popular set. Not rendered in the grid; represented
   * only by the trailing LockedTile count. Alphabetical. */
  hidden: RosterEntry[];
  /** Birds the user has heard that aren't plausibly here. Newest-first. */
  rareFinds: RosterEntry[];
  /** Total distinct species heard, across all sessions and all
   * regions. Drives tier advancement and the "Hear N more birds"
   * counter on the LockedTile. kind-2473 events are location-less by
   * design, so this count is necessarily global. */
  heardCount: number;
  /** Active tier (1-indexed). `UNLIMITED_TIER` after tier 4 is cleared. */
  tier: number;
  /** How many distinct birds must be heard to unlock the next tier.
   * Equals `ROSTER_TIERS[tier-1]` for tiers 1-4, `Infinity` for the
   * unlimited final tier. */
  tierTarget: number;
  /** Number of cells actually rendered in `visible`. */
  visibleCount: number;
  /** Total count across visible + hidden. */
  totalCount: number;
  /** True when we know the user's place AND have loaded the range table. */
  isRegionalized: boolean;
}

interface UseRosterOptions {
  placeSet: UserPlaceSet | null;
  /** Detections from history + the live session, already deduped by the
   * caller. Used to flip `heard` status on the matching roster entries. */
  detections: Detection[];
  /** Optional iNat-derived local species map (from useLocalSpeciesBands).
   * When present, species observed near the user get a popularity
   * bonus proportional to how close they've been seen; this pulls
   * locally-abundant species above globally-famous ones in the
   * tier-1 visible set. Absent/null means today's .bin-only ordering. */
  localSpeciesMap?: LocalSpeciesMap | null;
}

export function useRoster({
  placeSet,
  detections,
  localSpeciesMap,
}: UseRosterOptions): Roster {
  const labelsQuery = useBirdLabels();
  const regionsQuery = useSpeciesRegions();

  const labels = labelsQuery.data;
  const regions = regionsQuery.data;

  return useMemo<Roster>(() => {
    if (!labels) {
      return {
        visible: [],
        hidden: [],
        rareFinds: [],
        heardCount: 0,
        tier: 1,
        tierTarget: ROSTER_TIERS[0],
        visibleCount: 0,
        totalCount: 0,
        isRegionalized: false,
      };
    }

    const detectionByName = new Map<string, Detection>();
    for (const d of detections) {
      const key = d.scientificName.toLowerCase();
      const existing = detectionByName.get(key);
      if (!existing || d.timestamp > existing.timestamp) {
        detectionByName.set(key, d);
      }
    }

    const isRegionalized = Boolean(placeSet && regions?.loaded);

    const rosterEntries: RosterEntry[] = [];
    const rareEntries: RosterEntry[] = [];

    // Helper: compute the (popularity, effectivePopularity, localBand)
    // triple for a given label. iNat local-observation presence is
    // layered on top of the .bin pageview score as an ADDITIVE bonus;
    // absence is NEVER a penalty, so species missing from the iNat
    // map fall back to pure .bin-based ordering. This keeps rural /
    // under-covered areas from losing birds that really are there.
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

    for (const label of labels) {
      if (!label.isBird) continue;

      const detection = detectionByName.get(label.scientificName.toLowerCase());
      const heard = Boolean(detection);
      const { popularity, effectivePopularity, localBand } =
        computePopularity(label);

      if (!isRegionalized || !placeSet || !regions) {
        rosterEntries.push({
          label,
          detection,
          heard,
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

      if (status === 'out-of-region') {
        if (heard) {
          rareEntries.push({
            label,
            detection,
            heard,
            popularity,
            effectivePopularity,
            localBand,
          });
        }
        continue;
      }
      // in-region or unknown — both count as roster candidates.
      rosterEntries.push({
        label,
        detection,
        heard,
        popularity,
        effectivePopularity,
        localBand,
      });
    }

    // Total distinct heard species (in-region + unknown + out-of-region
    // vagrants). This is the single counter the user sees in the
    // LockedTile. `detectionByName` already deduped by scientific name,
    // so its size is the exact answer.
    const heardCount = detectionByName.size;
    const { tier, budget } = tierForHeardCount(heardCount);
    const tierTarget = Number.isFinite(budget) ? budget : rosterEntries.length;

    // Rank the in-region roster by EFFECTIVE popularity (pageviews +
    // iNat local-observation bonus). This pulls locally-abundant
    // species above globally-famous ones that don't occur near the
    // user. Falls back to raw popularity when no local map is loaded.
    // Ties broken by raw popularity first (so a non-local famous bird
    // still beats a non-local obscure bird), then alphabetically.
    const byPopularity = [...rosterEntries].sort((a, b) => {
      if (b.effectivePopularity !== a.effectivePopularity) {
        return b.effectivePopularity - a.effectivePopularity;
      }
      if (b.popularity !== a.popularity) return b.popularity - a.popularity;
      return a.label.commonName.localeCompare(b.label.commonName);
    });

    // Visible assembly — the invariant is:
    //   1. Every in-region heard bird is visible.
    //   2. The top-`budget` most popular in-region birds are visible,
    //      full stop. Heard status doesn't shrink this window.
    //   3. Render heard birds first (newest-first), then the unheard
    //      popular tail — no duplicates.
    // This matters at low tiers: if a user heard 6 obscure in-region
    // birds, they still want to see all 10 tier-1 popular birds to go
    // hunt for next. Under the old "cap total cells at budget" rule,
    // they'd only see 4 popular cells, which is the bug we're fixing.
    const popularSlice = Number.isFinite(budget)
      ? byPopularity.slice(0, budget)
      : byPopularity;
    const popularSet = new Set(popularSlice.map((e) => e.label.index));

    const heardEntries = rosterEntries
      .filter((e) => e.heard)
      .sort(
        (a, b) =>
          (b.detection?.timestamp ?? 0) - (a.detection?.timestamp ?? 0),
      );
    const heardIndices = new Set(heardEntries.map((e) => e.label.index));

    // Unheard popular cells — the tier window minus the heard ones
    // we're about to prepend. Preserves popularity order.
    const popularUnheardCells = popularSlice.filter(
      (e) => !heardIndices.has(e.label.index),
    );

    const visible = [...heardEntries, ...popularUnheardCells];

    // Hidden = every in-region entry that's neither heard nor in the
    // tier's top-N popular set. Used only for the LockedTile's count
    // ("Hear N more birds to unlock more") — not rendered in the grid.
    const hidden = rosterEntries
      .filter(
        (e) => !e.heard && !popularSet.has(e.label.index),
      )
      .sort((a, b) => a.label.commonName.localeCompare(b.label.commonName));

    rareEntries.sort(
      (a, b) => (b.detection?.timestamp ?? 0) - (a.detection?.timestamp ?? 0),
    );

    return {
      visible,
      hidden,
      rareFinds: rareEntries,
      heardCount,
      tier,
      tierTarget,
      visibleCount: visible.length,
      totalCount: rosterEntries.length,
      isRegionalized,
    };
  }, [labels, regions, placeSet, detections, localSpeciesMap]);
}
