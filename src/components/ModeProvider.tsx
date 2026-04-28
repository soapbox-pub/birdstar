import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type EffectiveMode,
  type Mode,
  ModeContext,
} from "@/contexts/ModeContext";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { equatorialToHorizontal } from "@/lib/astronomy";
import { sunPosition } from "@/lib/sun";

const STORAGE_KEY = "birdstar:mode";

/**
 * `"auto"` maps to birds while the sun is above the horizon and stars
 * while it is below. This threshold (0°) is the geometric horizon —
 * civil twilight isn't a meaningful cutoff for this app's purposes
 * (you can reasonably start bird-listening as soon as the sun clears
 * the horizon, and stars are the draw the moment it's fully below).
 *
 * A small hysteresis band would be overkill: the whole point of Auto
 * is that the user doesn't care about the transition. They can flip
 * to Birds or Stars explicitly if they want to override.
 */
const DAY_NIGHT_THRESHOLD_DEG = 0;

/**
 * How often we re-evaluate the sun's altitude while in Auto mode.
 * Five minutes is plenty granular — the sun moves ~1.25°/5min at the
 * equator and less at higher latitudes, so we'll never miss a
 * transition by more than a couple minutes of the actual event.
 */
const AUTO_RECHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Compute whether it's daytime at the given coordinates right now.
 * Uses Starpoint's sun-position math + equatorial → horizontal
 * conversion — the same code that drives where the sun appears on
 * the sky map in star mode.
 */
function isDaytime(lat: number, lon: number, date: Date = new Date()): boolean {
  const { ra, dec } = sunPosition(date);
  const { alt } = equatorialToHorizontal(ra, dec, lat, lon, date);
  return alt > DAY_NIGHT_THRESHOLD_DEG;
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useLocalStorage<Mode>(STORAGE_KEY, "auto");

  // Auto needs a location to decide day vs night. We piggyback on
  // starpoint's geolocation hook — it returns a cached-or-default
  // coordinate immediately (New York as the fallback) and refines it
  // once the browser grants permission, so `coords` is always usable.
  const { coords } = useGeolocation();

  // Recompute daytime every few minutes. The timer is kept cheap: a
  // single interval at module level, restarted only when the source
  // coords actually change.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), AUTO_RECHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const effectiveMode = useMemo<EffectiveMode>(() => {
    if (mode === "birds" || mode === "stars") return mode;
    return isDaytime(coords.latitude, coords.longitude, now)
      ? "birds"
      : "stars";
  }, [mode, coords.latitude, coords.longitude, now]);

  const setMode = useCallback(
    (m: Mode) => setModeState(m),
    [setModeState],
  );

  const value = useMemo(
    () => ({ mode, effectiveMode, setMode }),
    [mode, effectiveMode, setMode],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}
