import { useEffect, useRef } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/hooks/useFollowList';
import { useFollowActions } from '@/hooks/useFollowActions';
import { useToast } from '@/hooks/useToast';
import {
  clearFollowIntent,
  getFollowIntent,
} from '@/lib/followIntent';

/**
 * Watches for a logged-in user and a pending {@link getFollowIntent}
 * "follow this pubkey once you're signed in" record, then completes the
 * follow on the visitor's behalf.
 *
 * This is the back half of the "scan my QR to add me" flow: a logged-out
 * visitor taps **Follow** on a profile, we stash the target and send them
 * through login / signup, and when they land back here with an active
 * account this hook quietly follows the target and confirms with a toast.
 *
 * Guards:
 * - **No user, no action.** Nothing runs until `useCurrentUser` resolves a
 *   logged-in account.
 * - **Wait for the follow list.** We need the current contacts to know
 *   whether the target is already followed; firing before it loads could
 *   race {@link useFollowActions}'s read-fresh-then-write.
 * - **Don't follow yourself.** If the intent target is the now-logged-in
 *   user (e.g. they scanned their own QR), we just clear it.
 * - **Idempotent.** Already following → clear and confirm without writing.
 * - **Run once per intent.** A ref tracks the pubkey we've handled so a
 *   re-render (or the follow-list invalidation our own write triggers)
 *   can't re-enter and double-fire.
 */
export function useFollowIntentExecutor(): void {
  const { user } = useCurrentUser();
  const { data: follows } = useFollowList();
  const { follow } = useFollowActions();
  const { toast } = useToast();

  // The intent pubkey we've already started handling, so we don't re-run
  // when the follow-list query invalidates after our own write.
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Need the contacts list loaded to make a safe follow decision.
    if (follows === undefined) return;

    const intent = getFollowIntent();
    if (!intent) return;

    // Already processed this target in this session.
    if (handledRef.current === intent.pubkey) return;

    // Scanned their own QR (or otherwise targeted themselves): nothing to do.
    if (intent.pubkey === user.pubkey) {
      handledRef.current = intent.pubkey;
      clearFollowIntent();
      return;
    }

    // Already following — confirm and clear without a redundant write.
    if (follows?.has(intent.pubkey)) {
      handledRef.current = intent.pubkey;
      clearFollowIntent();
      return;
    }

    handledRef.current = intent.pubkey;

    (async () => {
      try {
        await follow(intent.pubkey);
        clearFollowIntent();
        toast({
          title: 'Added',
          description: "You're now following them. Welcome aboard!",
        });
      } catch (err) {
        console.error('Auto-follow from intent failed:', err);
        // Allow a retry: leave the intent in place but let a later effect
        // run pick it up again by releasing the per-session lock.
        handledRef.current = null;
        toast({
          title: "Couldn't complete the follow",
          description:
            err instanceof Error ? err.message : 'You can tap Follow to retry.',
          variant: 'destructive',
        });
      }
    })();
  }, [user, follows, follow, toast]);
}
