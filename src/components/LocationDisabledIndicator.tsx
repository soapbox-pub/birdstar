// Small bottom-of-viewport indicator shown whenever the app is running
// against a location fallback — i.e. when the browser's geolocation API
// has been denied, is unsupported, or the user actively declined the
// prompt and we've fallen back to a continent-level North America
// default.
//
// The indicator is a compact, fixed-position pill in the bottom-left
// corner of the viewport so it sits out of the way of content but is
// always reachable. It mirrors the top-left ModeSelector aesthetically
// and is rendered on every route (both Birds and Stars modes) from
// `src/pages/Index.tsx`.
//
// In Birds mode the PlayerBar occupies the full-width bottom strip at
// `z-40`; we lift the indicator above it with `bottom-24`/`bottom-28`.
// In Stars mode there's no player bar, so the indicator sits closer to
// the bottom edge.
//
// Clicking the pill opens a popover that explains why location is
// needed and offers a "Try again" action that re-runs the browser's
// geolocation prompt.
//
// IMPLEMENTATION NOTE: this component deliberately does NOT import the
// `useUserRegion` / `useGeolocation` hooks, even though it needs their
// state. Both hooks own side effects (auto-prompt, localStorage writes)
// and mounting a second instance on top of the page that already owns
// them would race the single-flight semantics. Instead, we read the
// persisted state directly and observe changes via the `storage` event
// and a custom `birdstar:location-change` event that the hooks dispatch
// after they commit a decision.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPinOff } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMode } from '@/hooks/useMode';

const EXPLAINER =
  'Birdstar needs access to GPS sensors on your device to show birds in your area and orient you with the stars.';

/** Event dispatched on `window` by `useUserRegion` and `useGeolocation`
 * whenever either commits a new decision (ready / denied / unavailable
 * / granted). Lets the indicator update without re-mounting those
 * hooks. */
export const LOCATION_CHANGE_EVENT = 'birdstar:location-change';

// -- Persisted-state readers -------------------------------------------------

const BIRDS_KEY = 'birdsong.userLocation.v3';
const STARS_KEY = 'starpoint:geo';

type BirdsStatus = 'ready' | 'denied' | 'unavailable' | 'unknown';

function readBirdsStatus(): BirdsStatus {
  try {
    const raw = localStorage.getItem(BIRDS_KEY);
    if (!raw) return 'unknown';
    const parsed = JSON.parse(raw) as { status?: string };
    const s = parsed?.status;
    if (s === 'ready' || s === 'denied' || s === 'unavailable') return s;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function readStarsHasFix(): boolean {
  try {
    const raw = localStorage.getItem(STARS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { latitude?: unknown; longitude?: unknown };
    return (
      typeof parsed?.latitude === 'number' && typeof parsed?.longitude === 'number'
    );
  } catch {
    return false;
  }
}

interface Snapshot {
  birds: BirdsStatus;
  starsHasFix: boolean;
}

function readSnapshot(): Snapshot {
  return { birds: readBirdsStatus(), starsHasFix: readStarsHasFix() };
}

// -- Component ---------------------------------------------------------------

export function LocationDisabledIndicator() {
  const { mode } = useMode();
  const [snapshot, setSnapshot] = useState<Snapshot>(readSnapshot);

  useEffect(() => {
    const refresh = () => setSnapshot(readSnapshot());
    window.addEventListener('storage', refresh);
    window.addEventListener(LOCATION_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(LOCATION_CHANGE_EVENT, refresh);
    };
  }, []);

  const birdsDisabled =
    snapshot.birds === 'denied' || snapshot.birds === 'unavailable';
  // Stars mode has no persisted "denied" state — the hook silently
  // falls back to an NA default and forgets. We approximate it by
  // showing the indicator whenever there is no cached fix AND the
  // user is currently in Stars mode. StarsIndex auto-requests on
  // mount, so after the browser either grants or denies, a
  // LOCATION_CHANGE_EVENT fires that refreshes this snapshot. On
  // denial, `starsHasFix` stays false → indicator shows.
  const starsDisabled = !snapshot.starsHasFix;

  const disabled = mode === 'stars' ? starsDisabled : birdsDisabled;

  const retry = useCallback(() => {
    // Best-effort cross-hook retry: clear any persisted denial so the
    // next hook-mount re-prompts, then dispatch the refresh event so
    // the active page re-reads state. This avoids the indicator having
    // to hold a reference to a hook's `request()` function.
    try {
      // For Birds: removing the stored decision puts the hook back into
      // 'unknown', which re-triggers its auto-prompt on the next tick.
      localStorage.removeItem(BIRDS_KEY);
    } catch {
      // Private mode / quota — not fatal.
    }
    window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
    // Directly call the browser's geolocation API too, so the browser
    // shows the permission prompt (or the saved denial) immediately
    // regardless of which mode we're in. The mode-specific hook will
    // also re-request on its own; this is just a nudge.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT)),
        () => window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT)),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      );
    }
  }, []);

  if (!disabled) return null;

  return (
    <div
      className={cn(
        // Always on top of PlayerBar (z-40) and top HUDs (z-20). Below
        // modal overlays which use z-50 from Radix.
        'fixed left-3 z-50 sm:left-4',
        // In Birds mode clear the PlayerBar (~80px tall). In Stars mode
        // sit close to the bottom edge.
        mode === 'stars' ? 'bottom-3 sm:bottom-4' : 'bottom-24 sm:bottom-28',
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Location disabled. Tap for details."
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur',
              'border transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              // Style adapts to the surrounding mode: Birds is
              // light-first with a dark-variant; Stars is always dark.
              mode === 'stars'
                ? 'border-white/20 bg-black/60 text-amber-100 hover:bg-black/75'
                : 'border-stone-300/70 bg-white/85 text-stone-700 hover:bg-white dark:border-indigo-900/60 dark:bg-indigo-950/60 dark:text-amber-200 dark:hover:bg-indigo-950/80',
            )}
          >
            <MapPinOff
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden
              strokeWidth={2}
            />
            <span className="leading-tight">Location disabled</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 text-sm">
          <div className="space-y-3">
            <p className="font-medium">Location disabled</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {EXPLAINER}
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              For now, Birdstar is showing the default North America view.
              You can re-enable location in your browser settings and try
              again.
            </p>
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button type="button" size="sm" variant="secondary" onClick={retry}>
                Try again
              </Button>
              <Link
                to="/privacy"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Privacy policy
              </Link>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default LocationDisabledIndicator;
