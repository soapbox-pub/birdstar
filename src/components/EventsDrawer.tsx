// "Birding events" drawer — a right-side sheet listing upcoming
// NIP-52 calendar events (kinds 31922/31923) curated by the official
// Birdstar account, so people can find real-world meetups and group
// walks to attend.
//
// Opened from a calendar icon button in the Birds-mode HUD (mirroring
// the constellation/Sparkles button in Stars mode). Each card is a big
// image with the event name, date, and city; tapping navigates to the
// event's `/{naddr}`, which BirdsIndex resolves into the
// EventDetailSheet.
//
// A "Nearby / World" dropdown in the header scopes the list. Nearby
// matches the curator's `g` (geohash) tags against the user's coarse
// location (a ~150 km cell plus its eight neighbors); it falls back to
// World automatically when we don't yet know where the user is.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { CalendarDays, Clock, Loader2, MapPin } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatEventWhen,
  sanitizeImageUrl,
  type BirdstarCalendarEvent,
} from '@/components/communityEventUtils';
import {
  BIRDSTAR_PUBKEY,
  useBirdstarEvents,
  type EventScope,
} from '@/hooks/useBirdstarEvents';
import { useUserRegion } from '@/hooks/useUserRegion';
import { cn } from '@/lib/utils';

interface EventsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventsDrawer({ open, onOpenChange }: EventsDrawerProps) {
  // Default to "Nearby"; the hook falls back to World when there's no
  // usable location, and `effectiveScope` reflects what actually ran.
  const [scope, setScope] = useState<EventScope>('nearby');

  const { coarse } = useUserRegion();
  const { upcoming, isLoading, effectiveScope } = useBirdstarEvents({
    scope,
    coarse,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-stone-200/70 bg-white p-0 text-stone-900 sm:max-w-md dark:border-indigo-900/40 dark:bg-[#13112e] dark:text-stone-100"
      >
        <SheetHeader className="shrink-0 border-b border-stone-200/70 px-5 pb-4 pt-5 text-left dark:border-indigo-900/40">
          {/* Title row — the Sheet's close (X) button floats at the
              top-right of the content, so keep this row to the title
              alone and put the scope dropdown on the line below where
              the description used to sit, clear of the X. */}
          <SheetTitle className="flex items-center gap-2 font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
            <CalendarDays
              className="size-5 text-emerald-600 dark:text-amber-300"
              aria-hidden
            />
            Birding events
          </SheetTitle>

          {/* Kept for screen readers; the visible affordance is the
              scope dropdown below. */}
          <SheetDescription className="sr-only">
            Go outside and meet other birders — group walks, bird counts,
            and meetups curated by Birdstar.
          </SheetDescription>

          <div className="mt-2">
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as EventScope)}
            >
              <SelectTrigger
                className="h-9 w-[7.25rem] border-stone-200/70 bg-white/80 text-stone-700 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-stone-200"
                aria-label="Filter events by location"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nearby">Nearby</SelectItem>
                <SelectItem value="world">World</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
              <EmptyState
                requestedScope={scope}
                effectiveScope={effectiveScope}
              />
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

        {/* Name, date, and city. */}
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
          {event.location ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
              <MapPin className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{event.location}</span>
            </p>
          ) : null}
        </div>
      </button>
    </Card>
  );
}

interface EmptyStateProps {
  requestedScope: EventScope;
  effectiveScope: EventScope;
}

function EmptyState({ requestedScope, effectiveScope }: EmptyStateProps) {
  // When the user asked for "Nearby" and we actually ran a nearby
  // query (location known), tell them so — an empty list means
  // "nothing close by" rather than "nothing anywhere". If they asked
  // for nearby but we fell back to world (no location), show the
  // generic copy.
  const nearbyActive =
    requestedScope === 'nearby' && effectiveScope === 'nearby';

  return (
    <Card className="border-dashed bg-white/40 dark:bg-indigo-950/30">
      <div className="px-8 py-12 text-center">
        <p className="mx-auto max-w-sm text-sm text-stone-600 dark:text-stone-300">
          {nearbyActive
            ? 'No upcoming birding events near you yet. Switch to “World” to see meetups everywhere, or check back soon.'
            : 'No upcoming birding events right now. Check back soon — new group walks and meetups are added regularly.'}
        </p>
      </div>
    </Card>
  );
}
