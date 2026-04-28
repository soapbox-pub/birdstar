import { useMemo } from "react";
import {
  Bird,
  Check,
  ChevronDown,
  Sparkles,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMode } from "@/hooks/useMode";
import { hapticTick } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * The floating top-left mode dropdown.
 *
 * In "auto" the trigger collapses to a bare circle with a down-chevron —
 * the visual cue is "this follows the sun, don't think about it". In
 * "birds" or "stars" the trigger widens to show the active mode's label
 * and icon.
 *
 * Styled to sit over both the bird roster's pale-gradient background and
 * starpoint's black sky, so it uses the same frosted-dark pill treatment
 * as the rest of the sky HUD.
 */
export function ModeSelector({ className }: { className?: string }) {
  const { mode, effectiveMode, setMode } = useMode();

  // When Auto is picked the dropdown appends "(currently birds)" / "
  // (currently stars)" to the matching row, so the user can tell which
  // way Auto is resolving right now without leaving the menu.
  const items = useMemo(
    () =>
      [
        {
          value: "auto" as const,
          label: "Auto",
          description:
            effectiveMode === "birds"
              ? "Currently birds — stars after dark"
              : "Currently stars — birds by day",
        },
        {
          value: "birds" as const,
          label: "Birds",
          description: "Listen for birds near you",
          icon: Bird,
        },
        {
          value: "stars" as const,
          label: "Stars",
          description: "Point your phone at the sky",
          icon: Sparkles,
        },
      ] as const,
    [effectiveMode],
  );

  const isAuto = mode === "auto";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch between birds, stars, and auto"
        className={cn(
          "group inline-flex items-center justify-center gap-2",
          "rounded-full border text-sm font-medium backdrop-blur-md",
          // Dark frosted pill — works over the bird roster's light
          // background (via the white/10 border) and the sky's black.
          "bg-black/40 border-white/10 text-white hover:bg-black/60",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-0",
          "transition-colors",
          // Compact circular treatment for Auto; widens to a pill with
          // label when birds/stars is explicitly selected.
          isAuto ? "h-10 w-10 p-0" : "h-10 px-3.5 pr-3",
          className,
        )}
        onClick={() => hapticTick()}
      >
        {isAuto ? (
          <ChevronDown className="h-4 w-4" aria-hidden />
        ) : mode === "birds" ? (
          <>
            <Bird className="h-4 w-4" aria-hidden />
            <span>Birds</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" aria-hidden />
            <span>Stars</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[220px] bg-slate-950/95 border-white/10 text-white backdrop-blur-lg"
      >
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.18em] text-white/50 font-semibold">
          Mode
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/10" />
        {items.map((item) => {
          const Icon = "icon" in item ? item.icon : null;
          const selected = mode === item.value;
          return (
            <DropdownMenuItem
              key={item.value}
              onSelect={() => setMode(item.value)}
              className={cn(
                "gap-3 py-2 pr-2 text-white focus:bg-white/10 focus:text-white",
                selected && "bg-white/5",
              )}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                {Icon ? (
                  <Icon className="h-4 w-4 opacity-80" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4 opacity-80" aria-hidden />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium leading-tight">
                  {item.label}
                </span>
                <span className="text-[11px] text-white/60 leading-tight">
                  {item.description}
                </span>
              </div>
              {selected ? (
                <Check className="h-3.5 w-3.5 text-white/70" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
