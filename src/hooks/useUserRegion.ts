// User-location resolution for the roster + confidence damping.
//
// The flow is:
//   1. On mount, read any cached place set from localStorage and surface
//      it immediately so the roster can render on return visits without
//      re-prompting the user.
//   2. Expose a `request()` callback the UI fires when the user explicitly
//      opts in. This calls `navigator.geolocation.getCurrentPosition`, which
//      triggers the browser's native permission prompt the first time.
//   3. On a successful fix we resolve the lat/lon to a `UserPlaceSet`
//      (continent + country + subdivision where available) and cache it.
//      On denial we record that so we don't re-prompt on every subsequent
//      visit.
//
// We deliberately DO NOT auto-request on mount. A geolocation prompt
// appearing without the user having asked for it is hostile UX.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveUserPlaces,
  placeSetFor,
  type RegionCode,
  type UserPlaceSet,
} from '@/lib/geo/continent';

// v3 key — v2 stored only the resolved place set (continent + country +
// subdivision). v3 additionally persists a *coarse* lat/lon (rounded to
// ~1°, ~100km on a side) so features like the observation-density map
// in BirdInfoDialog can center themselves on the user's region without
// re-prompting for geolocation. Rounding matters: the raw lat/lon from
// `navigator.geolocation` can be accurate to a few meters, which is
// far more precision than we need and far more than we want to keep
// in localStorage. 1° is already coarser than "which country/state"
// (which we store explicitly) and gives plenty of "approximate center
// of my area" for panning a tile map.
//
// Dropping stale v2 entries is cheap (the user just re-grants
// location; the next fix repopulates v3).
const STORAGE_KEY = 'birdsong.userLocation.v3';

export type RegionStatus =
  | 'unknown'
  | 'resolving'
  | 'ready'
  | 'denied'
  | 'unavailable';

/** Coarse geographic center stored with the resolved place set. */
export interface CoarseLatLon {
  /** Latitude rounded to 1° (≈111 km). Range -90..90. */
  lat: number;
  /** Longitude rounded to 1° (≈40–111 km depending on latitude). Range -180..180. */
  lon: number;
}

interface StoredState {
  status: RegionStatus;
  /** Only present when status === 'ready'. */
  continent?: RegionCode;
  country?: string;
  subdivision?: string;
  coarse?: CoarseLatLon;
  resolvedAt?: number;
}

/**
 * Round a geolocation coordinate to the nearest integer degree. This
 * is the precision we persist; anything finer would be leaking more
 * location than the rest of the app actually uses (the place set
 * itself is country/state-level).
 */
function roundCoord(n: number): number {
  // Math.round handles negative values correctly (-0.4 → 0, -0.6 → -1)
  // which is what we want for a symmetric 1° grid.
  return Math.round(n);
}

const VALID_CONTINENTS: RegionCode[] = [
  'NA', 'SA', 'EU', 'AF', 'AS', 'OC', 'AN', 'MARINE',
];

function readStored(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { status, continent, country, subdivision, coarse, resolvedAt } =
      parsed as Partial<StoredState>;
    if (
      status !== 'ready' &&
      status !== 'denied' &&
      status !== 'unavailable'
    ) {
      return null;
    }
    if (status === 'ready') {
      if (
        typeof continent !== 'string' ||
        !VALID_CONTINENTS.includes(continent as RegionCode)
      ) {
        return null;
      }
      // Coarse coords are optional — a v3 entry written through the
      // manual picker path may not carry them (manual picks start
      // from a place code, not a lat/lon). Validate the shape when
      // present and drop it otherwise rather than failing the whole
      // read.
      let validCoarse: CoarseLatLon | undefined;
      if (
        coarse &&
        typeof coarse === 'object' &&
        typeof (coarse as CoarseLatLon).lat === 'number' &&
        typeof (coarse as CoarseLatLon).lon === 'number' &&
        Math.abs((coarse as CoarseLatLon).lat) <= 90 &&
        Math.abs((coarse as CoarseLatLon).lon) <= 180
      ) {
        validCoarse = {
          lat: (coarse as CoarseLatLon).lat,
          lon: (coarse as CoarseLatLon).lon,
        };
      }
      return {
        status,
        continent: continent as RegionCode,
        country: typeof country === 'string' ? country : undefined,
        subdivision: typeof subdivision === 'string' ? subdivision : undefined,
        coarse: validCoarse,
        resolvedAt: typeof resolvedAt === 'number' ? resolvedAt : undefined,
      };
    }
    return { status };
  } catch {
    return null;
  }
}

function writeStored(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota — not fatal; we'll just re-ask next visit.
  }
}

function stateToPlaceSet(state: StoredState): UserPlaceSet | null {
  if (state.status !== 'ready' || !state.continent) return null;
  return placeSetFor(state.continent, state.country, state.subdivision);
}

export interface UseUserRegion {
  /** Resolved continent, or null if not yet known. Back-compat alias for
   * `placeSet?.continent`. */
  region: RegionCode | null;
  /** Full resolved place set (continent + country + subdivision), or
   * null if not yet known. */
  placeSet: UserPlaceSet | null;
  /** Coarse (1°-rounded) lat/lon of the geolocation fix, when
   * available. Only populated when the user resolved their location
   * via the browser's geolocation API — manual-picker resolutions
   * that came in through a different code path may leave this null.
   * Downstream features that need a map center should fall back to a
   * continent/country centroid when this is null. */
  coarse: CoarseLatLon | null;
  status: RegionStatus;
  hasDecided: boolean;
  /** Trigger the geolocation prompt. Safe to call multiple times. */
  request: () => void;
  /** Forget any stored decision so the opt-in affordance returns. */
  reset: () => void;
}

export function useUserRegion(): UseUserRegion {
  const [state, setState] = useState<StoredState>(() => {
    return readStored() ?? { status: 'unknown' };
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commit = useCallback((next: StoredState) => {
    if (!mountedRef.current) return;
    setState(next);
    if (next.status === 'ready' || next.status === 'denied' || next.status === 'unavailable') {
      writeStored(next);
    }
  }, []);

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      commit({ status: 'unavailable' });
      return;
    }
    if (state.status === 'resolving') return;
    setState((prev) => ({ ...prev, status: 'resolving' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const resolved = resolveUserPlaces(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        if (!resolved) {
          commit({ status: 'unavailable' });
          return;
        }
        commit({
          status: 'ready',
          continent: resolved.continent,
          country: resolved.country,
          subdivision: resolved.subdivision,
          // Persist the fix at 1° precision. This is strictly looser
          // than the raw coord we already used to resolve `continent`
          // / `country` / `subdivision` above, so we're not leaking
          // any new information — we're just keeping a coarse center
          // around for downstream features (e.g. the iNat
          // observation-density map in BirdInfoDialog).
          coarse: {
            lat: roundCoord(pos.coords.latitude),
            lon: roundCoord(pos.coords.longitude),
          },
          resolvedAt: Date.now(),
        });
      },
      (err) => {
        if (err.code === 1) {
          commit({ status: 'denied' });
        } else {
          commit({ status: 'unavailable' });
        }
      },
      {
        // Coarse accuracy is fine — we only need country/state-level.
        // Low-accuracy mode skips GPS on mobile and completes from
        // cell/wifi in <1s.
        enableHighAccuracy: false,
        timeout: 10_000,
        // Accept a fix up to an hour old; the user's state-level location
        // won't have changed.
        maximumAge: 60 * 60 * 1000,
      },
    );
  }, [state.status, commit]);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    if (mountedRef.current) {
      setState({ status: 'unknown' });
    }
  }, []);

  const hasDecided =
    state.status === 'ready' ||
    state.status === 'denied' ||
    state.status === 'unavailable';

  const placeSet = stateToPlaceSet(state);

  return {
    region: placeSet?.continent ?? null,
    placeSet,
    coarse: state.coarse ?? null,
    status: state.status,
    hasDecided,
    request,
    reset,
  };
}
