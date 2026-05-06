// Provider for {@link BirdSoundboardContext}. Owns one <audio>
// element per scientific name (lazily created on first play), a
// reactive Set of currently-playing species, and the Play-all /
// Stop-all orchestration used by the player bar.
//
// See BirdSoundboardContext for the why. The short version:
// SpeciesCell uses content-visibility:auto so cells scrolled
// offscreen aren't mounted, which means the player-bar "Play all"
// button can't rely on cell-owned <audio> elements — they might
// not exist. Centralising <audio> ownership in the provider fixes
// that AND makes every per-species UI (cell play button, dialog
// play button, Play-all/Stop-all) automatically stay in sync
// because they all read the same reactive set.
//
// Interaction with SongPlaybackContext:
//
//   The mic-feedback-avoidance system uses a reference counter
//   (SongPlaybackContext). We register ONE slot with it for the
//   entire duration the soundboard has anything playing — not one
//   per species. Individual <audio> elements firing overlapping
//   play/pause events through a single register/dispose pair would
//   be fragile; instead we observe our own `playingSet.size`
//   crossing zero and flip the counter at the 0↔1 boundary. The
//   recorder only cares about "is ANYTHING audible right now" so
//   a single registration is sufficient.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BirdSoundboardContext,
  type BirdSoundboardContextValue,
  type SoundboardTarget,
} from '@/contexts/BirdSoundboardContext';
import { SongPlaybackContext } from '@/contexts/SongPlaybackContext';
import type { BirdSound } from '@/hooks/useBirdSound';
import { fetchInatTaxonId } from '@/hooks/useInatTaxonId';
import { fetchWikipediaSound } from '@/hooks/useWikipediaSound';
import { useContext } from 'react';

/**
 * Maximum number of species playing simultaneously when "Play all"
 * is triggered. Browsers happily decode more than this but audio
 * mixing quality degrades quickly past ~15 concurrent elements,
 * and mobile Safari sometimes starts auto-pausing excess tracks.
 * 12 matches the design spec (dawn-chorus vibe without
 * overwhelming the output).
 */
const PLAY_ALL_CONCURRENCY = 12;

/**
 * Range (ms) for randomised start offsets inside a Play-all
 * sweep. The chorus sounds more natural when tracks don't start
 * in lockstep — spreading them over a few hundred ms removes the
 * "everyone hit play at the exact same frame" artifact without
 * making the user wait noticeably for the last track.
 */
const PLAY_ALL_STAGGER_MS = 400;

/**
 * Re-implements `useBirdSound`'s resolver without the hook
 * infrastructure, so the provider can pre-warm the TanStack
 * Query cache imperatively during Play-all. Keeping the two
 * cascades in sync is the whole point of sharing the
 * `['bird-sound', scientificName]` cache key — both call sites
 * will hit the same 24h cache entry regardless of which one
 * populated it first.
 */
async function resolveBirdSound(
  scientificName: string,
  commonName: string | null,
): Promise<BirdSound | null> {
  const wiki = await fetchWikipediaSound(scientificName, commonName);
  if (wiki) return wiki;
  const taxonId = await fetchInatTaxonId(scientificName);
  if (taxonId == null) return null;
  // Reuse the same iNat observation endpoint useBirdSound uses,
  // inline so we don't export internals from that file just for
  // the provider. Kept in one place for auditability.
  const url = new URL('https://api.inaturalist.org/v1/observations');
  url.searchParams.set('taxon_id', String(taxonId));
  url.searchParams.set('sounds', 'true');
  url.searchParams.set('quality_grade', 'research');
  url.searchParams.set('order_by', 'votes');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', '5');
  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: Array<{
      id: number;
      sounds?: Array<{ file_url?: string; attribution?: string }>;
    }>;
  };
  for (const obs of data.results ?? []) {
    const sound = obs.sounds?.find((s) => Boolean(s.file_url));
    if (!sound?.file_url) continue;
    return {
      audioUrl: sound.file_url,
      observationUrl: `https://www.inaturalist.org/observations/${obs.id}`,
      attribution:
        sound.attribution ??
        `Recording courtesy of iNaturalist observation #${obs.id}`,
      source: 'inaturalist',
    };
  }
  return null;
}

interface BirdSoundboardProviderProps {
  children: ReactNode;
}

export function BirdSoundboardProvider({ children }: BirdSoundboardProviderProps) {
  const queryClient = useQueryClient();
  const { register: registerSong } = useContext(SongPlaybackContext);

  // One <audio> element per scientific name, created lazily on
  // first play. Lives in a ref because swapping the map reference
  // would cause unnecessary renders — only `playingSet` needs to
  // be reactive. Elements are never evicted during the provider's
  // lifetime: the browser's audio decoder reuses them across
  // play/pause cycles cheaply, and re-creating on every tap would
  // lose buffered decoding work for no gain.
  const audiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Per-species "why did this last stop" flag. Set to true by
  // stopAll() so the <audio> element's onPause handler can
  // distinguish a user-initiated stop (keep playAllActive true
  // until it's drained) from an auto-end (rare; tracks loop) or
  // a browser-initiated pause (treat as stop). Cleared when the
  // species starts again.
  const stoppingRef = useRef<Set<string>>(new Set());

  // The canonical reactive set of currently-playing species.
  // Replaced (not mutated) on every transition so memoized
  // consumers can do identity comparisons.
  const [playingSet, setPlayingSet] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [playAllActive, setPlayAllActive] = useState(false);

  // Single SongPlayback registration spanning "anything is
  // playing". See file header for why we don't register per
  // species. Disposer is held in a ref so the cleanup path in
  // the playingSet effect below can call it on the 1→0
  // transition without re-reading from the context.
  const songDisposerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (playingSet.size > 0 && songDisposerRef.current === null) {
      songDisposerRef.current = registerSong();
    } else if (playingSet.size === 0 && songDisposerRef.current !== null) {
      songDisposerRef.current();
      songDisposerRef.current = null;
      // When nothing is left playing, a prior Play-all sweep is
      // necessarily also done. Clearing this here (rather than
      // inside stopAll) also handles the case where all tracks
      // stop individually via per-cell taps — the sound bar
      // returns to its normal state without a manual Stop all.
      setPlayAllActive(false);
    }
  }, [playingSet, registerSong]);

  // Unmount cleanup: release the SongPlayback slot and pause any
  // lingering audio so navigating away doesn't leave sound
  // bleeding into the next page.
  useEffect(() => {
    // Capture the ref object (NOT .current) at effect-run time so
    // the cleanup closure reads from the same container the rest
    // of the provider writes to. `audiosRef` itself is a stable
    // React ref object; `.current` is only accessed inside the
    // cleanup, which runs at unmount — that's the correct time to
    // drain whatever audio elements accumulated over the page's
    // lifetime. Copying the map via a local variable would snapshot
    // only the elements present at mount (always the empty map),
    // which defeats the whole point of the cleanup.
    const audios = audiosRef;
    const songDisposer = songDisposerRef;
    return () => {
      if (songDisposer.current) {
        songDisposer.current();
        songDisposer.current = null;
      }
      for (const el of audios.current.values()) {
        el.pause();
        el.src = '';
      }
      audios.current.clear();
    };
  }, []);

  /**
   * Get (or lazily create) the <audio> element for a given
   * scientific name. The element isn't attached to the DOM —
   * HTMLAudioElement works fine as a detached node for playback
   * purposes and skipping the DOM insertion avoids a render
   * tree bump with N invisible <audio> nodes for a large
   * soundboard.
   */
  const getOrCreateAudio = useCallback(
    (scientificName: string, audioUrl: string) => {
      const existing = audiosRef.current.get(scientificName);
      if (existing) {
        if (existing.src !== audioUrl) {
          // Source changed (shouldn't happen often, but the
          // Wikipedia→iNat fallback in useBirdSound can in
          // theory resolve to a different URL after the cache
          // entry initially fetched). Update in place rather
          // than leaking the old element.
          existing.src = audioUrl;
          existing.load();
        }
        return existing;
      }
      const el = new Audio(audioUrl);
      el.loop = true;
      el.preload = 'none';

      // Keep playingSet honest with whatever the browser decides
      // to do with this element: user taps Stop, tab loses
      // focus, track errors out, etc. All paths funnel through
      // these handlers.
      const remove = () => {
        setPlayingSet((prev) => {
          if (!prev.has(scientificName)) return prev;
          const next = new Set(prev);
          next.delete(scientificName);
          return next;
        });
        stoppingRef.current.delete(scientificName);
      };
      el.addEventListener('pause', remove);
      el.addEventListener('ended', remove);
      el.addEventListener('error', remove);

      audiosRef.current.set(scientificName, el);
      return el;
    },
    [],
  );

  const playSpecies = useCallback<BirdSoundboardContextValue['playSpecies']>(
    async ({ scientificName }, audioUrl) => {
      const el = getOrCreateAudio(scientificName, audioUrl);
      stoppingRef.current.delete(scientificName);
      try {
        // Mark as playing BEFORE awaiting play() so rapid UI
        // feedback (button switches to equaliser immediately)
        // doesn't wait for the browser to schedule the decode.
        // The pause/error listeners above will correct the
        // state if play() ends up rejecting.
        setPlayingSet((prev) => {
          if (prev.has(scientificName)) return prev;
          const next = new Set(prev);
          next.add(scientificName);
          return next;
        });
        await el.play();
      } catch {
        // Autoplay blocked, source load failed, etc. Reset.
        setPlayingSet((prev) => {
          if (!prev.has(scientificName)) return prev;
          const next = new Set(prev);
          next.delete(scientificName);
          return next;
        });
      }
    },
    [getOrCreateAudio],
  );

  const stopSpecies = useCallback<BirdSoundboardContextValue['stopSpecies']>(
    (scientificName) => {
      const el = audiosRef.current.get(scientificName);
      if (!el) {
        // Species isn't tracked — nothing to stop, but defensively
        // scrub it out of the playing set in case of a desync.
        setPlayingSet((prev) => {
          if (!prev.has(scientificName)) return prev;
          const next = new Set(prev);
          next.delete(scientificName);
          return next;
        });
        return;
      }
      stoppingRef.current.add(scientificName);
      el.pause();
      // Reset to 0 so the next play starts from the beginning —
      // otherwise a Stop/Play pair would resume mid-phrase which
      // reads as broken.
      el.currentTime = 0;
    },
    [],
  );

  const stopAll = useCallback<BirdSoundboardContextValue['stopAll']>(() => {
    // Snapshot keys first; we're about to mutate the underlying
    // state indirectly through each element's pause handler.
    const keys = Array.from(audiosRef.current.keys());
    for (const sn of keys) {
      const el = audiosRef.current.get(sn);
      if (!el) continue;
      stoppingRef.current.add(sn);
      el.pause();
      el.currentTime = 0;
    }
    // Belt + suspenders: the pause listeners will empty the set,
    // but do it synchronously here too so any render batched with
    // this call sees the cleared state.
    setPlayingSet(new Set());
    setPlayAllActive(false);
  }, []);

  // Guard against overlapping Play-all invocations (double-tap,
  // race between a finishing playAll and a new one, etc). The
  // provider doesn't need to reenter its own sweep; a second
  // call while one is in flight is a no-op.
  const playAllRunningRef = useRef(false);

  const playAll = useCallback<BirdSoundboardContextValue['playAll']>(
    async (targets) => {
      if (playAllRunningRef.current) return;
      if (targets.length === 0) return;
      playAllRunningRef.current = true;
      setPlayAllActive(true);

      try {
        // Resolve sound URLs through the TanStack Query cache.
        // fetchQuery() reuses any in-flight or cached result
        // keyed on ['bird-sound', sn] and only fires a new
        // network request when nothing is cached — meaning cells
        // that have already shown their per-cell play button
        // contribute an instant-start track, and only truly new
        // species pay the round-trip.
        const resolutions = await Promise.allSettled(
          targets.map(async (t) => {
            const sound = await queryClient.fetchQuery<BirdSound | null>({
              queryKey: ['bird-sound', t.scientificName],
              staleTime: 1000 * 60 * 60 * 24,
              gcTime: 1000 * 60 * 60 * 24,
              queryFn: () =>
                resolveBirdSound(t.scientificName, t.commonName ?? null),
            });
            return { target: t, sound };
          }),
        );

        // Only species we actually have a recording for make it
        // into the pool. Species with no recording are silently
        // skipped — they don't have a play button in the cell
        // either, so the user's mental model of "Play all plays
        // everything that has a play button" holds.
        const playable = resolutions
          .map((r) => (r.status === 'fulfilled' ? r.value : null))
          .filter(
            (r): r is { target: SoundboardTarget; sound: BirdSound } =>
              r !== null && r.sound !== null,
          );

        // Cap the concurrency AFTER resolution so we never fetch
        // more than we need — but since resolutions are cheap
        // (cached for most species), the cap is really about the
        // <audio> elements, not the network.
        const capped = playable.slice(0, PLAY_ALL_CONCURRENCY);

        // Randomised stagger: each track waits a small, unique
        // offset before starting. The offsets are uniformly
        // spread across PLAY_ALL_STAGGER_MS so the chorus has
        // an organic ramp-in rather than 12 simultaneous
        // attack transients.
        await Promise.allSettled(
          capped.map(({ target, sound }, i) => {
            // Deterministic + slight jitter — spreads the load
            // predictably in tests while still feeling organic
            // in production.
            const delay =
              (i * PLAY_ALL_STAGGER_MS) / Math.max(1, capped.length - 1) +
              Math.random() * 40;
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                // User may have hit Stop all during the stagger
                // window. Check before starting so we don't
                // zombie-start tracks after a stop.
                if (!playAllRunningRef.current) {
                  resolve();
                  return;
                }
                void playSpecies(target, sound.audioUrl).finally(resolve);
              }, delay);
            });
          }),
        );
      } finally {
        playAllRunningRef.current = false;
        // NOTE: we deliberately don't clear playAllActive here.
        // The tracks are still playing (looping) and the player
        // bar should stay in soundboard mode until the user hits
        // Stop all OR every track stops (which flips the flag in
        // the playingSet→0 effect above).
      }
    },
    [playSpecies, queryClient],
  );

  // Keep the playAllRunningRef honest when the user hits Stop all
  // mid-sweep — the allSettled above is still pending, and we
  // need to short-circuit it. The ref is checked inside the
  // setTimeout callbacks.
  useEffect(() => {
    if (!playAllActive) {
      playAllRunningRef.current = false;
    }
  }, [playAllActive]);

  const value = useMemo<BirdSoundboardContextValue>(
    () => ({
      playingSet,
      playAllActive,
      playSpecies,
      stopSpecies,
      playAll,
      stopAll,
    }),
    [playingSet, playAllActive, playSpecies, stopSpecies, playAll, stopAll],
  );

  return (
    <BirdSoundboardContext.Provider value={value}>
      {children}
    </BirdSoundboardContext.Provider>
  );
}
