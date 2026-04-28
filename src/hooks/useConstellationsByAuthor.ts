import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";

import {
  CUSTOM_CONSTELLATION_KIND,
  parseCustomConstellation,
  type CustomConstellation,
} from "@/lib/customConstellations";

/**
 * Fetch all custom constellations authored by a specific pubkey. Used
 * by the profile page to show everything a user has published.
 *
 * Addressable replaceable semantics apply: we keep only the latest event
 * per `d` tag.
 */
export function useConstellationsByAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<CustomConstellation[]>({
    queryKey: ["custom-constellations", "by-author", pubkey ?? ""],
    enabled: !!pubkey,
    queryFn: async ({ signal }) => {
      if (!pubkey) return [];
      const events = await nostr.query(
        [
          {
            kinds: [CUSTOM_CONSTELLATION_KIND],
            authors: [pubkey],
            limit: 100,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      const parsed = events
        .map(parseCustomConstellation)
        .filter((c): c is CustomConstellation => c !== null);
      const latest = new Map<string, CustomConstellation>();
      for (const c of parsed) {
        const prev = latest.get(c.d);
        if (!prev || c.createdAt > prev.createdAt) {
          latest.set(c.d, c);
        }
      }
      return Array.from(latest.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    },
    staleTime: 60 * 1000,
  });
}
