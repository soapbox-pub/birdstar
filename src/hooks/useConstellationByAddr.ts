import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";

import {
  CUSTOM_CONSTELLATION_KIND,
  parseCustomConstellation,
  type CustomConstellation,
} from "@/lib/customConstellations";

/**
 * Fetch a single custom constellation by its addressable coordinates
 * (pubkey + d-tag). Unlike `useCustomConstellations`, which loads a
 * broad feed, this targets exactly one figure — the form needed when
 * a user lands on a cold `naddr` URL that wasn't already cached.
 *
 * Returns `data: null` (not `undefined`) when the relay has no matching
 * event; `data: undefined` means still loading.
 */
export function useConstellationByAddr(
  pubkey: string | undefined,
  d: string | undefined,
) {
  const { nostr } = useNostr();

  return useQuery<CustomConstellation | null>({
    queryKey: ["custom-constellation", "by-addr", pubkey ?? "", d ?? ""],
    enabled: !!pubkey && !!d,
    queryFn: async ({ signal }) => {
      if (!pubkey || !d) return null;
      const events = await nostr.query(
        [
          {
            kinds: [CUSTOM_CONSTELLATION_KIND],
            authors: [pubkey],
            "#d": [d],
            limit: 1,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      const parsed = events
        .map(parseCustomConstellation)
        .filter((c): c is CustomConstellation => c !== null);
      if (parsed.length === 0) return null;
      // Take the most recent event per addressable replaceable semantics.
      parsed.sort((a, b) => b.createdAt - a.createdAt);
      return parsed[0];
    },
    staleTime: 60 * 1000,
  });
}
