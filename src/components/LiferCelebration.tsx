// Full-screen "NEW BIRD DISCOVERED" fanfare. Mounts once inside
// IndexInner (BirdsIndex.tsx) and renders null unless useLiferCelebration
// hands it a current item.
//
// Visual recipe:
//   - Softly darkened backdrop (fixed inset-0, click-through on the dark
//     area: tapping anywhere dismisses).
//   - Three layered expanding rings radiating from the card (ping style,
//     staggered) for a "signal acquired" vibe.
//   - Center card: the bird's Wikipedia photo (via useBirdInfo — the
//     cache is usually already warm from the species cell) with a
//     diagonal shimmer sweeping across the image. If the photo isn't
//     available (missing Wikipedia image, or offline), a Bird icon
//     stands in so the celebration still plays.
//   - "NEW BIRD DISCOVERED" banner in letter-spaced caps with a gold
//     underline. Common name + scientific name below the image.
//   - A burst of 24 confetti particles in the brand palette. Pure CSS
//     animation driven by per-particle custom properties — no extra
//     dependency, no runtime engine, GPU-friendly.
//
// Lifecycle:
//   - Auto-dismisses after AUTO_DISMISS_MS (calls onDismiss, which the
//     hook's `next()` routes to either the next queued item or null).
//   - Tapping anywhere on the backdrop dismisses early.
//   - Fires hapticLockOn() on mount. Respects prefers-reduced-motion
//     by disabling the ambient shimmer/ring/confetti loops (the card
//     still appears, it just doesn't dance).

import { memo, useEffect, useMemo } from 'react';
import { Bird, Sparkles } from 'lucide-react';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import type { LiferItem } from '@/hooks/useLiferCelebration';
import { hapticLockOn } from '@/lib/haptics';
import { cn } from '@/lib/utils';

const AUTO_DISMISS_MS = 4200;

// Deterministic-looking confetti spread. Pre-computed so every
// celebration has the same particle layout (no Math.random on render).
// Mix of warm + cool hues to read against both the Birds bright
// gradient and the dark theme.
const CONFETTI_COLORS = [
  '#fbbf24', // amber-400
  '#f97316', // orange-500
  '#ef4444', // red-500
  '#10b981', // emerald-500
  '#3b82f6', // blue-500
  '#a855f7', // purple-500
  '#ec4899', // pink-500
  '#fde047', // yellow-300
];

interface ConfettiSpec {
  color: string;
  /** Final horizontal translation (with unit, relative to center). */
  x: string;
  /** Final vertical translation — always downward (positive). */
  y: string;
  /** Final rotation. */
  r: string;
  /** Initial rotation so the squares don't all start axis-aligned. */
  startRotation: string;
  /** Animation delay so the burst staggers out. */
  delay: string;
  /** Animation duration — varied so not all land at once. */
  duration: string;
  /** Particle size in px. */
  size: number;
}

// Evenly fan out 24 particles over a full circle, then add a bit of
// per-particle jitter (using index-derived pseudo-noise so the layout
// is stable across mounts). Particles travel farther on the horizontal
// axis than vertical so the burst reads as "outward" rather than
// just "falling".
const CONFETTI: ConfettiSpec[] = Array.from({ length: 24 }, (_, i) => {
  const angle = (i / 24) * Math.PI * 2;
  // Cheap deterministic jitter in [-0.5, 0.5].
  const jitter = (seed: number) => {
    const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return (x - Math.floor(x)) - 0.5;
  };
  const radius = 260 + jitter(1) * 120; // px
  const x = Math.cos(angle) * radius + jitter(2) * 80;
  const y = Math.sin(angle) * radius * 0.9 + 180 + jitter(3) * 120; // bias downward
  const rotation = 360 * 2 + jitter(4) * 720;
  const startRotation = jitter(5) * 180;
  return {
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    x: `${x.toFixed(0)}px`,
    y: `${y.toFixed(0)}px`,
    r: `${rotation.toFixed(0)}deg`,
    startRotation: `${startRotation.toFixed(0)}deg`,
    delay: `${(jitter(6) * 120 + 60).toFixed(0)}ms`,
    duration: `${(1800 + jitter(7) * 600).toFixed(0)}ms`,
    size: 6 + Math.floor((jitter(8) + 0.5) * 6),
  };
});

export interface LiferCelebrationProps {
  item: LiferItem | null;
  onDismiss: () => void;
}

function LiferCelebrationImpl({ item, onDismiss }: LiferCelebrationProps) {
  // Haptic tick on mount (fires on each queued item, not just the
  // first — every lifer earns its own little buzz). Guarded by the
  // presence of `item` so dismissal doesn't re-trigger it.
  useEffect(() => {
    if (!item) return;
    hapticLockOn();
  }, [item]);

  // Auto-dismiss timer. Reset whenever the item id changes so the
  // next queued item gets a full AUTO_DISMISS_MS on screen even if
  // `onDismiss` identity is stable.
  useEffect(() => {
    if (!item) return;
    const t = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [item, onDismiss]);

  if (!item) return null;
  return <LiferOverlay item={item} onDismiss={onDismiss} />;
}

/**
 * The inner overlay. Split from the dispatcher above so `useBirdInfo`
 * only fires when an item is actually present (hook rules prevent us
 * from early-returning before the hook call otherwise).
 */
function LiferOverlay({
  item,
  onDismiss,
}: {
  item: LiferItem;
  onDismiss: () => void;
}) {
  const info = useBirdInfo(item.scientificName, item.commonName);
  const imageUrl = info.data?.imageUrl ?? null;

  // Pre-compute the confetti inline styles — the particle array is a
  // module-level constant so this memo is essentially "wrap the styles
  // in an object once per mount".
  const confettiStyles = useMemo(
    () =>
      CONFETTI.map(
        (c): React.CSSProperties => ({
          // CSS custom properties are typed as string-only in React's
          // CSSProperties; cast through Record to silence the tsc
          // complaint without losing type safety elsewhere.
          ...({
            '--lifer-confetti-x': c.x,
            '--lifer-confetti-y': c.y,
            '--lifer-confetti-r': c.r,
          } as Record<string, string>),
          backgroundColor: c.color,
          width: `${c.size}px`,
          height: `${c.size * 1.6}px`,
          transform: `rotate(${c.startRotation})`,
          animationDelay: c.delay,
          animationDuration: c.duration,
        }),
      ),
    [],
  );

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={`New bird discovered: ${item.commonName}`}
      className="fixed inset-0 z-50 flex items-center justify-center motion-safe:animate-lifer-backdrop"
    >
      {/* Backdrop. Click-through dismisses. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm cursor-pointer"
      />

      {/* Expanding signal-acquired rings, staggered so a new one is
          always in-flight. Hidden for reduced-motion users. */}
      <div
        className="pointer-events-none absolute motion-reduce:hidden"
        aria-hidden
      >
        {[0, 400, 800].map((delay) => (
          <div
            key={delay}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300/70 motion-safe:animate-lifer-ring"
            style={{
              width: '22rem',
              height: '22rem',
              left: 0,
              top: 0,
              animationDelay: `${delay}ms`,
            }}
          />
        ))}
      </div>

      {/* Confetti layer — positioned at the center so each particle's
          final translate is relative to the middle of the viewport. */}
      <div
        className="pointer-events-none absolute inset-0 motion-reduce:hidden"
        aria-hidden
      >
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {CONFETTI.map((_, i) => (
            <span
              key={i}
              className="absolute block rounded-sm motion-safe:animate-lifer-confetti"
              style={confettiStyles[i]}
            />
          ))}
        </div>
      </div>

      {/* The card itself. `pointer-events-auto` so the tap-to-dismiss
          still works on mobile where the card covers most of the
          screen. Wrapping the card click in onDismiss makes the whole
          overlay a giant "ack" button. */}
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          'relative z-10 mx-4 flex w-[min(22rem,90vw)] flex-col items-center gap-4 rounded-3xl p-6',
          'bg-white/95 text-stone-900 shadow-2xl ring-1 ring-amber-300/60 backdrop-blur-md',
          'dark:bg-stone-900/90 dark:text-stone-100 dark:ring-amber-400/40',
          'cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
          'motion-safe:animate-lifer-card',
        )}
      >
        {/* Top banner — "NEW BIRD DISCOVERED" in letter-spaced caps. */}
        <div className="motion-safe:animate-lifer-banner flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-amber-600 dark:text-amber-300">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          New bird discovered
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </div>

        {/* Image — square so the card has a predictable height
            regardless of the source aspect ratio. `object-cover` with
            a slightly high focal point keeps the bird's head in frame
            on most Wikipedia shots. The shimmer bar sweeps across in a
            separate absolutely-positioned child. */}
        <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-stone-100 ring-1 ring-amber-200/70 dark:bg-stone-800 dark:ring-amber-500/20">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={item.commonName}
              className="h-full w-full object-cover object-[50%_30%]"
              loading="eager"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Bird
                className="h-20 w-20 text-amber-500/80 dark:text-amber-300/80"
                aria-hidden
              />
            </div>
          )}
          {/* Diagonal shimmer sweep. */}
          <div
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-linear-to-r from-transparent via-white/70 to-transparent mix-blend-overlay motion-safe:animate-lifer-shimmer motion-reduce:hidden"
            aria-hidden
          />
          {/* Soft bottom vignette for legibility if the bird photo is
              bright at the bottom edge. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-black/30 to-transparent"
            aria-hidden
          />
        </div>

        {/* Name block. Common name gets the display serif treatment to
            match BirdInfoDialog; scientific name italic below. */}
        <div className="w-full text-center">
          <div className="font-serif text-2xl leading-tight">
            {item.commonName}
          </div>
          <div className="mt-0.5 text-sm italic text-stone-500 dark:text-stone-400">
            {item.scientificName}
          </div>
        </div>

        {/* Tap-to-dismiss hint. Deliberately quiet — the auto-dismiss
            does the work; this just tells the user they can move on
            sooner if they want. */}
        <div className="text-[11px] uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500">
          Tap to continue
        </div>
      </button>
    </div>
  );
}

export const LiferCelebration = memo(LiferCelebrationImpl);
