// Small location map + GPS re-request button for the Birds/Stars
// settings sheets.
//
// Shows a CARTO basemap centered on the user's current location with
// a "you are here" marker. The bottom-right crosshair button re-
// triggers `navigator.geolocation` so users whose device position
// drifted (e.g. they flew somewhere) can refresh without leaving the
// sheet.
//
// Deliberately narrower in scope than `ObservationMap`:
//   - No iNat grid layer, no taxon lookup.
//   - No "engagement" dance for scrollWheelZoom — this component
//     lives in a Sheet with its own scroll container.
//   - No attribution block: the settings sheet already links to a
//     `CopyrightDialog` at the bottom, which is where the CARTO /
//     OSM attribution belongs.
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LatLon {
  lat: number;
  lon: number;
}

interface LocationPickerMapProps {
  /** Center the map on this coordinate (also where the "you are here"
   * dot is drawn, when `showMarker` is true). */
  center: LatLon;
  /** Whether to draw the "you are here" dot. Set false when `center`
   * is a fallback centroid rather than a real fix — a pin sitting in
   * "middle of your continent" would misrepresent where the user is. */
  showMarker: boolean;
  /** Fire `navigator.geolocation.getCurrentPosition` and persist the
   * result as the user's location. Called when the user taps the
   * bottom-right crosshair button. */
  onRequestGeo: () => void;
  /** True while a geolocation request is in flight. Swaps the
   * crosshair icon for a spinner and disables the button so
   * double-taps don't fire a second prompt. */
  isRequestingGeo?: boolean;
  /** Visual theme. Dark applies CSS filters to the basemap tiles
   * matching the parent sheet's palette (Stars) while light leaves
   * them untouched (Birds). */
  theme?: 'light' | 'dark';
  className?: string;
}

// Zoom levels matching ObservationMap's semantics: 8 ≈ metro area
// (close enough for "here I am" to feel personal), 5 ≈ continent
// (used as a looser default when we don't have a real fix yet and
// the marker will be hidden).
const LOCATED_ZOOM = 8;
const FALLBACK_ZOOM = 5;
const MIN_ZOOM = 2;
const MAX_ZOOM = 15;

export function LocationPickerMap({
  center,
  showMarker,
  onRequestGeo,
  isRequestingGeo = false,
  theme = 'light',
  className,
}: LocationPickerMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Init the map once the container has a measurable size (same
  // pattern as ObservationMap — Radix's Sheet mounts with an
  // animation, so the container is 0×0 on the first effect tick
  // and Leaflet would cache that and refuse to draw tiles).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let observer: ResizeObserver | null = null;
    let map: L.Map | null = null;

    const initIfReady = () => {
      if (map) return;
      const { width, height } = el.getBoundingClientRect();
      if (width < 1 || height < 1) return;

      map = L.map(el, {
        center: [center.lat, center.lon],
        zoom: showMarker ? LOCATED_ZOOM : FALLBACK_ZOOM,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        zoomControl: false,
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

      mapRef.current = map;
      setMapReady(true);
    };

    initIfReady();

    if (!map) {
      observer = new ResizeObserver(() => {
        initIfReady();
        if (map) map.invalidateSize();
      });
      observer.observe(el);
    }

    return () => {
      observer?.disconnect();
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Only initialize once — center updates are handled by the effect
    // below, which calls setView without rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center when `center` changes (e.g. geolocation just resolved
  // after the sheet opened). Skips the animation so the map doesn't
  // slide away under the user if they're interacting.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([center.lat, center.lon], map.getZoom(), { animate: false });
  }, [center, mapReady]);

  // Manage the "you are here" marker. Same CSS-DivIcon approach as
  // ObservationMap so we don't ship Leaflet's default PNG assets.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (!showMarker) return;

    const icon = L.divIcon({
      className: 'user-location-marker',
      html: `
        <span class="relative flex h-3 w-3">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60"></span>
          <span class="relative inline-flex h-3 w-3 rounded-full bg-sky-500 ring-2 ring-white shadow-md"></span>
        </span>
      `,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    const marker = L.marker([center.lat, center.lon], {
      icon,
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    });
    marker.addTo(map);
    markerRef.current = marker;
  }, [center, showMarker, mapReady]);

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-xl border',
        'aspect-16/10',
        theme === 'dark'
          ? 'border-white/10 bg-slate-900'
          : 'border-stone-200/70 bg-stone-100 dark:border-indigo-900/60 dark:bg-indigo-950/40',
        // Match ObservationMap's dark-mode basemap filter so the CARTO
        // light tiles fit a dark UI without loading a second tile set.
        theme === 'dark'
          ? '[&_.carto-basemap-tiles]:filter-[invert(0.92)_hue-rotate(180deg)_brightness(0.9)]'
          : '[&_.carto-basemap-tiles]:dark:filter-[invert(0.92)_hue-rotate(180deg)_brightness(0.9)]',
        className,
      )}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* Re-request GPS button. Bottom-right, same square size as a
          Leaflet zoom control so it reads as part of the map chrome.
          z-[1000] so it sits above every Leaflet pane (the highest
          built-in is the popup pane at z-index 700) and the Leaflet
          control container (z-index 800); without this the button
          renders *behind* the tiles and appears invisible. */}
      <Button
        type="button"
        size="icon"
        variant="secondary"
        onClick={onRequestGeo}
        disabled={isRequestingGeo}
        aria-label="Use my current location"
        className={cn(
          'absolute bottom-2 right-2 z-[1000] h-8 w-8 rounded-md shadow',
          theme === 'dark'
            ? 'bg-slate-900/90 border border-white/15 text-white hover:bg-slate-800'
            : 'bg-white/95 border border-stone-300 text-stone-900 hover:bg-white',
        )}
      >
        {isRequestingGeo ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Crosshair className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
