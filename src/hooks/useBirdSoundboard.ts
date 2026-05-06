// Consumer helpers for the bird soundboard. Separated from the
// context file so the provider can export the context itself
// without a dep cycle (the provider imports the context; the
// context shouldn't import hooks that might someday import back
// from the provider).
//
// Three entry points:
//
//   - useBirdSoundboard(): the full context, used by the player
//     bar's Play-all/Stop-all buttons and anywhere else that
//     needs to invoke a soundboard action directly.
//   - useIsSpeciesPlaying(sn): narrow reactive subscription for
//     per-species UI surfaces (cell play button, dialog play
//     button). Uses the Set-identity equality from the provider
//     so re-renders only fire when the set itself changes, not
//     on every unrelated set mutation.
//   - useBirdSoundboardPlayAllActive(): bar-level convenience
//     that returns only the `playAllActive` flag, useful for
//     components that conditionally render based on soundboard
//     mode and don't need the rest of the context.

import { useContext } from 'react';
import {
  BirdSoundboardContext,
  type BirdSoundboardContextValue,
} from '@/contexts/BirdSoundboardContext';

export function useBirdSoundboard(): BirdSoundboardContextValue {
  return useContext(BirdSoundboardContext);
}

export function useIsSpeciesPlaying(scientificName: string | null): boolean {
  const { playingSet } = useContext(BirdSoundboardContext);
  if (!scientificName) return false;
  return playingSet.has(scientificName);
}

export function useBirdSoundboardPlayAllActive(): boolean {
  return useContext(BirdSoundboardContext).playAllActive;
}
