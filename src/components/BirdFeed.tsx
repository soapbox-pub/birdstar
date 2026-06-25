// The "Recent sightings" feed rendered under the birdex in Birds
// mode. Shows kind 2473 detections authored by the logged-in user
// plus everyone they follow, newest-first, with cursor-based infinite
// scroll.
//
// Structured as a single thin presentational module over
// `useFollowsBirdFeed`:
//
//   BirdFeed                — top-level section, handles gate states
//   └── FeedRow             — one detection (friend pfp + bird thumb + copy)
//
// Tapping a row navigates to `/bird/:slug` (the shareable bird-detail
// deep link); BirdsIndex's URL → dialog sync then opens the shared
// BirdInfoDialog. Keeping a single dialog instance in BirdsIndex (rather
// than one per surface) means every entry point yields the same
// shareable URL and the back button closes the dialog.
//
// There is no empty state and no loading skeleton by design —
// whenever the feed has zero items for any reason (logged out, no
// follows, follows haven't published anything, or the initial fetch
// is still in flight) the whole section is omitted. Mounting a
// skeleton or empty card above the player bar would compete with
// the birdex for the same "you haven't heard anything yet" story
// the birdex already owns. The section pops in silently as soon as
// the first real detection lands, which is fine for non-critical
// exploratory content.
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
import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import { Bird, Loader2 } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { NostrMetadata } from '@nostrify/nostrify';

import { Card } from '@/components/ui/card';
import { useAuthor } from '@/hooks/useAuthor';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useFollowsBirdFeed,
  type BirdFeedItem,
} from '@/hooks/useFollowsBirdFeed';
import { birdSlug } from '@/lib/birdSlug';
import { cn } from '@/lib/utils';

/** Render the feed when logged in. Hides itself entirely when logged
 *  out — no follow list means nothing useful to show, and the empty
 *  state would be misleading. The caller (BirdsIndex) conditionally
 *  mounts this component based on the same signal. */
export function BirdFeed() {
  const { user } = useCurrentUser();
  const {
    items,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useFollowsBirdFeed();

  // Tapping a row navigates to the shareable bird-detail URL; the
  // shared dialog (owned by BirdsIndex) opens from that route. We
  // navigate by the detection's scientific name rather than passing a
  // full Detection up — the URL is the single source of truth, and
  // BirdsIndex resolves the species (including a richer detection
  // subject when the species is in the viewer's own dex).
  const navigate = useNavigate();
  const openDetail = useCallback(
    (scientificName: string) => {
      if (!scientificName) return;
      navigate(`/bird/${birdSlug(scientificName)}`);
    },
    [navigate],
  );

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

  // Hide the section entirely whenever there are no items — whether
  // that's because the initial fetch is still in flight, the user
  // has no follows, or nobody on their list has ever published a
  // kind 2473 event. The birdex above already handles the "you
  // haven't heard anything yet" story; stacking a skeleton or empty
  // card underneath it would be redundant noise.
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <SectionHeader />
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <FeedRow item={item} onOpen={openDetail} />
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
    </>
  );
}

function SectionHeader() {
  return (
    <div className="mb-4">
      <h2 className="font-serif text-xl font-semibold text-stone-900 dark:text-stone-50">
        Recent sightings
      </h2>
    </div>
  );
}

interface FeedRowProps {
  item: BirdFeedItem;
  onOpen: (scientificName: string) => void;
}

function FeedRow({ item, onOpen }: FeedRowProps) {
  const author = useAuthor(item.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;

  const displayName =
    metadata?.name ?? metadata?.display_name ?? 'Anonymous';
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

  const navigate = useNavigate();

  const handleOpen = () => onOpen(item.scientificName);

  const handleOpenProfile = () => {
    navigate(`/${nip19.npubEncode(item.pubkey)}`);
  };

  return (
    <Card className="flex items-stretch overflow-hidden border-stone-200/70 bg-white/80 shadow-sm shadow-stone-900/5 backdrop-blur-sm transition-colors dark:border-indigo-900/40 dark:bg-indigo-950/40">
      {/* Author portrait + bird thumbnail. Tapping navigates to the
          author's profile (`/npub1…`). Kept as its own button —
          separate from the bird-info trigger — so the two destinations
          don't fight, and so we never nest interactive elements. */}
      <button
        type="button"
        onClick={handleOpenProfile}
        aria-label={`View ${isSelf ? 'your' : `${displayName}'s`} profile`}
        className={cn(
          'flex shrink-0 items-center py-3 pl-3 pr-1',
          'transition-transform hover:-translate-y-px',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
          'dark:focus-visible:ring-amber-400/60',
        )}
      >
        {/* Overlapping friend portrait + bird thumbnail. Same idiom
            as FollowDetectionToaster so the feed reads as a
            persisted log of the same events that trigger toasts. */}
        <div className="relative flex items-center">
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
      </button>

      {/* Detection copy. Tapping opens the bird info dialog. */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Open info about ${item.commonName}`}
        className={cn(
          'flex min-w-0 flex-1 items-center py-3 pl-2 pr-3 text-left',
          'transition-transform hover:-translate-y-px',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
          'dark:focus-visible:ring-amber-400/60',
        )}
      >
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
