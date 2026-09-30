import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Crown, Send, Users } from 'lucide-react';

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
 * your profile link, and see the people you follow ranked by Birdex size.
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

  const birdexSizes = useFollowsBirdexSizes();

  // A leaderboard: biggest Birdex first. Ties, including everyone with
  // no Birdex yet, fall back to most recently added first.
  // Tied counts share a rank (1, 2, 2, 4), and accounts with no species
  // aren't ranked at all.
  const following = useMemo(() => {
    const rows = [...(follows ?? [])]
      .reverse()
      .map((pubkey) => ({ pubkey, species: birdexSizes?.get(pubkey) ?? 0, rank: 0 }))
      .sort((a, b) => b.species - a.species);
    rows.forEach((row, i) => {
      if (row.species === 0) return;
      row.rank = i > 0 && rows[i - 1].species === row.species ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }, [follows, birdexSizes]);
  const ranked = following.some((row) => row.rank > 0);

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
        <h3 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
          {follows && follows.size > 0 ? `Following · ${follows.size}` : 'Following'}
        </h3>

        {isLoading ? (
          <div className="space-y-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : following.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="px-8 py-10 text-center">
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                You're not following anyone yet. Search for friends above, or send them an invite.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <ul className="-mx-2">
              {following.slice(0, shown).map(({ pubkey, species, rank }) => (
                <FriendRow
                  key={pubkey}
                  pubkey={pubkey}
                  species={species}
                  rank={ranked ? rank : undefined}
                  onNavigate={onClose}
                />
              ))}
            </ul>
            {following.length > shown && (
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
      </div>
    </div>
  );
}

interface FriendRowProps {
  pubkey: string;
  /** Species on their Birdex. */
  species: number;
  /** Leaderboard position; 0 when unranked, undefined when nobody is. */
  rank?: number;
  onNavigate: () => void;
}

function FriendRow({ pubkey, species, rank, onNavigate }: FriendRowProps) {
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
        {rank !== undefined && (
          <span
            className={cn(
              'w-6 shrink-0 text-center text-sm font-semibold tabular-nums',
              rank === 1 ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground',
            )}
            aria-label={rank > 0 ? `Rank ${rank}` : undefined}
          >
            {rank > 0 ? rank : ''}
          </span>
        )}
        <div className="relative shrink-0">
          <Avatar className="size-10">
            {picture && <AvatarImage src={picture} alt="" className="object-cover" />}
            <AvatarFallback>{(name ?? '?').charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          {rank === 1 && (
            <Crown
              className="absolute -top-2.5 left-1/2 size-5 -translate-x-1/2 rotate-[-12deg] fill-amber-400 text-amber-600 drop-shadow-sm dark:text-amber-300"
              aria-hidden
            />
          )}
        </div>
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
        {species > 0 && (
          <div className="shrink-0 text-right leading-tight">
            <p className="text-sm font-semibold tabular-nums">{species.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">species</p>
          </div>
        )}
      </Link>
    </li>
  );
}
