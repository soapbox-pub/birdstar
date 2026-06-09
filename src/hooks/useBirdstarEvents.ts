// Loads NIP-52 calendar events (date-based kind 31922 and time-based
// kind 31923) published by the official Birdstar account. These are
// surfaced in Birds mode as a "Birding events near you" section so
// people can find real-world meetups, group walks, and bird counts to
// attend.
//
// Only events authored by BIRDSTAR_PUBKEY are queried — calendar
// events are addressable (kinds 30000–39999), so the `d` tag alone is
// not a trust boundary. Filtering by `authors` is what makes this a
// curated, spoof-proof list (see AGENTS.md "Nostr Security Model").
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

/** Official Birdstar account that curates community birding events. */
export const BIRDSTAR_PUBKEY =
  '26c71ddc66f279347fb15bdcd18f385b5766a943e61cf82b5b64c3675e415997';

const DATE_BASED_KIND = 31922;
const TIME_BASED_KIND = 31923;

const MAX_EVENTS = 100;

export interface BirdstarCalendarEvent {
  /** Stable key for React lists — derived from the event id. */
  id: string;
  /** The underlying Nostr event id. */
  eventId: string;
  /** 31922 (date-based) or 31923 (time-based). */
  kind: number;
  /** The `d` identifier, needed to build an naddr / link. */
  identifier: string;
  title: string;
  summary: string | null;
  image: string | null;
  location: string | null;
  /** Long-form description from the event content. */
  description: string;
  /**
   * Event start, in ms since epoch. For date-based events this is
   * midnight UTC of the start date; for time-based events it's the
   * Unix start timestamp.
   */
  startMs: number;
  /** Event end in ms since epoch, when present. */
  endMs: number | null;
  /** True for all-day / multi-day (date-based, kind 31922) events. */
  allDay: boolean;
}

function firstTag(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find(([n]) => n === name);
  const value = tag?.[1];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Validate + normalize a calendar event into a UI shape. Returns null
 * for anything that doesn't carry the required NIP-52 tags (`d`,
 * `title`, `start`) or whose `start` can't be parsed for its kind.
 */
function eventToCalendarEvent(
  event: NostrEvent,
): BirdstarCalendarEvent | null {
  if (event.kind !== DATE_BASED_KIND && event.kind !== TIME_BASED_KIND) {
    return null;
  }

  const identifier = firstTag(event, 'd');
  const title = firstTag(event, 'title') ?? firstTag(event, 'name');
  const start = firstTag(event, 'start');
  if (!identifier || !title || !start) return null;

  const allDay = event.kind === DATE_BASED_KIND;

  let startMs: number;
  let endMs: number | null = null;
  const end = firstTag(event, 'end');

  if (allDay) {
    // Date-based: ISO 8601 date (YYYY-MM-DD). Parse as UTC midnight so
    // the day doesn't drift across time zones.
    const startDate = Date.parse(`${start}T00:00:00Z`);
    if (Number.isNaN(startDate)) return null;
    startMs = startDate;
    if (end) {
      const endDate = Date.parse(`${end}T00:00:00Z`);
      if (!Number.isNaN(endDate)) endMs = endDate;
    }
  } else {
    // Time-based: Unix timestamp in seconds.
    const startSec = Number.parseInt(start, 10);
    if (!Number.isFinite(startSec)) return null;
    startMs = startSec * 1000;
    if (end) {
      const endSec = Number.parseInt(end, 10);
      if (Number.isFinite(endSec)) endMs = endSec * 1000;
    }
  }

  return {
    id: `event-${event.id}`,
    eventId: event.id,
    kind: event.kind,
    identifier,
    title,
    summary: firstTag(event, 'summary') ?? null,
    image: firstTag(event, 'image') ?? null,
    location: firstTag(event, 'location') ?? null,
    description: event.content ?? '',
    startMs,
    endMs,
    allDay,
  };
}

export interface BirdstarEventsResult {
  /** Upcoming events, soonest-first. */
  upcoming: BirdstarCalendarEvent[];
  isLoading: boolean;
}

export function useBirdstarEvents(): BirdstarEventsResult {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['birdstar-events'],
    staleTime: 1000 * 60 * 5, // 5 minutes — events change rarely
    queryFn: async ({ signal }) => {
      // Combine both calendar-event kinds in one filter and split
      // client-side, constrained to the curated Birdstar author.
      const events = await nostr.query(
        [
          {
            kinds: [DATE_BASED_KIND, TIME_BASED_KIND],
            authors: [BIRDSTAR_PUBKEY],
            limit: MAX_EVENTS,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      // Capture "now" at fetch time so the render-time transform that
      // filters out past events stays pure (no Date.now() in useMemo).
      return { events, fetchedAt: Date.now() };
    },
  });

  const fetchedAt = query.data?.fetchedAt ?? 0;

  return useMemo<BirdstarEventsResult>(() => {
    const events = query.data?.events ?? [];

    // Addressable events: keep only the newest revision per `d` tag.
    const latestByAddr = new Map<string, NostrEvent>();
    for (const event of events) {
      const d = firstTag(event, 'd');
      if (!d) continue;
      const key = `${event.kind}:${d}`;
      const existing = latestByAddr.get(key);
      if (!existing || event.created_at > existing.created_at) {
        latestByAddr.set(key, event);
      }
    }

    // Hide events that have already finished. We compare against the
    // event end when present, otherwise the start. Date-based events
    // are treated as lasting their whole final day. `now` is captured
    // in the queryFn (not here) so this transform stays pure.
    const dayMs = 24 * 60 * 60 * 1000;

    const upcoming: BirdstarCalendarEvent[] = [];
    for (const event of latestByAddr.values()) {
      const cal = eventToCalendarEvent(event);
      if (!cal) continue;
      const effectiveEnd =
        cal.endMs ?? (cal.allDay ? cal.startMs + dayMs : cal.startMs);
      if (effectiveEnd < fetchedAt) continue;
      upcoming.push(cal);
    }

    upcoming.sort((a, b) => a.startMs - b.startMs);

    return {
      upcoming,
      isLoading: query.isLoading,
    };
  }, [query.data, query.isLoading, fetchedAt]);
}
