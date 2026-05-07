// Single source of truth for the user's location across the app.
//
// Before this hook existed, Birdstar had two independent location
// stores: `starpoint:geo` (full precision, read by Stars) and
// `birdsong.userLocation.v3.coarse` (1°-rounded, read by Birds).
// They never synced — setting your pin in Birds wouldn't update the
// Stars sky, and vice versa — and Birds persisted already-coarsened
// coords, so there was no way to recover the precise fix if we ever
// wanted it (e.g. for Stars-side astronomy).
//
// This module consolidates that into one key at full precision. The
// individual feature hooks — `useGeolocation` (Stars coords) and
// `useUserRegion` (Birds region) — now read from here and coarsen
// at their boundaries via `src/lib/geo/coarsen.ts`. The precise
// value is only ever exposed to consumers that demonstrably need it
// (astronomy math, map centering); anything that leaves the device
// goes through `coarsen()` first.
//
// Storage format:
//
//   - Key: `birdstar:location.v1` (bumped from the legacy
//     `starpoint:geo` / `birdsong.userLocation.v3` keys; see the
//     migration block in `readStored` for how we fold those in on
//     first load).
//   - Shape: SharedLocation (below). `source` distinguishes a fresh
//     GPS fix from a manual pin-drop so UI can reason about which
//     affordances to surface; `updatedAt` lets downstream code
//     decide when a cached value is too old to trust.

import { useCallback, useEffect, useRef, useState } from 'react';

/** localStorage key for the consolidated location. */
const STORAGE_KEY = 'birdstar:location.v1';

/** Legacy keys we read once for migration. */
const LEGACY_STARPOINT_KEY = 'starpoint:geo';
const LEGACY_BIRDSONG_KEY = 'birdsong.userLocation.v3';

/** Event dispatched on `window` when the shared location changes. The
 * `LocationDisabledIndicator` + other cross-component listeners
 * subscribe to this to re-render without a full app round-trip. */
export const LOCATION_CHANGE_EVENT = 'birdstar:location-change';

export interface SharedLocation {
  /** Full-precision latitude, as returned by `navigator.geolocation`
   * (or a manual pin-drop). NOT suitable for anything that leaves
   * the device — coarsen via `coarsen()` first. */
  latitude: number;
  /** Full-precision longitude. Same privacy caveat. */
  longitude: number;
  /** Reported accuracy from the geolocation fix, in meters. Omitted
   * for manual pin-drops. */
  accuracy?: number;
  /** Where this value came from. 'gps' means the browser resolved it
   * via `navigator.geolocation`; 'manual' means the user committed
   * a pin-drop from the settings map. Surface-level semantics only
   * — the shape and precision are identical either way. */
  source: 'gps' | 'manual';
  /** Wall-clock ms since epoch when this value was last written.
   * Consumers can use this to decide if a cached fix is too old to
   * trust for things like "are they still in that city". */
  updatedAt: number;
}

/**
 * Type guard for the stored shape. Rejects entries with invalid
 * lat/lon so stale/corrupt entries don't poison downstream hooks.
 */
function isValidStored(value: unknown): value is SharedLocation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SharedLocation>;
  if (typeof v.latitude !== 'number' || !Number.isFinite(v.latitude)) return false;
  if (typeof v.longitude !== 'number' || !Number.isFinite(v.longitude)) return false;
  if (Math.abs(v.latitude) > 90 || Math.abs(v.longitude) > 180) return false;
  if (v.source !== 'gps' && v.source !== 'manual') return false;
  if (typeof v.updatedAt !== 'number') return false;
  return true;
}

/** Read the current value, migrating legacy keys on first touch. */
function readStored(): SharedLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isValidStored(parsed)) return parsed;
      // Fall through to migration if the stored value is malformed.
    }
  } catch {
    // JSON parse / quota error — try migration.
  }

  // Migration path: prefer the Stars key (full precision) over the
  // Birds key (1°-rounded) when both exist, since the Stars one
  // retains more information. Either way, we treat a migrated entry
  // as `source: 'gps'` — we can't tell from the old shape whether
  // the user set it manually, but the distinction only affects UI
  // semantics, not correctness. The next GPS fix or manual pin-drop
  // will rewrite `source` accurately.
  const migrated = readLegacyStarpoint() ?? readLegacyBirdsong();
  if (migrated) {
    writeStored(migrated);
    return migrated;
  }
  return null;
}

function readLegacyStarpoint(): SharedLocation | null {
  try {
    const raw = localStorage.getItem(LEGACY_STARPOINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { latitude, longitude, accuracy } = parsed as Partial<SharedLocation>;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return {
      latitude,
      longitude,
      accuracy: typeof accuracy === 'number' ? accuracy : undefined,
      source: 'gps',
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function readLegacyBirdsong(): SharedLocation | null {
  try {
    const raw = localStorage.getItem(LEGACY_BIRDSONG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as { coarse?: { lat?: unknown; lon?: unknown } };
    const lat = obj.coarse?.lat;
    const lon = obj.coarse?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    // The Birds legacy key only stored 1°-rounded values, so the
    // migrated fix is intrinsically coarse. That's fine — it's a
    // valid SharedLocation, just with less precision than a fresh
    // GPS fix would give. The next geolocation refresh on mount
    // (see `useGeolocation`) will replace it with full precision.
    return {
      latitude: lat,
      longitude: lon,
      source: 'gps',
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function writeStored(value: SharedLocation): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota / private mode — not fatal; the in-memory value is still
    // authoritative for the current session.
  }
  notifyLocationChange();
}

function clearStored(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notifyLocationChange();
}

/** Fire the custom event cross-component listeners subscribe to. */
function notifyLocationChange(): void {
  try {
    window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
  } catch {
    // SSR / non-browser env — no-op.
  }
}

export interface UseSharedLocation {
  /** Current value, or null when the user has never resolved a
   * location (fresh install, or explicit clear). */
  location: SharedLocation | null;
  /** Overwrite the stored value. Takes the full `SharedLocation`
   * shape so callers are forced to think about `source` —
   * accidentally writing a manual pin as `gps` (or vice versa)
   * would mislead downstream UI. */
  setLocation: (value: SharedLocation) => void;
  /** Remove the stored value entirely. Used when the user revokes
   * permission and we want to stop serving a stale fix. */
  clearLocation: () => void;
}

/**
 * Subscribe to the shared location. Changes propagate within the
 * same tab via {@link LOCATION_CHANGE_EVENT}, and across tabs via
 * the native `storage` event.
 */
export function useSharedLocation(): UseSharedLocation {
  const [location, setLocationState] = useState<SharedLocation | null>(() =>
    readStored(),
  );

  // Resync on cross-tab writes + same-tab custom events. Using a ref
  // to avoid capturing a stale `readStored` in the listener closure;
  // `readStored` itself is module-scoped so this is mostly belt-and-
  // braces.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key !== STORAGE_KEY &&
        e.key !== LEGACY_STARPOINT_KEY &&
        e.key !== LEGACY_BIRDSONG_KEY
      ) {
        return;
      }
      if (!mountedRef.current) return;
      setLocationState(readStored());
    };
    const handleCustom = () => {
      if (!mountedRef.current) return;
      setLocationState(readStored());
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(LOCATION_CHANGE_EVENT, handleCustom);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(LOCATION_CHANGE_EVENT, handleCustom);
    };
  }, []);

  const setLocation = useCallback((value: SharedLocation) => {
    writeStored(value);
    setLocationState(value);
  }, []);

  const clearLocation = useCallback(() => {
    clearStored();
    setLocationState(null);
  }, []);

  return { location, setLocation, clearLocation };
}

/**
 * Non-hook read of the current shared location. Useful for migration
 * shims and tests. Prefer {@link useSharedLocation} inside components.
 */
export function getSharedLocation(): SharedLocation | null {
  return readStored();
}
