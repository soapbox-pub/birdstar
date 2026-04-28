import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useCurrentUser } from "./useCurrentUser";
import { useNostrPublish } from "./useNostrPublish";
import {
  CUSTOM_CONSTELLATION_KIND,
  buildConstellationTags,
  parseCustomConstellation,
  type CustomConstellation,
} from "@/lib/customConstellations";

/**
 * Query recent public custom constellations authored by anyone on the
 * configured relays. Filtering is done by kind alone; the parser
 * discards any events that don't match the Starpoint schema.
 */
export function useCustomConstellations(limit = 200) {
  const { nostr } = useNostr();

  return useQuery<CustomConstellation[]>({
    queryKey: ["custom-constellations", "all", limit],
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [
          {
            kinds: [CUSTOM_CONSTELLATION_KIND],
            limit,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      const parsed = events
        .map(parseCustomConstellation)
        .filter((c): c is CustomConstellation => c !== null);
      // Deduplicate by pubkey+d, keeping latest (addressable semantics).
      const latest = new Map<string, CustomConstellation>();
      for (const c of parsed) {
        const key = `${c.pubkey}:${c.d}`;
        const prev = latest.get(key);
        if (!prev || c.createdAt > prev.createdAt) {
          latest.set(key, c);
        }
      }
      return Array.from(latest.values()).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Query only the current user's custom constellations. Returns an empty
 * array if nobody is logged in.
 */
export function useMyCustomConstellations() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<CustomConstellation[]>({
    queryKey: ["custom-constellations", "mine", user?.pubkey],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      if (!user) return [];
      const events = await nostr.query(
        [
          {
            kinds: [CUSTOM_CONSTELLATION_KIND],
            authors: [user.pubkey],
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
    staleTime: 30 * 1000,
  });
}

/**
 * Publish (or update) a custom constellation.
 */
export function usePublishConstellation() {
  const { mutateAsync: publish, isPending } = useNostrPublish();
  const queryClient = useQueryClient();

  const mutate = useCallback(
    async (opts: {
      d: string;
      title: string;
      edges: Array<[number, number]>;
      description?: string;
    }) => {
      const tags = buildConstellationTags({
        d: opts.d,
        title: opts.title,
        edges: opts.edges,
      });
      const event = await publish({
        kind: CUSTOM_CONSTELLATION_KIND,
        content: opts.description ?? "",
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });
      // Refresh both lists so the new one appears immediately.
      await queryClient.invalidateQueries({
        queryKey: ["custom-constellations"],
      });
      return event;
    },
    [publish, queryClient],
  );

  return { mutate, isPending };
}

/**
 * Delete a custom constellation using NIP-09 (kind 5 deletion request).
 */
export function useDeleteConstellation() {
  const { mutateAsync: publish, isPending } = useNostrPublish();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const mutate = useCallback(
    async (d: string) => {
      if (!user) throw new Error("Not logged in");
      const address = `${CUSTOM_CONSTELLATION_KIND}:${user.pubkey}:${d}`;
      await publish({
        kind: 5,
        content: "Deleted custom constellation",
        tags: [["a", address]],
        created_at: Math.floor(Date.now() / 1000),
      });
      await queryClient.invalidateQueries({
        queryKey: ["custom-constellations"],
      });
    },
    [publish, user, queryClient],
  );

  return { mutate, isPending };
}
