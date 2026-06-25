// Individual calendar-event detail view. Rendered *in place* inside the
// events drawer (`EventsDrawer`) — both when a card is tapped and when
// the app is opened on an event deep link (`/naddr1…`) — with a back
// arrow that returns to the list and a Share button for the deep link.
//
// The event is resolved by the parent (BirdsIndex) from the URL via
// `useBirdstarEventByAddr`; this component is purely presentational.
import { useCallback, useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock,
  Loader2,
  MapPin,
  Share2,
} from 'lucide-react';

import { LinkifiedEventText } from '@/components/EventDescription';
import {
  formatEventWhen,
  sanitizeImageUrl,
  type BirdstarCalendarEvent,
} from '@/components/communityEventUtils';
import { BIRDSTAR_PUBKEY } from '@/hooks/useBirdstarEvents';
import { useToast } from '@/hooks/useToast';
import { hapticTap } from '@/lib/haptics';

interface EventDetailContentProps {
  event: BirdstarCalendarEvent | null;
  isLoading: boolean;
  onBack?: () => void;
}

export function EventDetailContent({
  event,
  isLoading,
  onBack,
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
      {/* Back arrow — floats top-left, mirroring the sheet's close (X)
          button at top-right with identical formatting. Only shown when
          there's a list to return to (i.e. inside the events drawer). */}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to events"
          className="absolute left-[calc(1rem+env(safe-area-inset-left))] top-[calc(1rem+env(safe-area-inset-top))] z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white shadow-md ring-1 ring-white/10 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-0 sm:left-4 sm:top-4"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

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
          {/* Share — directly under the image. Native share where
              available, clipboard copy as the fallback. */}
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share this event"
            className="inline-flex items-center gap-2 rounded-full border border-stone-200/80 bg-white/70 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:border-indigo-900/50 dark:bg-indigo-950/50 dark:text-stone-200 dark:hover:bg-indigo-950/80 dark:hover:text-stone-50 dark:focus-visible:ring-amber-400/60"
          >
            {copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Share2 className="size-4" aria-hidden />
            )}
            {copied ? 'Copied' : 'Share'}
          </button>

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
    </div>
  );
}
