// Stars-side geolocation hook. Feeds lat/lon to astronomy math
// (`equatorialToHorizontal`), the sky map, and the settings-sheet
// pin-drop picker. Backs onto `useSharedLocation` so manual pins set
// in Birds settings propagate to Stars and vice versa — see that
// module for the storage shape and migration notes.
//
// Public API is kept stable (`coords`, `status`, `error`, `request`,
// `setManual`, `usingFallback`) so existing call sites in
// `StarsIndex`, `SkyBackdrop`, `SunDetailSheet`, and
// `PlanetDetailSheet` don't need to change.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSharedLocation,
  type SharedLocation,
} from "@/hooks/useSharedLocation";

export interface GeoCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

type Status = "idle" | "prompting" | "granted" | "denied" | "error" | "unsupported";

// North America fallback: ~geographic center of the contiguous United
// States (Lebanon, KS, per USGS). Picked as a politically-neutral,
// continent-ish center so the sky map has something reasonable to render
// when the user declines location access. `usingFallback` surfaces a
// flag so UI can tell the user the sky is being drawn for a default
// location, not their real one.
const NORTH_AMERICA_DEFAULT: GeoCoords = { latitude: 39.8283, longitude: -98.5795 };

function toGeoCoords(loc: SharedLocation): GeoCoords {
  return {
    latitude: loc.latitude,
    longitude: loc.longitude,
    accuracy: loc.accuracy,
  };
}

export function useGeolocation() {
  const { location, setLocation } = useSharedLocation();

  const [coords, setCoords] = useState<GeoCoords>(() =>
    location ? toGeoCoords(location) : NORTH_AMERICA_DEFAULT,
  );
  const [status, setStatus] = useState<Status>(location ? "granted" : "idle");
  const [error, setError] = useState<string | null>(null);
  // True whenever `coords` is the North-America fallback rather than
  // a real fix (either from a browser prompt or a manual pin). Flips
  // back to false on a successful geolocation or manual set.
  const [usingFallback, setUsingFallback] = useState<boolean>(!location);

  // Keep local state in sync with the shared store when it changes
  // out-of-band (e.g. the Birds settings pin-drop updates the shared
  // location while this hook is mounted, or a sibling tab writes a
  // new fix). This is a classic "derived state" pattern — we mirror
  // the external value into the local `coords`/`status` triad so the
  // component can optimistically flip to `prompting` / `denied`
  // locally during a request without racing the shared-store write.
  //
  // Done via an in-render state adjustment (rather than useEffect)
  // so the update is eager — the first paint already reflects the
  // new value instead of flashing the stale one for a frame. React
  // handles this idiomatically: a setState during render with a
  // different value re-renders the same component synchronously
  // before committing.
  const [prevLocation, setPrevLocation] = useState(location);
  if (location !== prevLocation) {
    setPrevLocation(location);
    if (location) {
      setCoords(toGeoCoords(location));
      setStatus("granted");
      setUsingFallback(false);
    }
  }

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      setCoords((prev) => prev ?? NORTH_AMERICA_DEFAULT);
      setUsingFallback(true);
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
        setLocation({
          latitude: c.latitude,
          longitude: c.longitude,
          accuracy: c.accuracy,
          source: "gps",
          updatedAt: Date.now(),
        });
        setStatus("granted");
        setUsingFallback(false);
      },
      (err) => {
        setError(err.message);
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        // Fall back to the North America default so the sky map still
        // draws something. Don't write to the shared store — next
        // visit we'd rather the browser's own permission state drive
        // the behavior than have a stale "granted" flag.
        setCoords(NORTH_AMERICA_DEFAULT);
        setUsingFallback(true);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    );
  }, [setLocation]);

  // Silent background refresh on mount when we started from a cached
  // fix. Users who move between sessions (e.g. fly to another city)
  // would otherwise stay pinned to their old coords forever — the
  // hook starts in status='granted' so nothing would ever re-prompt
  // the browser. We deliberately DON'T go through `start()` here
  // because that flips status to 'prompting' and, on error, clobbers
  // `coords` with the NA fallback — which would be a UI regression
  // (a real cached fix swapped out for Lebanon, KS just because a
  // background refresh timed out). On success we commit the fresh
  // fix; on error we silently keep the cached one.
  //
  // maximumAge: 0 — we explicitly want a fresh fix from the device,
  // not whatever the browser has cached internally. This is the
  // whole point of the refresh.
  //
  // `setLocation` is stable (memoized by `useSharedLocation`), so we
  // can list it in deps safely. A `didRefreshRef` guard keeps us
  // mount-only under React 18 strict-mode double-mount.
  const didRefreshRef = useRef(false);
  useEffect(() => {
    if (didRefreshRef.current) return;
    didRefreshRef.current = true;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    // Only refresh if we had a prior fix to begin with — otherwise
    // the caller's normal "idle → request" path handles first-time
    // prompts. Reading the shared store here (rather than closing
    // over `location`) avoids re-running the effect when the value
    // arrives asynchronously from the migration path.
    if (!location) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const c: GeoCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setCoords(c);
        setLocation({
          latitude: c.latitude,
          longitude: c.longitude,
          accuracy: c.accuracy,
          source: "gps",
          updatedAt: Date.now(),
        });
        setStatus("granted");
        setUsingFallback(false);
      },
      () => {
        // Background refresh failed — keep the cached fix.
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15_000 },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setManual = useCallback(
    (c: GeoCoords) => {
      setCoords(c);
      setLocation({
        latitude: c.latitude,
        longitude: c.longitude,
        accuracy: c.accuracy,
        source: "manual",
        updatedAt: Date.now(),
      });
      setStatus("granted");
      setUsingFallback(false);
    },
    [setLocation],
  );

  return { coords, status, error, request: start, setManual, usingFallback };
}
