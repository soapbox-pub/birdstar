import { Bird, Sparkles } from "lucide-react";

import { useMode } from "@/hooks/useMode";
import { hapticTick } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * Two-position Birds/Stars toggle that lives in the top-left of both
 * experiences.
 *
 * ## Interaction model
 *
 * **Clicking anywhere on the toggle flips it to the opposite mode.**
 * The two halves still exist as separate buttons for keyboard and
 * screen-reader affordance (each is aria-pressed, each announces
 * "Birds mode" / "Stars mode"), but both halves' click handler does
 * the same thing: set the *opposite* mode. That means a user who
 * wants to flip never has to think about which half to tap — any
 * pixel of the pill works.
 *
 * ## Visual
 *
 * Dark frosted pill + sliding knob. The pill is dark on both
 * backgrounds (pale birds gradient, black sky) so the same component
 * works in either mode without restyling. The knob carries the active
 * mode's accent color so the "where am I" cue is unambiguous even for
 * users who don't parse icons.
 */
export function ModeSelector({ className }: { className?: string }) {
  const { mode, setMode } = useMode();

  const isBirds = mode === "birds";

  // Any click flips. The two half-buttons exist for a11y (each one
  // has its own aria-pressed + label), but we intentionally collapse
  // their click semantics: "flip to the opposite of whatever's live".
  const flip = () => {
    hapticTick();
    setMode(isBirds ? "stars" : "birds");
  };

  return (
    <div
      role="group"
      aria-label="Switch between birds and stars"
      className={cn(
        "relative inline-flex h-10 w-[168px] items-center rounded-full border p-1 backdrop-blur-md",
        // Dark frosted pill — works over the bird birdex's light
        // background (via the white/10 border) and the sky's black.
        "border-white/10 bg-black/40 text-white",
        "focus-within:ring-2 focus-within:ring-white/40",
        "transition-colors",
        className,
      )}
    >
      {/* Sliding knob tracks the current mode. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1 h-8 w-[80px] rounded-full shadow-md transition-transform duration-200 ease-out motion-reduce:transition-none",
          // Birds gets an emerald knob, stars an indigo/violet one — a
          // color cue that survives the icon and works in both modes.
          isBirds
            ? "translate-x-0 bg-emerald-500/90"
            : "translate-x-[80px] bg-indigo-500/90",
        )}
      />

      <button
        type="button"
        onClick={flip}
        aria-pressed={isBirds}
        aria-label="Birds mode"
        className={cn(
          "relative z-10 inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-medium",
          "transition-colors",
          "focus-visible:outline-hidden",
          isBirds ? "text-white" : "text-white/60 hover:text-white/85",
        )}
      >
        <Bird className="h-4 w-4" aria-hidden />
        <span>Birds</span>
      </button>

      <button
        type="button"
        onClick={flip}
        aria-pressed={!isBirds}
        aria-label="Stars mode"
        className={cn(
          "relative z-10 inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-medium",
          "transition-colors",
          "focus-visible:outline-hidden",
          !isBirds ? "text-white" : "text-white/60 hover:text-white/85",
        )}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        <span>Stars</span>
      </button>
    </div>
  );
}
