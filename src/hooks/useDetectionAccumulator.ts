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
 * regardless of species or whether it ever confirmed. Surfaced so UI
 * that wants to reflect "what was just heard" (e.g. the player bar's
 * album-art thumbnail) can track the raw hit stream rather than the
 * pending-leader (highest-summed species) or the confirmed map
 * (threshold-crossers only). Cleared to null only when the in-memory
 * windows are empty — i.e. no hits at all within the rolling window.
 *
 * This is deliberately decoupled from PendingLeader: pending leader is
 * "who's winning the accumulation race" (highest γ-shaped sum), which
 * can point at a species that hasn't been heard in the last ~30 s if
 * they earlier stacked up a lot of confidence and no other species has
 * been heard since. `latestHit` always points at the most recent
 * actual audio hit.
 */
export interface LatestHit {
  scientificName: string;
  commonName: string;
  /** Timestamp (ms) of the hit. */
  timestamp: number;
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
   * off doesn't block the ingest hot path.
   *
   * Captured in a ref like `locationAdjuster` so handlers can freely
   * re-identify on render.
   */
  onSpeciesHit?: (label: BirdLabel) => void;
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
  const { onConfirm, locationAdjuster, onSpeciesHit } = options;

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

  const [confirmedSightings, setConfirmedSightings] = useState<
    Map<string, Detection>
  >(() => new Map());
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
    let newestKey: string | null = null;
    let newestAt = 0;

    for (const [key, hits] of windowsRef.current) {
      const live = hits.filter((h) => h.timestamp >= cutoff);
      if (live.length === 0) {
        windowsRef.current.delete(key);
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
      }
    }

    // Update latestHit from whichever species has the most-recent live
    // hit. Done even when there is no pending leader (all windows
    // empty) so the slot clears in sync with the bar's empty state.
    if (newestKey) {
      const names = namesBySpeciesKeyRef.current.get(newestKey);
      if (names) {
        setLatestHit((prev) => {
          if (
            prev &&
            prev.scientificName === names.scientificName &&
            prev.commonName === names.commonName &&
            prev.timestamp === newestAt
          ) {
            return prev;
          }
          return {
            scientificName: names.scientificName,
            commonName: names.commonName,
            timestamp: newestAt,
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
        onSpeciesHitRef.current?.(label);
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
          return next;
        });

        onConfirmRef.current?.(detection);
      } else {
        // Not yet confirmed — just stash the updated window back.
        windowsRef.current.set(key, pruned);
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
