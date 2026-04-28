import type { NostrEvent } from "@nostrify/nostrify";

/** The custom Nostr event kind for user-drawn constellations (see NIP.md). */
export const CUSTOM_CONSTELLATION_KIND = 30621;

/**
 * Wire format for a HIP star reference: a bare decimal string encoding
 * the Hipparcos catalog number (e.g. `"32349"` for Sirius). NIP.md is
 * the canonical source for the semantics — events do not re-describe
 * themselves per edge with a "HIP " prefix.
 */
const HIP_REF_RE = /^\d+$/;

/** Format a HIP number as its canonical wire string (e.g. `"32349"`). */
export function formatHipRef(hip: number): string {
  return String(hip);
}

/**
 * Parse a HIP wire reference into the bare integer. Returns `null` if
 * the value isn't a well-formed decimal string for a positive integer.
 */
export function parseHipRef(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (!HIP_REF_RE.test(value)) return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * A parsed custom constellation as rendered on the sky map.
 * Edges reference stars by their Hipparcos catalog number.
 */
export interface CustomConstellation {
  /** Author's pubkey (hex). */
  pubkey: string;
  /** Slug from the `d` tag. */
  d: string;
  /** Display name. */
  title: string;
  /** Optional description (event content). */
  description: string;
  /** Pairs of HIP numbers forming the figure. */
  edges: Array<[number, number]>;
  /** When the event was created (unix seconds). */
  createdAt: number;
  /** Original event for debugging / zap / etc. */
  event: NostrEvent;
}

/**
 * Parse a raw Nostr event into a CustomConstellation. Returns null if the
 * event is missing required fields or has no valid edges.
 */
export function parseCustomConstellation(
  event: NostrEvent,
): CustomConstellation | null {
  if (event.kind !== CUSTOM_CONSTELLATION_KIND) return null;

  const d = event.tags.find(([n]) => n === "d")?.[1];
  const title = event.tags.find(([n]) => n === "title")?.[1];
  if (!d || !title) return null;

  const edges: Array<[number, number]> = [];
  for (const tag of event.tags) {
    if (tag[0] !== "edge") continue;
    const from = parseHipRef(tag[1]);
    const to = parseHipRef(tag[2]);
    if (from === null || to === null) continue;
    edges.push([from, to]);
  }
  if (edges.length === 0) return null;

  return {
    pubkey: event.pubkey,
    d,
    title,
    description: event.content ?? "",
    edges,
    createdAt: event.created_at,
    event,
  };
}

/**
 * Build the tags array for publishing a custom constellation. Edges are
 * serialized as bare decimal strings of the Hipparcos catalog number.
 */
export function buildConstellationTags(opts: {
  d: string;
  title: string;
  edges: Array<[number, number]>;
}): string[][] {
  const { d, title, edges } = opts;
  return [
    ["d", d],
    ["title", title],
    ["alt", `A custom Starpoint constellation: ${title}`],
    ...edges.map(([a, b]) => ["edge", formatHipRef(a), formatHipRef(b)]),
  ];
}

/** Generate a URL-safe slug from a title. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `constellation-${Math.random().toString(36).slice(2, 8)}`;
}
