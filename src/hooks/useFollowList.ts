import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";

import { useCurrentUser } from "./useCurrentUser";

/**
 * Fetch the logged-in user's NIP-02 follow list (kind 3 contacts).
 *
 * Returns a `Set<string>` of pubkeys the user follows, or `null` if
 * nobody is logged in / no contacts list has been published yet. The
 * set is stable-referenced per query result so consumers can use it
 * directly in dependency arrays and membership checks.
 *
 * Kind 3 is replaceable: relays only keep the latest event per pubkey,
 * so we ask for exactly one and extract `p`-tagged pubkeys from it.
 */
export function useFollowList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery<Set<string> | null>({
    queryKey: ["follow-list", user?.pubkey],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      if (!user) return null;
      const events = await nostr.query(
        [
          {
            kinds: [3],
            authors: [user.pubkey],
            limit: 1,
          },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      if (events.length === 0) return new Set<string>();
      const latest = events.reduce((a, b) =>
        a.created_at >= b.created_at ? a : b,
      );
      const follows = new Set<string>();
      for (const [name, value] of latest.tags) {
        if (name === "p" && typeof value === "string" && value.length === 64) {
          follows.add(value);
        }
      }
      return follows;
    },
    staleTime: 5 * 60 * 1000,
  });
}
