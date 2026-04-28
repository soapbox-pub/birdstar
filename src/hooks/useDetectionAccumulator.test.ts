// Tests for the location-aware damping path in useDetectionAccumulator.
//
// We don't try to exercise the full IndexedDB hydrate here — that requires a
// real IDB (jsdom doesn't ship one) and the store is already isolated behind
// its own module. Instead we mock birdHitStore's async hooks so the hook
// mounts cleanly, then drive `ingest` directly and assert on the visible
// accumulator state.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/birdHitStore', () => ({
  appendHit: vi.fn().mockResolvedValue(undefined),
  getHitsSince: vi.fn().mockResolvedValue([]),
  pruneOlderThan: vi.fn().mockResolvedValue(undefined),
}));

import {
  useDetectionAccumulator,
  CONFIRMATION_THRESHOLD,
  OUT_OF_REGION_MULTIPLIER,
  contributionFor,
} from './useDetectionAccumulator';
import type { BirdLabel } from '@/lib/birdnet/labels';

const robinLabel: BirdLabel = {
  index: 42,
  scientificName: 'Turdus migratorius',
  commonName: 'American Robin',
  isBird: true,
};

const outOfRegionLabel: BirdLabel = {
  index: 99,
  scientificName: 'Bubo africanus',
  commonName: 'Spotted Eagle-Owl',
  isBird: true,
};

describe('useDetectionAccumulator location damping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms an in-region species in a single strong hit', async () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() =>
      useDetectionAccumulator({
        onConfirm,
        // All species in-range → no damping.
        locationAdjuster: () => 1,
      }),
    );

    // Wait for hydrate to finish so `isHydrating` flips false and the
    // component is in its steady state.
    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    act(() => {
      result.current.ingest(
        { index: robinLabel.index, score: 0.9 },
        robinLabel,
        1_000_000,
      );
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      scientificName: robinLabel.scientificName,
      commonName: robinLabel.commonName,
    });
  });

  it('does NOT confirm an out-of-region species on a single hit of the same raw strength', async () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() =>
      useDetectionAccumulator({
        onConfirm,
        // Everything out-of-range.
        locationAdjuster: () => OUT_OF_REGION_MULTIPLIER,
      }),
    );

    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    // raw 0.9 × 0.5 (damping) = adjusted 0.45 → contribution 0.45^γ,
    // which at γ=2 is 0.2025 — well below the 0.45 threshold.
    act(() => {
      result.current.ingest(
        { index: outOfRegionLabel.index, score: 0.9 },
        outOfRegionLabel,
        2_000_000,
      );
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lets an out-of-region species accumulate across repeated strong hits', async () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() =>
      useDetectionAccumulator({
        onConfirm,
        locationAdjuster: () => OUT_OF_REGION_MULTIPLIER,
      }),
    );

    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    // Each hit's adjusted score is 0.9 × 0.5 = 0.45; contribution is
    // 0.45^γ. At γ=2 that's 0.2025 per hit, so three hits (0.6075) are
    // enough to cross the 0.45 threshold. Fire four to be comfortably
    // clear of any γ retuning within reason.
    const base = 3_000_000;
    act(() => {
      for (let i = 0; i < 4; i++) {
        result.current.ingest(
          { index: outOfRegionLabel.index, score: 0.9 },
          outOfRegionLabel,
          base + i * 2_000,
        );
      }
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // The emitted Detection carries no score (kind 2473 events deliberately
    // omit per-event confidence — publishing IS the confidence signal).
    // We only assert that accumulation did in fact cross the threshold.
    expect(4 * contributionFor(0.9 * OUT_OF_REGION_MULTIPLIER)).toBeGreaterThanOrEqual(
      CONFIRMATION_THRESHOLD,
    );
  });

  it('treats a returned multiplier of 0 as silencing the species (no floor cross, no confirm)', async () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() =>
      useDetectionAccumulator({
        onConfirm,
        locationAdjuster: () => 0,
      }),
    );

    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    act(() => {
      result.current.ingest(
        { index: outOfRegionLabel.index, score: 1 },
        outOfRegionLabel,
        4_000_000,
      );
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(result.current.pendingLeader).toBeNull();
  });

  it('falls back to no damping when locationAdjuster is absent', async () => {
    const onConfirm = vi.fn();
    const { result } = renderHook(() => useDetectionAccumulator({ onConfirm }));

    await waitFor(() => expect(result.current.isHydrating).toBe(false));

    act(() => {
      result.current.ingest(
        { index: robinLabel.index, score: 0.85 },
        robinLabel,
        5_000_000,
      );
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
