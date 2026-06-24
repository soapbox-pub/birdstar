import { nip19 } from "nostr-tools";

import type { Mode } from "@/contexts/ModeContext";
import { CUSTOM_CONSTELLATION_KIND } from "@/lib/customConstellations";
import { isCalendarEventKind } from "@/hooks/useBirdstarEvents";

/**
 * Stars-only overlay path prefixes declared in `AppRouter.tsx`.
 *
 * Each of these renders `Index`, which then opens a detail sheet over
 * the sky map via `useOpenedView`. In Birds mode they have no visual
 * effect — the overlay simply doesn't appear — so cold-loading them
 * in Birds is meaningless and confusing.
 */
const STARS_OVERLAY_PREFIXES = [
  "/star/",
  "/zodiac/",
  "/planet/",
] as const;

/** Stars-only single-segment paths. */
const STARS_OVERLAY_EXACT = new Set(["/sun", "/moon"]);

/**
 * Decide whether a pathname unambiguously implies Stars mode at cold
 * load time. Returns `"stars"` for routes that *only* make sense over
 * the sky map, and `null` otherwise — meaning "no preference, defer to
 * the user's stored choice".
 *
 * Used by `ModeProvider` to override the persisted mode on first
 * render when the URL is a Stars-only deep link (e.g. `/zodiac/aries`
 * shared from another device). The override is in-memory only: the
 * user's `birdstar:mode` localStorage value is untouched, so the next
 * cold-load of `/` still resumes their last explicit choice.
 *
 * `/bird/:slug` (the shareable bird-detail deep link) is forced to
 * Birds — the bird dialog only mounts there, so cold-loading a shared
 * bird URL in Stars would show nothing.
 *
 * Otherwise Birds is never forced from the URL — `/` is the only other
 * Birds entry point, and `/` defers to the stored mode (which already
 * defaults to Birds on a fresh install).
 *
 * The npub/nprofile case is intentionally left to the stored mode:
 * profile sheets exist in both Birds (via the LoginArea author menu)
 * and Stars (via the sky overlay), so the path alone doesn't disambiguate.
 * `naddr` identifiers for custom constellations
 * (kind {@link CUSTOM_CONSTELLATION_KIND}) are forced to Stars; `naddr`
 * identifiers for Birdstar calendar events (kinds 31922/31923) are
 * forced to Birds, since the event detail sheet only mounts there.
 */
export function modeFromPath(pathname: string): Mode | null {
  if (STARS_OVERLAY_EXACT.has(pathname)) return "stars";
  for (const prefix of STARS_OVERLAY_PREFIXES) {
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
      return "stars";
    }
  }

  // `/bird/:slug` — shareable bird-detail deep link. Forced to Birds
  // since the bird dialog only mounts there.
  if (pathname.startsWith("/bird/") && pathname.length > "/bird/".length) {
    return "birds";
  }

  // `/:nip19Id` — naddrs for custom constellations force Stars, and
  // naddrs for Birdstar calendar events force Birds. Everything else
  // (npub, nprofile, malformed) defers to stored mode; NIP19Page itself
  // 404s the unsupported cases.
  const nip19Match = /^\/([a-z0-9]+)$/i.exec(pathname);
  if (nip19Match) {
    const id = nip19Match[1];
    // Cheap prefix gate before attempting full bech32 decode. Other
    // single-segment routes (e.g. `/privacy`) are declared above
    // `/:nip19Id` in AppRouter and don't reach this path matcher in
    // practice, but the prefix check makes the helper safe to call
    // for any pathname.
    if (!id.startsWith("naddr1")) return null;
    try {
      const decoded = nip19.decode(id);
      if (decoded.type === "naddr") {
        if (decoded.data.kind === CUSTOM_CONSTELLATION_KIND) {
          return "stars";
        }
        if (isCalendarEventKind(decoded.data.kind)) {
          return "birds";
        }
      }
    } catch {
      // fall through
    }
  }

  return null;
}
