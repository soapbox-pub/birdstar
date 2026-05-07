// User-location resolution for the birdex + confidence damping.
//
// The flow is:
//   1. On mount, read any cached place set from localStorage and surface
//      it immediately so the birdex can render on return visits without
//      re-prompting the user.
//   2. If nothing is cached (status === 'unknown'), automatically fire
//      the geolocation prompt. The birdex can't render without a region,
//      so sitting on an empty page waiting for the user to click a
//      button wastes a round trip — we just ask.
//   3. On a successful fix we resolve the lat/lon to a `UserPlaceSet`
//      (continent + country + subdivision where available) and cache it.
//      On denial we record that so we don't re-prompt on every subsequent
//      visit — the manual-picker fallback takes over instead.
//   4. `request()` is still exported so a "try again" affordance after
//      a denial can re-trigger the prompt.

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
  // Notify observers (e.g. the bottom-of-page LocationDisabledIndicator)
  // that our decision changed. Local storage events don't fire in the
  // same tab, so we piggyback on a custom event instead.
  try {
    window.dispatchEvent(new Event('birdstar:location-change'));
  } catch {
    // SSR / non-browser env — no-op.
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
   * null if not yet known. Stays null when geolocation is denied /
   * unavailable so callers that have their own manual-picker fallback
   * can prefer it; callers without one should read `fallbackPlaceSet`
   * when `usingFallback` is true. */
  placeSet: UserPlaceSet | null;
  /** Continent-level North America place set, populated only when the
   * user has denied geolocation or it is unavailable. Lets UI render
   * a sensible default instead of gating on a missing region. */
  fallbackPlaceSet: UserPlaceSet | null;
  /** Coarse (1°-rounded) lat/lon of the geolocation fix, when
   * available. Only populated when the user resolved their location
   * via the browser's geolocation API — manual-picker resolutions
   * that came in through a different code path may leave this null.
   * Downstream features that need a map center should fall back to a
   * continent/country centroid when this is null. */
  coarse: CoarseLatLon | null;
  status: RegionStatus;
  hasDecided: boolean;
  /** True when geolocation has been declined / is unavailable and
   * `fallbackPlaceSet` is populated. Surface a "location disabled"
   * indicator to the user when this is true. */
  usingFallback: boolean;
  /** Trigger the geolocation prompt. Safe to call multiple times. */
  request: () => void;
  /** Commit a manually-chosen lat/lon (e.g. from a pin-drop map in
   * settings). Resolves the coordinates to a continent/country/
   * subdivision place set the same way an auto-resolved GPS fix
   * would, and persists a 1°-rounded `coarse` value so
   * location-dependent features (observation map, species bands,
   * geohash publishing) pick up the change. Returns true if the
   * coordinates resolved to a known place; false otherwise (e.g.
   * a point in the middle of the ocean without a containing box). */
  setManualCoords: (latitude: number, longitude: number) => boolean;
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
    try {
      window.dispatchEvent(new Event('birdstar:location-change'));
    } catch {
      // SSR / non-browser env — no-op.
    }
    if (mountedRef.current) {
      setState({ status: 'unknown' });
    }
  }, []);

  // Manual pin-drop from the settings map. Resolves the lat/lon to a
  // place set the same way an auto-resolved GPS fix would, then
  // commits both the resolved places and a 1°-rounded `coarse`
  // coordinate so downstream features (observation map, species
  // bands, geohash publishing) pick up the change immediately.
  //
  // Returns `false` when `resolveUserPlaces` can't locate the input
  // (e.g. open-ocean coordinate outside every known box). Callers
  // can show a tiny "out of range" hint — but the map's own
  // world-wrap + bounded zoom should already keep users out of
  // obviously-nonsense territory. In practice NA/EU/AS/etc. land
  // resolves fine.
  const setManualCoords = useCallback(
    (latitude: number, longitude: number): boolean => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return false;
      }
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        return false;
      }
      const resolved = resolveUserPlaces(latitude, longitude);
      if (!resolved) return false;
      commit({
        status: 'ready',
        continent: resolved.continent,
        country: resolved.country,
        subdivision: resolved.subdivision,
        coarse: {
          lat: roundCoord(latitude),
          lon: roundCoord(longitude),
        },
        resolvedAt: Date.now(),
      });
      return true;
    },
    [commit],
  );

  // Auto-prompt on mount when there's no cached decision. We key the
  // effect on `state.status === 'unknown'` so a subsequent `reset()`
  // (status → 'unknown') will re-prompt too.
  //
  // Guards:
  //   - Only fire for 'unknown'. A stored 'denied' or 'unavailable'
  //     entry means the user has already said no (or the browser can't
  //     resolve them); re-prompting would be hostile.
  //   - Uses a ref so the effect stays dep-stable across renders of
  //     `request` (which changes whenever `state.status` changes).
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  }, [request]);
  useEffect(() => {
    if (state.status === 'unknown') {
      requestRef.current();
    }
  }, [state.status]);

  // Also re-resolve on mount when we came up with a 'ready' fix from
  // the cache. The cached place set is what the user saw last time —
  // but they may have physically moved since (e.g. flew to another
  // country), and without this refresh we'd keep them stuck on their
  // old region until they manually reset.
  //
  // We deliberately DON'T go through `request()` here, because that
  // flips status to 'resolving' and would make `resolvedPlaceSet`
  // transiently null — the UI would briefly swap from "my real
  // region" to the NA fallback, then back, which is worse than the
  // bug we're fixing. Instead, fire `getCurrentPosition` directly
  // and only commit a new state when we actually have a fresh fix
  // (or a denial). On error we keep the cached fix in place.
  //
  // Only runs once on mount. `commit` isn't listed as a dep because
  // we capture it via ref — listing it would re-fire this effect
  // on every render of the parent. A `didRunRef` guard makes this
  // safe under React 18 strict-mode double-mount.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  const didRefreshRef = useRef(false);
  useEffect(() => {
    if (didRefreshRef.current) return;
    didRefreshRef.current = true;
    if (readStored()?.status !== 'ready') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const resolved = resolveUserPlaces(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        if (!resolved) return;
        commitRef.current({
          status: 'ready',
          continent: resolved.continent,
          country: resolved.country,
          subdivision: resolved.subdivision,
          coarse: {
            lat: roundCoord(pos.coords.latitude),
            lon: roundCoord(pos.coords.longitude),
          },
          resolvedAt: Date.now(),
        });
      },
      () => {
        // Background refresh failed (permission revoked since last
        // visit, transient timeout, etc). Keep the cached fix in
        // place — showing the old region is better than dumping the
        // user back to a continent fallback.
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 60 * 60 * 1000,
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const hasDecided =
    state.status === 'ready' ||
    state.status === 'denied' ||
    state.status === 'unavailable';

  // When the user has declined or we can't resolve a fix, `placeSet`
  // stays null — callers that already have a manual-picker fallback
  // (e.g. BirdsIndex) can prefer that over the continent default.
  // Callers with no manual fallback should read `fallbackPlaceSet`
  // when `usingFallback` is true so the UI keeps rendering against
  // a sensible default (continent-level North America) instead of
  // gating on a missing region.
  //
  // `fallbackPlaceSet` is ALSO populated while the decision is still
  // pending ('unknown' / 'resolving'). First-time visitors land on a
  // birdex populated with North American species immediately instead
  // of a skeleton; when their real geolocation resolves a moment
  // later the `placeSet` upgrade transparently swaps in their true
  // region's birds. If it resolves to denied/unavailable the NA
  // fallback just stays put. `usingFallback` remains tied to the
  // "actually declined" states so the LocationDisabledIndicator
  // doesn't flash on a normal grant path.
  const resolvedPlaceSet = stateToPlaceSet(state);
  const usingFallback =
    !resolvedPlaceSet &&
    (state.status === 'denied' || state.status === 'unavailable');
  const fallbackPlaceSet =
    resolvedPlaceSet ? null : placeSetFor('NA');

  return {
    region: resolvedPlaceSet?.continent ?? null,
    placeSet: resolvedPlaceSet,
    fallbackPlaceSet,
    coarse: state.coarse ?? null,
    status: state.status,
    hasDecided,
    usingFallback,
    request,
    setManualCoords,
    reset,
  };
}
