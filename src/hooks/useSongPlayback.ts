// Reads the shared song-playback state for the mic-feedback-
// avoidance system. See src/contexts/SongPlaybackContext.ts for
// the why.
//
// Two entry points:
//
//   - useSongPlaybackActive(): just the boolean. This is what
//     useAudioRecorder calls to decide whether to gate ingestion.
//   - useRegisterSongPlayback(isPlaying): convenience wrapper
//     that handles the register-on-play / dispose-on-pause
//     dance for a song player component. Pass it whatever
//     'playing' bool the player is already tracking.
import { useContext, useEffect } from 'react';
import { SongPlaybackContext } from '@/contexts/SongPlaybackContext';

/**
 * Subscribe to whether ANY registered song player is currently
 * playing audio. Re-renders the consumer only on 0 <-> 1 count
 * transitions (not on every register call).
 */
export function useSongPlaybackActive(): boolean {
  return useContext(SongPlaybackContext).active;
}

/**
 * Register/deregister a player with the shared counter based on
 * its own playing state. The effect runs register() when
 * isPlaying flips to true and calls the returned disposer when
 * it flips back to false (or the component unmounts). Using the
 * disposer pattern rather than a paired stop() makes the
 * cleanup foolproof -- useEffect naturally calls the disposer
 * on both isPlaying=false transitions and unmount.
 */
export function useRegisterSongPlayback(isPlaying: boolean): void {
  const { register } = useContext(SongPlaybackContext);

  useEffect(() => {
    if (!isPlaying) return;
    const dispose = register();
    return dispose;
  }, [isPlaying, register]);
}
