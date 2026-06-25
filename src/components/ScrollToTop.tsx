import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Routes that render the persistent `Index` page and merely open a
 * dialog / sheet *over* it (bird detail, star/zodiac/planet/sun/moon
 * sheets, and every NIP-19 identifier — profiles, constellations,
 * events). Navigating between these is not a real page transition: the
 * underlying checklist or sky map stays mounted and the user's scroll
 * position should be preserved, exactly as it would be if the overlay
 * were opened from local state instead of the URL.
 *
 * `/` and `/privacy` (and the 404) are the only genuine page surfaces;
 * `/` is the bare overlay-less Index, so returning to it from an open
 * overlay is also a "close the dialog" action, not a page change.
 */
function isOverlayPath(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname === '/sun' || pathname === '/moon') return true;
  for (const prefix of ['/bird/', '/star/', '/zodiac/', '/planet/']) {
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
      return true;
    }
  }
  // `/:nip19Id` — a single path segment with no slash. Covers npub /
  // nprofile / note / nevent / naddr overlays. `/privacy` is also a
  // single segment but is explicitly a real page, so exclude it.
  if (pathname === '/privacy') return false;
  return /^\/[^/]+$/.test(pathname);
}

/**
 * Scroll the window to the top on real page transitions only.
 *
 * Opening or closing a dialog/sheet — which in this app is expressed as
 * a URL change to one of the {@link isOverlayPath} routes — must NOT
 * yank the page back to the top: the content behind the overlay is the
 * same scrollable surface the user was just looking at. We therefore
 * only reset scroll when navigating to a route that is a genuine
 * separate page (e.g. `/privacy`, the 404).
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    const from = prevPathname.current;
    prevPathname.current = pathname;

    // No scroll reset when either endpoint of the navigation is an
    // overlay over the persistent Index page — that's a dialog
    // open/close, not a page change.
    if (isOverlayPath(pathname) || isOverlayPath(from)) return;

    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
