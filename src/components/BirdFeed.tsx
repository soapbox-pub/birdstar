// The "Recent sightings" feed rendered under the birdex in Birds
// mode. Shows kind 2473 detections authored by the logged-in user
// plus everyone they follow, newest-first, with cursor-based infinite
// scroll.
//
// Structured as a single thin presentational module over
// `useFollowsBirdFeed`:
//
//   BirdFeed                — top-level section, handles gate states
//   ├── EmptyState          — dashed card for "no sightings yet"
//   ├── FeedRowSkeleton     — placeholder row while the first page loads
//   └── FeedRow             — one detection (friend pfp + bird thumb + copy)
//       └── BirdInfoDialog  — opens on tap (shared with the birdex)
//
// The row layout intentionally mirrors `FollowDetectionToaster`'s
// toast body — two overlapping portraits (friend on the left, bird
// on the right) so the visual idiom "your friend heard this bird" is
// consistent between the transient toast and the persistent feed.
//
// Inspired by Ditto's Feed component
// (~/Projects/ditto/src/components/Feed.tsx): infinite-scroll
// sentinel via `react-intersection-observer`, a matching skeleton
// while the first page loads, a dashed empty-state card, and a tiny
// loader at the bottom while the next page streams in.
import { useCallback, useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { Bird, Loader2 } from 'lucide-react';
import type { NostrMetadata } from '@nostrify/nostrify';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BirdInfoDialog,
  type BirdSubject,
} from '@/components/BirdInfoDialog';
import type { Detection } from '@/components/BirdCard';
import { useAuthor } from '@/hooks/useAuthor';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useFollowsBirdFeed,
  type BirdFeedItem,
} from '@/hooks/useFollowsBirdFeed';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

/** Render the feed when logged in. Hides itself entirely when logged
 *  out — no follow list means nothing useful to show, and the empty
 *  state would be misleading. The caller (BirdsIndex) conditionally
 *  mounts this component based on the same signal. */
export function BirdFeed() {
  const { user } = useCurrentUser();
  const {
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    followsReady,
  } = useFollowsBirdFeed();

  // Shared dialog subject — lifted up here so opening one row's
  // dialog doesn't retain the previous row's data after the dialog
  // closes.
  const [subject, setSubject] = useState<BirdSubject | null>(null);
  const openDialog = useCallback((detection: Detection) => {
    setSubject({ kind: 'detection', detection });
  }, []);
  const closeDialog = useCallback((open: boolean) => {
    if (!open) setSubject(null);
  }, []);

  // Intersection sentinel for infinite scroll. `rootMargin: 400px`
  // means we start the next fetch while the user is still ~400px
  // away from the bottom, so the network round-trip overlaps with
  // continued scrolling instead of stalling it.
  const { ref: sentinelRef, inView: sentinelInView } = useInView({
    threshold: 0,
    rootMargin: '400px 0px',
  });
  useEffect(() => {
    if (sentinelInView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [sentinelInView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Don't render anything for logged-out users. BirdsIndex already
  // gates on `user`, but we double-check here so the component can
  // be moved without reintroducing a logged-out empty state.
  if (!user) return null;

  const showSkeletons = !followsReady || isLoading;

  return (
    <>
      <SectionHeader />
      {showSkeletons ? (
        <FeedRowSkeletonList />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <FeedRow item={item} onOpen={openDialog} />
            </li>
          ))}
          {hasNextPage ? (
            <li
              ref={sentinelRef}
              className="flex items-center justify-center py-6"
              aria-hidden={!isFetchingNextPage}
            >
              {isFetchingNextPage ? (
                <Loader2 className="size-5 animate-spin text-stone-400 dark:text-stone-500" />
              ) : (
                // Reserve space so the sentinel is always in-flow
                // and the IntersectionObserver has something to
                // measure against; invisible when not loading.
                <span className="h-5" aria-hidden />
              )}
            </li>
          ) : null}
        </ul>
      )}
      <BirdInfoDialog
        subject={subject}
        open={subject !== null}
        onOpenChange={closeDialog}
      />
    </>
  );
}

function SectionHeader() {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <h2 className="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
        Recent sightings
      </h2>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        From you and the people you follow
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed bg-transparent">
      <CardContent className="flex flex-col items-center px-8 py-12 text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          <Bird className="size-6" aria-hidden />
        </div>
        <p className="max-w-sm text-sm text-stone-600 dark:text-stone-400">
          No sightings yet. Once you hear a bird — or the people you follow
          do — their detections will appear here.
        </p>
      </CardContent>
    </Card>
  );
}

interface FeedRowProps {
  item: BirdFeedItem;
  onOpen: (detection: Detection) => void;
}

function FeedRow({ item, onOpen }: FeedRowProps) {
  const author = useAuthor(item.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;

  const displayName =
    metadata?.name ?? metadata?.display_name ?? genUserName(item.pubkey);
  const friendPicture = metadata?.picture ?? null;

  // Pre-fetched so tapping through to the dialog feels instant.
  // `useBirdInfo` is shared with BirdCard / BirdInfoDialog and is
  // cached by React Query — repeated renders don't cost anything.
  const { data: birdInfo } = useBirdInfo(
    item.scientificName,
    item.commonName,
  );

  const { user } = useCurrentUser();
  const isSelf = user?.pubkey === item.pubkey;

  const detection: Detection = {
    id: item.id,
    scientificName: item.scientificName,
    commonName: item.commonName,
    timestamp: item.timestamp,
    eventId: item.id,
  };

  const handleOpen = () => onOpen(detection);

  return (
    <Card className="overflow-hidden border-stone-200/70 bg-white/80 shadow-sm shadow-stone-900/5 backdrop-blur-sm transition-colors dark:border-indigo-900/40 dark:bg-indigo-950/40">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Open info about ${item.commonName}`}
        className={cn(
          'flex w-full items-center gap-3 p-3 text-left',
          'transition-transform hover:-translate-y-px',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
          'dark:focus-visible:ring-amber-400/60',
        )}
      >
        {/* Overlapping friend portrait + bird thumbnail. Same idiom
            as FollowDetectionToaster so the feed reads as a
            persisted log of the same events that trigger toasts. */}
        <div className="relative flex shrink-0 items-center">
          <Avatar
            src={friendPicture}
            alt={displayName}
            className="size-12 ring-2 ring-background"
          />
          <span
            className={cn(
              '-ml-3 inline-flex size-12 items-center justify-center overflow-hidden rounded-full',
              'ring-2 ring-background',
              'bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100',
              'dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60',
            )}
          >
            {birdInfo?.imageUrl ? (
              <img
                src={birdInfo.imageUrl}
                alt={item.commonName}
                className="size-full object-cover"
                loading="lazy"
              />
            ) : (
              <Bird
                className="size-5 text-emerald-700 dark:text-emerald-200"
                aria-hidden
              />
            )}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-50">
              {isSelf ? 'You' : displayName}
            </span>
            <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
              · {timeAgo(item.timestamp)}
            </span>
          </div>
          <p className="truncate text-sm text-stone-600 dark:text-stone-300">
            heard{' '}
            <span className="font-medium text-stone-900 dark:text-stone-50">
              {vowelArticle(item.commonName)} {item.commonName}
            </span>
          </p>
          <p className="truncate text-xs italic text-stone-500 dark:text-stone-400">
            {item.scientificName}
          </p>
        </div>
      </button>
    </Card>
  );
}

function FeedRowSkeletonList() {
  // 4 rows is enough to fill a typical mobile viewport without
  // overwhelming desktop. Keyed by index since they're identical.
  return (
    <ul className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <FeedRowSkeleton />
        </li>
      ))}
    </ul>
  );
}

function FeedRowSkeleton() {
  return (
    <Card className="overflow-hidden border-stone-200/70 bg-white/60 dark:border-indigo-900/40 dark:bg-indigo-950/30">
      <div className="flex items-center gap-3 p-3">
        <div className="relative flex shrink-0 items-center">
          <Skeleton className="size-12 rounded-full ring-2 ring-background" />
          <Skeleton className="-ml-3 size-12 rounded-full ring-2 ring-background" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </Card>
  );
}

// Small avatar with an initials fallback — mirrors the one in
// FollowDetectionToaster so a future extraction can swap either
// site for a shared primitive. We intentionally don't use the
// Radix-based `ui/avatar` component here because the toast-style
// "initials on a tinted gradient" background isn't one of its
// variants and adding it would drag in extra props for a one-off.
function Avatar({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center overflow-hidden rounded-full',
        'bg-linear-to-br from-stone-200 to-stone-300',
        'text-xs font-semibold text-stone-600',
        'dark:from-stone-700 dark:to-stone-800 dark:text-stone-200',
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <span aria-hidden>{initials(alt)}</span>
      )}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "an American Robin" vs. "a Northern Cardinal". Same cheap heuristic
 *  used by FollowDetectionToaster. */
function vowelArticle(word: string): string {
  if (!word) return 'a';
  return /^[aeiouAEIOU]/.test(word) ? 'an' : 'a';
}

/** Relative timestamp with graceful fallback to an absolute date for
 *  anything older than a week. Shared-free (no dependency on
 *  date-fns) because the format is intentionally compact — matches
 *  Ditto's `timeAgo` helper. */
function timeAgo(ms: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
