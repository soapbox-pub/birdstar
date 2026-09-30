import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Send, Users } from 'lucide-react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { OverlayCloseButton } from '@/components/OverlayCloseButton';
import { FriendsLeaderboard, FriendsLeaderboardSkeleton, type LeaderboardEntry } from '@/components/FriendsLeaderboard';
import { ProfileSearchInput } from '@/components/ProfileSearchInput';
import { ProfileShareView } from '@/components/ProfileShareView';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowActions } from '@/hooks/useFollowActions';
import { useFollowList } from '@/hooks/useFollowList';
import { useFollowsBirdexSizes } from '@/hooks/useFollowsBirdexSizes';
import { useVerifiedNip05 } from '@/hooks/useNip05Resolve';
import { useToast } from '@/hooks/useToast';
import { hapticTap } from '@/lib/haptics';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

interface FriendsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** How many followed accounts to render before "Show more". */
const PAGE_SIZE = 30;

/**
 * Manage who you follow: search for accounts to add (NIP-50 typeahead,
 * or paste an npub / NIP-05), invite people who aren't on Nostr yet with
 * your profile link, and see how you and the people you follow rank by
 * Birdex size.
 * Adding a friend is a kind 3 follow-list update; unfollowing happens
 * from their profile.
 *
 * Full-screen on mobile, a centered modal from `sm` up, like
 * {@link BirdProfileDialog}.
 */
export function FriendsDialog({ open, onOpenChange }: FriendsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // A single grid row capped at the dialog's height, so the
          // Following list below scrolls inside itself. Left `auto`, the
          // row grows to fit the whole list and nothing scrolls.
          'h-[100dvh] max-h-[100dvh] w-screen max-w-none grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-none border-0 p-0',
          'left-0 top-0 translate-x-0 translate-y-0',
          'sm:left-[50%] sm:safe-center-y sm:h-[min(44rem,88dvh)] sm:w-full sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border',
        )}
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Escape with the search results open closes just the results
        // (ProfileSearchInput handles that), not the whole dialog.
        onEscapeKeyDown={(e) => {
          if (e.target instanceof HTMLElement && e.target.getAttribute('aria-expanded') === 'true') {
            e.preventDefault();
          }
        }}
      >
        <DialogClose asChild>
          <OverlayCloseButton variant="surface" />
        </DialogClose>
        {open && <FriendsBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FriendsBody({ onClose }: { onClose: () => void }) {
  const { user } = useCurrentUser();
  const { data: follows, isLoading } = useFollowList();
  const { follow } = useFollowActions();
  const { toast } = useToast();
  const [inviting, setInviting] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);

  const { sizes, isLoading: sizesLoading } = useFollowsBirdexSizes();
  const selfPubkey = user?.pubkey;

  // Everyone with a Birdex, you included, goes on the leaderboard,
  // biggest first. Ties share a rank (1, 2, 2, 4) and are ordered by
  // most recently followed. Follows with no Birdex yet are listed below,
  // most recently added first.
  const { leaders, unranked } = useMemo(() => {
    const recentFirst = [...(follows ?? [])].reverse();
    const candidates = selfPubkey && !follows?.has(selfPubkey) ? [...recentFirst, selfPubkey] : recentFirst;
    const leaders: LeaderboardEntry[] = candidates
      .filter((pubkey) => sizes.has(pubkey))
      .map((pubkey) => ({ pubkey, species: sizes.get(pubkey) ?? 0, rank: 0 }))
      .sort((a, b) => b.species - a.species);
    leaders.forEach((row, i) => {
      row.rank = i > 0 && leaders[i - 1].species === row.species ? leaders[i - 1].rank : i + 1;
    });
    return { leaders, unranked: recentFirst.filter((pubkey) => !sizes.has(pubkey)) };
  }, [follows, sizes, selfPubkey]);

  const loading = isLoading || sizesLoading;

  if (!user) return null;

  if (inviting) {
    return (
      <div className="h-full overflow-y-auto overscroll-contain">
        <ProfileShareView
          pubkey={user.pubkey}
          onBack={() => setInviting(false)}
          className="pt-[calc(1.75rem+env(safe-area-inset-top))] sm:pt-7"
        />
      </div>
    );
  }

  const handleAdd = async (pubkey: string) => {
    if (pubkey === user.pubkey) {
      toast({ title: "That's you!", description: 'Try searching for a friend instead.' });
      return;
    }
    if (follows?.has(pubkey)) {
      toast({ title: 'Already following' });
      return;
    }
    try {
      await follow(pubkey);
      hapticTap();
      toast({ title: 'Friend added' });
    } catch (err) {
      toast({
        title: "Couldn't add friend",
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-5 px-6 pb-5 pt-[calc(1.75rem+env(safe-area-inset-top))] sm:pt-7">
        <DialogHeader className="pr-10 text-left">
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <Users className="size-5 text-emerald-600 dark:text-emerald-300" aria-hidden />
            Friends
          </DialogTitle>
          <DialogDescription>
            Follow friends to see the birds they hear and the constellations they draw.
          </DialogDescription>
        </DialogHeader>

        <ProfileSearchInput onSelect={handleAdd} />

        <button
          type="button"
          onClick={() => setInviting(true)}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Send className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Invite friends</span>
            <span className="block text-xs text-muted-foreground">
              Share a link. They'll follow you as soon as they join.
            </span>
          </span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-4">
        {loading ? (
          <FriendsLeaderboardSkeleton />
        ) : !follows || follows.size === 0 ? (
          <Card className="border-dashed">
            <CardContent className="px-8 py-10 text-center">
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                You're not following anyone yet. Search for friends above, or send them an invite.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {leaders.length > 0 && (
              <FriendsLeaderboard entries={leaders} selfPubkey={user.pubkey} onNavigate={onClose} />
            )}
            {unranked.length > 0 && (
              <>
                <h3
                  className={cn(
                    'mb-3 text-xs uppercase tracking-widest text-muted-foreground',
                    leaders.length > 0 && 'mt-8',
                  )}
                >
                  {leaders.length > 0
                    ? `Not on the board yet · ${unranked.length}`
                    : `Following · ${follows.size}`}
                </h3>
                <ul className="-mx-2">
                  {unranked.slice(0, shown).map((pubkey) => (
                    <FriendRow key={pubkey} pubkey={pubkey} onNavigate={onClose} />
                  ))}
                </ul>
                {unranked.length > shown && (
                  <Button
                    variant="ghost"
                    className="mt-2 w-full"
                    onClick={() => setShown((n) => n + PAGE_SIZE)}
                  >
                    Show more
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FriendRow({ pubkey, onNavigate }: { pubkey: string; onNavigate: () => void }) {
  const author = useAuthor(pubkey);

  const metadata = author.data?.metadata;
  const name = metadata?.name || metadata?.display_name;
  const picture = sanitizeUrl(metadata?.picture);
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);
  const nip05 = useVerifiedNip05(metadata?.nip05, pubkey);

  return (
    <li>
      <Link
        to={`/${npub}`}
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-10">
          {picture && <AvatarImage src={picture} alt="" className="object-cover" />}
          <AvatarFallback>{(name ?? '?').charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {author.isLoading && !name ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            <p className="truncate text-sm font-semibold">{name ?? 'Anonymous'}</p>
          )}
          <p className={cn('truncate text-xs text-muted-foreground', !nip05 && 'font-mono')}>
            {nip05 ?? `${npub.slice(0, 12)}…${npub.slice(-6)}`}
          </p>
        </div>
      </Link>
    </li>
  );
}
