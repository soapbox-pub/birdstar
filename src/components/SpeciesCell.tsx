// A single birdex cell in the location-based bird checklist. Renders as a
// button that opens the info dialog; visual state depends on whether the
// user has heard this species.
//
// The cell uses `content-visibility: auto` via `contentVisibility` +
// `containIntrinsicSize` Tailwind utilities (added in tailwind.config.ts)
// to let the browser skip rendering + image loading for offscreen cells.
// This is the CSS-native answer to the "6,500 cells with Wikipedia
// thumbnails" performance problem — modern Chromium/Firefox/Safari all
// support it, and it gracefully degrades to "render everything" on
// browsers that don't.
//
// Image loading is gated on `IntersectionObserver`: we only call
// `useBirdInfo` (which fires a Wikipedia request) once the cell has been
// observed to enter the viewport at least once. After that, the query is
// enabled permanently so scrolling back up doesn't re-fetch.
//
// Two top-right badge treatments, mutually exclusive:
//   - Rare heard:   amber "Rare" chip (non-interactive).
//   - Confirmed:    emerald play button that triggers reference-song
//                   playback inline, without opening the dialog.
// Plain unheard / starter-set / unconfirmed cells get no badge —
// unconfirmed birds render identically to unheard ones (grayed out,
// no icon) so the grid reads as a simple heard/not-heard checklist.

import { memo, useEffect, useRef, useState } from 'react';
import { Bird, Play, Sparkles } from 'lucide-react';
import type { BirdexEntry } from '@/hooks/useBirdex';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { useBirdSound } from '@/hooks/useBirdSound';
import { useRegisterSongPlayback } from '@/hooks/useSongPlayback';
import { cn } from '@/lib/utils';

interface SpeciesCellProps {
  entry: BirdexEntry;
  onSelect: (entry: BirdexEntry) => void;
}

function SpeciesCellImpl({ entry, onSelect }: SpeciesCellProps) {
  const { label, heard, isRare } = entry;

  // Lazy-enable the Wikipedia query once the cell has entered the
  // viewport. This keeps the cost at "N visible cells" rather than "all
  // 6,500 cells at mount", which would saturate the network + cache on
  // page load.
  const rootRef = useRef<HTMLDivElement>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);

  useEffect(() => {
    if (hasBeenVisible) return;
    const el = rootRef.current;
    if (!el) return;

    // IntersectionObserver fires async; the rootMargin pre-loads a screen
    // ahead + behind so scrolling feels instant even on slow networks.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setHasBeenVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasBeenVisible]);

  const { data } = useBirdInfo(
    hasBeenVisible ? label.scientificName : null,
    hasBeenVisible ? label.commonName : null,
  );

  // Confirmed (heard && !rare) cells expose the inline play control;
  // everyone else gets the normal click-to-open-dialog behavior
  // without a soundboard.
  const confirmed = heard && !isRare;

  return (
    <div
      ref={rootRef}
      className={cn(
        // OUTER wrapper: owns the hover lift, the shadow, and nothing
        // else visual. Deliberately NOT clipped and NOT rounded.
        //
        // Why the split? A rounded + overflow-hidden element that
        // ALSO transforms (hover:-translate-y-0.5) is unreliable as a
        // clip when its descendants are ALSO transforming (the image
        // scale). Chromium's compositor will promote the scaling
        // child to its own layer and, for a frame or two, clip it to
        // the parent's pre-transform rectangular bounds — which is
        // what produced the square-corner flash. Moving the rounded
        // clip to a non-transforming child element means the clip is
        // always stable while hover animations play around it.
        //
        // content-visibility + contain-intrinsic-size live on the
        // outer so the browser can skip the entire subtree when
        // offscreen.
        //
        // `group` on the outer so the inner clip's border + ring
        // classes can respond to hover/focus of the underlying
        // open-dialog button (keyed off `group-hover` / `group-focus-visible`).
        // The open-dialog trigger is a full-bleed absolutely-
        // positioned <button> below — we deliberately don't make
        // the outer element itself a <button>, because the play
        // control for confirmed species is a sibling <button> and
        // nesting interactive elements is invalid HTML + breaks a11y.
        'group relative block aspect-square',
        '[content-visibility:auto] [contain-intrinsic-size:200px_200px]',
        'transition-[transform,filter] duration-300',
        'hover:-translate-y-0.5',
        heard
          ? 'drop-shadow-md hover:drop-shadow-lg'
          : 'drop-shadow-sm hover:drop-shadow-md',
      )}
    >
      {/* Full-bleed "open details dialog" trigger. Rendered FIRST
          in DOM so the visually-overlapping clip (pointer-events-
          none) paints on top of it, and so the confirmed play
          button later in DOM stays above it in paint order too.
          The `peer` utility lets the clip key its focus ring on
          this specific button's focus-visible state — we want the
          big cell ring when the open-dialog trigger is
          keyboard-focused, but NOT when the small play button
          is focused (the play button has its own smaller ring).
          Nested <button>s would be invalid HTML; siblings with
          peer/group variants keep the semantics correct. */}
      <button
        type="button"
        onClick={() => onSelect(entry)}
        aria-label={
          heard
            ? `Heard ${label.commonName}. Show details.`
            : `${label.commonName}. Not yet heard. Show details.`
        }
        className="peer absolute inset-0 rounded-2xl text-left focus:outline-none"
      />

      {/* INNER clip: owns the rounded corners, the overflow clip, the
          border, the background, and the focus ring. Does NOT
          transform — its rectangle (and therefore its rounded clip)
          stays stable while the parent lifts on hover. All absolutely
          positioned layers (image, gradient, badges, label) stack
          inside this element. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden rounded-2xl border',
          'transition-[border-color,filter] duration-300',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
          'peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-[#0d1230]',
          heard
            ? isRare
              ? 'border-amber-300/80 bg-amber-50/80 peer-focus-visible:ring-amber-500/60 dark:border-amber-700/50 dark:bg-amber-950/30 dark:peer-focus-visible:ring-amber-400/60'
              : 'border-emerald-300/80 bg-white/90 peer-focus-visible:ring-emerald-500/60 dark:border-emerald-700/50 dark:bg-indigo-950/60 dark:peer-focus-visible:ring-amber-400/60'
            : cn(
                'border-stone-200/70 bg-white/40 group-hover:border-stone-300',
                'peer-focus-visible:ring-stone-400/60',
                'dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:group-hover:border-indigo-800/70',
                'dark:peer-focus-visible:ring-amber-400/40',
                // Grayed-out treatment for unheard birds: fade the
                // whole clip subtree (image + gradient + label). Kept
                // on the clip wrapper rather than the individual
                // layers so the effect is uniform and survives the
                // image-loading handoff from gradient to photo.
                // Unconfirmed cells share this exact treatment — the
                // grid reads as a simple heard/not-heard checklist,
                // with no visual distinction for "possibly heard".
                'opacity-60 filter-[grayscale(0.3)] group-hover:opacity-80',
              ),
        )}
      >
        {/* Fallback gradient — shows through until the image loads,
            and stays as the background for the no-image glyph state. */}
        <div
          className="absolute inset-0 bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100 dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60"
          aria-hidden
        />

        {data?.imageUrl ? (
          <img
            src={data.imageUrl}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className={cn(
              'absolute inset-0 h-full w-full object-cover object-[50%_25%]',
              'transition-transform duration-500 group-hover:scale-[1.04]',
              !heard && 'saturate-50',
            )}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <BirdGlyph faded={!heard} />
          </div>
        )}

        {/* Bottom gradient for name legibility */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/60 to-transparent" />

        {/* Name label — overlaid on the image so the cell is image-dominant */}
        <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-4">
          <div
            className={cn(
              'truncate font-serif text-sm font-semibold leading-tight',
              heard ? 'text-white' : 'text-white/85',
            )}
          >
            {label.commonName}
          </div>
          <div
            className={cn(
              'truncate text-[10px] italic',
              heard ? 'text-white/75' : 'text-white/55',
            )}
          >
            {label.scientificName}
          </div>
        </div>
      </div>

      {/* Top-right badge region. Mutually exclusive treatments:
          - Rare heard:   amber "Rare" chip (non-interactive).
          - Confirmed:    emerald play button (inline soundboard).
          - Starter/unheard/unconfirmed: no badge — unconfirmed
            cells render identically to unheard ones. */}
      {heard ? (
        isRare ? (
          <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-500/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow ring-1 ring-white/20 backdrop-blur-sm">
            <Sparkles className="h-2.5 w-2.5" aria-hidden />
            Rare
          </span>
        ) : (
          <SpeciesCellPlayButton
            commonName={label.commonName}
            scientificName={hasBeenVisible ? label.scientificName : null}
            enabled={confirmed && hasBeenVisible}
          />
        )
      ) : null}
    </div>
  );
}

/**
 * Inline reference-song play button rendered in the top-right of a
 * confirmed SpeciesCell. Visually matches the old green checkmark
 * badge (same `bg-emerald-500/95` palette, same ring + shadow, same
 * size) so the cell's "you heard this one" cue stays recognizable —
 * we just replaced the check glyph with a play triangle and made
 * the badge clickable.
 *
 * Playback logic mirrors the BirdInfoDialog's `useSongPlayer`:
 *
 *   - Reference sound looked up via `useBirdSound` (Wikipedia/
 *     Commons first, iNaturalist fallback).
 *   - Hidden looping <audio> element mounted locally so each cell
 *     owns its own playback independent of the dialog and any
 *     other cell. Looping matches the dialog — bird reference
 *     recordings are short phrases and comparing them to a field
 *     observation benefits from hearing the phrase multiple times.
 *   - `useRegisterSongPlayback` tells the mic recorder to mute
 *     itself while this cell is playing, same feedback-avoidance
 *     path the dialog uses.
 *   - Play icon swaps to an animated equaliser glyph while
 *     playing (same visual language as the dialog's button).
 *
 * When the species has no usable recording from either provider,
 * the button is rendered disabled rather than removed so the
 * confirmed indicator stays in the same position and users don't
 * have to guess whether a species is confirmed.
 */
function SpeciesCellPlayButton({
  commonName,
  scientificName,
  enabled,
}: {
  commonName: string;
  /** Null until the cell has entered the viewport once (same
   *  gating strategy as `useBirdInfo` in the parent). Keeps us
   *  from firing a Wikipedia+iNat sound lookup for every confirmed
   *  species in the entire birdex at mount. */
  scientificName: string | null;
  /** Gate for the query. True once the cell has been visible and
   *  the species is confirmed. */
  enabled: boolean;
}) {
  const { data: sound } = useBirdSound(
    enabled ? scientificName : null,
    enabled ? commonName : null,
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Mute the mic recorder while this cell is playing, so the
  // speaker's output doesn't feed back into the next BirdNET
  // window. Exactly the hook the dialog uses.
  useRegisterSongPlayback(isPlaying);

  // Reset to paused whenever the source URL changes. With 6,500
  // cells the same SpeciesCellPlayButton instance should never see
  // two different species, but if the sound lookup resolves late
  // (e.g. Wikipedia → iNat fallback), the audio element's src will
  // swap out from under us and any stale `isPlaying=true` would be
  // pointing at a released resource. In-render adjustment instead
  // of an effect so there's no extra render cycle and no
  // react-hooks/set-state-in-effect warning.
  const [prevAudioUrl, setPrevAudioUrl] = useState<string | undefined>(
    sound?.audioUrl,
  );
  if (prevAudioUrl !== sound?.audioUrl) {
    setPrevAudioUrl(sound?.audioUrl);
    setIsPlaying(false);
  }

  const disabled = !sound;

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      // play() may reject if autoplay is blocked or the source
      // fails to load. Swallow the rejection — the button
      // returns to the play state and the user can retry.
      el.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false),
      );
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={
          disabled
            ? `${commonName} confirmed. No reference recording available.`
            : isPlaying
              ? `Pause ${commonName} reference song.`
              : `Play ${commonName} reference song.`
        }
        aria-pressed={isPlaying}
        className={cn(
          // Sized up from the original 24px checkmark badge to 36px
          // (h-9 w-9) so the play affordance reads as a primary
          // action on the cell — users should see it as a
          // tappable soundboard, not a status badge. Still a
          // touch smaller than the dialog's 40px button because
          // the cell itself is much smaller than the dialog
          // header, but large enough to meet reasonable touch-
          // target guidance on mobile.
          'absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full',
          'bg-emerald-500/95 text-white shadow-md ring-1 ring-white/20 backdrop-blur-sm',
          'dark:bg-emerald-400/95 dark:text-emerald-950',
          'transition-[transform,background-color,box-shadow] duration-200',
          'hover:bg-emerald-600/95 hover:shadow-lg active:scale-95',
          'dark:hover:bg-emerald-300/95',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/70 focus-visible:ring-offset-1',
          'focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0d1230]',
          // Disabled state keeps the same shape/color but drops
          // interactivity so the confirmed indicator stays
          // consistent even when a species has no usable
          // recording.
          'disabled:cursor-default disabled:hover:bg-emerald-500/95 disabled:hover:shadow-md disabled:active:scale-100',
          'disabled:dark:hover:bg-emerald-400/95',
        )}
      >
        {isPlaying ? (
          <EqualiserBars />
        ) : (
          // Nudge the triangle right by 1px so it looks optically
          // centered inside the circle (the glyph's centroid
          // sits left of its bounding box).
          <Play className="h-4 w-4 translate-x-px fill-current" aria-hidden />
        )}
      </button>

      {/* Hidden audio element. Only mounted when we have a usable
          source URL so we don't ship an empty <audio src="">.
          Looped for the same reason the dialog loops: bird
          reference recordings are short phrases and users want to
          hear them repeatedly while comparing to the field. */}
      {sound ? (
        <audio
          ref={audioRef}
          src={sound.audioUrl}
          preload="none"
          loop
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          className="hidden"
        >
          Your browser does not support embedded audio.
        </audio>
      ) : null}
    </>
  );
}

/**
 * Four tiny vertical bars bouncing with staggered CSS animations,
 * rendered inside the play button while a recording is playing.
 * Mirrors the dialog's equaliser glyph so both surfaces speak the
 * same visual language for "audio is active — tap to stop." Colour
 * is `currentColor` so it inherits the button's text colour (white
 * on emerald in light mode, emerald-950 in dark mode).
 */
function EqualiserBars() {
  const delays = ['0ms', '120ms', '60ms', '180ms'];
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {delays.map((delay, i) => (
        <span
          key={i}
          className="block w-[2px] animate-pulse-bar rounded-full bg-current"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}

function BirdGlyph({ faded }: { faded?: boolean }) {
  return (
    <Bird
      aria-hidden
      strokeWidth={1.5}
      className={cn(
        'h-12 w-12',
        faded
          ? 'text-stone-400/50 dark:text-stone-500/40'
          : 'text-emerald-700/50 dark:text-amber-300/50',
      )}
    />
  );
}

// Memo aggressively — the parent grid re-renders whenever any detection
// is added, so 6,500 cells re-evaluating their DOM would be
// catastrophic. `useBirdex` rebuilds its entry objects on every
// render (they capture popularity / localBand as well, which can
// drift as iNat data loads), so we compare the fields that actually
// drive the cell's rendered output rather than relying on reference
// equality.
export const SpeciesCell = memo(SpeciesCellImpl, (prev, next) => {
  if (prev.onSelect !== next.onSelect) return false;
  const a = prev.entry;
  const b = next.entry;
  return (
    a.label === b.label &&
    a.heard === b.heard &&
    a.isRare === b.isRare &&
    a.isUnconfirmed === b.isUnconfirmed &&
    a.detection?.eventId === b.detection?.eventId &&
    a.detection?.timestamp === b.detection?.timestamp
  );
});
