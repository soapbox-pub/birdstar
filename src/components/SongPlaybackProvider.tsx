// Provider for {@link SongPlaybackContext}. See that file for the
// motivating bug (mic + speaker feedback loop when playing a
// reference song while the recorder is live).
//
// Implementation notes:
//
//   - Count lives in a ref, not in state. Writes to a ref don't
//     trigger renders, which is important because register() can
//     be called inside layout effects and a setState there would
//     schedule an extra commit. The `active` boolean IS in state
//     and is only flipped when the count transitions across zero
//     -- so any number of play/pause events that stay non-zero
//     cause exactly one re-render each (on/off), not one per
//     register call.
//
//   - register() returns a disposer closure that captures the
//     registration's own identity via a flag, so a caller that
//     accidentally calls the disposer twice only decrements
//     once. Guarding this matters because React strict-mode can
//     run effects twice in dev, and a double-decrement would
//     leave the counter briefly negative and the `active` bool
//     stuck at its old value.
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { SongPlaybackContext } from '@/contexts/SongPlaybackContext';

interface SongPlaybackProviderProps {
  children: ReactNode;
}

export function SongPlaybackProvider({ children }: SongPlaybackProviderProps) {
  const countRef = useRef(0);
  const [active, setActive] = useState(false);

  const register = useCallback(() => {
    countRef.current += 1;
    if (countRef.current === 1) setActive(true);

    // Guard flag so a duplicate dispose call (e.g. strict-mode
    // effect re-runs, or a jittery onPause+onEnded event pair)
    // doesn't underflow the counter.
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      countRef.current = Math.max(0, countRef.current - 1);
      if (countRef.current === 0) setActive(false);
    };
  }, []);

  const value = useMemo(() => ({ active, register }), [active, register]);

  return (
    <SongPlaybackContext.Provider value={value}>
      {children}
    </SongPlaybackContext.Provider>
  );
}
