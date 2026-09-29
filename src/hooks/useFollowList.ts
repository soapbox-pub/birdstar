import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";
import type { NostrEvent } from "@nostrify/nostrify";

import { useCurrentUser } from "./useCurrentUser";
import { useNostrStorage } from "./useNostrStorage";
import { fetchFreshEvent } from "@/lib/fetchFreshEvent";

/** The `p`-tagged pubkeys of a kind 3 contact list, in list order. */
export function contactListPubkeys(event: NostrEvent | null | undefined): Set<string> {
  const follows = new Set<string>();
  for (const [name, value] of event?.tags ?? []) {
    if (name === "p" && typeof value === "string" && value.length === 64) {
      follows.add(value);
    }
  }
  return follows;
}

/**
 * Fetch the logged-in user's NIP-02 follow list (kind 3 contacts).
 *
 * Returns a `Set<string>` of pubkeys the user follows, or `null` if
 * nobody is logged in / no contacts list has been published yet. The
 * set is stable-referenced per query result so consumers can use it
 * directly in dependency arrays and membership checks. Iteration order
 * is list order, so the most recently added follows come last.
 *
 * Kind 3 is replaceable: relays only keep the latest event per pubkey.
 * The newer of the relay copy and the locally stored copy wins, so a
 * follow we just published shows up even before relays have indexed it.
 */
export function useFollowList() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { store } = useNostrStorage();

  return useQuery<Set<string> | null>({
    queryKey: ["follow-list", user?.pubkey],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      if (!user) return null;
      const event = await fetchFreshEvent(
        nostr,
        { kinds: [3], authors: [user.pubkey] },
        { store, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
      );
      return contactListPubkeys(event);
    },
    staleTime: 5 * 60 * 1000,
  });
}
