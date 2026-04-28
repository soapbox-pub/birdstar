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
import { AlertCircle, Bird, HelpCircle, MapPin, Pause, Play, RotateCcw } from 'lucide-react';
import type { Detection } from '@/components/BirdCard';
import { AudioVisualizer } from '@/components/AudioVisualizer';
import { MicrophoneHelpDialog } from '@/components/MicrophoneHelpDialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import type { RecorderErrorKind } from '@/hooks/useAudioRecorder';
import type { PendingLeader, LatestHit } from '@/hooks/useDetectionAccumulator';
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
  showFirstLoadNote: boolean;
  /** Most recently detected bird this session (or null if none yet). */
  latestDetection: Detection | null;
  /**
   * Species of the most recent prediction that cleared the raw-confidence
   * floor. Independent of `latestDetection` (which is only confirmed
   * sightings) and `pendingLeader` (highest-summed species). Drives the
   * album-art thumbnail IMAGE so it always reflects the most recent bird
   * heard — confirmed or not, leading or not. The pie/`?` overlay and
   * tap target still follow `pendingLeader` / `latestDetection`.
   */
  latestHit: LatestHit | null;
  /**
   * Species currently accumulating toward confirmation, if any. When
   * present, drives the pie/`?` overlay on the album-art thumbnail and
   * takes priority in the click target and status label. It does NOT
   * drive the thumbnail image — that's `latestHit`, so the image always
   * reflects the bird most recently heard.
   */
  pendingLeader: PendingLeader | null;
  getAnalyser: () => AnalyserNode | null;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  /**
   * Called when the user taps the "album art" thumbnail. The parent owns
   * the details dialog so it can be shared between the player bar and the
   * detection cards on the page.
   */
  onSelectLatest?: (detection: Detection) => void;
  /**
   * Called when the user taps the "album art" thumbnail while a species
   * is pending (accumulating toward confirmation). The parent opens a
   * BirdInfoDialog for the pending species so the user can read about
   * the bird that *might* be singing while they wait for the rolling
   * window to tip over the confirmation threshold. Passing only the
   * scientific name keeps this bar decoupled from the labels table —
   * the parent resolves the label.
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
  showFirstLoadNote,
  latestDetection,
  latestHit,
  pendingLeader,
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
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
        <AlbumArt
          detection={latestDetection}
          latestHit={latestHit}
          pendingLeader={pendingLeader}
          onClick={() => {
            // Priority matches the thumbnail's visual priority: a
            // pending leader (yellow ? badge + progress pie) takes
            // precedence over the last confirmed detection, so a
            // tap opens the dialog for whichever bird the
            // thumbnail is currently representing. Guard both
            // callbacks in case a parent wires only one.
            if (pendingLeader) {
              onSelectPending?.(
                pendingLeader.scientificName,
                pendingLeader.progress,
              );
              return;
            }
            if (latestDetection) {
              onSelectLatest?.(latestDetection);
            }
          }}
        />

        <div className="min-w-0 flex-1">
          <CenterRegion
            mode={mode}
            loadingPct={loadingPct}
            errorMessage={errorMessage}
            errorKind={errorKind}
            showFirstLoadNote={showFirstLoadNote}
            latestDetection={latestDetection}
            pendingLeader={pendingLeader}
            getAnalyser={getAnalyser}
            visualizerActive={visualizerActive}
            isMutedForSong={isMutedForSong}
            onSelectLatest={onSelectLatest}
            onSelectPending={onSelectPending}
          />
        </div>

        <PrimaryButton
          mode={mode}
          onPause={onPause}
          onResume={onResume}
          onRetry={onRetry}
          errorKind={errorKind}
        />
      </div>
    </div>
  );
}

/**
 * Left-hand "album art" slot.
 *
 * Image source is ALWAYS the `latestHit` — i.e. whichever species most
 * recently crossed the raw-confidence floor, regardless of whether that
 * species is accumulating, confirmed, or neither. This keeps the
 * thumbnail honest to "what was just heard" and avoids the confusing
 * case where the image locked onto a pending-leader species (highest
 * γ-sum) even though a different bird had just sung.
 *
 * Overlay chrome — the dimming pie and amber `?` badge — remains driven
 * by `pendingLeader` as before: "here's how close some species is to
 * confirmation". Note that the pie species and the thumbnail species
 * can temporarily disagree when the most recent hit is for a different
 * bird than the current leader. That's intentional: the thumbnail
 * answers "who just sang?" and the pie answers "who's about to be
 * confirmed?".
 *
 * Click priority mirrors the old behavior:
 *   1. Pending leader → opens the pending dialog for that species.
 *   2. Latest confirmed detection → opens the confirmed dialog.
 *   3. Neither → non-interactive silhouette.
 *
 * Fallback image source order: latestHit → pendingLeader → detection →
 * silhouette. The fallbacks only kick in very briefly at startup
 * before the first qualifying hit arrives (`latestHit` null) so the
 * thumbnail can still reflect a confirmation or a leader if somehow
 * they appear first (hydrate-from-disk ordering edge case).
 */
function AlbumArt({
  detection,
  latestHit,
  pendingLeader,
  onClick,
}: {
  detection: Detection | null;
  latestHit: LatestHit | null;
  pendingLeader: PendingLeader | null;
  onClick: () => void;
}) {
  // Image source: most recent hit. Fallbacks cover the narrow window
  // between hydrate completing (may populate pendingLeader/detection
  // first) and the first live hit landing.
  const imageSource = latestHit ?? pendingLeader ?? detection;
  // Overlay + click target still key off pendingLeader — the pie
  // answers "who's about to confirm?" and must stay welded to the
  // accumulator's leader, not the recency stream.
  const isPending = Boolean(pendingLeader);

  const { data } = useBirdInfo(
    imageSource?.scientificName ?? null,
    imageSource?.commonName ?? null,
  );
  const imageUrl = data?.imageUrl;

  const thumbnail = (
    <div
      className={cn(
        'relative h-14 w-14 shrink-0 overflow-hidden rounded-md shadow-sm sm:h-16 sm:w-16',
        'bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100',
        'dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60',
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={imageSource?.commonName ?? ''}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-emerald-700/50 dark:text-amber-300/50">
          <Bird className="h-7 w-7" aria-hidden strokeWidth={1.75} />
        </div>
      )}
      {isPending ? (
        <>
          <ConfidencePie progress={pendingLeader!.progress} />
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
  );

  // Both pending and confirmed are now clickable. For pending, the
  // click opens a BirdInfoDialog for the currently-accumulating
  // species so the user can read about the bird the app *thinks*
  // it's hearing while they wait for the window to tip over the
  // threshold. The confirmed case is unchanged.
  if (isPending) {
    const pct = Math.round(pendingLeader!.progress * 100);
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Unconfirmed: ${pendingLeader!.commonName} — ${pct}% to confirmation. Show details.`}
        title={`${pendingLeader!.commonName} — ${pct}% to confirmation`}
        className={cn(
          'shrink-0 rounded-md transition-transform hover:scale-[1.03] focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-white dark:focus-visible:ring-amber-300/60 dark:focus-visible:ring-offset-[#0d1230]',
        )}
      >
        {thumbnail}
      </button>
    );
  }

  if (!detection) {
    // Nothing to drill into yet — keep it non-interactive so a click
    // doesn't open an empty dialog.
    return thumbnail;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Show details for ${detection.commonName}`}
      className={cn(
        'shrink-0 rounded-md transition-transform hover:scale-[1.03] focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2',
        'focus-visible:ring-offset-white dark:focus-visible:ring-amber-400/60 dark:focus-visible:ring-offset-[#0d1230]',
      )}
    >
      {thumbnail}
    </button>
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
  showFirstLoadNote,
  latestDetection,
  pendingLeader,
  getAnalyser,
  visualizerActive,
  isMutedForSong,
  onSelectLatest,
  onSelectPending,
}: {
  mode: PlayerMode;
  loadingPct: number;
  errorMessage: string | null;
  errorKind: RecorderErrorKind | null;
  showFirstLoadNote: boolean;
  latestDetection: Detection | null;
  pendingLeader: PendingLeader | null;
  getAnalyser: () => AnalyserNode | null;
  visualizerActive: boolean;
  /**
   * True when the recorder is gated because a reference song is
   * playing. Used to swap the status label ("Mic paused" vs
   * "Listening…") so the user understands the flat visualizer.
   */
  isMutedForSong: boolean;
  /**
   * Forwarded from PlayerBarProps. Wired to the status-label top
   * line so tapping a bird name there opens the same dialog the
   * album art does. Both are parallel surfaces pointing at the
   * same subject; making only one of them clickable would feel
   * arbitrary.
   */
  onSelectLatest?: (detection: Detection) => void;
  onSelectPending?: (scientificName: string, progress: number) => void;
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
          Downloading BirdNET model… {loadingPct}%
        </p>
        <Progress value={loadingPct} className="h-1.5" />
        {showFirstLoadNote ? (
          <p className="truncate text-xs text-stone-400 dark:text-stone-500">
            One-time ~50 MB download.
          </p>
        ) : null}
      </div>
    );
  }

  // Happy paths — visualizer + status label.
  // Title mirrors the album-art slot's priority: a pending leader (species
  // currently accumulating toward confirmation) takes precedence over the
  // last confirmed detection, so the text and thumbnail always refer to
  // the same bird.
  // A label's "subject" identifies whether the top line of the
  // status label refers to an actual bird the user can drill into
  // (a confirmed detection or a pending species) or is just
  // operator-facing chrome ("Ready", "Paused", "Mic paused", ...).
  // Driving this off a tagged field rather than sniffing the text
  // keeps the two "is the name clickable?" decisions -- in the
  // album art and the top line -- aligned by construction: both
  // priorities go pending > detection > null, so tapping either
  // opens the same dialog for the same bird.
  type LabelSubject =
    | { kind: 'detection'; detection: Detection }
    | { kind: 'pending'; pending: PendingLeader }
    | null;

  const statusLabel: {
    top: string;
    bottom: string;
    subject: LabelSubject;
  } = (() => {
    switch (mode) {
      case 'listening':
        // Muted-for-song overrides all other listening sub-states:
        // we're not meaningfully "listening" to anything the mic
        // can hear right now, and the pending-leader progress is
        // frozen since no chunks are being ingested. Telling the
        // user exactly why the squiggle went flat avoids the
        // "wait, is it broken?" reaction.
        if (isMutedForSong) {
          return {
            top: 'Mic paused',
            bottom: 'Listening resumes when the song ends',
            subject: null,
          };
        }
        if (pendingLeader) {
          const pct = Math.round(pendingLeader.progress * 100);
          return {
            top: pendingLeader.commonName,
            bottom: `Listening… ${pct}% to confirmation`,
            subject: { kind: 'pending', pending: pendingLeader },
          };
        }
        return latestDetection
          ? {
              top: latestDetection.commonName,
              bottom: `Last heard ${formatClock(latestDetection.timestamp)}`,
              subject: { kind: 'detection', detection: latestDetection },
            }
          : {
              top: 'Listening…',
              bottom: 'Point the mic toward the trees',
              subject: null,
            };
      case 'paused':
        if (pendingLeader) {
          return {
            top: pendingLeader.commonName,
            bottom: 'Paused — tap play to resume',
            subject: { kind: 'pending', pending: pendingLeader },
          };
        }
        return latestDetection
          ? {
              top: latestDetection.commonName,
              bottom: 'Paused — tap play to resume',
              subject: { kind: 'detection', detection: latestDetection },
            }
          : {
              top: 'Paused',
              bottom: 'Tap play to resume',
              subject: null,
            };
      case 'ready-idle':
        return {
          top: 'Ready',
          bottom: 'Waiting for microphone access…',
          subject: null,
        };
      default:
        return {
          top: 'Getting ready',
          bottom: 'Starting up…',
          subject: null,
        };
    }
  })();

  const handleTopClick = () => {
    if (!statusLabel.subject) return;
    if (statusLabel.subject.kind === 'pending') {
      onSelectPending?.(
        statusLabel.subject.pending.scientificName,
        statusLabel.subject.pending.progress,
      );
    } else {
      onSelectLatest?.(statusLabel.subject.detection);
    }
  };

  return (
    <div className="flex min-w-0 flex-col justify-center gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        {statusLabel.subject ? (
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
            onClick={handleTopClick}
            aria-label={
              statusLabel.subject.kind === 'pending'
                ? `Unconfirmed: ${statusLabel.subject.pending.commonName}. Show details.`
                : `Show details for ${statusLabel.subject.detection.commonName}`
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
        {mode === 'listening' ? (
          <span
            aria-hidden
            className="relative inline-flex h-2 w-2 shrink-0"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60 dark:bg-amber-400/60" />
            <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-500 dark:bg-amber-400" />
          </span>
        ) : null}
        <p className="ml-auto hidden shrink-0 truncate text-xs text-stone-500 sm:inline dark:text-stone-400">
          {statusLabel.bottom}
        </p>
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
 * Right-hand primary button. Semantically one control with three visuals:
 *   - play when idle/paused/ready
 *   - pause when listening
 *   - retry icon when in error state (with error-styled ring)
 * Loading state shows a disabled play button so the bar's layout doesn't
 * jump when the model finishes downloading.
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
        <Pause className="h-5 w-5 fill-current" />
      ) : (
        // Nudge the play icon right by 1px — it's visually offset inside
        // its square bounding box because the triangle's visual center
        // sits a little left of the geometric center.
        <Play className="h-5 w-5 translate-x-px fill-current" />
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
// `pendingLeader` are swapped as whole objects (the accumulator memoizes
// the PendingLeader object when nothing meaningful has changed), and the
// callback props are stable on the parent side thanks to useCallback.
export const PlayerBar = memo(PlayerBarImpl);
