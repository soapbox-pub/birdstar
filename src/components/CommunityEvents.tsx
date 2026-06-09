// "Birding events near you" — a curated list of NIP-52 calendar events
// (date-based kind 31922 and time-based kind 31923) published by the
// official Birdstar account, surfaced in Birds mode so people can find
// real-world meetups, group walks, and bird counts to attend.
//
// Modeled on BirdFeed's presentational style: a vertical list of
// translucent cards that matches the light (stone/emerald/amber) and
// dark (indigo/violet) Birds palettes. Unlike BirdFeed this section
// shows loading skeletons and an empty state, because it's a
// deliberately-curated list rather than incidental social content —
// "no upcoming events" is a meaningful, non-misleading answer.
//
// Each card links out to njump.me for the full event detail (the
// in-app NIP-19 router only renders profiles and constellations), so
// the addressable event opens in a Nostr-aware viewer.
import { useMemo } from 'react';
import { nip19 } from 'nostr-tools';
import { CalendarDays, Clock, ExternalLink, MapPin } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BIRDSTAR_PUBKEY,
  useBirdstarEvents,
  type BirdstarCalendarEvent,
} from '@/hooks/useBirdstarEvents';
import { cn } from '@/lib/utils';

/**
 * https-only URL allowlist for event-sourced image URLs. Even though
 * these events come from the trusted Birdstar pubkey, sanitizing
 * defends against a compromised key injecting a `javascript:` or
 * `data:` URL into an <img src>.
 */
function sanitizeImageUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function CommunityEvents() {
  const { upcoming, isLoading } = useBirdstarEvents();

  return (
    <>
      <SectionHeader />
      {isLoading ? (
        <EventListSkeleton />
      ) : upcoming.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {upcoming.map((event) => (
            <li key={event.id}>
              <EventRow event={event} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SectionHeader() {
  return (
    <div className="mb-4">
      <h2 className="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
        Birding events near you
      </h2>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
        Go outside and meet other birders — group walks, bird counts,
        and meetups curated by Birdstar.
      </p>
    </div>
  );
}

function EventRow({ event }: { event: BirdstarCalendarEvent }) {
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

  return (
    <Card className="overflow-hidden border-stone-200/70 bg-white/80 shadow-sm shadow-stone-900/5 backdrop-blur-sm transition-colors dark:border-indigo-900/40 dark:bg-indigo-950/40">
      <a
        href={`https://njump.me/${naddr}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`View details for ${event.title}`}
        className={cn(
          'flex w-full items-stretch gap-3 p-3 text-left',
          'transition-transform hover:-translate-y-px',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
          'dark:focus-visible:ring-amber-400/60',
        )}
      >
        {/* Date chip (left) or event image when one is provided. */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="size-16 shrink-0 rounded-lg object-cover ring-1 ring-stone-200/70 dark:ring-indigo-900/40"
          />
        ) : (
          <DateChip event={event} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900 dark:text-stone-50">
              {event.title}
            </h3>
            <ExternalLink
              className="mt-0.5 size-4 shrink-0 text-stone-400 dark:text-stone-500"
              aria-hidden
            />
          </div>

          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
            {event.allDay ? (
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <Clock className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">{formatWhen(event)}</span>
          </p>

          {event.location ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{event.location}</span>
            </p>
          ) : null}

          {event.summary ? (
            <p className="mt-1 line-clamp-2 text-xs text-stone-600 dark:text-stone-300">
              {event.summary}
            </p>
          ) : null}
        </div>
      </a>
    </Card>
  );
}

/** Compact calendar-page-style date chip used when an event has no image. */
function DateChip({ event }: { event: BirdstarCalendarEvent }) {
  const date = new Date(event.startMs);
  const month = date
    .toLocaleDateString(undefined, { month: 'short' })
    .toUpperCase();
  const day = date.getDate();

  return (
    <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100 ring-1 ring-stone-200/70 dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60 dark:ring-indigo-900/40">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-amber-200">
        {month}
      </span>
      <span className="text-2xl font-bold leading-none text-stone-900 dark:text-stone-50">
        {day}
      </span>
    </div>
  );
}

function EventListSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i}>
          <Card className="overflow-hidden border-stone-200/70 bg-white/80 backdrop-blur-sm dark:border-indigo-900/40 dark:bg-indigo-950/40">
            <div className="flex items-center gap-3 p-3">
              <Skeleton className="size-16 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
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

/**
 * Human-readable "when" line. Date-based events show a date (or date
 * range); time-based events show a date + time.
 */
function formatWhen(event: BirdstarCalendarEvent): string {
  const start = new Date(event.startMs);

  if (event.allDay) {
    const startLabel = start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    if (event.endMs) {
      // Date-based `end` is exclusive — the last attended day is the
      // day before. Show the inclusive range.
      const lastDay = new Date(event.endMs - 24 * 60 * 60 * 1000);
      if (lastDay.getTime() > start.getTime()) {
        const endLabel = lastDay.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        return `${startLabel} – ${endLabel}`;
      }
    }
    return startLabel;
  }

  const dateLabel = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeLabel = start.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${dateLabel} · ${timeLabel}`;
}
