import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

export interface GeoCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

type Status = "idle" | "prompting" | "granted" | "denied" | "error" | "unsupported";

const DEFAULT: GeoCoords = { latitude: 40.7128, longitude: -74.006 }; // New York fallback

export function useGeolocation() {
  const [cached, setCached] = useLocalStorage<GeoCoords | null>("starpoint:geo", null);
  const [coords, setCoords] = useState<GeoCoords>(cached ?? DEFAULT);
  const [status, setStatus] = useState<Status>(cached ? "granted" : "idle");
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
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
      },
      (err) => {
        setError(err.message);
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
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
  }, [setCached]);

  return { coords, status, error, request: start, setManual };
}
