// Live BirdNET confidence feed, broadcast to any surface that wants
// to visualise "which species are audible right now." Populated from
// every BirdNET inference chunk in BirdsIndex; consumed by
// SpeciesCell (and potentially future visualisations) to drive a
// decaying per-species glow on the dex grid.
//
// Design goals:
//
//   1. O(1) reads per cell. The birdex grid can render hundreds of
//      cells; each one needs to ask "what's my current glow
//      intensity?" once per animation frame window without walking
//      a prediction list.
//   2. Selective re-renders. A cell should re-render ONLY when its
//      own species' intensity changes, not when any unrelated
//      species fires. Implemented via `useSyncExternalStore` with a
//      per-species snapshot — unrelated updates short-circuit on
//      snapshot equality.
//   3. Works with SpeciesCell's aggressive memo. The cell's props
//      never change when a glow does; the subscription lives INSIDE
//      the cell so React can skip the outer memo comparison while
//      still refreshing the glow layer.
//   4. No prop drilling. Thousands of species labels × every
//      detection chunk is not a shape worth threading through the
//      grid.
//
// Lifecycle: raw scores come from BirdNET's top-K output (already
// sigmoid-activated, in [0, 1]). A chunk publishes ALL its
// predictions above a floor; the store stamps each with a
// `producedAt` time and a `decayMs` lifetime. A single rAF-driven
// ticker advances time, recomputes live intensities, and notifies
// subscribers whose intensity actually changed since their last
// snapshot. Entries whose intensity has decayed to 0 are dropped.
//
// Keying convention matches the rest of the app:
// `scientificName.toLowerCase()`. This is the same key used by
// `useBirdex`, `useEncounteredSpecies`, and `sessionPublishedAt` —
// keeping it consistent means lookups don't drift across systems.

import { createContext } from 'react';

/**
 * A single live prediction entry, stamped with the time it was
 * produced and the total time it should take to decay to zero.
 * Stored internally; not part of the public API.
 */
export interface GlowEntry {
  /** Peak raw score (sigmoid-activated BirdNET output, in [0, 1]). */
  score: number;
  /** Wall-clock ms timestamp (Date.now()) the score was produced. */
  producedAt: number;
  /** Total decay duration in ms. Intensity = score * (1 - elapsed/decayMs). */
  decayMs: number;
}

export interface BirdGlowContextValue {
  /**
   * Publish a batch of raw BirdNET predictions. The store stamps
   * each with `producedAt = now` and schedules decay. If the same
   * species is already glowing, the new score REPLACES the old one
   * when it's higher OR when the old one was already decaying past
   * halfway — so sustained detections stay lit without ever going
   * dark between chunks, and a single weak reading can't dim a
   * strong leading species.
   *
   * Empty arrays are safe (no-op). Scores <= 0 are ignored.
   */
  publish(
    predictions: readonly { scientificName: string; score: number }[],
  ): void;
  /**
   * Subscribe to the store. The callback fires when ANY species'
   * intensity changes (including decay-driven changes, not just
   * publishes). Subscribers should read via {@link getIntensity}
   * with their own species key to compute their snapshot.
   *
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Read the current glow intensity for a scientific name, in
   * [0, 1]. Returns 0 if the species has never been detected, has
   * fully decayed, or the store is inert (no provider mounted).
   * Callers MUST pass a case-insensitive key; the store
   * normalises internally, so both `"Turdus migratorius"` and
   * `"turdus migratorius"` resolve to the same entry.
   */
  getIntensity(scientificName: string): number;
}

const inertStore: BirdGlowContextValue = {
  publish: () => {},
  subscribe: () => () => {},
  getIntensity: () => 0,
};

/**
 * Default value is inert. Components rendered outside the provider
 * (e.g. in tests) get a store that silently accepts writes and
 * always reports zero intensity — so the dex renders identically to
 * the pre-glow baseline rather than crashing.
 */
export const BirdGlowContext = createContext<BirdGlowContextValue>(inertStore);
