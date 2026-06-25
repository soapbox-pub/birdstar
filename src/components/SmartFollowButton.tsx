import { useCallback, useMemo, useState } from 'react';

import AuthDialog from '@/components/auth/AuthDialog';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/hooks/useFollowList';
import { useFollowActions } from '@/hooks/useFollowActions';
import { useToast } from '@/hooks/useToast';
import { hapticTap } from '@/lib/haptics';
import { setFollowIntent } from '@/lib/followIntent';
import { cn } from '@/lib/utils';

interface SmartFollowButtonProps {
  /** The pubkey (hex) of the user to follow. */
  pubkey: string;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * A follow button that walks a visitor all the way from "no account" to
 * "following you" with a single tap — the action behind the scan-to-add
 * QR flow.
 *
 * Unlike {@link FollowButton} (which renders nothing when logged out),
 * this handles every entry state implicitly:
 *
 * - **Logged in, viewing someone else** — toggles follow / unfollow on the
 *   spot, same safe read-fresh-then-write as `FollowButton`.
 * - **Logged in, viewing your own profile** — renders nothing (you can't
 *   follow yourself).
 * - **Logged out (with or without an account)** — tapping records a
 *   {@link setFollowIntent} for this pubkey and opens the unified
 *   {@link AuthDialog}. The dialog supports both "create a new account"
 *   and "log in to an existing account", so the same button serves the
 *   no-account and has-account-but-logged-out cases. Once auth completes,
 *   {@link useFollowIntentExecutor} (mounted at the app root) follows the
 *   target automatically and confirms with a toast.
 *
 * The result: a stranger scans your QR, lands on your profile, taps one
 * button, breezes through account creation, and is already following you
 * when they arrive — no second trip to find the Follow button.
 */
export function SmartFollowButton({
  pubkey,
  className,
  size = 'default',
}: SmartFollowButtonProps) {
  const { user } = useCurrentUser();
  const { data: follows } = useFollowList();
  const { isPending, follow, unfollow } = useFollowActions();
  const { toast } = useToast();

  const [authOpen, setAuthOpen] = useState(false);

  const isFollowing = useMemo(
    () => !!follows && follows.has(pubkey),
    [follows, pubkey],
  );

  const handleLoggedInToggle = useCallback(async () => {
    try {
      if (isFollowing) {
        await unfollow(pubkey);
        hapticTap();
        toast({ title: 'Unfollowed' });
      } else {
        await follow(pubkey);
        hapticTap();
        toast({ title: 'Followed' });
      }
    } catch (err) {
      console.error('Follow toggle failed:', err);
      toast({
        title: "Couldn't update your follow list",
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  }, [isFollowing, pubkey, follow, unfollow, toast]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (user) {
        void handleLoggedInToggle();
        return;
      }

      // Logged out: remember who they wanted to follow, then send them
      // through login / signup. The intent executor finishes the follow.
      hapticTap();
      setFollowIntent(pubkey);
      setAuthOpen(true);
    },
    [user, handleLoggedInToggle, pubkey],
  );

  // Can't follow yourself — and a Follow button on your own profile is
  // just confusing.
  if (user && user.pubkey === pubkey) return null;

  const label = !user
    ? 'Follow'
    : isPending
      ? '…'
      : isFollowing
        ? 'Unfollow'
        : 'Follow';

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={isFollowing ? 'outline' : 'default'}
        onClick={handleClick}
        disabled={isPending}
        className={cn('rounded-full font-semibold', className)}
      >
        {label}
      </Button>

      {/* Self-contained auth dialog, mirroring LoginArea's pattern. Opened
          only for logged-out visitors; on success the root-mounted
          FollowIntentExecutor completes the pending follow. */}
      <AuthDialog isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );
}
