// Shared soundboard state for Birds mode. Lets every "play this
// bird's reference song" surface in the app (per-cell play button
// in the birdex, the BirdInfoDialog's player button, and the
// "Play all" / "Stop all" buttons in the bottom sound bar) agree
// on a single source of truth for which species are currently
// singing.
//
// Why a context, not ad-hoc per-component state?
//
//   Before this existed, each cell owned its own hidden <audio>
//   element and local `isPlaying` state. That was fine in
//   isolation but broke the moment we wanted any of the following:
//
//     1. A "Play all" button in the player bar that triggers
//        playback for every heard species (including species whose
//        SpeciesCell is currently offscreen, i.e. not mounted
//        thanks to `content-visibility: auto`).
//     2. A "Stop all" button that stops every currently-playing
//        recording, again regardless of which cells are mounted.
//     3. Visual sync: if the user opens the BirdInfoDialog for a
//        species that's already playing via the soundboard, the
//        dialog's play button should show the equaliser state
//        immediately, not render a fresh "play" glyph that
//        contradicts reality.
//
//   Since SpeciesCell uses content-visibility:auto and an
//   IntersectionObserver to skip rendering offscreen cells, the
//   soundboard cannot rely on cell-owned <audio> elements — they
//   might not exist. Instead, the context owns one <audio> per
//   scientific name (lazily created on first play), and every UI
//   surface routes through it.
//
// Relationship to SongPlaybackContext:
//
//   SongPlaybackContext is a reference counter that tells the mic
//   recorder to mute itself while any audio is playing (avoids a
//   speaker→mic feedback loop that would confirm phantom
//   detections). BirdSoundboardContext sits ABOVE that: it
//   registers/deregisters with the SongPlaybackContext whenever
//   at least one species is playing. Consumers that only care
//   about "is anything playing globally" keep reading
//   useSongPlaybackActive() — they don't need to know about the
//   soundboard. Consumers that want per-species state (cell play
//   buttons, dialog play button, Play-all/Stop-all) use this
//   context.
//
// Provider mount: inside the SongPlaybackProvider, above
// IndexInner in BirdsIndex. See BirdSoundboardProvider for the
// wiring.
import { createContext } from 'react';

/**
 * Minimal shape of the entries the soundboard needs in order to
 * initiate playback: a stable scientific-name key (the primary
 * identifier across cache, context, and UI), plus the common name
 * for aria labels and error reporting. Intentionally narrower
 * than BirdexEntry so unrelated callers (e.g. the dialog, or a
 * future "play this row" surface) don't have to fabricate a full
 * birdex entry to use the soundboard.
 */
export interface SoundboardTarget {
  scientificName: string;
  commonName: string;
}

export interface BirdSoundboardContextValue {
  /**
   * Scientific names of species currently playing. Exposed as a
   * Set (wrapped in a reactive value) so consumers can do an O(1)
   * `playingSet.has(sn)` check without allocating. Reference is
   * replaced (not mutated) on every change so React memoized
   * consumers can rely on identity equality for "did the set
   * change."
   */
  playingSet: ReadonlySet<string>;
  /**
   * True iff a bulk "Play all" operation is currently in flight or
   * sustaining. Distinct from `playingSet.size > 0` because a
   * single manual cell play shouldn't make the player bar think
   * the user is running the soundboard. Cleared when the user
   * hits Stop all OR when the last Play-all-started track stops.
   */
  playAllActive: boolean;
  /**
   * Start or stop playback for a single species. Idempotent: if
   * the species is already playing, calling play() again does
   * nothing; if it's not playing, stop() is a no-op. Playback
   * uses a context-owned <audio> element keyed on scientific
   * name — one element per species for the entire lifetime of
   * the provider — so multiple cells / dialogs targeting the
   * same species always share the same underlying audio.
   *
   * `audioUrl` is required on play() because the caller is the
   * one that resolved it via useBirdSound (which lives inside a
   * TanStack Query cache). Passing it in keeps the context
   * provider from needing its own query hook.
   */
  playSpecies(target: SoundboardTarget, audioUrl: string): Promise<void>;
  stopSpecies(scientificName: string): void;
  /**
   * Play every target's reference recording concurrently, up to a
   * browser-safe concurrency cap, with small staggered starts so
   * the chorus doesn't begin in lockstep. Resolves the sound URL
   * for each target via the same TanStack Query cache key
   * useBirdSound uses (`['bird-sound', scientificName]`), so
   * targets whose sound was already fetched start instantly and
   * others queue up behind the fetch.
   *
   * Sets `playAllActive: true` for the duration. Calling
   * playAll() while it's already active is a no-op.
   */
  playAll(targets: readonly SoundboardTarget[]): Promise<void>;
  /**
   * Stop everything currently playing (soundboard-initiated or
   * not) and clear `playAllActive`. Safe to call when nothing is
   * playing.
   */
  stopAll(): void;
}

const noop = () => {};
const noopAsync = async () => {};

/**
 * Default value used when a consumer renders outside the provider
 * (e.g. during tests or a stray import). Everything is inert so
 * nothing crashes; the UI just behaves as if the soundboard
 * feature were disabled.
 */
export const BirdSoundboardContext = createContext<BirdSoundboardContextValue>({
  playingSet: new Set(),
  playAllActive: false,
  playSpecies: noopAsync,
  stopSpecies: noop,
  playAll: noopAsync,
  stopAll: noop,
});
