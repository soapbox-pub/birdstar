import { useCallback, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNostrStorage } from '@/hooks/useNostrStorage';
import { contactListPubkeys } from '@/hooks/useFollowList';
import { fetchFreshEvent } from '@/lib/fetchFreshEvent';

export interface UseFollowActionsReturn {
  /** Whether a follow / unfollow mutation is in progress. */
  isPending: boolean;
  /** Follow a pubkey. Fetches the freshest kind 3 first, then publishes. */
  follow: (pubkey: string) => Promise<void>;
  /** Unfollow a pubkey. Fetches the freshest kind 3 first, then publishes. */
  unfollow: (pubkey: string) => Promise<void>;
}

/**
 * All kind-3 writes run one at a time, app-wide. Two concurrent
 * read-modify-writes (e.g. adding several friends in quick succession)
 * would read the same list, and the later publish would drop the
 * earlier one's change.
 */
let followListWriteChain: Promise<unknown> = Promise.resolve();

function serializeFollowListWrite<T>(write: () => Promise<T>): Promise<T> {
  const run = followListWriteChain.then(write, write);
  // Swallow on the chain so one failure doesn't wedge the queue; the
  // caller still sees the rejection.
  followListWriteChain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Safe follow / unfollow actions for the logged-in user's NIP-02 contact
 * list (kind 3). Modelled on Ditto's `useFollowActions`.
 *
 * **Why this is delicate:** kind 3 is a single replaceable event. A naive
 * "read from cache → add/remove a `p` tag → publish" can silently wipe a
 * user's entire follow list if the cache is stale or a relay returns an
 * empty result. The whole list lives in one event, so one bad write is
 * unrecoverable.
 *
 * Safety properties, all inherited from the Ditto pattern:
 *
 * 1. **Read fresh, not cached.** {@link fetchFreshEvent} queries relays
 *    for the latest kind 3 *right before* mutating, picking the highest
 *    `created_at` across all relay responses.
 * 2. **Never go backwards.** It also reads the locally cached copy and
 *    keeps whichever is newer, so a transient relay miss can't rebuild
 *    the list from an empty base.
 * 3. **Preserve everything.** All non-`p` tags (relay hints, petnames,
 *    etc.) and the `content` field are carried over untouched — we only
 *    add or remove the single target `p` tag.
 * 4. **One write at a time.** Writes are queued so back-to-back edits
 *    each build on the previous one, and each gets a strictly later
 *    `created_at` so relays can't order two same-second edits backwards.
 */
export function useFollowActions(): UseFollowActionsReturn {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { store } = useNostrStorage();
  const queryClient = useQueryClient();

  const [isPending, setIsPending] = useState(false);

  const mutateFollowList = useCallback(
    async (targetPubkey: string, action: 'follow' | 'unfollow') => {
      if (!user) throw new Error('Not logged in');
      setIsPending(true);

      try {
        await serializeFollowListWrite(async () => {
          // ① Fetch the freshest kind 3 via the pool, falling back to the
          //    locally cached copy so a relay miss can't wipe the list.
          const prev = await fetchFreshEvent(
            nostr,
            { kinds: [3], authors: [user.pubkey] },
            { store },
          );

          // ② Split existing tags into `p` tags (follows) and everything
          //    else (relay hints, petnames, etc. — preserved verbatim).
          const existingTags = prev?.tags ?? [];
          const pTags = existingTags.filter(([name]) => name === 'p');
          const nonPTags = existingTags.filter(([name]) => name !== 'p');

          // ③ Compute the new `p` tag set.
          let newPTags: string[][];
          if (action === 'follow') {
            const alreadyFollowed = pTags.some(([, pk]) => pk === targetPubkey);
            newPTags = alreadyFollowed
              ? pTags
              : [...pTags, ['p', targetPubkey]];
          } else {
            newPTags = pTags.filter(([, pk]) => pk !== targetPubkey);
          }

          // ④ Rebuild: non-p tags first, then p tags. Preserve content
          //    (some clients store relay hints there).
          const now = Math.floor(Date.now() / 1000);
          const published = await publishEvent({
            kind: 3,
            content: prev?.content ?? '',
            tags: [...nonPTags, ...newPTags],
            created_at: prev ? Math.max(now, prev.created_at + 1) : now,
          });

          // ⑤ Store what we published before releasing the queue, so the
          //    next queued write reads it as its floor even if relays
          //    haven't indexed it yet. Then show it in the UI right away.
          await store.event(published);
          queryClient.setQueryData<Set<string>>(
            ['follow-list', user.pubkey],
            contactListPubkeys(published),
          );
          queryClient.invalidateQueries({ queryKey: ['follow-list'] });
        });
      } finally {
        setIsPending(false);
      }
    },
    [nostr, user, publishEvent, store, queryClient],
  );

  const follow = useCallback(
    (pubkey: string) => mutateFollowList(pubkey, 'follow'),
    [mutateFollowList],
  );

  const unfollow = useCallback(
    (pubkey: string) => mutateFollowList(pubkey, 'unfollow'),
    [mutateFollowList],
  );

  return { isPending, follow, unfollow };
}
