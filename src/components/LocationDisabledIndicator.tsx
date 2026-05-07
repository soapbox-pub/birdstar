// Indicator shown whenever the app is running against a location
// fallback — i.e. when the browser's geolocation API has been denied,
// is unsupported, or the user actively declined the prompt and we've
// fallen back to a continent-level North America default.
//
// Two variants:
//
//   - `floating` (default): a compact, fixed-position pill in the
//     bottom-left corner. Used by Stars mode which has no natural
//     "above the content" slot.
//
//   - `inline`: flows with the parent, centered so it sits above
//     whatever it precedes. Birds mode uses this above the
//     BirdexGrid so the notice is visible without overlapping the
//     PlayerBar or the manual-location controls.
//
// Clicking the pill opens a popover that explains why location is
// needed. From there a "How to enable" button opens
// `LocationHelpDialog` with browser-specific instructions — a JS
// retry can't override a persisted denial, so we send the user to
// their browser settings rather than pretending a button press will
// fix it.
//
// IMPLEMENTATION NOTE: this component deliberately does NOT import the
// `useUserRegion` / `useGeolocation` hooks, even though it needs their
// state. Both hooks own side effects (auto-prompt, localStorage writes)
// and mounting a second instance on top of the page that already owns
// them would race the single-flight semantics. Instead, we read the
// persisted state directly and observe changes via the `storage` event
// and a custom `birdstar:location-change` event that the hooks dispatch
// after they commit a decision.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPinOff } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { LocationHelpDialog } from '@/components/LocationHelpDialog';
import { cn } from '@/lib/utils';
import { useMode } from '@/hooks/useMode';
import {
  getSharedLocation,
  LOCATION_CHANGE_EVENT,
} from '@/hooks/useSharedLocation';

const EXPLAINER =
  'Birdstar needs access to GPS sensors on your device to show birds in your area and orient you with the stars.';

// -- Persisted-state readers -------------------------------------------------
//
// "Disabled" means different things per mode:
//
//   - In Birds mode, we have an explicit per-user decision stored in
//     `birdsong.userLocation.v3.status`: 'denied' or 'unavailable'
//     means the user actively declined (or the browser can't resolve
//     them). `ready` / `unknown` are NOT disabled states — the latter
//     just means the prompt hasn't fired yet.
//   - In Stars mode there's no persisted denial flag (the hook falls
//     back silently). Instead, we check whether the shared precise
//     location store has a value at all: if it does, the user has
//     granted (or manually pinned) a fix somewhere; if not, they're
//     either first-time or declined.

const BIRDS_STATUS_KEY = 'birdsong.userLocation.v3';

type BirdsStatus = 'ready' | 'denied' | 'unavailable' | 'unknown';

function readBirdsStatus(): BirdsStatus {
  try {
    const raw = localStorage.getItem(BIRDS_STATUS_KEY);
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
  return getSharedLocation() !== null;
}

interface Snapshot {
  birds: BirdsStatus;
  starsHasFix: boolean;
}

function readSnapshot(): Snapshot {
  return { birds: readBirdsStatus(), starsHasFix: readStarsHasFix() };
}

// -- Component ---------------------------------------------------------------

export interface LocationDisabledIndicatorProps {
  /**
   * `floating` (default) — fixed-position pill in the bottom-left,
   * styled for whichever mode is mounted. This is what Stars mode
   * uses since it has no natural "above the content" slot.
   *
   * `inline` — a centered, static pill that flows with the
   * surrounding markup. Birds mode uses this above the BirdexGrid.
   */
  variant?: 'floating' | 'inline';
  className?: string;
}

export function LocationDisabledIndicator({
  variant = 'floating',
  className,
}: LocationDisabledIndicatorProps = {}) {
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

  if (!disabled) return null;

  return (
    <div
      className={cn(
        variant === 'floating'
          ? cn(
              // Always on top of PlayerBar (z-40) and top HUDs (z-20). Below
              // modal overlays which use z-50 from Radix.
              'fixed left-3 z-50 sm:left-4',
              // In Birds mode clear the PlayerBar (~80px tall). In Stars mode
              // sit close to the bottom edge.
              mode === 'stars' ? 'bottom-3 sm:bottom-4' : 'bottom-24 sm:bottom-28',
            )
          : // Inline variant: flows with the parent, centered so it sits
            // above whatever content it precedes (e.g. the BirdexGrid).
            'flex w-full justify-center',
        className,
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
        <PopoverContent
          side="top"
          align={variant === 'floating' ? 'start' : 'center'}
          className="w-72 text-sm"
        >
          <div className="space-y-3">
            <p className="font-medium">Location disabled</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {EXPLAINER}
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              For now, Birdstar is showing the default North America view.
              Re-enable location in your browser settings to see birds near
              you.
            </p>
            <div className="flex items-center justify-between gap-2 pt-1">
              <LocationHelpDialog
                trigger={
                  <Button type="button" size="sm" variant="secondary">
                    How to enable
                  </Button>
                }
              />
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
