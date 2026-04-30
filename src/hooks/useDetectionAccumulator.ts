// Rolling-window confidence accumulator.
//
// BirdNET fires a prediction every ~2 seconds. A single loud call will
// produce a score ≥ 0.80; a soft, distant, or partial call may only produce
// scores in the 0.1-0.4 range. Rather than surface a noisy stream of weak
// detections — or miss genuine soft calls by requiring a single strong hit —
// we accumulate per-species "evidence" over a 3-minute window and only
// "confirm" a species when the accumulated evidence crosses a threshold.
//
// Score shaping (why we don't just sum raw scores):
//   Linear summation treats two 0.40 hits as equivalent to one 0.80 hit.
//   But a single confident 0.80 call is qualitatively stronger evidence
//   than two mediocre 0.40 calls — the former is BirdNET clearly
//   recognizing a vocalization, the latter is the classifier being
//   uncertain twice. To reflect this, each hit contributes
//   `score ** CONFIRMATION_GAMMA` (γ=2) instead of `score`. That makes
//   high-confidence hits worth disproportionately more than
//   low-confidence ones:
//
//     raw 0.80  →  contribution 0.64   (one clean call ≈ threshold)
//     raw 0.50  →  contribution 0.25   (need ~2 for confirmation)
//     raw 0.40  →  contribution 0.16   (need ~3)
//     raw 0.20  →  contribution 0.04   (need ~12 — barely audible,
//                                        sustained calling for most of
//                                        the window)
//
// Mechanics:
//   - Every qualifying hit (adjusted score ≥ MIN_RAW_CONFIDENCE, where
//     "adjusted" means post-locationAdjuster) is appended to an IndexedDB
//     log (birdHitStore) and pushed into an in-memory rolling window
//     keyed by species. The log stores the raw BirdNET score and the
//     locationAdjuster multiplier as TWO separate fields — the product
//     (adjusted score) is computed at read time. This keeps the
//     objective model signal on disk separately from the contextual
//     damping, so we can retune the damping pipeline without losing or
//     rewriting historical data.
//     The in-memory window entry carries both the adjusted score and
//     the γ-shaped contribution derived from it (what the accumulator
//     actually sums against the confirmation threshold).
//   - Hits older than CONFIRMATION_WINDOW_MS are evicted from the window
//     lazily — on every ingest for the affected species, and on-demand when
//     we inspect it.
//   - When the remaining hits for a species have contributions summing
//     to ≥ CONFIRMATION_THRESHOLD, we emit a Detection with the (clamped)
//     combined raw score and clear that species' window so the next
//     confirmation has to build up fresh.
//   - On mount, we prune the on-disk log to the last RAW_LOG_RETENTION_MS
//     and seed the rolling windows from the last CONFIRMATION_WINDOW_MS of
//     hits so a reload mid-accumulation doesn't lose progress.
//     Contributions are re-derived from `rawScore × multiplier` at
//     hydrate time — no schema migration needed when γ or the
//     multiplier-interpretation change.
//
// Location-aware damping:
//   - An optional `locationAdjuster` multiplier is applied to each raw
//     BirdNET score before the floor + window push. It lets the caller
//     downweight species based on their range:
//       * Graded iNaturalist signal (preferred): when the user has a
//         coarse lat/lon and iNat data is available, the adjuster picks
//         a per-species multiplier from BAND_TO_DAMPING (see
//         lib/inat/localSpecies.ts) reflecting how close the nearest
//         observation of that species has been logged. Species seen
//         within 25 km get no damping; species at 500 km get 0.35×;
//         species with a precisely-resolved nearest distance get
//         interpolated damping.
//       * Binary .bin-ecoregion fallback: when iNat data isn't
//         available or the species is absent from the iNat signal
//         entirely, we fall back to the pre-iNat behavior —
//         OUT_OF_REGION_MULTIPLIER (0.5×) for out-of-ecoregion,
//         1× otherwise.
//     Because damping is applied to the score BEFORE γ-shaping, its
//     effect on accumulation time is non-linear: a 0.5× multiplier
//     squares to a 4× accumulation penalty, and the old 0.25× would
//     now be a 16× penalty (hence the softening from 0.25 → 0.5).
//     Damped species still accumulate — genuine vagrants can confirm
//     if heard often enough — but require proportionally more
//     evidence.
//
//   - An optional `onSpeciesHit` callback fires for every prediction
//     that passes the non-bird and raw-floor checks, regardless of
//     whether it ultimately confirms. Used by the host to warm the
//     iNat nearest-observation cache for species the user is
//     actively hearing, so the damper has a precise distance to
//     consult on the next ingest.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Detection } from '@/components/BirdCard';
import type { BirdLabel } from '@/lib/birdnet/labels';
import type { BirdPrediction } from '@/lib/birdnet/model';
import {
  appendHit,
  getHitsSince,
  pruneOlderThan,
  type BirdHit,
} from '@/lib/birdHitStore';

// Floor for a hit to enter the rolling window. Applied to the
// location-adjusted score (i.e. after locationAdjuster). Chosen so that
// even γ-squared this value gives a per-hit contribution of 0.04, meaning
// a species calling at exactly the floor would need ~12 hits in the 3-minute
// window to confirm — sustained, persistent evidence, not just a blip.
// Scores below this are dropped entirely (not logged, not accumulated):
// at γ=2 they contribute so little that hundreds of hits would be needed,
// and in practice that's indistinguishable from pipeline noise.
export const MIN_RAW_CONFIDENCE = 0.2;
// Rolling window length. Hits older than this are dropped from the sum.
export const CONFIRMATION_WINDOW_MS = 3 * 60 * 1000;
// Exponent applied to each hit's adjusted score to produce the value
// actually summed in the rolling window. γ > 1 makes high-confidence hits
// worth disproportionately more than low-confidence ones, so two 0.4 hits
// (2 × 0.16 = 0.32) no longer confirm where one clean 0.7 hit (0.49) does.
// See the top-of-file doc comment for the rationale and tuning table.
export const CONFIRMATION_GAMMA = 2;
// Cumulative γ-shaped contribution within the window that promotes a
// species to "confirmed". In raw-score terms: one 0.67 hit, two 0.48
// hits, three 0.39 hits, or roughly four 0.34 hits are enough.
export const CONFIRMATION_THRESHOLD = 0.45;
// Fraction of CONFIRMATION_THRESHOLD a species must cross — in γ-shaped
// contribution units, accumulated in the rolling window — before it
// "qualifies as encountered" and gets recorded into the durable
// encountered-species store that populates the birdex's unconfirmed
// bucket. Below this, we still accumulate internally (so genuine soft
// calls can still confirm), but nothing shows up in the dex.
//
// At 0.6, the effective bar is a γ-sum of 0.27 out of 0.45. In raw-
// BirdNET terms that's roughly one 0.52 hit, two 0.37 hits, or four
// 0.26 hits within the 3-minute window. Meaning: to land in the
// unconfirmed bucket, a species has to have come genuinely close to
// being confirmed — not just produced a single weak blip. Users have
// explicitly asked for "almost-confirmed only" in the dex so the
// unconfirmed bucket stays meaningful.
export const ENCOUNTER_QUALIFY_FRACTION = 0.6;
// Derived absolute γ-sum bar. Exposed so hydrate + ingest can apply
// the same math.
export const ENCOUNTER_QUALIFY_SUM =
  CONFIRMATION_THRESHOLD * ENCOUNTER_QUALIFY_FRACTION;
// How long raw hits live on disk before the startup prune deletes them.
export const RAW_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
// Multiplier applied to scores for species whose known range doesn't
// include the user's ecoregion. Because damping is applied BEFORE the
// γ exponent, its effective impact on accumulation time is the square
// of the multiplier: a 0.5× damper is a 4× accumulation penalty. A
// strong 0.9 BirdNET hit on an out-of-region species adjusts to 0.45,
// contributes (0.45)² = 0.20 — below the confirmation threshold, so
// vagrants need at least 2-3 strong hits to register.
export const OUT_OF_REGION_MULTIPLIER = 0.5;

/**
 * γ-shape a raw (or location-adjusted) score into the value actually
 * accumulated in the rolling window. Raising to the power of γ
 * disproportionately rewards confident hits and punishes weak ones.
 * Exported so callers can reason symmetrically about progress / thresholds.
 */
export function contributionFor(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.pow(score, CONFIRMATION_GAMMA);
}

function speciesKey(d: { scientificName: string; commonName: string }): string {
  return `${d.scientificName}|${d.commonName}`;
}

/** A single entry in a species' rolling window. */
interface WindowHit {
  /**
   * Location-adjusted BirdNET score in [0, 1] — i.e. `rawScore * multiplier`,
   * computed at ingest (or at hydrate, from the two fields persisted
   * separately on disk). Used only internally as the input to
   * `contributionFor`; NOT surfaced to consumers. Kept on the hit
   * (rather than re-multiplied on every sum) because the cached
   * `contribution` below depends on it and we want hydrate and live
   * ingest to produce identically-shaped entries.
   */
  score: number;
  /**
   * γ-shaped evidence value (`score ** CONFIRMATION_GAMMA`) that's
   * actually summed against CONFIRMATION_THRESHOLD. Cached on the hit
   * so `refreshPendingLeader` doesn't re-run `Math.pow` for every
   * species on every 5-second decay tick.
   */
  contribution: number;
  timestamp: number;
}

/**
 * Snapshot of the species currently closest to being confirmed. Used to
 * drive the "accumulating bird" pie overlay in the player bar. `progress`
 * is `sum / CONFIRMATION_THRESHOLD` clamped to [0, 1] — i.e. the fraction
 * of the way to confirmation.
 */
export interface PendingLeader {
  scientificName: string;
  commonName: string;
  /**
   * Current rolling-window sum of γ-shaped contributions, in
   * [0, CONFIRMATION_THRESHOLD). Expressed in contribution units, not
   * raw BirdNET-score units; consumers should use `progress` for UI.
   */
  sum: number;
  /** `sum / CONFIRMATION_THRESHOLD`, clamped to [0, 1]. */
  progress: number;
  /** Timestamp (ms) of the most recent hit contributing to this leader. */
  lastHitAt: number;
}

/**
 * Most recent prediction that passed the MIN_RAW_CONFIDENCE floor,
 * regardless of species or whether it ever confirmed. This is the one
 * slot the player bar reflects in every dimension — thumbnail image,
 * pie overlay, `?` badge, status label, and click target — so the
 * bar always reads as "here is the bird you just heard".
 *
 * `progress` is *this species'* accumulated evidence toward confirmation
 * (its γ-shaped rolling-window sum / CONFIRMATION_THRESHOLD, clamped to
 * [0, 1]), NOT the highest-summed species' progress. A freshly-heard
 * species that has never contributed before will come through with a
 * low progress, which is exactly what the pie should display — dimmed
 * ≈ "we just heard this once, nowhere near confirmed".
 *
 * `confirmed` is true when this species has been promoted to
 * `confirmedSightings` during the current session. When confirmed,
 * the pie is fully revealed and the `?` badge is hidden, but the image
 * still reflects that it was the most recent bird heard.
 */
export interface LatestHit {
  scientificName: string;
  commonName: string;
  /** Timestamp (ms) of the hit. */
  timestamp: number;
  /**
   * γ-shaped rolling-window sum for THIS species divided by
   * CONFIRMATION_THRESHOLD, clamped to [0, 1]. 1 when the species is
   * already confirmed (the window is cleared on confirmation, so the
   * raw sum is 0 — we substitute 1 so the pie reads as "done").
   */
  progress: number;
  /** True when this species is in `confirmedSightings`. */
  confirmed: boolean;
}

export interface AccumulatorOptions {
  /**
   * Called exactly once per species each time its rolling-window sum
   * crosses CONFIRMATION_THRESHOLD. The window is cleared before this
   * fires, so subsequent confirmations start from zero.
   */
  onConfirm?: (detection: Detection) => void;

  /**
   * Optional per-prediction score multiplier in [0, 1], keyed off the
   * BirdNET label index. Used by the location-aware damping pipeline to
   * downweight predictions for species whose known range doesn't include
   * the user's continent. Returns 1 (or undefined) for "no adjustment".
   *
   * The multiplier is applied **before** the MIN_RAW_CONFIDENCE floor, so
   * heavily-damped predictions can fall below the floor entirely. The
   * raw BirdNET score and the multiplier returned here are persisted
   * to the on-disk hit log as TWO separate fields; the product
   * (adjusted score) is what contributes to the rolling-window sum,
   * so out-of-range species naturally take much longer to cross
   * CONFIRMATION_THRESHOLD.
   *
   * The callback is captured in a ref so it can change identity on every
   * render (e.g. when `region` or the species-regions table updates)
   * without destabilising the memoized `ingest` callback.
   */
  locationAdjuster?: (labelIndex: number, label: BirdLabel) => number;

  /**
   * Called for every prediction that passes both the non-bird and raw-
   * floor checks, regardless of whether it ultimately confirms. Used
   * by the host to opportunistically warm caches for species the user
   * is actively hearing — notably the iNat nearest-observation lookup
   * that refines confidence damping beyond the 5-band bulk signal.
   *
   * Fire-and-forget from the accumulator's perspective — the callback
   * runs after the prediction is ingested, so any async work it kicks
   * off doesn't block the ingest hot path. `timestamp` is the ingest
   * time (ms epoch) so persistent consumers can stamp first/last-seen
   * without reading `Date.now()` and disagreeing with the audio
   * chunk clock.
   *
   * Captured in a ref like `locationAdjuster` so handlers can freely
   * re-identify on render.
   *
   * NOTE: this fires on EVERY qualifying hit. If you want a tighter
   * "nearly confirmed" signal for the birdex's unconfirmed bucket,
   * use `onEncounterQualified` instead.
   */
  onSpeciesHit?: (label: BirdLabel, timestamp: number) => void;

  /**
   * Called when a species' γ-shaped rolling-window sum crosses
   * ENCOUNTER_QUALIFY_SUM (60% of the confirmation threshold) —
   * i.e. when the species has become "almost confirmed". Fires
   * at most once per species per rolling window; a species that
   * qualifies, confirms, and re-accumulates will fire again after
   * the post-confirmation window reset.
   *
   * This is the signal the birdex uses to decide whether a species
   * belongs in the unconfirmed bucket. It's deliberately tighter than
   * `onSpeciesHit` so the dex only surfaces species the accumulator
   * genuinely almost confirmed, not every weak blip that cleared the
   * MIN_RAW_CONFIDENCE floor.
   *
   * Also fires during hydration for any species whose restored window
   * is already above the qualify bar, so app restarts don't drop
   * the signal on the floor.
   *
   * The payload is just scientific + common names — no `index` or
   * `isBird`, because hydrate has no ready access to either and
   * the only current consumer (the encountered-species store) doesn't
   * need them. If a future consumer wants the full `BirdLabel`, it
   * can look it up from the labels table by scientific name.
   *
   * Captured in a ref, same as the other callbacks.
   */
  onEncounterQualified?: (
    info: { scientificName: string; commonName: string },
    timestamp: number,
  ) => void;
}

export interface AccumulatorApi {
  /**
   * Ingest one raw prediction. Appends to the on-disk log (fire-and-forget),
   * updates the rolling window for the species, and triggers `onConfirm` +
   * a state update if the cumulative score crosses the threshold.
   *
   * Predictions below MIN_RAW_CONFIDENCE or for non-bird labels are ignored.
   */
  ingest: (pred: BirdPrediction, label: BirdLabel, timestamp: number) => void;

  /**
   * Drop a species from the confirmed map (e.g. on user-initiated deletion).
   * Does not touch the on-disk log or the rolling window — the species is
   * free to re-confirm if more hits come in.
   */
  forgetConfirmed: (d: { scientificName: string; commonName: string }) => void;

  /**
   * Species confirmed during this session, keyed by speciesKey. Merged with
   * Nostr history in Index.tsx for the final display.
   */
  confirmedSightings: Map<string, Detection>;

  /**
   * Species currently closest to being confirmed, if any. Null when no
   * species has any hits within the rolling window. Drives the pie overlay
   * on the player bar's album art.
   */
  pendingLeader: PendingLeader | null;

  /**
   * Species of the most recent prediction that cleared the raw-confidence
   * floor, regardless of accumulator state. Null when no qualifying hits
   * have landed in the current rolling window (i.e. the on-disk seed was
   * empty and nothing has been ingested live). Drives the player bar's
   * album-art thumbnail so it reflects "what was just heard" rather than
   * the highest-summed pending species or the last confirmation.
   */
  latestHit: LatestHit | null;

  /** True until the on-disk prune + rehydrate has completed. */
  isHydrating: boolean;
}

export function useDetectionAccumulator(
  options: AccumulatorOptions = {},
): AccumulatorApi {
  const { onConfirm, locationAdjuster, onSpeciesHit, onEncounterQualified } =
    options;

  // Rolling window per species. Stored in a ref since it's updated on every
  // chunk and shouldn't trigger renders on its own — only the confirmed map
  // is observable from the UI.
  const windowsRef = useRef<Map<string, WindowHit[]>>(new Map());

  // Stable callback ref so `ingest` doesn't get a new identity every time
  // the parent re-renders with a different inline onConfirm.
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  // Same trick for locationAdjuster — it's expected to be re-created each
  // render as the user's resolved region or the species-regions table
  // hydrate, but the ingest path runs on the audio-chunk critical path and
  // shouldn't re-identify for that.
  const locationAdjusterRef = useRef(locationAdjuster);
  useEffect(() => {
    locationAdjusterRef.current = locationAdjuster;
  }, [locationAdjuster]);

  // onSpeciesHit — fires for every ingest that passed the raw floor,
  // regardless of whether it confirmed. Stable ref for the same reason
  // as the two callbacks above; host-side changes (e.g. coarse coord
  // resolving after mount) shouldn't re-identify `ingest`.
  const onSpeciesHitRef = useRef(onSpeciesHit);
  useEffect(() => {
    onSpeciesHitRef.current = onSpeciesHit;
  }, [onSpeciesHit]);

  // onEncounterQualified — fires the first time a species' γ-sum
  // crosses ENCOUNTER_QUALIFY_SUM in the current rolling window.
  // Tracked separately from `onSpeciesHit` so cache-warming stays
  // eager (every hit) while "populate the birdex unconfirmed bucket"
  // stays tight (only species that nearly confirmed).
  const onEncounterQualifiedRef = useRef(onEncounterQualified);
  useEffect(() => {
    onEncounterQualifiedRef.current = onEncounterQualified;
  }, [onEncounterQualified]);

  // Set of species keys that have already fired onEncounterQualified
  // for their current rolling window. Cleared on confirmation (so the
  // species can re-qualify next time) and on window eviction (handled
  // implicitly — if the window empties we drop the entry; see
  // refreshPendingLeader).
  const qualifiedRef = useRef<Set<string>>(new Set());

  const [confirmedSightings, setConfirmedSightings] = useState<
    Map<string, Detection>
  >(() => new Map());
  // Mirror of confirmedSightings for use inside refreshPendingLeader,
  // which doesn't want to take confirmedSightings as a dep (it would
  // invalidate the memoized ingest callback on every new confirmation).
  // Writes to this ref always happen right next to setConfirmedSightings.
  const confirmedRef = useRef<Map<string, Detection>>(new Map());
  const [pendingLeader, setPendingLeader] = useState<PendingLeader | null>(null);
  // Most recent qualifying hit (any species). Updated on every ingest that
  // passes the floor and reset to null once the rolling window empties, so
  // the player bar's album art never displays a species that hasn't been
  // heard within CONFIRMATION_WINDOW_MS. Independent of pendingLeader —
  // `latestHit` is recency-first; `pendingLeader` is sum-first.
  const [latestHit, setLatestHit] = useState<LatestHit | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  // Species name cache so we can report the leader with its human-readable
  // names without digging through the window hits (which only carry score
  // and timestamp). Grows on every ingest; never shrinks, which is fine —
  // the bird namespace is bounded at ~6000 labels.
  const namesBySpeciesKeyRef = useRef<
    Map<string, { scientificName: string; commonName: string }>
  >(new Map());

  /**
   * Recompute the pending leader from the current windows ref. Evicts
   * expired hits from each species as a side effect, removes empty
   * windows, and picks the species with the highest remaining sum.
   *
   * Also recomputes `latestHit` (the species of the most-recent live
   * hit across all windows) so it ages out in lockstep with the
   * pending-leader decay tick.
   *
   * Called from: (a) post-ingest, (b) a low-frequency tick so leaders
   * decay even when no new hits arrive, and (c) after hydration.
   */
  const refreshPendingLeader = useCallback((referenceTime: number) => {
    const cutoff = referenceTime - CONFIRMATION_WINDOW_MS;
    let bestKey: string | null = null;
    let bestSum = 0;
    let bestLastHit = 0;
    // Absolute newest live hit across all species — drives `latestHit`.
    // We also snapshot the newest species' own sum so the player bar
    // can render a pie for *that* species' progress, not the leader's.
    let newestKey: string | null = null;
    let newestAt = 0;
    let newestSum = 0;

    for (const [key, hits] of windowsRef.current) {
      const live = hits.filter((h) => h.timestamp >= cutoff);
      if (live.length === 0) {
        windowsRef.current.delete(key);
        // Let this species fire onEncounterQualified again if it
        // reaccumulates from scratch — the window has fully aged out.
        qualifiedRef.current.delete(key);
        continue;
      }
      if (live.length !== hits.length) {
        windowsRef.current.set(key, live);
      }
      const sum = live.reduce((acc, h) => acc + h.contribution, 0);
      const lastHit = live[live.length - 1].timestamp;
      // Tiebreak by most-recent hit so a freshly-calling species pips a
      // stale one with the same sum.
      if (
        sum > bestSum ||
        (sum === bestSum && lastHit > bestLastHit)
      ) {
        bestKey = key;
        bestSum = sum;
        bestLastHit = lastHit;
      }
      if (lastHit > newestAt) {
        newestAt = lastHit;
        newestKey = key;
        newestSum = sum;
      }
    }

    // Update latestHit from whichever species has the most-recent live
    // hit. Done even when there is no pending leader (all windows
    // empty) so the slot clears in sync with the bar's empty state.
    //
    // The progress here is THIS species' own γ-summed evidence toward
    // confirmation, not the leader's — so the pie the player bar
    // renders on this species' thumbnail always reflects *its own*
    // accumulation. A brand-new species gets a near-empty pie (heavy
    // dim veil) which is exactly right: "we just heard this once".
    if (newestKey) {
      const names = namesBySpeciesKeyRef.current.get(newestKey);
      if (names) {
        const confirmed = confirmedRef.current.has(newestKey);
        // When a species is confirmed, its window is cleared (sum → 0),
        // but we want the pie to read "done" (full reveal) rather than
        // "empty". Clamp to 1 in that case.
        const progress = confirmed
          ? 1
          : Math.min(newestSum / CONFIRMATION_THRESHOLD, 1);
        setLatestHit((prev) => {
          if (
            prev &&
            prev.scientificName === names.scientificName &&
            prev.commonName === names.commonName &&
            prev.timestamp === newestAt &&
            prev.progress === progress &&
            prev.confirmed === confirmed
          ) {
            return prev;
          }
          return {
            scientificName: names.scientificName,
            commonName: names.commonName,
            timestamp: newestAt,
            progress,
            confirmed,
          };
        });
      }
    } else {
      setLatestHit((prev) => (prev === null ? prev : null));
    }

    if (!bestKey) {
      setPendingLeader((prev) => (prev === null ? prev : null));
      return;
    }

    const names = namesBySpeciesKeyRef.current.get(bestKey);
    if (!names) {
      // Shouldn't happen in practice (names are populated before
      // refreshPendingLeader is ever called for a given key), but guard
      // defensively so we never crash on a malformed cache.
      setPendingLeader((prev) => (prev === null ? prev : null));
      return;
    }

    const progress = Math.min(bestSum / CONFIRMATION_THRESHOLD, 1);

    setPendingLeader((prev) => {
      // Avoid spurious renders when nothing meaningful changed.
      if (
        prev &&
        prev.scientificName === names.scientificName &&
        prev.commonName === names.commonName &&
        prev.sum === bestSum &&
        prev.lastHitAt === bestLastHit
      ) {
        return prev;
      }
      return {
        scientificName: names.scientificName,
        commonName: names.commonName,
        sum: bestSum,
        progress,
        lastHitAt: bestLastHit,
      };
    });
  }, []);

  // On mount: prune old rows, then read the last window-width of hits and
  // seed the in-memory windows. We deliberately DON'T pre-confirm species
  // that are already over threshold on disk — that would re-trigger Nostr
  // publishes for things the user already confirmed in a previous session.
  // Instead we start empty and let the live stream drive everything; the
  // seeded hits just make sure a partial accumulation isn't wiped.
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();

    (async () => {
      await pruneOlderThan(now - RAW_LOG_RETENTION_MS);
      const recent = await getHitsSince(now - CONFIRMATION_WINDOW_MS);
      if (cancelled) return;

      const windows = new Map<string, WindowHit[]>();
      const names = namesBySpeciesKeyRef.current;
      for (const hit of recent) {
        const key = hit.speciesKey;
        let arr = windows.get(key);
        if (!arr) {
          arr = [];
          windows.set(key, arr);
        }
        // The store persists raw BirdNET score and the locationAdjuster
        // multiplier as two separate fields. The value the accumulator
        // cares about is the product (adjusted score) — compute it
        // here, then re-derive the γ-shaped contribution from that.
        // Doing the multiplication on read (rather than baking an
        // adjusted score into the store) means future changes to the
        // damping interpretation don't require a log migration, and
        // gives us the freedom to surface the raw signal separately
        // if we ever want to.
        const multiplier =
          typeof hit.multiplier === 'number' && Number.isFinite(hit.multiplier)
            ? Math.max(0, Math.min(1, hit.multiplier))
            : 1;
        const adjustedScore = Math.max(0, Math.min(1, hit.score * multiplier));
        arr.push({
          score: adjustedScore,
          contribution: contributionFor(adjustedScore),
          timestamp: hit.timestamp,
        });
        if (!names.has(key)) {
          names.set(key, {
            scientificName: hit.scientificName,
            commonName: hit.commonName,
          });
        }
      }
      windowsRef.current = windows;

      // Replay onEncounterQualified for any species whose restored
      // window is already above the qualify bar — otherwise a reload
      // mid-accumulation would drop the signal and the species would
      // silently fail to land in the birdex's unconfirmed bucket
      // even though the accumulator was clearly on track to confirm.
      // Uses the species' most-recent hit timestamp so the
      // encountered-species store records a plausible lastSeenAt.
      for (const [key, hits] of windows) {
        const sum = hits.reduce((acc, h) => acc + h.contribution, 0);
        if (sum < ENCOUNTER_QUALIFY_SUM) continue;
        if (qualifiedRef.current.has(key)) continue;
        qualifiedRef.current.add(key);
        const nm = names.get(key);
        if (!nm) continue;
        const lastTs = hits[hits.length - 1]?.timestamp ?? now;
        try {
          onEncounterQualifiedRef.current?.(
            {
              scientificName: nm.scientificName,
              commonName: nm.commonName,
            },
            lastTs,
          );
        } catch (error) {
          console.warn(
            '[useDetectionAccumulator] onEncounterQualified failed (hydrate)',
            error,
          );
        }
      }

      refreshPendingLeader(now);
      setIsHydrating(false);
    })().catch((err) => {
      console.warn('[useDetectionAccumulator] hydrate failed', err);
      if (!cancelled) setIsHydrating(false);
    });

    return () => {
      cancelled = true;
    };
  }, [refreshPendingLeader]);

  // Decay tick. Without this, a species that accumulates partway and then
  // goes silent would stay frozen in the pending-leader slot until another
  // hit (possibly for a different species) triggered a refresh. Tick every
  // 5 s — much coarser than the 2 s prediction cadence, so effectively
  // free, and still responsive to windows emptying out.
  useEffect(() => {
    const id = window.setInterval(() => {
      refreshPendingLeader(Date.now());
    }, 5000);
    return () => window.clearInterval(id);
  }, [refreshPendingLeader]);

  const ingest = useCallback<AccumulatorApi['ingest']>(
    (pred, label, timestamp) => {
      if (!label || !label.isBird) return;

      // Apply the optional location-based multiplier before the floor.
      // Out-of-region species are damped (typically 0.5× via the .bin
      // binary signal, or a graded iNat-derived value); the `?? 1`
      // fallback guarantees default behavior whenever the adjuster
      // isn't wired up or returns an undefined/NaN multiplier.
      const raw = pred.score;
      const multiplier = locationAdjusterRef.current?.(pred.index, label);
      const factor =
        typeof multiplier === 'number' && Number.isFinite(multiplier)
          ? Math.max(0, Math.min(1, multiplier))
          : 1;
      const score = raw * factor;

      if (score < MIN_RAW_CONFIDENCE) return;

      // We've passed the floor. Notify the host so it can warm any
      // per-species caches keyed off this label — e.g. lazy iNat
      // nearest-observation lookups used by the graded damper for
      // the NEXT ingest. Fire after the floor check so we don't
      // spend cache budget on noise below threshold.
      try {
        onSpeciesHitRef.current?.(label, timestamp);
      } catch (error) {
        // Never let a misbehaving host callback crash the audio
        // pipeline — this is a fire-and-forget hint, not a
        // correctness dependency.
        console.warn('[useDetectionAccumulator] onSpeciesHit failed', error);
      }

      const key = speciesKey(label);

      // Record the species' name so refreshPendingLeader can report it
      // back without threading names through every WindowHit.
      if (!namesBySpeciesKeyRef.current.has(key)) {
        namesBySpeciesKeyRef.current.set(key, {
          scientificName: label.scientificName,
          commonName: label.commonName,
        });
      }

      // Persist the raw hit. Fire-and-forget — we intentionally don't await.
      // NOTE: we store the raw BirdNET score and the locationAdjuster
      // multiplier as two separate fields, NOT the pre-multiplied
      // adjusted score. The adjusted score is a derived value; keeping
      // the raw signal and the contextual damping factor separate
      // means (a) we can retune the damping pipeline without rewriting
      // the log, and (b) the stored snapshot of what the adjuster
      // returned for this hit at this moment is preserved even if
      // `locationAdjuster` later evaluates to something different
      // (e.g. user moves, iNat data refines). Hydrate recomputes the
      // adjusted score as `score * multiplier`.
      const toStore: Omit<BirdHit, 'id'> = {
        speciesKey: key,
        scientificName: label.scientificName,
        commonName: label.commonName,
        labelIndex: pred.index,
        score: raw,
        multiplier: factor,
        timestamp,
      };
      void appendHit(toStore);

      // Update the rolling window for this species, evicting expired hits.
      const cutoff = timestamp - CONFIRMATION_WINDOW_MS;
      const prev = windowsRef.current.get(key) ?? [];
      const pruned = prev.filter((h) => h.timestamp >= cutoff);
      const contribution = contributionFor(score);
      pruned.push({ score, contribution, timestamp });

      // Sum γ-shaped contributions, NOT raw scores, for the threshold
      // check. See CONFIRMATION_GAMMA / contributionFor for rationale.
      const sum = pruned.reduce((acc, h) => acc + h.contribution, 0);

      if (sum >= CONFIRMATION_THRESHOLD) {
        // Confirmed. Clear the window so the next confirmation for this
        // species starts from scratch; the 10-minute Nostr cooldown in
        // useAutoPublishDetection separately guards against re-publishing
        // too aggressively.
        windowsRef.current.delete(key);
        // A confirmed species is strictly "more qualified than
        // encountered" — clearing this lets the species re-fire
        // onEncounterQualified if it accumulates again after
        // confirmation (rare, but keeps the two signals independent).
        qualifiedRef.current.delete(key);

        const detection: Detection = {
          // Session id — kept stable per species so React can reuse the
          // same card if it re-confirms later in the session. Matches the
          // existing convention of `session-<labelIndex>`.
          id: `session-${pred.index}`,
          scientificName: label.scientificName,
          commonName: label.commonName,
          timestamp,
        };

        setConfirmedSightings((prevMap) => {
          const next = new Map(prevMap);
          const existing = next.get(key);
          next.set(key, {
            ...detection,
            // Preserve the existing id so list keys stay stable across
            // re-confirmations of the same species.
            id: existing?.id ?? detection.id,
          });
          confirmedRef.current = next;
          return next;
        });

        onConfirmRef.current?.(detection);
      } else {
        // Not yet confirmed — just stash the updated window back.
        windowsRef.current.set(key, pruned);

        // Fire the "encountered" signal the first time this species'
        // rolling-window sum crosses the qualify bar. Fire-and-
        // forget: wrapped in try/catch so a misbehaving host handler
        // can't break the audio pipeline, same policy as
        // onSpeciesHit above.
        if (sum >= ENCOUNTER_QUALIFY_SUM && !qualifiedRef.current.has(key)) {
          qualifiedRef.current.add(key);
          try {
            onEncounterQualifiedRef.current?.(
              {
                scientificName: label.scientificName,
                commonName: label.commonName,
              },
              timestamp,
            );
          } catch (error) {
            console.warn(
              '[useDetectionAccumulator] onEncounterQualified failed',
              error,
            );
          }
        }
      }

      // Refresh the leader so the pie overlay reflects either this
      // species pulling ahead, or another species now being the leader
      // after this one confirmed and was cleared.
      refreshPendingLeader(timestamp);
    },
    [refreshPendingLeader],
  );

  const forgetConfirmed = useCallback<AccumulatorApi['forgetConfirmed']>((d) => {
    const key = speciesKey(d);
    setConfirmedSightings((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      confirmedRef.current = next;
      return next;
    });
  }, []);

  return {
    ingest,
    forgetConfirmed,
    confirmedSightings,
    pendingLeader,
    latestHit,
    isHydrating,
  };
}
