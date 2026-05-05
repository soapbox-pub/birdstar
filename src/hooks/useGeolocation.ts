import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export interface GeoCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

type Status = "idle" | "prompting" | "granted" | "denied" | "error" | "unsupported";

// North America fallback: ~geographic center of the contiguous United
// States (Lebanon, KS, per USGS). Picked as a politically-neutral,
// continent-ish center so the sky map has something reasonable to render
// when the user declines location access. `useFallback()` surfaces a
// flag so UI can tell the user the sky is being drawn for a default
// location, not their real one.
const NORTH_AMERICA_DEFAULT: GeoCoords = { latitude: 39.8283, longitude: -98.5795 };

/** Fire the custom event the `LocationDisabledIndicator` listens for.
 * Kept local to avoid a cross-module import between hook and component. */
function notifyLocationChange(): void {
  try {
    window.dispatchEvent(new Event('birdstar:location-change'));
  } catch {
    // SSR / non-browser env — no-op.
  }
}

export function useGeolocation() {
  const [cached, setCached] = useLocalStorage<GeoCoords | null>("starpoint:geo", null);
  const [coords, setCoords] = useState<GeoCoords>(cached ?? NORTH_AMERICA_DEFAULT);
  const [status, setStatus] = useState<Status>(cached ? "granted" : "idle");
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  // True whenever `coords` is the North-America fallback rather than
  // a real fix (either from a browser prompt or a manual pin). Flips
  // back to false on a successful geolocation or manual set.
  const [usingFallback, setUsingFallback] = useState<boolean>(!cached);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      // Ensure we have a usable fallback so Stars still renders.
      setCoords((prev) => prev ?? NORTH_AMERICA_DEFAULT);
      setUsingFallback(true);
      notifyLocationChange();
      return;
    }
    setStatus("prompting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c: GeoCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setCoords(c);
        setCached(c);
        setStatus("granted");
        setUsingFallback(false);
        notifyLocationChange();
      },
      (err) => {
        setError(err.message);
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        // Fall back to the North America default so the sky map still
        // draws something. Don't cache — next visit we'd rather the
        // browser's own permission state drive the behavior than have
        // a stale "granted" flag.
        setCoords(NORTH_AMERICA_DEFAULT);
        setUsingFallback(true);
        notifyLocationChange();
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    );
  }, [setCached]);

  // Clean up watch on unmount
  useEffect(() => {
    const ref = watchIdRef;
    return () => {
      if (ref.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(ref.current);
      }
    };
  }, []);

  const setManual = useCallback((c: GeoCoords) => {
    setCoords(c);
    setCached(c);
    setStatus("granted");
    setUsingFallback(false);
    notifyLocationChange();
  }, [setCached]);

  return { coords, status, error, request: start, setManual, usingFallback };
}
