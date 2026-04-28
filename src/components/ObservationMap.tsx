// Interactive observation-density map for BirdInfoDialog.
//
// Shows iNaturalist's observation grid overlaid on a CARTO basemap,
// centered on the user's region when they've granted geolocation.
// Grid cells communicate species range viscerally: at a glance the
// user can tell whether the bird they're looking at is plausibly
// findable "around here", and density patterns remain readable even
// for hyper-abundant species like American Robin.
//
// Why /grid/ and not /colored_heatmap/: the colored-heatmap endpoint
// renders solid-colored splats that merge into opaque walls for
// common species — a Northern Cardinal's eastern US range becomes
// one indecipherable red blob hiding the entire basemap. The /grid/
// endpoint instead tiles the world into discrete squares colored by
// density, so the basemap always shows through the gaps and the
// user can actually tell which cities are inside the range. It's
// the right primitive for a field-guide map.
//
// Implementation: vanilla Leaflet with two raster TileLayers, mounted
// imperatively in a useEffect so React rerenders don't rebuild the
// whole map. We avoid react-leaflet because the ref/lifecycle
// integration there has historically been fragile across version
// bumps, and the whole map fits in ~80 lines of plain Leaflet calls.
//
// Interaction trade-offs:
//
//   - `scrollWheelZoom` starts DISABLED. Otherwise scrolling the
//     dialog with the wheel over the map would zoom the map instead
//     of scrolling the dialog, which is infuriating on desktop.
//     After the user clicks the map (signaling "I want to interact
//     with this"), we enable it; it re-disables when they click
//     outside.
//   - Pinch zoom (touch) stays enabled — pinch doesn't conflict
//     with scroll on mobile, and it's the expected gesture.
//   - `dragging` is on so users can pan.
//   - Zoom is clamped to [2, 12]. Zoom 2 = whole world (useful for
//     globally-distributed seabirds); 12 ≈ city block (beyond this
//     the grid gets too granular to be informative and iNat
//     starts returning blank tiles).
//
// "You are here" marker: when `coarse` is present (meaning the user
// granted geolocation), we drop a pulsing blue dot at that fix.
// Critically we DON'T render the marker when falling back to a
// continent centroid — a pin sitting in "middle of North America"
// would be a lie. Marker is a plain CSS-styled DivIcon so we don't
// need to ship Leaflet's default PNG marker assets (which would
// otherwise 404 without extra Vite-side config).
//
// Dark mode treatment: rather than loading a second basemap tile
// set (CARTO's `dark_all`), we apply a CSS filter to the basemap
// TileLayer's DOM container that inverts + hue-rotates it. The iNat
// grid sits in its own pane above the filtered base layer so the
// colored density squares keep their warm colours. This halves
// network load compared to dual-basemap and avoids a flash-of-wrong-
// theme during theme switches.
//
// Privacy: the map center comes from `useUserRegion().coarse`, which
// is a 1°-rounded (≈100 km) lat/lon persisted alongside the place
// set. Strictly coarser than the country/subdivision we already
// derive from the same fix, so no new location is revealed by this
// feature. Manual-picker users who never granted geolocation fall
// back to a per-continent centroid (roughly "middle of your
// continent"), which is good enough to show iNat's grid in a
// useful frame.
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInatTaxonId } from '@/hooks/useInatTaxonId';
import { useUserRegion, type CoarseLatLon } from '@/hooks/useUserRegion';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Continent-level centroids used when the user hasn't granted
 * geolocation (e.g. they only set their location via the manual
 * picker, which doesn't give us a lat/lon). Rough values, rounded to
 * the nearest 5 degrees — the goal is "show a useful chunk of the
 * right continent", not to pinpoint centers exactly.
 */
const CONTINENT_CENTROIDS: Record<string, CoarseLatLon> = {
  NA: { lat: 40, lon: -100 }, // Central US / southern Canada
  SA: { lat: -15, lon: -60 }, // Central Brazil / Amazon basin
  EU: { lat: 50, lon: 15 },   // Central Europe
  AF: { lat: 0, lon: 20 },    // Central Africa
  AS: { lat: 35, lon: 100 },  // Central Asia
  OC: { lat: -25, lon: 135 }, // Central Australia
  AN: { lat: -80, lon: 0 },   // Antarctica (won't have useful bird data but completeness)
  MARINE: { lat: 0, lon: 0 }, // Null island; marine birds are everywhere
};

/**
 * Default zoom levels for the two location scenarios. When we have a
 * real geolocation fix from the user we zoom in to ~metro-area scale
 * (8), which is close enough for "this is where I am" to feel
 * personal and wide enough that the iNat grid has some density to
 * show. When we're falling back to a continent centroid we start
 * wider (5) since the marker is meaningless and the user wants to
 * orient by range, not personal location.
 */
const LOCATED_ZOOM = 8;
const FALLBACK_ZOOM = 5;
const MIN_ZOOM = 2;
const MAX_ZOOM = 12;

interface ObservationMapProps {
  scientificName: string | null;
}

export function ObservationMap({ scientificName }: ObservationMapProps) {
  const { data: taxonId, isLoading: isTaxonLoading } =
    useInatTaxonId(scientificName);
  const { coarse, region } = useUserRegion();

  // Pick the map center. Priority: geolocation coarse fix → continent
  // centroid → NA (the default user base skews Americas, and iNat's
  // grid is densest there anyway so this produces a useful view
  // even for users with no location data).
  //
  // `hasRealFix` gates both the "you are here" marker (don't lie
  // about location) and the initial zoom level (tighter when we
  // actually know where you are, looser when we're guessing at
  // continental scale).
  const { center, hasRealFix } = useMemo<{
    center: CoarseLatLon;
    hasRealFix: boolean;
  }>(() => {
    if (coarse) return { center: coarse, hasRealFix: true };
    if (region && CONTINENT_CENTROIDS[region]) {
      return { center: CONTINENT_CENTROIDS[region], hasRealFix: false };
    }
    return { center: CONTINENT_CENTROIDS.NA, hasRealFix: false };
  }, [coarse, region]);

  const initialZoom = hasRealFix ? LOCATED_ZOOM : FALLBACK_ZOOM;

  // Whether the user has "engaged" the map (clicked inside it at
  // least once). Controls scrollWheelZoom: disabled by default so
  // scrolling the dialog doesn't get hijacked, enabled once they've
  // committed to interacting.
  const [engaged, setEngaged] = useState(false);

  // Flipped by the init effect once Leaflet actually mounted on a
  // sized container. Pure trigger for the downstream heatmap /
  // center / engagement effects — a ref write alone wouldn't
  // re-run them. Starts false so the taxon-id effect doesn't try
  // to attach a layer to a nonexistent map.
  const [mapReady, setMapReady] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const gridLayerRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  // Create the map once the container has a measurable size. Radix's
  // DialogContent mounts with a zoom/slide animation, so on our
  // initial effect tick the container element has 0×0 dimensions —
  // Leaflet caches that as `map._size = (0, 0)` and subsequently
  // refuses to draw any tiles, leaving us with the symptom the user
  // saw: an empty <div class="h-full w-full">. Solution: use
  // ResizeObserver to defer init until we see a non-zero width, then
  // stay subscribed so we can `invalidateSize()` if the container is
  // resized later (e.g. phone rotation, window resize, dialog
  // reflow).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Teardown state captured so the cleanup function can access
    // whatever we created regardless of what the effect ran up to.
    let observer: ResizeObserver | null = null;
    let map: L.Map | null = null;

    const initIfReady = () => {
      if (map) return; // already initialised
      const { width, height } = el.getBoundingClientRect();
      if (width < 1 || height < 1) return;

      map = L.map(el, {
        center: [center.lat, center.lon],
        zoom: initialZoom,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: false,
        worldCopyJump: true,
      });

      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        {
          subdomains: 'abcd',
          maxZoom: 19,
          className: 'carto-basemap-tiles',
        },
      ).addTo(map);

      const onEngage = () => setEngaged(true);
      map.on('click', onEngage);
      map.on('dragstart', onEngage);
      map.on('zoomstart', onEngage);

      mapRef.current = map;
      // Trigger the subsequent effects (heatmap layer, center
      // update, engagement toggle) now that the ref is populated.
      // React doesn't re-run those effects on ref writes, so we
      // need this state bump to nudge them into action.
      setMapReady(true);
    };

    // Try immediately in case the container already has a size
    // (common when reopening a dialog whose first open warmed up
    // the layout).
    initIfReady();

    // If not yet sized, watch for the first non-zero layout.
    if (!map) {
      observer = new ResizeObserver(() => {
        initIfReady();
        // Even after init, keep the observer alive so we can call
        // invalidateSize on subsequent resizes — Leaflet doesn't
        // notice container resizes on its own and would otherwise
        // render blank strips along new edges.
        if (map) map.invalidateSize();
      });
      observer.observe(el);
    }

    return () => {
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
      gridLayerRef.current = null;
      userMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update view when the map center changes (e.g. geolocation
  // resolves after dialog opens). Uses `setView` rather than
  // recreating the map to keep any in-progress user interaction
  // intact.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Only re-center if the user hasn't engaged yet. After they pan
    // or zoom, moving the view out from under them would be rude.
    if (engaged) return;
    map.setView([center.lat, center.lon], initialZoom, { animate: false });
  }, [center, engaged, initialZoom, mapReady]);

  // Toggle scroll-wheel zoom based on engagement.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (engaged) {
      map.scrollWheelZoom.enable();
    } else {
      map.scrollWheelZoom.disable();
    }
  }, [engaged, mapReady]);

  // Manage the iNat observation grid layer. Create/replace it
  // whenever the taxon id resolves or changes.
  //
  // /grid/ endpoint vs /colored_heatmap/ endpoint: grid returns
  // discrete colored squares (one per cell of iNat's internal spatial
  // index) where the color reflects observation density in that cell.
  // Crucially the cells have transparent gaps between them, so the
  // basemap shows through and you can still see city/geography
  // context even in a species' core range. The colored_heatmap
  // endpoint returns solid splats that form opaque walls for
  // abundant species — exactly the "Northern Cardinal eastern US
  // blob hiding everything" problem the user flagged.
  //
  // Opacity 0.75: the grid is already gappy, but dropping a bit
  // below full opacity lets strong basemap features (coastlines,
  // major cities) read through even under the densest cells. Above
  // 0.8 you start losing that context; below 0.6 the grid looks
  // washed out and hard to read.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Drop the previous layer first so stacking order stays clean
    // (otherwise switching species would leave the old layer on
    // top of the new one for a frame).
    if (gridLayerRef.current) {
      gridLayerRef.current.remove();
      gridLayerRef.current = null;
    }

    if (taxonId == null) return;

    const layer = L.tileLayer(
      `https://api.inaturalist.org/v1/grid/{z}/{x}/{y}.png?taxon_id=${taxonId}`,
      {
        maxZoom: 21,
        opacity: 0.75,
        className: 'inat-grid-tiles',
      },
    );
    layer.addTo(map);
    gridLayerRef.current = layer;
  }, [taxonId, mapReady]);

  // Manage the "you are here" marker. Only shown when we have a
  // real geolocation fix (hasRealFix), never on the continent-
  // centroid fallback where a pin would misrepresent where the
  // user is. Rebuilt whenever the coarse fix changes so a
  // late-arriving geolocation result updates cleanly.
  //
  // Uses a CSS-only DivIcon (no PNG) so we don't need to bundle or
  // configure Leaflet's default marker assets (which otherwise 404
  // under Vite without extra fiddling). The pulsing ring is a pure
  // CSS animation, cheap to run.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Always tear down the previous marker first. Marker additions
    // are cheap; the key thing is not accumulating stale markers
    // across re-runs when the user's coarse fix changes.
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }

    if (!hasRealFix) return;

    const icon = L.divIcon({
      className: 'user-location-marker',
      // Two nested elements: an outer pulsing ring + a solid inner
      // dot. The outer ring animates scale + opacity so the whole
      // thing reads as a "radar ping" style locator without needing
      // JS for the animation.
      html: `
        <span class="relative flex h-3 w-3">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60"></span>
          <span class="relative inline-flex h-3 w-3 rounded-full bg-sky-500 ring-2 ring-white shadow-md"></span>
        </span>
      `,
      iconSize: [12, 12],
      // Anchor at the center of the 12×12 icon so the dot sits
      // exactly on the user's coordinates.
      iconAnchor: [6, 6],
    });

    const marker = L.marker([center.lat, center.lon], {
      icon,
      // Non-interactive: the marker is a pure location indicator,
      // not a clickable feature. Prevents it from eating clicks that
      // should pan the map or hit the heatmap below.
      interactive: false,
      keyboard: false,
      // Above the grid overlay so it's always visible.
      zIndexOffset: 1000,
    });
    marker.addTo(map);
    userMarkerRef.current = marker;
  }, [center, hasRealFix, mapReady]);

  // The map container is always rendered so the init effect can
  // attach to it. While we're still resolving the taxon id AND the
  // map hasn't finished initialising, we show a skeleton OVERLAY on
  // top of the container — not instead of it — so ResizeObserver
  // still gets a real DOM node to size-check. Gating behind
  // `!mapReady` (not `mapRef`) so a re-render doesn't flip the
  // overlay back on after init completed.
  const showSkeletonOverlay = isTaxonLoading && !mapReady;

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-xl border border-stone-200/70',
        // Shorter than square: a full aspect-square ate a lot of
        // dialog real estate and pushed the description below the
        // fold. 16:10 gives enough vertical room to read north/south
        // range at a glance while keeping the "you are here" dot +
        // song player visible in the same viewport on most phones.
        'aspect-16/10 bg-stone-100',
        'dark:border-indigo-900/60 dark:bg-indigo-950/40',
        // Dark-mode tint applied to the basemap tile layer's DOM
        // subtree. Targets the class we set on the CARTO TileLayer
        // above; the iNat grid layer has a different class and
        // is unaffected, so the warm observation density squares
        // keep their natural colours.
        '[&_.carto-basemap-tiles]:dark:filter-[invert(0.92)_hue-rotate(180deg)_brightness(0.9)]',
      )}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* Skeleton overlay while we're still resolving the taxon.
          Sits above the (basemap-only) map so the user sees
          activity instead of a loaded basemap with no dots. Goes
          away as soon as the iNat taxon id resolves and the
          grid layer mounts. */}
      {showSkeletonOverlay ? (
        <Skeleton className="absolute inset-0 rounded-xl" />
      ) : null}
    </div>
  );
}

/**
 * URLs for the tile providers we render in {@link ObservationMap},
 * exposed so the host dialog can render attribution credits in its
 * own shared footer instead of forcing the map to render its own
 * caption line right underneath. Licensing ToS requires these links
 * be visible and clickable somewhere in the UI where the map is
 * shown — wherever the host chooses to put them is fine.
 */
// Fast-refresh: tolerate this one non-component export. Moving it to a
// separate file would fragment the map's public API for a single HMR hint.
// eslint-disable-next-line react-refresh/only-export-components
export const MAP_ATTRIBUTION = {
  carto: 'https://carto.com/attributions',
  osm: 'https://www.openstreetmap.org/copyright',
  inat: (taxonId: number) => `https://www.inaturalist.org/taxa/${taxonId}`,
} as const;
