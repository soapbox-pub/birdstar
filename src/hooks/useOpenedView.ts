import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { nip19 } from "nostr-tools";

import { starByHip, type Star } from "@/lib/stars";
import { zodiacById, type ZodiacSign } from "@/lib/zodiac";
import {
  isPlanetId,
  type PlanetId,
} from "@/lib/planets";
import {
  CUSTOM_CONSTELLATION_KIND,
  type CustomConstellation,
} from "@/lib/customConstellations";
import { useCustomConstellations } from "@/hooks/useCustomConstellations";
import { useConstellationByAddr } from "@/hooks/useConstellationByAddr";

/**
 * Discriminated union describing which overlay view (if any) the
 * current URL has opened over the sky. Each variant carries the fully-
 * resolved data the corresponding sheet needs — no follow-up lookups
 * required inside the render.
 *
 * The `'loading'` variant covers the window between "URL says to open
 * this constellation" and "we've fetched the event"; sheets can keep
 * themselves open with a placeholder during that window.
 */
export type OpenedView =
  | { kind: "none" }
  | { kind: "star"; star: Star }
  | { kind: "zodiac"; sign: ZodiacSign }
  | { kind: "planet"; id: PlanetId }
  | { kind: "sun" }
  | { kind: "moon" }
  | { kind: "constellation"; constellation: CustomConstellation }
  | { kind: "profile"; pubkey: string }
  | { kind: "loading" }
  | { kind: "not-found" };

type RouteKind = "star" | "zodiac" | "planet" | "sun" | "moon" | "nip19" | null;

/**
 * Disambiguate which route-type is currently active based on the
 * registered route-param shape. Each overlay route contributes exactly
 * one param (or the static path `/sun` / `/moon`); the presence of a
 * given param tells us which branch to take.
 */
function routeKindFromParams(params: {
  hip?: string;
  zodiacId?: string;
  planetId?: string;
  nip19Id?: string;
}): RouteKind {
  if (params.hip !== undefined) return "star";
  if (params.zodiacId !== undefined) return "zodiac";
  if (params.planetId !== undefined) return "planet";
  if (params.nip19Id !== undefined) return "nip19";
  return null;
}

/**
 * Resolve the currently-opened view from the URL. Must be called inside
 * a Router. Hooks up to `useCustomConstellations` for the cheap path
 * (already-loaded constellations) and falls back to
 * `useConstellationByAddr` to fetch cold-pasted `naddr` URLs.
 *
 * `/sun` and `/moon` are static paths with no params, so we peek at
 * `useLocation().pathname` to detect them. Every other branch is driven
 * entirely by `useParams`.
 */
export function useOpenedView(): OpenedView {
  const params = useParams<{
    hip?: string;
    zodiacId?: string;
    planetId?: string;
    nip19Id?: string;
  }>();
  const { pathname } = useLocation();

  const routeKind: RouteKind = pathname === "/sun"
    ? "sun"
    : pathname === "/moon"
      ? "moon"
      : routeKindFromParams(params);

  // Decode any NIP-19 identifier up front so downstream queries see
  // stable inputs on every render.
  const decodedNip19 = useMemo(() => {
    if (routeKind !== "nip19" || !params.nip19Id) return null;
    try {
      return nip19.decode(params.nip19Id);
    } catch {
      return null;
    }
  }, [routeKind, params.nip19Id]);

  // For an naddr pointing at a custom constellation, extract (pubkey, d).
  const naddrCoords = useMemo(() => {
    if (!decodedNip19) return null;
    if (decodedNip19.type !== "naddr") return null;
    const data = decodedNip19.data;
    if (data.kind !== CUSTOM_CONSTELLATION_KIND) return null;
    return { pubkey: data.pubkey, d: data.identifier };
  }, [decodedNip19]);

  // Fast path: is this naddr already in the loaded feed?
  const { data: all } = useCustomConstellations();
  const alreadyLoaded = useMemo(() => {
    if (!naddrCoords || !all) return null;
    return (
      all.find(
        (c) => c.pubkey === naddrCoords.pubkey && c.d === naddrCoords.d,
      ) ?? null
    );
  }, [all, naddrCoords]);

  // Fallback query for cold deep-links. Disabled unless we have coords
  // and the fast path missed.
  const needsRemote = !!naddrCoords && alreadyLoaded === null;
  const { data: remoteConstellation, isLoading: remoteLoading } =
    useConstellationByAddr(
      needsRemote ? naddrCoords.pubkey : undefined,
      needsRemote ? naddrCoords.d : undefined,
    );

  return useMemo<OpenedView>(() => {
    switch (routeKind) {
      case null:
        return { kind: "none" };

      case "sun":
        return { kind: "sun" };

      case "moon":
        return { kind: "moon" };

      case "star": {
        const hip = Number(params.hip);
        if (!Number.isFinite(hip) || hip <= 0) return { kind: "not-found" };
        const star = starByHip(hip);
        if (!star) return { kind: "not-found" };
        return { kind: "star", star };
      }

      case "zodiac": {
        if (!params.zodiacId) return { kind: "not-found" };
        const sign = zodiacById(params.zodiacId);
        if (!sign) return { kind: "not-found" };
        return { kind: "zodiac", sign };
      }

      case "planet": {
        if (!params.planetId || !isPlanetId(params.planetId)) {
          return { kind: "not-found" };
        }
        return { kind: "planet", id: params.planetId };
      }

      case "nip19": {
        if (!decodedNip19) return { kind: "not-found" };
        // Profiles open as an overlay sheet over the sky, keeping the
        // app's "every route renders Index with an overlay" model.
        if (decodedNip19.type === "npub") {
          return { kind: "profile", pubkey: decodedNip19.data };
        }
        if (decodedNip19.type === "nprofile") {
          return { kind: "profile", pubkey: decodedNip19.data.pubkey };
        }
        // naddr-to-custom-constellation continues to dispatch here.
        if (!naddrCoords) return { kind: "not-found" };
        if (alreadyLoaded) {
          return { kind: "constellation", constellation: alreadyLoaded };
        }
        if (remoteConstellation) {
          return { kind: "constellation", constellation: remoteConstellation };
        }
        if (remoteLoading || all === undefined) return { kind: "loading" };
        return { kind: "not-found" };
      }

      default:
        return { kind: "none" };
    }
  }, [
    routeKind,
    params.hip,
    params.zodiacId,
    params.planetId,
    decodedNip19,
    naddrCoords,
    alreadyLoaded,
    remoteConstellation,
    remoteLoading,
    all,
  ]);
}
