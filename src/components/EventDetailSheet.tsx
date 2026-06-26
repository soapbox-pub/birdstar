// Individual calendar-event detail sheet. Opens as a second right-side
// sheet stacked *on top* of the events drawer (`EventsDrawer`) — both
// when a card is tapped and when the app is opened on an event deep link
// (`/naddr1…`). Closing it (the X, Escape, or backdrop) just dismisses
// this sheet and reveals the events list underneath exactly as it was
// left (same Nearby/World toggle and scroll position).
//
// The event is supplied by the parent (BirdsIndex): the full object when
// tapped in-app, or resolved from the URL via `useBirdstarEventByAddr`
// for a cold deep link.
import { useCallback, useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import {
  CalendarDays,
  Check,
  Clock,
  Loader2,
  MapPin,
  Share2,
} from 'lucide-react';

import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { OverlayCloseButton } from '@/components/OverlayCloseButton';
import { LinkifiedEventText } from '@/components/EventDescription';
import {
  formatEventWhen,
  sanitizeImageUrl,
  type BirdstarCalendarEvent,
} from '@/components/communityEventUtils';
import { BIRDSTAR_PUBKEY } from '@/hooks/useBirdstarEvents';
import { useToast } from '@/hooks/useToast';
import { hapticTap } from '@/lib/haptics';

interface EventDetailSheetProps {
  /** The resolved event, or null when nothing is open. */
  event: BirdstarCalendarEvent | null;
  /** True while a cold deep-link is still resolving. */
  isLoading: boolean;
  /** True when the detail sheet should be open. */
  open: boolean;
  /** Called when the sheet is dismissed (X, Escape, or backdrop). */
  onClose: () => void;
}

export function EventDetailSheet({
  event,
  isLoading,
  open,
  onClose,
}: EventDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex w-full flex-col gap-0 border-stone-200/70 bg-white p-0 text-stone-900 sm:max-w-md dark:border-indigo-900/40 dark:bg-[#13112e] dark:text-stone-100"
        showCloseButton={false}
      >
        <SheetClose asChild>
          <OverlayCloseButton />
        </SheetClose>
        <EventDetailContent event={event} isLoading={isLoading} />
      </SheetContent>
    </Sheet>
  );
}

interface EventDetailContentProps {
  event: BirdstarCalendarEvent | null;
  isLoading: boolean;
}

export function EventDetailContent({
  event,
  isLoading,
}: EventDetailContentProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const imageUrl = useMemo(
    () => sanitizeImageUrl(event?.image ?? null),
    [event?.image],
  );

  // Absolute, shareable deep link to this event (`https://…/naddr1…`),
  // pinned to the Birdstar curator pubkey so the shared link resolves to
  // the trusted event regardless of who opens it.
  const shareUrl = useMemo(() => {
    if (!event) return null;
    const naddr = nip19.naddrEncode({
      kind: event.kind,
      pubkey: BIRDSTAR_PUBKEY,
      identifier: event.identifier,
    });
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/${naddr}`;
  }, [event]);

  const handleShare = useCallback(async () => {
    if (!shareUrl) return;
    hapticTap();

    const nav = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>;
    };

    // Prefer the OS share sheet on supported (mostly mobile) platforms;
    // fall back to copying the link to the clipboard everywhere else.
    if (typeof nav.share === 'function') {
      try {
        await nav.share({
          title: event?.title ?? 'Birding event',
          text: event?.title
            ? `Check out this birding event: ${event.title}`
            : 'Check out this birding event on Birdstar',
          url: shareUrl,
        });
        return;
      } catch {
        // User dismissed the share sheet, or it failed — fall through to
        // copying so there's still a useful outcome.
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Link copied', description: 'Share it anywhere.' });
    } catch {
      toast({
        title: "Couldn't share",
        description: 'Copy the link from your browser instead.',
        variant: 'destructive',
      });
    }
  }, [shareUrl, event, toast]);

  if (isLoading && !event) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          className="size-6 animate-spin text-stone-400 dark:text-stone-500"
          aria-label="Loading event"
        />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-sm text-stone-600 dark:text-stone-300">
          This event couldn’t be found. It may have been removed or the link is
          invalid.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto sm:overflow-hidden">
      {/* Hero image (or gradient banner fallback). On mobile it keeps its
          natural full-width aspect ratio and scrolls away with the content;
          from `sm` upward it returns to the fixed-height sheet treatment. */}
      <div className="relative shrink-0 sm:h-56">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-auto w-full object-cover sm:h-full"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100 sm:h-full sm:aspect-auto dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60">
            <CalendarDays
              className="size-12 text-emerald-700/70 dark:text-amber-200/70"
              aria-hidden
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
      </div>

      {/* Body scrolls with the hero on mobile. At `sm` and up it scrolls
          independently below the fixed-height banner. */}
      <div className="sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:overscroll-contain">
        <div className="space-y-5 p-5">
          <div>
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
              {event.title}
            </h2>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-200">
              {event.allDay ? (
                <CalendarDays
                  className="size-4 shrink-0 text-emerald-600 dark:text-amber-300"
                  aria-hidden
                />
              ) : (
                <Clock
                  className="size-4 shrink-0 text-emerald-600 dark:text-amber-300"
                  aria-hidden
                />
              )}
              <span>{formatEventWhen(event)}</span>
            </div>

            {event.location ? (
              <div className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-200">
                <MapPin
                  className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-amber-300"
                  aria-hidden
                />
                {/* Location can be an address or a link (e.g. a video-call URL
                    per NIP-52), so linkify it. */}
                <LinkifiedEventText text={event.location} />
              </div>
            ) : null}
          </div>

          {event.description ? (
            <LinkifiedEventText
              text={event.description}
              className="text-sm leading-relaxed text-stone-700 dark:text-stone-200"
            />
          ) : event.summary ? (
            <LinkifiedEventText
              text={event.summary}
              className="text-sm leading-relaxed text-stone-700 dark:text-stone-200"
            />
          ) : null}
        </div>
      </div>

      {/* Share — a full-width primary action pinned at the bottom of the
          sheet. Native share where available, clipboard copy as the
          fallback. */}
      <div className="shrink-0 border-t border-stone-200/70 bg-white/80 p-5 backdrop-blur-sm dark:border-indigo-900/40 dark:bg-[#13112e]/80 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <Button
          type="button"
          size="lg"
          onClick={handleShare}
          aria-label="Share this event"
          className="w-full gap-2 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700 dark:bg-amber-400 dark:text-indigo-950 dark:hover:bg-amber-300"
        >
          {copied ? (
            <Check className="size-5" aria-hidden />
          ) : (
            <Share2 className="size-5" aria-hidden />
          )}
          {copied ? 'Link copied' : 'Share event'}
        </Button>
      </div>
    </div>
  );
}
