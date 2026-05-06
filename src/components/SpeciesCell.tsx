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
// Top-right badge treatment: every heard bird gets an inline play
// button that triggers reference-song playback without opening the
// dialog. The button's colour encodes rarity:
//
//   - Confirmed (in-region):  emerald — matches the cell's green
//                             confirmation styling.
//   - Rare (out-of-region):   orange — visually distinct from the
//                             ordinary confirmed palette so rare
//                             finds still stand out in the grid,
//                             but actionable (tap to hear it) rather
//                             than a static "Rare" chip.
//
// Plain unheard / starter-set / unconfirmed cells get no badge —
// unconfirmed birds render identically to unheard ones (grayed out,
// no icon) so the grid reads as a simple heard/not-heard checklist.
//
// Playback itself is delegated to BirdSoundboardContext. Each
// mounted play button reads `useIsSpeciesPlaying(scientificName)`
// for its on/off state and calls `playSpecies` / `stopSpecies` on
// tap. This keeps every play surface (cell buttons, dialog button,
// Play-all/Stop-all in the player bar) in sync — one <audio>
// element per species lives in the provider, and every UI consults
// the same reactive set.

import { memo, useEffect, useRef, useState } from 'react';
import { Bird, Play } from 'lucide-react';
import type { BirdexEntry } from '@/hooks/useBirdex';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { useBirdSound } from '@/hooks/useBirdSound';
import {
  useBirdSoundboard,
  useIsSpeciesPlaying,
} from '@/hooks/useBirdSoundboard';
import { useBirdGlowIntensity } from '@/hooks/useBirdGlow';
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

  // Live BirdNET confidence glow. Subscribes to the shared glow
  // store; value is a decayed [0, 1] intensity bucketed to 1%
  // precision, so this hook fires re-renders only on perceptible
  // changes. Subscribing INSIDE the memoized component is
  // intentional — the outer React.memo compares only the cell's
  // static props, and the glow layer refreshes independently. See
  // `src/contexts/BirdGlowContext.ts` for the rationale.
  //
  // Gated on `hasBeenVisible` so the 6,500-cell grid only mounts
  // active subscriptions for cells the user has actually
  // scrolled past once — an offscreen cell has no visible glow
  // anyway (content-visibility: auto skips paint), so subscribing
  // it would cost a Map.get per rAF tick for zero visual benefit.
  const glow = useBirdGlowIntensity(
    hasBeenVisible ? label.scientificName : null,
  );

  // Heard cells expose the inline play control; everyone else gets
  // the normal click-to-open-dialog behavior without a soundboard.
  // Rare birds (out-of-region heard) still get a play button — just
  // rendered in orange instead of emerald so they visually stand
  // out as notable. Replaces the old static "Rare" chip.
  const variant: 'confirmed' | 'rare' | null = heard
    ? isRare
      ? 'rare'
      : 'confirmed'
    : null;

  // Colored glow driven by live BirdNET confidence. Intensity is a
  // [0, 1] decayed score — we shape it into a soft outer shadow on
  // the inner clip so it composes cleanly with the parent's
  // `drop-shadow-*` utility (different CSS property, no conflict).
  // Two-stop shadow (tight + wide) reads as a soft halo rather
  // than a hard ring; opacity and spread both scale with intensity
  // so weak detections whisper and strong ones sing.
  //
  // Palette matches the cell's variant — emerald for confirmed in-
  // region, amber for rare, sky for starter/unconfirmed — so the
  // glow feels like an extension of the cell's resting colour
  // rather than a separate signal.
  const glowStyle: React.CSSProperties | undefined =
    glow > 0
      ? (() => {
          const rgb =
            variant === 'rare'
              ? '251, 191, 36'   // amber-400
              : variant === 'confirmed'
                ? '52, 211, 153' // emerald-400
                : '125, 211, 252'; // sky-300 (starter / unconfirmed)
          // Ease with a mild curve so low-confidence hits register
          // visibly without making peak hits look identical.
          const shaped = Math.pow(glow, 0.75);
          const innerAlpha = (0.35 + 0.45 * shaped).toFixed(3);
          const outerAlpha = (0.15 + 0.35 * shaped).toFixed(3);
          const innerRadius = 6 + 10 * shaped;
          const outerRadius = 14 + 28 * shaped;
          return {
            boxShadow:
              `0 0 ${innerRadius.toFixed(1)}px rgba(${rgb}, ${innerAlpha}), ` +
              `0 0 ${outerRadius.toFixed(1)}px rgba(${rgb}, ${outerAlpha})`,
          };
        })()
      : undefined;

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
          inside this element.

          The inline `boxShadow` (set via `glowStyle`) renders the
          live BirdNET confidence glow. We apply it here rather than
          on the outer because the outer uses Tailwind's
          `drop-shadow-*` utility (which compiles to `filter: drop-
          shadow(...)`); box-shadow is a different CSS property and
          composes cleanly alongside it. The glow sits OUTSIDE the
          rounded clip's overflow hide because box-shadow always
          paints outside the element's box regardless of overflow. */}
      <div
        style={glowStyle}
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

      {/* Top-right badge region. Every heard bird gets an inline
          play button; its colour encodes rarity (emerald = in-
          region confirmed, orange = rare out-of-region). Plain
          unheard / starter / unconfirmed cells get no badge. */}
      {variant ? (
        <SpeciesCellPlayButton
          commonName={label.commonName}
          scientificName={hasBeenVisible ? label.scientificName : null}
          enabled={hasBeenVisible}
          variant={variant}
        />
      ) : null}
    </div>
  );
}

/**
 * Inline reference-song play button rendered in the top-right of a
 * heard SpeciesCell. Comes in two colour variants:
 *
 *   - confirmed: emerald, used for ordinary in-region heard birds.
 *     Matches the cell's green confirmation styling.
 *   - rare: orange, used for out-of-region heard birds. Visually
 *     distinct so rare finds still pop in the grid, while remaining
 *     actionable (tap to hear it) rather than a static "Rare" chip.
 *
 * Playback is delegated to BirdSoundboardContext:
 *
 *   - Reference sound looked up via `useBirdSound` (Wikipedia/
 *     Commons first, iNaturalist fallback). The lookup populates
 *     the shared TanStack Query cache used by both this button and
 *     the player bar's "Play all" button — so tapping Play all
 *     after browsing the grid is instant for any species whose
 *     cell has already scrolled into view.
 *   - Play/stop calls go through the soundboard provider, which
 *     owns one <audio> element per scientific name for the
 *     lifetime of the page. That means this button's playing
 *     state, the dialog's play button state, and the Play-all /
 *     Stop-all orchestration all observe the same reactive Set
 *     of playing species.
 *   - `useIsSpeciesPlaying` is the reactive subscription that
 *     drives the button's icon (play triangle ↔ equaliser bars).
 *
 * When the species has no usable recording from either provider,
 * the button is rendered disabled rather than removed so the
 * heard indicator stays in the same position and users don't have
 * to guess whether a species is heard.
 */
function SpeciesCellPlayButton({
  commonName,
  scientificName,
  enabled,
  variant,
}: {
  commonName: string;
  /** Null until the cell has entered the viewport once (same
   *  gating strategy as `useBirdInfo` in the parent). Keeps us
   *  from firing a Wikipedia+iNat sound lookup for every heard
   *  species in the entire birdex at mount. */
  scientificName: string | null;
  /** Gate for the query. True once the cell has been visible. */
  enabled: boolean;
  /** Colour treatment: emerald for in-region confirmed, orange for
   *  rare out-of-region. Controls the button's palette only — the
   *  playback semantics are identical. */
  variant: 'confirmed' | 'rare';
}) {
  const { data: sound } = useBirdSound(
    enabled ? scientificName : null,
    enabled ? commonName : null,
  );

  const { playSpecies, stopSpecies } = useBirdSoundboard();
  const isPlaying = useIsSpeciesPlaying(scientificName);

  const disabled = !sound;

  const toggle = () => {
    if (!scientificName || !sound) return;
    if (isPlaying) {
      stopSpecies(scientificName);
    } else {
      void playSpecies({ scientificName, commonName }, sound.audioUrl);
    }
  };

  // Colour tokens split out so the button className below doesn't
  // balloon. Each variant has:
  //   - base:       resting background + text + ring
  //   - hover:      hover background
  //   - focusRing:  focus-visible ring colour
  //   - darkHover:  dark-mode hover background
  const palette =
    variant === 'rare'
      ? {
          base:
            'bg-orange-500/95 text-white ring-white/20 ' +
            'dark:bg-orange-400/95 dark:text-orange-950',
          hover:
            'hover:bg-orange-600/95 hover:shadow-lg ' +
            'dark:hover:bg-orange-300/95',
          focusRing: 'focus-visible:ring-orange-500/70',
          disabledHover:
            'disabled:hover:bg-orange-500/95 disabled:dark:hover:bg-orange-400/95',
        }
      : {
          base:
            'bg-emerald-500/95 text-white ring-white/20 ' +
            'dark:bg-emerald-400/95 dark:text-emerald-950',
          hover:
            'hover:bg-emerald-600/95 hover:shadow-lg ' +
            'dark:hover:bg-emerald-300/95',
          focusRing: 'focus-visible:ring-emerald-500/70',
          disabledHover:
            'disabled:hover:bg-emerald-500/95 disabled:dark:hover:bg-emerald-400/95',
        };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={
        disabled
          ? `${commonName} heard. No reference recording available.`
          : isPlaying
            ? `Stop ${commonName} reference song.`
            : `Play ${commonName} reference song.`
      }
      aria-pressed={isPlaying}
      className={cn(
        // 36px (h-9 w-9) reads as a primary action on the cell —
        // users should see it as a tappable soundboard, not a
        // status badge. Still a touch smaller than the dialog's
        // 40px button because the cell is much smaller than the
        // dialog header, but large enough to meet reasonable
        // touch-target guidance on mobile.
        'absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full',
        'shadow-md ring-1 backdrop-blur-sm',
        'transition-[transform,background-color,box-shadow] duration-200',
        'active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0d1230]',
        palette.base,
        palette.hover,
        palette.focusRing,
        // Disabled state keeps the same shape/color but drops
        // interactivity so the heard indicator stays consistent
        // even when a species has no usable recording.
        'disabled:cursor-default disabled:hover:shadow-md disabled:active:scale-100',
        palette.disabledHover,
      )}
    >
      {isPlaying ? (
        <EqualiserBars />
      ) : (
        // Nudge the triangle right by 1px so it looks optically
        // centered inside the circle (the glyph's centroid sits
        // left of its bounding box).
        <Play className="h-4 w-4 translate-x-px fill-current" aria-hidden />
      )}
    </button>
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
