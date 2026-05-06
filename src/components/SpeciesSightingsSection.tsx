// "Recent sightings" section rendered inside `BirdInfoDialog`. Shows
// detections of the currently-viewed species authored by the
// logged-in user or anyone they follow.
//
// This is intentionally a distinct component from the top-level
// `BirdFeed` / `FeedRow` on the Birds page:
//
//   - `FeedRow` is species-agnostic (shows the friend AND the bird
//     portraits, with bird+name copy) because the Birds-page feed
//     mixes many species in one list.
//   - Inside the dialog the species is already established by the
//     dialog's title + banner, so each row only needs the friend's
//     avatar + name + timestamp. Repeating the bird portrait on
//     every row would be redundant noise.
//   - `FeedRow` also opens *another* `BirdInfoDialog` on click; doing
//     that from inside an already-open dialog would nest dialogs,
//     which isn't a great interaction. Rows in this component are
//     non-interactive — they're informational.
//
// Empty state is explicit (unlike the Birds-page feed which hides
// itself when empty): the section heading has already set the
// expectation that a list follows, so a tiny empty card keeps the
// layout honest. No sightings is useful information in the dialog
// context ("none of my friends have heard this one yet").
import { useState } from 'react';

import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useSpeciesSightings,
  type SpeciesSightingItem,
} from '@/hooks/useSpeciesSightings';
import { genUserName } from '@/lib/genUserName';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { NostrMetadata } from '@nostrify/nostrify';

/** Number of sightings visible before the user taps "Show more". The
 *  hook itself fetches up to 20 (its internal PAGE_SIZE), so the
 *  expanded view caps there. Three is short enough to keep the dialog
 *  compact on a phone while still giving a hint of social activity
 *  without interaction — the common species will have 1–2 sightings
 *  from close friends and the collapsed view fits them all. */
const COLLAPSED_COUNT = 3;

interface SpeciesSightingsSectionProps {
  /** Wikidata entity URI for the species. When null the parent
   *  should not render this component at all — the hook would be
   *  disabled anyway, but we guard here to avoid a dead UI slot. */
  entityUri: string | null;
}

/**
 * Section header + list of recent sightings for a single species from
 * the user's social graph. Renders nothing when logged out (no graph
 * to query) or when there's no `entityUri` to scope the search.
 */
export function SpeciesSightingsSection({
  entityUri,
}: SpeciesSightingsSectionProps) {
  const { user } = useCurrentUser();
  const { items, isLoading, followsReady } = useSpeciesSightings(entityUri);

  // Reset the expanded state when the dialog switches species. Done
  // as an in-render state adjustment keyed on `entityUri` rather
  // than an effect — React explicitly allows this, skips an extra
  // render cycle, and avoids the react-hooks/set-state-in-effect
  // lint. Same pattern as `CollapsibleProse` in BirdInfoDialog.tsx.
  const [expanded, setExpanded] = useState(false);
  const [prevEntity, setPrevEntity] = useState(entityUri);
  if (prevEntity !== entityUri) {
    setPrevEntity(entityUri);
    setExpanded(false);
  }

  // Logged out: no social graph to query, and the feature doesn't
  // meaningfully exist in that state. Hide the section entirely
  // rather than showing an empty card that would confuse the story.
  if (!user) return null;

  // Species has no Wikidata id — can't query by entity URI. Hiding
  // the section matches the behavior of the sibling "Discussion"
  // section on the same data boundary.
  if (!entityUri) return null;

  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  const hiddenCount = Math.max(0, items.length - COLLAPSED_COUNT);

  return (
    <section className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
      <h3 className="font-serif text-lg">Recent sightings</h3>
      {/* Three possible states:
          - Loading (follow list still resolving OR query in flight):
            skeletons. Followed list loading is the common case on
            first dialog open and is essentially instant after that.
          - Resolved with items: the list (clipped to COLLAPSED_COUNT
            until "Show more" is tapped).
          - Resolved with no items: a compact empty card. */}
      {!followsReady || isLoading ? (
        <SightingsSkeleton />
      ) : items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {visibleItems.map((item) => (
              <li key={item.id}>
                <SightingRow
                  item={item}
                  isSelf={user.pubkey === item.pubkey}
                />
              </li>
            ))}
          </ul>
          {/* Toggle visibility only when there's actually more to
              show. Collapsed state exposes the hidden count so the
              user knows the cost of expanding. Expanded state just
              offers the symmetric "Show less" to collapse back. */}
          {hiddenCount > 0 || expanded ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className={cn(
                'text-sm font-semibold underline-offset-2 hover:underline',
                'transition-colors focus:outline-none focus-visible:underline',
                'text-emerald-700 hover:text-emerald-800',
                'dark:text-amber-300 dark:hover:text-amber-200',
              )}
            >
              {expanded ? 'Show less' : `Show more (${hiddenCount})`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-sm italic text-stone-400 dark:text-stone-500">
          No one you follow has heard this bird yet.
        </p>
      )}
    </section>
  );
}

function SightingsSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {[0, 1].map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-md px-2 py-1.5"
        >
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </li>
      ))}
    </ul>
  );
}

interface SightingRowProps {
  item: SpeciesSightingItem;
  isSelf: boolean;
}

function SightingRow({ item, isSelf }: SightingRowProps) {
  const author = useAuthor(item.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;
  const displayName =
    metadata?.name ?? metadata?.display_name ?? genUserName(item.pubkey);
  const picture = metadata?.picture ?? null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-1.5',
        'bg-stone-50/60 dark:bg-indigo-950/30',
      )}
    >
      <Avatar src={picture} alt={displayName} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-stone-700 dark:text-stone-200">
          <span className="font-semibold text-stone-900 dark:text-stone-50">
            {isSelf ? 'You' : displayName}
          </span>{' '}
          <span className="text-stone-500 dark:text-stone-400">
            heard this · {timeAgo(item.timestamp)}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Small avatar with an initials fallback — matches the idiom used
 *  in `BirdFeed` and `FollowDetectionToaster`. Kept inline here
 *  rather than factored out because the three sites differ slightly
 *  (border-ring, size) and the primitive itself is trivial. */
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
        'text-[10px] font-semibold text-stone-600',
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

/** Compact relative-time formatter. Duplicates the one in
 *  `BirdFeed.tsx` — kept local so this component has no cross-file
 *  runtime dependency on the Birds-page feed. Same format & rules. */
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
