// A single roster cell in the location-based bird checklist. Renders as a
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

import { memo, useEffect, useRef, useState } from 'react';
import { Bird, Check, Sparkles } from 'lucide-react';
import type { BirdLabel } from '@/lib/birdnet/labels';
import type { Detection } from '@/components/BirdCard';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { cn } from '@/lib/utils';

interface SpeciesCellProps {
  label: BirdLabel;
  detection?: Detection;
  heard: boolean;
  /** Visual treatment flag: heard-but-out-of-region. Renders a "rare"
   * badge and a warmer palette. */
  rare?: boolean;
  onSelect: (label: BirdLabel, detection: Detection | undefined) => void;
}

function SpeciesCellImpl({
  label,
  detection,
  heard,
  rare = false,
  onSelect,
}: SpeciesCellProps) {
  // Lazy-enable the Wikipedia query once the cell has entered the
  // viewport. This keeps the cost at "N visible cells" rather than "all
  // 6,500 cells at mount", which would saturate the network + cache on
  // page load.
  const rootRef = useRef<HTMLButtonElement>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);

  useEffect(() => {
    if (hasBeenVisible) return;
    const el = rootRef.current;
    if (!el) return;

    // IntersectionObserver fires async; the rootMargin pre-loads a screen
    // ahead + behind so scrolling feels instant even on slow networks.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
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

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={() => onSelect(label, detection)}
      aria-label={
        heard
          ? `Heard ${label.commonName}. Show details.`
          : `${label.commonName}. Not yet heard. Show details.`
      }
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
        'group relative block aspect-square',
        '[content-visibility:auto] [contain-intrinsic-size:200px_200px]',
        'text-left transition-[transform,filter] duration-300',
        'hover:-translate-y-0.5',
        'focus:outline-none',
        heard
          ? rare
            ? 'drop-shadow-md hover:drop-shadow-lg'
            : 'drop-shadow-md hover:drop-shadow-lg'
          : 'drop-shadow-sm hover:drop-shadow-md',
      )}
    >
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
          'group-focus-visible:ring-2 group-focus-visible:ring-offset-2',
          'group-focus-visible:ring-offset-white dark:group-focus-visible:ring-offset-[#0d1230]',
          heard
            ? rare
              ? 'border-amber-300/80 bg-amber-50/80 group-focus-visible:ring-amber-500/60 dark:border-amber-700/50 dark:bg-amber-950/30 dark:group-focus-visible:ring-amber-400/60'
              : 'border-emerald-300/80 bg-white/90 group-focus-visible:ring-emerald-500/60 dark:border-emerald-700/50 dark:bg-indigo-950/60 dark:group-focus-visible:ring-amber-400/60'
            : cn(
                'border-stone-200/70 bg-white/40 group-hover:border-stone-300',
                'group-focus-visible:ring-stone-400/60',
                'dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:group-hover:border-indigo-800/70',
                'dark:group-focus-visible:ring-amber-400/40',
                // Grayed-out treatment for unheard birds: fade the
                // whole clip subtree (image + gradient + label). Kept
                // on the clip wrapper rather than the individual
                // layers so the effect is uniform and survives the
                // image-loading handoff from gradient to photo.
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

        {/* Heard / rare badges (top-right) */}
        {heard ? (
          rare ? (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-500/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow ring-1 ring-white/20 backdrop-blur-sm">
              <Sparkles className="h-2.5 w-2.5" aria-hidden />
              Rare
            </span>
          ) : (
            <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/95 text-white shadow ring-1 ring-white/20 backdrop-blur-sm dark:bg-emerald-400/95 dark:text-emerald-950">
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            </span>
          )
        ) : null}

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
    </button>
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
// is added, so 6,500 cells re-evaluating props would be catastrophic.
export const SpeciesCell = memo(SpeciesCellImpl, (prev, next) => {
  return (
    prev.label === next.label &&
    prev.detection?.eventId === next.detection?.eventId &&
    prev.detection?.timestamp === next.detection?.timestamp &&
    prev.heard === next.heard &&
    prev.rare === next.rare &&
    prev.onSelect === next.onSelect
  );
});
