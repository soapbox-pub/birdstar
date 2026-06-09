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
import { encodeGeohash, geohashNeighbors } from '@/lib/geo/geohash';
import type { CoarseLatLon } from '@/lib/geo/coarsen';

/** Official Birdstar account that curates community birding events. */
export const BIRDSTAR_PUBKEY =
  '26c71ddc66f279347fb15bdcd18f385b5766a943e61cf82b5b64c3675e415997';

/** NIP-52 date-based (all-day / multi-day) calendar event. */
export const DATE_BASED_KIND = 31922;
/** NIP-52 time-based calendar event. */
export const TIME_BASED_KIND = 31923;

/** The calendar-event kinds this app renders. */
export const CALENDAR_EVENT_KINDS = [DATE_BASED_KIND, TIME_BASED_KIND] as const;

/** True for any kind this app treats as a Birdstar calendar event. */
export function isCalendarEventKind(kind: number): boolean {
  return kind === DATE_BASED_KIND || kind === TIME_BASED_KIND;
}

const MAX_EVENTS = 100;

/**
 * Geohash precision used for the "Nearby" filter. The Birdstar curator
 * tags every event with a ladder of `g` prefixes (lengths 2–7); a
 * length-3 prefix is a ~150 km cell, which matches "events I could
 * realistically travel to" without being so tight that a metro spills
 * across the boundary. We also query the eight neighboring cells (see
 * {@link geohashNeighbors}) so an event just over a grid edge from the
 * user isn't dropped.
 */
const NEARBY_GEOHASH_PRECISION = 3;

/** How the events list is scoped. */
export type EventScope = 'nearby' | 'world';

/**
 * Build the set of length-3 geohash prefixes to match against the
 * event `#g` tags for a "Nearby" query: the user's own cell plus its
 * eight neighbors. Returns null when we can't derive a geohash (no
 * coordinate), which the hook treats as "fall back to World".
 */
function nearbyGeohashes(coarse: CoarseLatLon | null): string[] | null {
  if (!coarse) return null;
  try {
    const center = encodeGeohash(
      coarse.lat,
      coarse.lon,
      NEARBY_GEOHASH_PRECISION,
    );
    return geohashNeighbors(center);
  } catch {
    // Coordinate out of range / unencodable — treat as no location.
    return null;
  }
}

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
export function eventToCalendarEvent(
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
  /**
   * The scope actually in effect. This can differ from the requested
   * scope: asking for `'nearby'` without a usable location silently
   * falls back to `'world'` so the list is never empty just because we
   * don't know where the user is.
   */
  effectiveScope: EventScope;
}

export interface UseBirdstarEventsOptions {
  /** Requested scope. Defaults to `'world'`. */
  scope?: EventScope;
  /**
   * Coarse (1°-rounded) user location, used to build the geohash
   * filter for `'nearby'`. When absent, a `'nearby'` request falls
   * back to `'world'`.
   */
  coarse?: CoarseLatLon | null;
}

export function useBirdstarEvents(
  options: UseBirdstarEventsOptions = {},
): BirdstarEventsResult {
  const { nostr } = useNostr();
  const { scope = 'world', coarse = null } = options;

  // Build the nearby geohash set (center + 8 neighbors). When this is
  // null — no coordinate, or a requested scope of 'world' — we query
  // the whole curated list. `effectiveScope` reflects what we actually
  // did so callers can tailor empty-state copy.
  const geohashes = scope === 'nearby' ? nearbyGeohashes(coarse) : null;
  const effectiveScope: EventScope = geohashes ? 'nearby' : 'world';

  // Stable, primitive cache key for the geohash set so the query only
  // refetches when the cells actually change.
  const geohashKey = geohashes ? geohashes.join(',') : null;

  const query = useQuery({
    queryKey: ['birdstar-events', geohashKey],
    staleTime: 1000 * 60 * 5, // 5 minutes — events change rarely
    queryFn: async ({ signal }) => {
      // Combine both calendar-event kinds in one filter and split
      // client-side, constrained to the curated Birdstar author. For a
      // nearby query we additionally constrain on the `#g` geohash tag;
      // relays index single-letter tags, so this filtering happens at
      // the relay rather than client-side.
      const events = await nostr.query(
        [
          {
            kinds: [DATE_BASED_KIND, TIME_BASED_KIND],
            authors: [BIRDSTAR_PUBKEY],
            ...(geohashes ? { '#g': geohashes } : {}),
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
      effectiveScope,
    };
  }, [query.data, query.isLoading, fetchedAt, effectiveScope]);
}

export interface BirdstarEventByAddrResult {
  event: BirdstarCalendarEvent | null;
  isLoading: boolean;
}

/**
 * Fetch a single calendar event by its addressable coordinates
 * (kind + `d` identifier). Used to resolve cold deep-links to
 * `/{naddr}` when the event isn't already in the cached list.
 *
 * The author is hard-pinned to {@link BIRDSTAR_PUBKEY} regardless of
 * the `pubkey` embedded in the naddr — only Birdstar-authored events
 * are renderable, so a deep-link claiming some other author resolves
 * to "not found" rather than rendering spoofed content.
 */
export function useBirdstarEventByAddr(
  kind: number | undefined,
  identifier: string | undefined,
): BirdstarEventByAddrResult {
  const { nostr } = useNostr();

  const enabled =
    typeof kind === 'number' &&
    isCalendarEventKind(kind) &&
    typeof identifier === 'string' &&
    identifier.length > 0;

  const query = useQuery({
    queryKey: ['birdstar-event', kind, identifier],
    enabled,
    staleTime: 1000 * 60 * 5,
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [
          {
            kinds: [kind as number],
            authors: [BIRDSTAR_PUBKEY],
            '#d': [identifier as string],
            limit: 1,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      return events;
    },
  });

  return useMemo<BirdstarEventByAddrResult>(() => {
    const events = query.data ?? [];
    // Newest revision wins.
    let latest: NostrEvent | null = null;
    for (const event of events) {
      if (!latest || event.created_at > latest.created_at) latest = event;
    }
    const event = latest ? eventToCalendarEvent(latest) : null;
    return {
      event,
      isLoading: enabled && query.isLoading,
    };
  }, [query.data, query.isLoading, enabled]);
}
