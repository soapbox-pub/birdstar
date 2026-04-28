// Global coordination between the BirdInfoDialog reference-song
// player and the live microphone recorder.
//
// The problem this solves: the recorder uses getUserMedia with
// echoCancellation / noiseSuppression / autoGainControl all
// DISABLED (anything else would eat the very tonal structure
// BirdNET needs to classify a song). That's correct for bird
// recognition but it means nothing in the browser prevents the
// mic from picking up audio coming out of the device's own
// speakers. If the user taps "play reference song" while the
// recorder is still live, the mic ingests the played-back audio
// and can confirm a phantom detection -- with a logged-in user,
// that phantom could be published to Nostr as a real sighting.
//
// Fix: any song player that actually starts audio playback
// increments a shared counter; when it pauses/ends/unmounts it
// decrements. The recorder hook reads the counter via
// useSongPlaybackActive() and gates ingestion while it's non-
// zero. A counter (not a boolean) lets multiple concurrent
// players coexist cleanly, even though in practice only one
// dialog is open at a time -- defensive against rapid
// open/close cycles where register/unregister can interleave.
//
// This context is mounted once in the AppRouter above <Index>.
// No hooks that consume it should render outside the provider,
// but for safety the default value is a no-op implementation
// that returns `active: false`, so a stray consumer will
// silently behave as if nothing is playing rather than crash.
import { createContext } from 'react';

export interface SongPlaybackContextValue {
  /**
   * True iff at least one song player is currently emitting
   * audio. Reactive: re-renders consumers when the count
   * transitions 0 <-> 1.
   */
  active: boolean;
  /**
   * Called by a song player when it starts playback. The
   * returned disposer MUST be called on pause/end/unmount to
   * balance the counter. Using a disposer instead of a paired
   * `stop()` call makes misuse harder: useEffect cleanup
   * functions naturally call the disposer with no way to forget
   * which registration they were paired with.
   */
  register: () => () => void;
}

const noopDisposer = () => {};

/**
 * Default value used when a consumer renders outside the
 * provider. `active: false` means "don't mute anything", which
 * is the safe fallback -- worst case the feature silently
 * no-ops, but nothing breaks.
 */
export const SongPlaybackContext = createContext<SongPlaybackContextValue>({
  active: false,
  register: () => noopDisposer,
});
