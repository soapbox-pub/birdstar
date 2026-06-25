// Shared floating close (X) button for full-bleed overlays — the
// per-event detail sheet, the events drawer, and the mobile full-screen
// bird dialogs. Each of those overlays hides its primitive's built-in
// close control (`showCloseButton={false}`) and renders this instead so
// the X stays legible over arbitrary hero imagery and clears the iOS
// safe-area insets.
//
// It renders a bare <button> and spreads props/ref through, so call sites
// compose it with their close primitive via `asChild`:
//
//   <SheetClose asChild>
//     <OverlayCloseButton />
//   </SheetClose>
//   <DialogClose asChild>
//     <OverlayCloseButton variant="surface" />
//   </DialogClose>
import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

interface OverlayCloseButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Palette: `dark` (default) sits on a translucent black scrim — legible
   * over photos; `surface` uses the themed background — for dialogs that
   * open over a tinted profile header rather than a photo.
   */
  variant?: 'dark' | 'surface';
}

export function OverlayCloseButton({
  variant = 'dark',
  className,
  ref,
  ...props
}: OverlayCloseButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="Close"
      className={cn(
        // Position: clears the safe-area inset on mobile, snaps back to a
        // flat 1rem inset from `sm` upward. Call sites can override these
        // via `className` (e.g. the bird dialog uses a tighter 0.75rem).
        'absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-10 inline-flex h-9 w-9 items-center justify-center rounded-full sm:right-4 sm:top-4',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
        variant === 'dark'
          ? 'bg-black/50 text-white shadow-md ring-1 ring-white/10 backdrop-blur-sm hover:bg-black/70 hover:text-white focus-visible:ring-white/70'
          : 'bg-background/75 text-foreground shadow-sm ring-1 ring-border backdrop-blur-sm hover:bg-background focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}
