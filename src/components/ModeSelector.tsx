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
 * The toggle only has two visible sides — Birds (left) and Stars
 * (right). There is no visible "Auto" affordance. A first-time visitor
 * still loads in auto mode (the knob tracks `effectiveMode` — the
 * resolved birds/stars based on sun altitude), and the moment they
 * click the toggle, the app commits to that concrete mode and sheds
 * auto forever. That matches the mental model: if you flip the switch,
 * you meant to flip it.
 *
 * Clicking either half explicitly sets that mode (so tapping the
 * already-active side while still in auto commits the current
 * resolution without flipping it — useful as an "I know, keep it
 * here" affordance). Clicking the knob / blank track flips to the
 * opposite concrete mode.
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
  const { effectiveMode, setMode } = useMode();

  const isBirds = effectiveMode === "birds";

  // Clicking a side sets that concrete mode. Clicking the already-
  // active side still commits (auto → birds or auto → stars without a
  // visible flip), which is the documented "lock it in" path.
  const pick = (next: "birds" | "stars") => {
    hapticTick();
    setMode(next);
  };

  return (
    <div
      role="group"
      aria-label="Switch between birds and stars"
      className={cn(
        "relative inline-flex h-10 w-[168px] items-center rounded-full border p-1 backdrop-blur-md",
        // Dark frosted pill — works over the bird roster's light
        // background (via the white/10 border) and the sky's black.
        "border-white/10 bg-black/40 text-white",
        "focus-within:ring-2 focus-within:ring-white/40",
        "transition-colors",
        className,
      )}
    >
      {/* Sliding knob. Tracks effectiveMode so auto users see it at
          whichever side the sun decided — it snaps to the opposite
          side on their first click without needing state of its own. */}
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
        onClick={() => pick("birds")}
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
        onClick={() => pick("stars")}
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
