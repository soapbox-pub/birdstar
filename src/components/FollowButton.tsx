import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/hooks/useFollowList';
import { useFollowActions } from '@/hooks/useFollowActions';
import { useToast } from '@/hooks/useToast';
import { hapticTap } from '@/lib/haptics';
import { cn } from '@/lib/utils';

interface FollowButtonProps {
  /** The pubkey (hex) of the user to follow / unfollow. */
  pubkey: string;
  className?: string;
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Reusable follow / unfollow button backed by {@link useFollowActions}'s
 * safe read-fresh-then-write contact-list mutation.
 *
 * Renders nothing when logged out or when the target is the logged-in
 * user (you can't follow yourself, and an own-profile Follow button is
 * just confusing).
 */
export function FollowButton({
  pubkey,
  className,
  size = 'sm',
}: FollowButtonProps) {
  const { user } = useCurrentUser();
  const { data: follows } = useFollowList();
  const { isPending, follow, unfollow } = useFollowActions();
  const { toast } = useToast();

  const isFollowing = useMemo(
    () => !!follows && follows.has(pubkey),
    [follows, pubkey],
  );

  const handleToggle = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!user) return;

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
    },
    [user, pubkey, isFollowing, follow, unfollow, toast],
  );

  // Don't render for own profile or when logged out.
  if (!user || user.pubkey === pubkey) return null;

  return (
    <Button
      type="button"
      size={size}
      variant={isFollowing ? 'outline' : 'default'}
      onClick={handleToggle}
      disabled={isPending}
      className={cn('rounded-full font-semibold', className)}
    >
      {isPending ? '…' : isFollowing ? 'Unfollow' : 'Follow'}
    </Button>
  );
}
