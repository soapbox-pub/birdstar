// "Birding events" drawer — a right-side sheet listing upcoming
// NIP-52 calendar events (kinds 31922/31923) curated by the official
// Birdstar account, so people can find real-world meetups and group
// walks to attend.
//
// Opened from a calendar icon button in the Birds-mode HUD (mirroring
// the constellation/Sparkles button in Stars mode). Each card is a big
// image with the event name and date only; tapping navigates to the
// event's `/{naddr}`, which BirdsIndex resolves into the
// EventDetailSheet.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { CalendarDays, Clock, Loader2 } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import {
  formatEventWhen,
  sanitizeImageUrl,
  type BirdstarCalendarEvent,
} from '@/components/communityEventUtils';
import { BIRDSTAR_PUBKEY, useBirdstarEvents } from '@/hooks/useBirdstarEvents';
import { cn } from '@/lib/utils';

interface EventsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventsDrawer({ open, onOpenChange }: EventsDrawerProps) {
  const { upcoming, isLoading } = useBirdstarEvents();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-stone-200/70 bg-white p-0 text-stone-900 sm:max-w-md dark:border-indigo-900/40 dark:bg-[#13112e] dark:text-stone-100"
      >
        <SheetHeader className="shrink-0 border-b border-stone-200/70 px-5 pb-4 pt-5 text-left dark:border-indigo-900/40">
          <SheetTitle className="flex items-center gap-2 font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
            <CalendarDays
              className="size-5 text-emerald-600 dark:text-amber-300"
              aria-hidden
            />
            Birding events
          </SheetTitle>
          <SheetDescription className="text-stone-600 dark:text-stone-300">
            Go outside and meet other birders — group walks, bird counts,
            and meetups curated by Birdstar.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="p-5">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2
                  className="size-6 animate-spin text-stone-400 dark:text-stone-500"
                  aria-label="Loading events"
                />
              </div>
            ) : upcoming.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="flex flex-col gap-4">
                {upcoming.map((event) => (
                  <li key={event.id}>
                    <EventCard
                      event={event}
                      onNavigate={() => onOpenChange(false)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface EventCardProps {
  event: BirdstarCalendarEvent;
  /** Called just before navigating, so the drawer can close itself. */
  onNavigate: () => void;
}

function EventCard({ event, onNavigate }: EventCardProps) {
  const navigate = useNavigate();

  const imageUrl = useMemo(
    () => sanitizeImageUrl(event.image),
    [event.image],
  );

  const naddr = useMemo(
    () =>
      nip19.naddrEncode({
        kind: event.kind,
        pubkey: BIRDSTAR_PUBKEY,
        identifier: event.identifier,
      }),
    [event.kind, event.identifier],
  );

  const open = () => {
    onNavigate();
    navigate(`/${naddr}`);
  };

  return (
    <Card className="overflow-hidden border-stone-200/70 bg-white/80 p-0 shadow-sm shadow-stone-900/5 backdrop-blur-sm transition-colors dark:border-indigo-900/40 dark:bg-indigo-950/40">
      <button
        type="button"
        onClick={open}
        aria-label={`View details for ${event.title}`}
        className={cn(
          'group block w-full text-left',
          'transition-transform hover:-translate-y-px',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
          'dark:focus-visible:ring-amber-400/60',
        )}
      >
        {/* Big image — the focal point of each card. */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="h-40 w-full object-cover"
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100 dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60">
            <CalendarDays
              className="size-10 text-emerald-700/70 dark:text-amber-200/70"
              aria-hidden
            />
          </div>
        )}

        {/* Name + date only. */}
        <div className="p-4">
          <h3 className="font-serif text-base font-semibold leading-snug text-stone-900 dark:text-stone-50">
            {event.title}
          </h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-stone-600 dark:text-stone-300">
            {event.allDay ? (
              <CalendarDays className="size-4 shrink-0" aria-hidden />
            ) : (
              <Clock className="size-4 shrink-0" aria-hidden />
            )}
            <span>{formatEventWhen(event)}</span>
          </p>
        </div>
      </button>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed bg-white/40 dark:bg-indigo-950/30">
      <div className="px-8 py-12 text-center">
        <p className="mx-auto max-w-sm text-sm text-stone-600 dark:text-stone-300">
          No upcoming birding events right now. Check back soon — new
          group walks and meetups are added regularly.
        </p>
      </div>
    </Card>
  );
}
