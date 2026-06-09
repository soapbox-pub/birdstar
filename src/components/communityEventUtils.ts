// Shared helpers for rendering Birdstar calendar events (NIP-52
// kinds 31922/31923) in the events drawer and the individual event
// detail sheet.
import type { BirdstarCalendarEvent } from '@/hooks/useBirdstarEvents';

export type { BirdstarCalendarEvent };

/**
 * https-only URL allowlist for event-sourced image URLs. Even though
 * these events come from the trusted Birdstar pubkey, sanitizing
 * defends against a compromised key injecting a `javascript:` or
 * `data:` URL into an <img src>.
 */
export function sanitizeImageUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Human-readable "when" line. Date-based events show a date (or date
 * range); time-based events show a date + time.
 */
export function formatEventWhen(event: BirdstarCalendarEvent): string {
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
