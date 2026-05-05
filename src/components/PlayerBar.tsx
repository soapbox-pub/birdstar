// SoundCloud-style fixed player bar anchored to the bottom of the viewport.
// Houses three regions:
//   - Left: "album art" = thumbnail of the last-detected bird, clickable to
//     open a details dialog owned by the parent.
//   - Center: species + timestamp on top, live frequency-bar visualization
//     below. Replaced by an error/loading card when appropriate.
//   - Right: primary play/pause button (also acts as "try again" in the
//     error case).
//
// Consolidates what used to be StatusLine / ListeningIndicator / a chunk
// of the EmptyState copy into one control surface.
//
// Memoized at export so unrelated state churn on the parent page (e.g. the
// map of session detections growing every 2 s when a new prediction lands)
// doesn't force the whole bar — including the LoginArea-adjacent Radix
// subtrees mounted via its children — to re-render. The React Profiler
// showed ~75 ms/s of LoginArea-subtree work attributable to exactly this
// pattern; memoizing the bar cuts it to near-zero on idle ticks.
import { memo } from 'react';
import { AlertCircle, HelpCircle, MapPin, Mic, MicOff, RotateCcw } from 'lucide-react';
import type { Detection } from '@/components/BirdCard';
import { AudioVisualizer } from '@/components/AudioVisualizer';
import { MicrophoneHelpDialog } from '@/components/MicrophoneHelpDialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import type { RecorderErrorKind } from '@/hooks/useAudioRecorder';
import type { LatestHit } from '@/hooks/useDetectionAccumulator';
import { useSongPlaybackActive } from '@/hooks/useSongPlayback';
import { cn } from '@/lib/utils';

export type PlayerMode =
  | 'idle'
  | 'loading'
  | 'ready-idle'
  | 'listening'
  | 'paused'
  | 'error';

interface PlayerBarProps {
  mode: PlayerMode;
  loadingPct: number;
  errorMessage: string | null;
  errorKind: RecorderErrorKind | null;
  /**
   * Most recently confirmed detection this session (or null if none yet).
   * Used only to resolve the click target when the album-art species is
   * confirmed — we hand the Detection back to the parent's
   * `onSelectLatest` so the shared BirdInfoDialog opens against the
   * real event (with its Nostr eventId, etc.). Not used for the
   * thumbnail image / name / pie — those all follow `latestHit` so
   * the bar is always about the most recently heard bird.
   */
  latestDetection: Detection | null;
  /**
   * Most recent prediction that cleared the raw-confidence floor.
   * The player bar is effectively a mirror of this: thumbnail image,
   * species name, dimming pie (`latestHit.progress`), amber `?` badge
   * (`!latestHit.confirmed`), and tap target all reflect the bird
   * *just heard*, whether or not it's confirmed. Null only until the
   * first qualifying hit lands (or after the 3-minute rolling window
   * empties).
   */
  latestHit: LatestHit | null;
  getAnalyser: () => AnalyserNode | null;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  /**
   * Called when the user taps the album art and the currently-displayed
   * species is already confirmed. The parent owns the details dialog so
   * it can be shared between the player bar and the detection cards.
   */
  onSelectLatest?: (detection: Detection) => void;
  /**
   * Called when the user taps the album art and the currently-displayed
   * species is unconfirmed (still accumulating). The parent opens a
   * BirdInfoDialog for that species so the user can read about the
   * bird the app thinks it just heard. Passing only the scientific
   * name keeps this bar decoupled from the labels table — the parent
   * resolves the label.
   */
  onSelectPending?: (scientificName: string, progress: number) => void;
  /**
   * When true, a small opt-in chip is shown offering to use the user's
   * location to improve identification accuracy (location-aware confidence
   * damping). The parent decides visibility based on whether the user has
   * already decided AND whether a species-regions table is loaded, so the
   * bar can stay opinion-free about when to show it.
   */
  showLocationOptIn?: boolean;
  /** Fired when the opt-in chip is clicked. Should trigger the native
   * geolocation prompt in the parent. */
  onRequestLocation?: () => void;
}

function PlayerBarImpl({
  mode,
  loadingPct,
  errorMessage,
  errorKind,
  latestDetection,
  latestHit,
  getAnalyser,
  onPause,
  onResume,
  onRetry,
  onSelectLatest,
  onSelectPending,
  showLocationOptIn = false,
  onRequestLocation,
}: PlayerBarProps) {
  // Whether a bird reference song is currently playing somewhere
  // in the app (usually from an open BirdInfoDialog). While true,
  // the recorder drops incoming mic samples to prevent a feedback
  // loop -- see useAudioRecorder + SongPlaybackContext. We read it
  // here too so the status UI can tell the truth: "the mic is
  // temporarily muted" instead of pretending we're still actively
  // listening. Without this the squiggle continues to animate
  // (before we fixed it by disabling the MediaStreamTrack) and
  // the status label reads "Listening…" even though BirdNET has
  // stopped seeing any audio. Reading the context directly here
  // rather than threading a new prop through Index keeps the
  // data-flow local -- this bar is the only component that
  // visually needs to react to it.
  const songPlaying = useSongPlaybackActive();
  const isMutedForSong = songPlaying && mode === 'listening';

  // Active = visualizer should read live audio. We render the
  // visualizer in every non-error state so the bar always has its
  // signature shape; the `active` flag just gates whether it
  // actually reads from the analyser. Muted-for-song also flips
  // active off so the squiggle flattens in sync with the now-
  // silent MediaStreamTrack.
  const visualizerActive = mode === 'listening' && !isMutedForSong;

  /**
   * Resolve a click on the album art (or status label) to the right
   * dialog. The album art currently represents `latestHit`, so:
   *   - If the species is confirmed, open the confirmed dialog. We
   *     prefer the full `latestDetection` when it matches the latest
   *     hit (same species), because that carries the Nostr eventId
   *     and any other hydrated fields. Otherwise we synthesize a
   *     minimal Detection from the hit itself — the parent's
   *     `handleSelectLatest` will try to hydrate it from its
   *     detection map on the way to the dialog.
   *   - If the species is unconfirmed (accumulating), open the
   *     pending dialog so the user can read about the bird the
   *     classifier thinks is singing.
   */
  const openLatestHitDialog = () => {
    if (!latestHit) return;
    if (latestHit.confirmed) {
      const matchedDetection =
        latestDetection &&
        latestDetection.scientificName === latestHit.scientificName &&
        latestDetection.commonName === latestHit.commonName
          ? latestDetection
          : null;
      const detection: Detection = matchedDetection ?? {
        // `session-` prefix matches the convention in
        // useDetectionAccumulator so key handling stays consistent
        // if the parent later merges this into a map.
        id: `session-${latestHit.scientificName}`,
        scientificName: latestHit.scientificName,
        commonName: latestHit.commonName,
        timestamp: latestHit.timestamp,
      };
      onSelectLatest?.(detection);
      return;
    }
    onSelectPending?.(latestHit.scientificName, latestHit.progress);
  };

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/85 backdrop-blur-md',
        'dark:border-indigo-900/60 dark:bg-[#0d1230]/85',
        'shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)]',
      )}
      role="region"
      aria-label="Listening controls"
    >
      {showLocationOptIn && onRequestLocation ? (
        <LocationOptInBanner onRequest={onRequestLocation} />
      ) : null}
      <div className="mx-auto flex max-w-4xl items-center px-3 py-3 sm:px-4">
        <AlbumArt latestHit={latestHit} onClick={openLatestHitDialog} />

        <div className="min-w-0 flex-1">
          <CenterRegion
            mode={mode}
            loadingPct={loadingPct}
            errorMessage={errorMessage}
            errorKind={errorKind}
            latestHit={latestHit}
            getAnalyser={getAnalyser}
            visualizerActive={visualizerActive}
            isMutedForSong={isMutedForSong}
            onOpenLatestHit={openLatestHitDialog}
            onResume={onResume}
          />
        </div>

        <div className="ml-3 sm:ml-4">
          <PrimaryButton
            mode={mode}
            onPause={onPause}
            onResume={onResume}
            onRetry={onRetry}
            errorKind={errorKind}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Left-hand "album art" slot.
 *
 * Everything in this slot reflects the SAME bird — the most recently
 * heard one. Image, name, dimming pie (that species' own progress to
 * confirmation), amber `?` badge (shown iff unconfirmed), and tap
 * target all come from `latestHit`. When the pie is full and the
 * badge is hidden the bar reads as "latest confirmed"; a dim pie
 * with a `?` reads as "just heard once, still unconfirmed". No
 * state where the image and overlay point at different birds.
 *
 * When no bird has been heard yet — or when the Wikipedia photo for
 * the current hit hasn't loaded — the whole slot collapses to zero
 * width and slides shut. We never render a fallback bird-icon
 * placeholder; the bar simply doesn't have an album-art region
 * until there's a real photo to put in it. The width/margin/opacity
 * transition is what makes the slot feel like it's opening when a
 * new bird lands.
 */
function AlbumArt({
  latestHit,
  onClick,
}: {
  latestHit: LatestHit | null;
  onClick: () => void;
}) {
  const { data } = useBirdInfo(
    latestHit?.scientificName ?? null,
    latestHit?.commonName ?? null,
  );
  const imageUrl = data?.imageUrl ?? null;

  // We only reveal the slot once BOTH conditions are true: a bird has
  // been heard AND we actually have its photo. Opening with a gradient
  // placeholder (or worse, the Bird silhouette icon) reads as "we
  // think there's a bird but we don't know what" which is exactly
  // the impression we're trying to avoid per product direction.
  const isOpen = latestHit !== null && imageUrl !== null;

  // The pie is only meaningful when the species is still accumulating.
  // Once confirmed, hide the overlay chrome entirely — the thumbnail
  // is just "this is the bird that was confirmed most recently".
  const isUnconfirmed = Boolean(latestHit && !latestHit.confirmed);
  const progress = latestHit?.progress ?? 0;
  const pct = Math.round(progress * 100);

  const ariaLabel = latestHit
    ? latestHit.confirmed
      ? `Show details for ${latestHit.commonName}`
      : `Unconfirmed: ${latestHit.commonName} — ${pct}% to confirmation. Show details.`
    : '';
  const ringColor = latestHit?.confirmed
    ? 'focus-visible:ring-emerald-500/60 dark:focus-visible:ring-amber-400/60'
    : 'focus-visible:ring-amber-400/70 dark:focus-visible:ring-amber-300/60';

  return (
    // Animated outer wrapper. Width, right-margin, and opacity all
    // transition together so when the slot collapses it doesn't leave
    // a visible gap between the center region and the left edge of
    // the bar. `overflow-hidden` keeps the inner thumbnail from
    // poking past the collapsing edge mid-animation.
    // `motion-reduce:transition-none` respects prefers-reduced-motion
    // per the project's motion guidelines.
    <div
      aria-hidden={!isOpen}
      className={cn(
        'shrink-0 overflow-hidden transition-[width,margin,opacity] duration-300 ease-out',
        'motion-reduce:transition-none',
        isOpen
          ? 'mr-3 w-14 opacity-100 sm:mr-4 sm:w-16'
          : 'mr-0 w-0 opacity-0',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!isOpen}
        tabIndex={isOpen ? 0 : -1}
        aria-label={ariaLabel}
        title={
          latestHit
            ? latestHit.confirmed
              ? latestHit.commonName
              : `${latestHit.commonName} — ${pct}% to confirmation`
            : undefined
        }
        className={cn(
          'block rounded-md transition-transform hover:scale-[1.03] focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0d1230]',
          ringColor,
        )}
      >
        <div
          className={cn(
            'relative h-14 w-14 shrink-0 overflow-hidden rounded-md shadow-sm sm:h-16 sm:w-16',
          )}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={latestHit?.commonName ?? ''}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
          {isUnconfirmed ? (
            <>
              <ConfidencePie progress={progress} />
              {/* Yellow "?" badge. Sits on top of the pie dimmer so it
                  stays legible even at 0% progress when the pie covers
                  the whole thumbnail. Communicates "unconfirmed — tap
                  to learn more", matching the amber "Unconfirmed
                  sighting" row the dialog renders on open. Kept small
                  (h-4 / h-[18px] on sm) so it doesn't obscure the
                  bird photograph. */}
              <span
                className={cn(
                  'pointer-events-none absolute right-1 top-1 inline-flex items-center justify-center',
                  'h-4 w-4 rounded-full sm:h-[18px] sm:w-[18px]',
                  'bg-amber-400 text-amber-950 shadow ring-1 ring-white/40',
                  'dark:bg-amber-300 dark:text-amber-950 dark:ring-amber-950/40',
                )}
                aria-hidden
              >
                <HelpCircle
                  className="h-3 w-3 sm:h-3.5 sm:w-3.5"
                  strokeWidth={2.5}
                />
              </span>
            </>
          ) : null}
        </div>
      </button>
    </div>
  );
}

/**
 * Semi-transparent pie overlay on the album-art thumbnail indicating how
 * close a pending species is to confirmation. The overlay covers a sector
 * proportional to the *remaining* progress — starts as a full-circle dim
 * veil at progress=0 and is "eaten away" clockwise from 12 o'clock until
 * the thumbnail is fully revealed at progress=1.
 *
 * Rendered via SVG because a pure-CSS conic-gradient trick can't easily
 * composite an alpha-only dimmer, and we want the bird photograph visible
 * underneath the overlay, just darkened.
 */
function ConfidencePie({ progress }: { progress: number }) {
  // Clamp defensively — progress should already be in [0, 1] from the
  // accumulator but a stray NaN or overshoot here would blow up the SVG
  // path math.
  const clamped = Math.max(0, Math.min(1, progress));
  const remaining = 1 - clamped;

  // 64x64 viewBox centered at (32, 32) with radius 32 — matches the
  // thumbnail's sm:16 size closely and scales down cleanly to h-14.
  const size = 64;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  // SVG arcs use sweep angles in the range (0, 360°) — an arc from a
  // point back to the same point has length 0, not 360. Handle the
  // full-circle and empty cases as special geometry so the edge cases
  // look right.
  const pathData = (() => {
    if (remaining <= 0) return null; // fully revealed, overlay gone
    if (remaining >= 1) {
      // Full circle — use two half-arc segments since a single arc can't
      // close on itself.
      return [
        `M ${cx} ${cy - r}`,
        `A ${r} ${r} 0 1 1 ${cx} ${cy + r}`,
        `A ${r} ${r} 0 1 1 ${cx} ${cy - r}`,
        'Z',
      ].join(' ');
    }
    // Partial wedge starting at 12 o'clock, sweeping clockwise by
    // (remaining * 360°). We build:
    //   - move to center
    //   - line up to 12 o'clock
    //   - arc clockwise to the end angle
    //   - line back to center
    const angle = remaining * 2 * Math.PI; // radians
    const endX = cx + r * Math.sin(angle);
    const endY = cy - r * Math.cos(angle);
    const largeArc = remaining > 0.5 ? 1 : 0;
    return [
      `M ${cx} ${cy}`,
      `L ${cx} ${cy - r}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`,
      'Z',
    ].join(' ');
  })();

  if (!pathData) return null;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      <path d={pathData} fill="rgba(15, 23, 42, 0.55)" />
    </svg>
  );
}

/**
 * The middle region of the bar. Switches layout based on mode: the happy
 * path shows a label on top and the visualizer below; errors and loading
 * take over the whole region with appropriate copy.
 */
function CenterRegion({
  mode,
  loadingPct,
  errorMessage,
  errorKind,
  latestHit,
  getAnalyser,
  visualizerActive,
  isMutedForSong,
  onOpenLatestHit,
  onResume,
}: {
  mode: PlayerMode;
  loadingPct: number;
  errorMessage: string | null;
  errorKind: RecorderErrorKind | null;
  /**
   * Most recent species to clear the raw-confidence floor. The status
   * label's top line names this species (with timestamp or
   * "listening… X% to confirmation" depending on whether it's
   * confirmed), so the label and the album art always point at the
   * same bird.
   */
  latestHit: LatestHit | null;
  getAnalyser: () => AnalyserNode | null;
  visualizerActive: boolean;
  /**
   * True when the recorder is gated because a reference song is
   * playing. Used to swap the status label ("Mic paused" vs
   * "Listening…") so the user understands the flat visualizer.
   */
  isMutedForSong: boolean;
  /**
   * Called when the user taps the top-line species name. Resolves to
   * the same dialog the album art opens — parent handles the
   * confirmed-vs-pending branching since it owns the full Detection
   * map needed to hydrate a confirmed click.
   */
  onOpenLatestHit: () => void;
  /**
   * Called when the user taps the "tap to resume" secondary label in
   * the paused state. Mirrors the primary play button so the whole
   * center region is a valid resume affordance, not just the round
   * play icon.
   */
  onResume: () => void;
}) {
  if (mode === 'error') {
    return (
      <ErrorRegion
        errorKind={errorKind}
        errorMessage={errorMessage}
      />
    );
  }

  if (mode === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-w-0 flex-col justify-center gap-1.5"
      >
        <p className="truncate text-sm text-stone-600 dark:text-stone-300">
          Loading BirdNET model… {loadingPct}%
        </p>
        <Progress value={loadingPct} className="h-1.5" />
      </div>
    );
  }

  // Happy paths — visualizer + status label. The top line names the
  // same bird the album art is currently showing (`latestHit`), with
  // a subtitle that varies by mode + confirmation state. Keeping the
  // status label and the thumbnail welded to the same subject means
  // they can never tell conflicting stories.
  const hitPct = latestHit ? Math.round(latestHit.progress * 100) : 0;

  const statusLabel: {
    top: string;
    bottom: string;
    /**
     * True when the top line names an actual bird (i.e. `latestHit`
     * is populated and we're in a mode that surfaces it). Drives
     * whether the top line renders as a button or a plain <p>.
     */
    clickable: boolean;
    /**
     * True when the bottom line is a "tap to resume" affordance and
     * should render as a button that calls `onResume`. Lets the user
     * resume listening by tapping the label text as well as the
     * primary play button.
     */
    resumable: boolean;
  } = (() => {
    switch (mode) {
      case 'listening':
        // Muted-for-song overrides all other listening sub-states:
        // we're not meaningfully "listening" to anything the mic
        // can hear right now, and the rolling-window progress is
        // frozen since no chunks are being ingested. Telling the
        // user exactly why the squiggle went flat avoids the
        // "wait, is it broken?" reaction.
        if (isMutedForSong) {
          return {
            top: 'Mic paused',
            bottom: 'Listening resumes when the song ends',
            clickable: false,
            resumable: false,
          };
        }
        if (latestHit) {
          return {
            top: latestHit.commonName,
            bottom: latestHit.confirmed
              ? `Last heard ${formatClock(latestHit.timestamp)}`
              : `Listening… ${hitPct}% to confirmation`,
            clickable: true,
            resumable: false,
          };
        }
        return {
          top: 'Listening…',
          bottom: 'Point the mic toward the trees',
          clickable: false,
          resumable: false,
        };
      case 'paused':
        if (latestHit) {
          return {
            top: latestHit.commonName,
            bottom: 'Paused — tap to resume',
            clickable: true,
            resumable: true,
          };
        }
        return {
          top: 'Paused',
          bottom: 'Tap to resume',
          clickable: false,
          resumable: true,
        };
      case 'ready-idle':
        return {
          top: 'Ready',
          bottom: 'Waiting for microphone access…',
          clickable: false,
          resumable: false,
        };
      default:
        return {
          top: 'Getting ready',
          bottom: 'Starting up…',
          clickable: false,
          resumable: false,
        };
    }
  })();

  return (
    <div className="flex min-w-0 flex-col justify-center gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        {statusLabel.clickable && latestHit ? (
          // Button when the top line names an actual bird. Tapping
          // opens the same info dialog the album art does. Styling
          // mirrors the <p> branch (font, truncation, color) so the
          // bar doesn't visually jump between the click-through and
          // the plain-status states. Underline-on-hover is the only
          // affordance -- a full button chrome would be too heavy for
          // a status strip, but some affordance is needed or the
          // clickability isn't discoverable.
          <button
            type="button"
            onClick={onOpenLatestHit}
            aria-label={
              latestHit.confirmed
                ? `Show details for ${latestHit.commonName}`
                : `Unconfirmed: ${latestHit.commonName}. Show details.`
            }
            className={cn(
              'min-w-0 truncate text-left font-serif text-sm font-semibold sm:text-base',
              'underline-offset-2 hover:underline focus-visible:underline',
              'focus:outline-none focus-visible:outline-none',
              mode === 'listening'
                ? 'text-stone-900 dark:text-stone-50'
                : 'text-stone-700 dark:text-stone-200',
            )}
          >
            {statusLabel.top}
          </button>
        ) : (
          <p
            className={cn(
              'min-w-0 truncate font-serif text-sm font-semibold sm:text-base',
              mode === 'listening'
                ? 'text-stone-900 dark:text-stone-50'
                : 'text-stone-700 dark:text-stone-200',
            )}
            aria-live="polite"
          >
            {statusLabel.top}
          </p>
        )}
        {statusLabel.resumable ? (
          // When paused, render the secondary label as a button so the
          // user can resume by tapping the text as well as the round
          // play button. Styling matches the <p> branch so the bar
          // doesn't visually jump between paused and listening.
          <button
            type="button"
            onClick={onResume}
            aria-label="Resume listening"
            className={cn(
              'ml-auto hidden shrink-0 truncate text-xs text-stone-500 sm:inline dark:text-stone-400',
              'underline-offset-2 hover:underline focus-visible:underline',
              'focus:outline-none focus-visible:outline-none',
            )}
          >
            {statusLabel.bottom}
          </button>
        ) : (
          <p className="ml-auto hidden shrink-0 truncate text-xs text-stone-500 sm:inline dark:text-stone-400">
            {statusLabel.bottom}
          </p>
        )}
      </div>

      <div className="h-8 w-full sm:h-10">
        <AudioVisualizer
          getAnalyser={getAnalyser}
          active={visualizerActive}
        />
      </div>
    </div>
  );
}

function ErrorRegion({
  errorKind,
  errorMessage,
}: {
  errorKind: RecorderErrorKind | null;
  errorMessage: string | null;
}) {
  // Permission-denied gets a bespoke treatment with the help dialog; all
  // other error kinds share a common compact layout.
  if (errorKind === 'permission-denied') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-w-0 items-start gap-2"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-rose-900 dark:text-rose-200">
            Microphone access is blocked
          </p>
          <p className="truncate text-xs text-rose-700 dark:text-rose-300">
            Allow this site to use your microphone in your browser settings.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <MicrophoneHelpDialog
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-rose-300 bg-white/70 px-2 text-xs text-rose-800 hover:bg-white dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-100 dark:hover:bg-rose-900/60"
                >
                  Use my microphone
                </Button>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  const { title, body } = (() => {
    switch (errorKind) {
      case 'no-device':
        return {
          title: 'No microphone found',
          body: 'Plug one in (or enable the built-in mic) and try again.',
        };
      case 'device-busy':
        return {
          title: 'Microphone is in use',
          body: 'Another app or tab is using the microphone.',
        };
      case 'unsupported':
        return {
          title: 'Microphone not supported here',
          body: 'Try a recent version of Chrome, Firefox, Safari, or Edge over HTTPS.',
        };
      default:
        return {
          title: 'Something went wrong',
          body: errorMessage ?? 'Unknown error',
        };
    }
  })();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-0 items-start gap-2"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-rose-900 dark:text-rose-200">
          {title}
        </p>
        <p className="truncate text-xs text-rose-700 dark:text-rose-300">
          {body}
        </p>
      </div>
    </div>
  );
}

/**
 * Right-hand primary button. Semantically one control, but the icon
 * reflects the CURRENT state rather than the action it triggers:
 *   - listening → Mic (the mic is live)
 *   - idle/paused/ready → MicOff (the mic is off)
 *   - error → retry icon, with error-styled ring
 * The aria-label and title still describe the action ("Pause
 * listening" / "Start listening") so screen readers and hover
 * tooltips announce what tapping will do. Loading state shows a
 * disabled MicOff so the bar's layout doesn't jump when the model
 * finishes loading.
 */
function PrimaryButton({
  mode,
  onPause,
  onResume,
  onRetry,
  errorKind,
}: {
  mode: PlayerMode;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  errorKind: RecorderErrorKind | null;
}) {
  const isListening = mode === 'listening';
  const isError = mode === 'error';
  const isLoading = mode === 'loading';
  // We can't retry from a permission-denied state with just a button click
  // (the browser won't re-prompt), so hide it here and let the inline
  // "I've enabled it" button in the error region do the job.
  if (isError && errorKind === 'permission-denied') {
    return <div className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" aria-hidden />;
  }

  const handleClick = () => {
    if (isError) return onRetry();
    if (isListening) return onPause();
    return onResume();
  };

  const label = isError
    ? 'Try again'
    : isListening
      ? 'Pause listening'
      : 'Start listening';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      aria-label={label}
      aria-pressed={isListening}
      title={label}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all sm:h-12 sm:w-12',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0d1230]',
        isError
          ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/60 dark:bg-rose-500 dark:hover:bg-rose-400'
          : isListening
            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20 hover:bg-emerald-700 focus-visible:ring-emerald-500/60 dark:bg-amber-400 dark:text-stone-900 dark:shadow-amber-500/20 dark:hover:bg-amber-300 dark:focus-visible:ring-amber-400/60'
            : 'bg-stone-900 text-white hover:bg-stone-800 focus-visible:ring-stone-500/60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white',
        isLoading && 'cursor-not-allowed opacity-50',
      )}
    >
      {isError ? (
        <RotateCcw className="h-5 w-5" />
      ) : isListening ? (
        // Mic-on glyph: the mic IS currently live. Tapping pauses it.
        <Mic className="h-5 w-5" strokeWidth={2.25} />
      ) : (
        // Mic-off glyph: the mic is NOT listening right now. Tapping
        // turns it on.
        <MicOff className="h-5 w-5" strokeWidth={2.25} />
      )}
    </button>
  );
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Thin opt-in strip across the top of the player bar asking for location
 * access to improve identification accuracy. Deliberately understated — a
 * single line of copy with one action and no dismissal affordance. The
 * parent hides it once the user has decided (either way) and after a
 * successful resolution, so there's no need for a "no thanks" button
 * here: tapping nothing is effectively the decline path, and the browser
 * will remember a denied permission itself.
 */
function LocationOptInBanner({ onRequest }: { onRequest: () => void }) {
  return (
    <div
      className={cn(
        'border-b border-stone-200/70 bg-emerald-50/70 px-3 py-1.5 text-xs',
        'dark:border-indigo-900/60 dark:bg-indigo-950/40',
      )}
    >
      <div className="mx-auto flex max-w-4xl items-center gap-2">
        <MapPin
          className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-amber-300"
          aria-hidden
        />
        <p className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300">
          Use your location to improve identification accuracy?
        </p>
        <button
          type="button"
          onClick={onRequest}
          className={cn(
            'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
            'bg-emerald-600 text-white hover:bg-emerald-700',
            'dark:bg-amber-400 dark:text-stone-900 dark:hover:bg-amber-300',
            'focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-emerald-500/60 dark:focus-visible:ring-amber-400/60',
          )}
        >
          Use location
        </button>
      </div>
    </div>
  );
}

// Memoized — see the file-level comment for why. A shallow compare is
// sufficient: all scalar props are primitives, `latestDetection` and
// `latestHit` are swapped as whole objects (the accumulator memoizes
// the LatestHit object when nothing meaningful has changed), and the
// callback props are stable on the parent side thanks to useCallback.
export const PlayerBar = memo(PlayerBarImpl);
