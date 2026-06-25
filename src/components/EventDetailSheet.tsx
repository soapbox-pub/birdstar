// Individual calendar-event view, opened when the URL is a Birdstar
// calendar-event naddr (e.g. /naddr1…). Mounts as a right-side sheet
// over Birds mode, mirroring how Stars opens its constellation detail
// sheet from a deep link.
//
// The event is resolved by the parent (BirdsIndex) from the URL via
// `useBirdstarEventByAddr`; this component is purely presentational.
import { useMemo } from 'react';
import { CalendarDays, Clock, Loader2, MapPin, X } from 'lucide-react';

import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet';
import { LinkifiedEventText } from '@/components/EventDescription';
import {
  formatEventWhen,
  sanitizeImageUrl,
  type BirdstarCalendarEvent,
} from '@/components/communityEventUtils';

interface EventDetailSheetProps {
  /** The resolved event, or null when nothing is open. */
  event: BirdstarCalendarEvent | null;
  /** True while a cold deep-link is still resolving. */
  isLoading: boolean;
  /** True when the URL is an event naddr (so the sheet should be open). */
  open: boolean;
  /** Called when the sheet is dismissed. */
  onClose: () => void;
}

export function EventDetailSheet({
  event,
  isLoading,
  open,
  onClose,
}: EventDetailSheetProps) {
  const imageUrl = useMemo(
    () => sanitizeImageUrl(event?.image ?? null),
    [event?.image],
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex w-full flex-col gap-0 border-stone-200/70 bg-white p-0 text-stone-900 sm:max-w-md dark:border-indigo-900/40 dark:bg-[#13112e] dark:text-stone-100"
        showCloseButton={false}
      >
        <SheetClose
          aria-label="Close"
          className="absolute right-[calc(1rem+env(safe-area-inset-right))] top-[calc(1rem+env(safe-area-inset-top))] z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white shadow-md ring-1 ring-white/10 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-0 sm:right-4 sm:top-4"
        >
          <X className="h-4 w-4" aria-hidden />
        </SheetClose>
        {isLoading && !event ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2
              className="size-6 animate-spin text-stone-400 dark:text-stone-500"
              aria-label="Loading event"
            />
          </div>
        ) : !event ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              This event couldn’t be found. It may have been removed or the
              link is invalid.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-hidden">
            {/* Hero image (or gradient banner fallback). */}
            <div className="relative shrink-0">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="h-48 w-full object-cover sm:h-56"
                />
              ) : (
                <div className="flex h-40 w-full items-center justify-center bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100 dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60">
                  <CalendarDays
                    className="size-12 text-emerald-700/70 dark:text-amber-200/70"
                    aria-hidden
                  />
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent" />
            </div>

            {/* Scrollable body. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                      {/* Location can be an address or a link (e.g. a
                          video-call URL per NIP-52), so linkify it. */}
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
        )}
      </SheetContent>
    </Sheet>
  );
}
