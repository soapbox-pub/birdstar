import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Crown, Trophy } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { cn } from '@/lib/utils';

export interface LeaderboardEntry {
  pubkey: string;
  /** Species on their Birdex. Always > 0 on the board. */
  species: number;
  /** Competition rank: ties share a place (1, 2, 2, 4). */
  rank: number;
}

interface FriendsLeaderboardProps {
  /** Ranked entries, best first. */
  entries: LeaderboardEntry[];
  /** The logged-in user, highlighted wherever they land. */
  selfPubkey: string;
  onNavigate: () => void;
}

type Medal = 'gold' | 'silver' | 'bronze';

const MEDAL: Record<Medal, { ring: string; step: string; text: string }> = {
  gold: {
    ring: 'ring-amber-400 dark:ring-amber-300',
    step: 'from-amber-200 via-amber-300 to-amber-500 dark:from-amber-300 dark:via-amber-400 dark:to-amber-600',
    text: 'text-amber-950',
  },
  silver: {
    ring: 'ring-slate-300 dark:ring-slate-400',
    step: 'from-slate-100 via-slate-200 to-slate-400 dark:from-slate-200 dark:via-slate-300 dark:to-slate-500',
    text: 'text-slate-800',
  },
  bronze: {
    ring: 'ring-orange-400 dark:ring-orange-400',
    step: 'from-orange-200 via-orange-300 to-orange-500 dark:from-orange-300 dark:via-orange-400 dark:to-orange-600',
    text: 'text-orange-950',
  },
};

function medalFor(rank: number): Medal {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
}

/**
 * The Friends leaderboard: the top three on a podium, everyone else in a
 * ranked list with a bar scaled against the leader's species count.
 */
export function FriendsLeaderboard({ entries, selfPubkey, onNavigate }: FriendsLeaderboardProps) {
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  const best = entries[0]?.species ?? 1;

  // Second place stands on the left, first in the middle, third on the right.
  const order = [podium[1], podium[0], podium[2]];

  return (
    <section aria-labelledby="leaderboard-heading">
      <div className="relative overflow-hidden rounded-2xl border bg-linear-to-b from-amber-50 via-background to-background px-3 pt-4 dark:from-amber-400/10">
        <div className="mb-7 flex items-center justify-between px-1">
          <h3
            id="leaderboard-heading"
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300"
          >
            <Trophy className="size-4" aria-hidden />
            Leaderboard
          </h3>
          <span className="text-xs text-muted-foreground">Species heard</span>
        </div>

        <ol className="grid grid-cols-3 items-end gap-2">
          {order.map((entry, i) =>
            entry ? (
              <PodiumSpot
                key={entry.pubkey}
                entry={entry}
                isSelf={entry.pubkey === selfPubkey}
                onNavigate={onNavigate}
              />
            ) : (
              <li key={`empty-${i}`} aria-hidden />
            ),
          )}
        </ol>
      </div>

      {rest.length > 0 && (
        <ol className="-mx-2 mt-3">
          {rest.map((entry) => (
            <LeaderRow
              key={entry.pubkey}
              entry={entry}
              best={best}
              isSelf={entry.pubkey === selfPubkey}
              onNavigate={onNavigate}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function useProfile(pubkey: string) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const npub = useMemo(() => nip19.npubEncode(pubkey), [pubkey]);
  return {
    npub,
    name: metadata?.name || metadata?.display_name,
    picture: sanitizeUrl(metadata?.picture),
    isLoading: author.isLoading,
  };
}

interface SpotProps {
  entry: LeaderboardEntry;
  isSelf: boolean;
  onNavigate: () => void;
}

function PodiumSpot({ entry, isSelf, onNavigate }: SpotProps) {
  const { npub, name, picture, isLoading } = useProfile(entry.pubkey);
  const medal = MEDAL[medalFor(entry.rank)];
  const first = entry.rank === 1;
  const label = isSelf ? 'You' : (name ?? 'Anonymous');

  return (
    // The podium's DOM order is 2-1-3 for layout, so `value` keeps each
    // spot's announced number right.
    <li value={entry.rank} className="min-w-0">
      <Link
        to={`/${npub}`}
        onClick={onNavigate}
        className="group flex flex-col items-center rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${label}, rank ${entry.rank}, ${entry.species} species`}
      >
        <div className="relative">
          {first && (
            <Crown
              className="absolute -top-5 left-1/2 size-7 -translate-x-1/2 rotate-[-10deg] fill-amber-400 text-amber-600 drop-shadow motion-safe:animate-bounce dark:text-amber-300"
              style={{ animationDuration: '2.4s' }}
              aria-hidden
            />
          )}
          <Avatar
            className={cn(
              'ring-4 ring-offset-2 ring-offset-background transition-transform group-hover:scale-105',
              medal.ring,
              first ? 'size-16' : 'size-12',
            )}
          >
            {picture && <AvatarImage src={picture} alt="" className="object-cover" />}
            <AvatarFallback>{(name ?? '?').charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
        </div>

        <div className="mt-3 w-full px-1 text-center">
          {isLoading && !name && !isSelf ? (
            <Skeleton className="mx-auto h-4 w-16" />
          ) : (
            <p className={cn('truncate text-sm font-semibold', isSelf && 'text-emerald-700 dark:text-emerald-300')}>
              {label}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{entry.species.toLocaleString()}</span>{' '}
            species
          </p>
        </div>

        <div
          className={cn(
            'relative mt-2 flex w-full origin-bottom items-start justify-center overflow-hidden rounded-t-xl bg-linear-to-b pt-2 shadow-inner motion-safe:animate-podium-rise',
            medal.step,
            first ? 'h-24' : entry.rank === 2 ? 'h-16' : 'h-12',
          )}
          style={{ animationDelay: first ? '0ms' : entry.rank === 2 ? '120ms' : '240ms' }}
          aria-hidden
        >
          <span className={cn('font-serif text-3xl font-bold drop-shadow-sm', medal.text)}>{entry.rank}</span>
          {first && (
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/40 blur-sm motion-safe:animate-lifer-shimmer motion-reduce:hidden" />
          )}
        </div>
      </Link>
    </li>
  );
}

function LeaderRow({ entry, best, isSelf, onNavigate }: SpotProps & { best: number }) {
  const { npub, name, picture, isLoading } = useProfile(entry.pubkey);
  const label = isSelf ? 'You' : (name ?? 'Anonymous');
  const barStyle: CSSProperties = { width: `${Math.max(4, (entry.species / best) * 100)}%` };

  return (
    <li value={entry.rank}>
      <Link
        to={`/${npub}`}
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isSelf && 'bg-emerald-500/10 ring-1 ring-emerald-500/30 hover:bg-emerald-500/15',
        )}
        aria-label={`${label}, rank ${entry.rank}, ${entry.species} species`}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums text-muted-foreground">
          {entry.rank}
        </span>
        <Avatar className="size-10">
          {picture && <AvatarImage src={picture} alt="" className="object-cover" />}
          <AvatarFallback>{(name ?? '?').charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            {isLoading && !name && !isSelf ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <p className={cn('truncate text-sm font-semibold', isSelf && 'text-emerald-700 dark:text-emerald-300')}>
                {label}
              </p>
            )}
            <p className="shrink-0 text-sm font-semibold tabular-nums">{entry.species.toLocaleString()}</p>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full origin-left rounded-full bg-linear-to-r from-emerald-400 to-emerald-600 motion-safe:animate-bar-grow"
              style={barStyle}
            />
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Placeholder shaped like the podium and first few rows. */
export function FriendsLeaderboardSkeleton() {
  return (
    <div aria-hidden>
      <div className="rounded-2xl border px-3 pt-4">
        <Skeleton className="mb-5 ml-1 h-4 w-28" />
        <div className="grid grid-cols-3 items-end gap-2">
          {['h-16', 'h-24', 'h-12'].map((h, i) => (
            <div key={i} className="flex flex-col items-center">
              <Skeleton className={cn('rounded-full', i === 1 ? 'size-16' : 'size-12')} />
              <Skeleton className="mt-3 h-4 w-14" />
              <Skeleton className="mt-1 h-3 w-10" />
              <Skeleton className={cn('mt-2 w-full rounded-b-none rounded-t-xl', h)} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
