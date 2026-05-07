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
//      (continent + country + subdivision where available), persist the
//      resolved places here and the precise lat/lon to
//      `useSharedLocation`. On denial we record that so we don't
//      re-prompt on every subsequent visit — the manual-picker fallback
//      takes over instead.
//   4. `request()` is still exported so a "try again" affordance after
//      a denial can re-trigger the prompt.
//
// Storage responsibilities:
//
//   - This module's own key (`birdsong.userLocation.v3`) stores only
//     the resolved *place set* plus the user's grant decision — no
//     coordinates. v3 entries written by earlier versions carry a
//     `coarse` field; we still tolerate those on read (for forward
//     compat with un-migrated entries) but we no longer write one.
//   - The precise lat/lon lives in `useSharedLocation`
//     (`birdstar:location.v1`). `coarse` is exposed here as a derived
//     value: we call `coarsen()` on the shared lat/lon each render,
//     so the privacy boundary is enforced in one place even as
//     storage evolves.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveUserPlaces,
  placeSetFor,
  type RegionCode,
  type UserPlaceSet,
} from '@/lib/geo/continent';
import {
  coarsen,
  type CoarseLatLon,
} from '@/lib/geo/coarsen';
import {
  useSharedLocation,
  LOCATION_CHANGE_EVENT,
} from '@/hooks/useSharedLocation';

// Re-exported so existing consumers that import `CoarseLatLon` from
// this module keep working without an import-path churn. New code
// should import from '@/lib/geo/coarsen' directly.
export type { CoarseLatLon };

const STORAGE_KEY = 'birdsong.userLocation.v3';

export type RegionStatus =
  | 'unknown'
  | 'resolving'
  | 'ready'
  | 'denied'
  | 'unavailable';

interface StoredState {
  status: RegionStatus;
  /** Only present when status === 'ready'. */
  continent?: RegionCode;
  country?: string;
  subdivision?: string;
  resolvedAt?: number;
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
    const { status, continent, country, subdivision, resolvedAt } =
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
      return {
        status,
        continent: continent as RegionCode,
        country: typeof country === 'string' ? country : undefined,
        subdivision: typeof subdivision === 'string' ? subdivision : undefined,
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
    window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
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
  /** Coarse (1°-rounded) lat/lon derived from the shared location
   * store. Null when we don't have a fix yet. Use this as the input
   * to any privacy-sensitive boundary (iNat query params, geohash
   * encoding, IDB cache keys) so precise coords never leave the
   * device. Re-coarsen at the call site if you prefer to make the
   * boundary explicit — `coarsen()` is idempotent. */
  coarse: CoarseLatLon | null;
  status: RegionStatus;
  hasDecided: boolean;
  /** True when geolocation has been declined / is unavailable and
   * `fallbackPlaceSet` is populated. Surface a "location disabled"
   * indicator to the user when this is true. */
  usingFallback: boolean;
  /** Trigger the geolocation prompt. Safe to call multiple times. */
  request: () => void;
  /** Forget any stored decision so the opt-in affordance returns. */
  reset: () => void;
}

export function useUserRegion(): UseUserRegion {
  const { location: sharedLocation, setLocation: setSharedLocation } =
    useSharedLocation();

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

  // Commit a new region state. Persistence to localStorage is
  // handled by the `lastWrittenRef` effect below — keeping the
  // mutation path one-way (state → effect → storage) means we don't
  // have two places to worry about keeping the localStorage in
  // sync with React state.
  const commit = useCallback((next: StoredState) => {
    if (!mountedRef.current) return;
    setState(next);
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
        // Persist the precise fix to the shared store — `coarse` is
        // a read-time derivation from this. Downstream boundaries
        // (iNat, geohash) coarsen explicitly via `coarsen()` so no
        // precise coord leaves the device.
        setSharedLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: 'gps',
          updatedAt: Date.now(),
        });
        commit({
          status: 'ready',
          continent: resolved.continent,
          country: resolved.country,
          subdivision: resolved.subdivision,
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
  }, [state.status, commit, setSharedLocation]);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
    } catch {
      // SSR / non-browser env — no-op.
    }
    if (mountedRef.current) {
      setState({ status: 'unknown' });
    }
  }, []);

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

  // Cross-mode sync. When another surface (e.g. the Stars settings
  // pin-drop) writes a new precise coord to the shared store, Birds
  // should pick it up and refresh its resolved region. Without this,
  // a Stars pin-drop would update the sky but leave the birdex pinned
  // to the user's previous region until they manually re-granted in
  // Birds too.
  //
  // We only run `resolveUserPlaces` here — no network, no
  // getCurrentPosition — so this is cheap enough to do as an
  // in-render derivation: when the shared coord's resolved region
  // differs from our current `state`, adjust synchronously. A
  // separate effect then mirrors the new state to localStorage.
  //
  // Guarding on reference equality of the shared-location object
  // prevents us from re-resolving on every render; only a fresh
  // `setLocation` call changes the identity.
  const [prevSharedLocation, setPrevSharedLocation] = useState(sharedLocation);
  if (sharedLocation !== prevSharedLocation) {
    setPrevSharedLocation(sharedLocation);
    if (sharedLocation) {
      const resolved = resolveUserPlaces(
        sharedLocation.latitude,
        sharedLocation.longitude,
      );
      if (
        resolved &&
        (state.status !== 'ready' ||
          state.continent !== resolved.continent ||
          state.country !== resolved.country ||
          state.subdivision !== resolved.subdivision)
      ) {
        // `resolvedAt` is stamped by `commit` for the primary write
        // paths (request / auto-prompt). We omit
        // it here because `Date.now()` is impure and React rejects
        // impure calls during render. Downstream code doesn't read
        // `resolvedAt`, so its absence on a cross-mode sync is
        // cosmetic.
        setState({
          status: 'ready',
          continent: resolved.continent,
          country: resolved.country,
          subdivision: resolved.subdivision,
        });
      }
    }
  }

  // Persist the place-set whenever it transitions to one of the
  // "decided" statuses. Kept as an effect rather than folded into
  // the in-render block above because writes to localStorage are a
  // bona fide side effect and don't belong in render.
  //
  // We compare against the raw string already in localStorage to
  // suppress redundant writes (e.g. the no-op mount case when we
  // initialized `state` from `readStored()` and nothing changed
  // before the effect ran). A `useRef` cache would be faster, but
  // the React Compiler lint rules disallow reading refs during
  // render-adjacent initialization; a localStorage read here is
  // synchronous and plenty fast for this workload.
  useEffect(() => {
    if (
      state.status !== 'ready' &&
      state.status !== 'denied' &&
      state.status !== 'unavailable'
    ) {
      return;
    }
    const serialized = JSON.stringify(state);
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current === serialized) return;
    } catch {
      // localStorage unavailable — attempting the write below will
      // also throw and be swallowed by `writeStored`.
    }
    writeStored(state);
  }, [state]);

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
  // Only runs once on mount. `commit` / `setSharedLocation` are
  // captured via refs so the effect can stay mount-only without
  // eslint complaining about missing deps.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  const setSharedLocationRef = useRef(setSharedLocation);
  useEffect(() => {
    setSharedLocationRef.current = setSharedLocation;
  }, [setSharedLocation]);
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
        setSharedLocationRef.current({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: 'gps',
          updatedAt: Date.now(),
        });
        commitRef.current({
          status: 'ready',
          continent: resolved.continent,
          country: resolved.country,
          subdivision: resolved.subdivision,
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

  // Derive `coarse` from the shared precise coord on every render.
  // This is the one place the 1°-rounding happens for Birds-side
  // consumers; downstream boundaries (iNat URLs, geohash encode)
  // also call `coarsen()` explicitly at the edge for defense in
  // depth, but this derivation is cheap and keeps the rest of the
  // app's call sites unchanged. Memoized so reference identity is
  // stable while the underlying value is — prevents useEffect
  // deps-arrays that include `coarse` from re-firing on every render.
  const coarse = useMemo<CoarseLatLon | null>(() => {
    if (!sharedLocation) return null;
    // Only surface a coarse value when we also have a resolved
    // region; otherwise downstream consumers (observation map,
    // species bands) would fire iNat queries on a centroid the user
    // hasn't actually committed to.
    if (state.status !== 'ready') return null;
    return coarsen(sharedLocation.latitude, sharedLocation.longitude);
  }, [sharedLocation, state.status]);

  return {
    region: resolvedPlaceSet?.continent ?? null,
    placeSet: resolvedPlaceSet,
    fallbackPlaceSet,
    coarse,
    status: state.status,
    hasDecided,
    usingFallback,
    request,
    reset,
  };
}
