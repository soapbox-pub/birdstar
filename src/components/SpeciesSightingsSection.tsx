// "Recent sightings" section rendered inside `BirdInfoDialog`. Shows
// which of the user's friends (NIP-02 follows) — including the user
// themselves — have heard this species, as a horizontal strip of
// overlapping avatars.
//
// This is a deliberately minimal presentation: no per-event rows,
// no timestamps, no repeated bird portraits. The dialog's banner and
// title already establish the species; all this section needs to
// communicate is *who* in the user's social graph has heard it. A
// horizontal avatar strip reads at a glance — "2 of my friends have
// heard this one" — and scales cleanly on narrow phone dialogs
// without stealing vertical space from the Wikipedia extract, map,
// and discussion below.
//
// Dedupe rule: one avatar per pubkey. A friend who has logged the
// same species 30 times still appears once. The underlying hook
// already caps event count generously (see `useSpeciesSightings`),
// so "covered friends" here is a near-perfect reflection of the
// actual social graph.
//
// Overflow rule: up to `VISIBLE_MAX` avatars render inline; any
// remainder collapses into a "+N" chip on the right. This mirrors
// the Slack / Linear / Figma "who's here" strip convention and keeps
// the row from running off narrow dialogs.
//
// No "Show more" interaction: the section is informational only.
// Clicking through to a full list would land somewhere outside the
// dialog (the Birds-page feed) which is a different surface; keeping
// the strip non-interactive avoids dead ends.
import { useMemo } from 'react';

import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSpeciesSightings } from '@/hooks/useSpeciesSightings';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { NostrMetadata } from '@nostrify/nostrify';

/** Maximum number of avatars rendered inline before overflow rolls
 *  into a "+N" chip. Eight fits comfortably on a 360px dialog with
 *  -ml-2 overlap + 2px ring, and matches the "team strip" convention
 *  used by Slack, Linear, and Figma. */
const VISIBLE_MAX = 8;

interface SpeciesSightingsSectionProps {
  /** Wikidata entity URI for the species. When null the parent
   *  should not render this component at all — the hook would be
   *  disabled anyway, but we guard here to avoid a dead UI slot. */
  entityUri: string | null;
}

/**
 * Section header + horizontal avatar strip of friends (plus the user
 * themselves) who have heard this species. Renders nothing when
 * logged out (no social graph to query) or when there's no
 * `entityUri` to scope the search.
 */
export function SpeciesSightingsSection({
  entityUri,
}: SpeciesSightingsSectionProps) {
  const { user } = useCurrentUser();
  const { items, isLoading, followsReady } = useSpeciesSightings(entityUri);

  // Dedupe by author pubkey. `items` arrives newest-first from the
  // hook, so preserving first-seen order gives us a "most recently
  // heard" ordering for free — the friend whose most recent
  // detection is freshest shows up leftmost.
  //
  // Self is hoisted to the front when present so the user's own
  // avatar leads the strip. Recognizing your own face first is the
  // fastest way to parse "have *I* heard this?" at a glance, and
  // avoids an inconsistent position depending on post timing.
  const friendPubkeys = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const item of items) {
      if (seen.has(item.pubkey)) continue;
      seen.add(item.pubkey);
      ordered.push(item.pubkey);
    }
    if (user && seen.has(user.pubkey)) {
      // Move self to the front; no-op if already first.
      const rest = ordered.filter((p) => p !== user.pubkey);
      return [user.pubkey, ...rest];
    }
    return ordered;
  }, [items, user]);

  // Logged out: no social graph to query, and the feature doesn't
  // meaningfully exist in that state. Hide the section entirely
  // rather than showing an empty card that would confuse the story.
  if (!user) return null;

  // Species has no Wikidata id — can't query by entity URI. Hiding
  // the section matches the behavior of the sibling "Discussion"
  // section on the same data boundary.
  if (!entityUri) return null;

  const overflow = Math.max(0, friendPubkeys.length - VISIBLE_MAX);
  const visiblePubkeys = friendPubkeys.slice(0, VISIBLE_MAX);

  return (
    <section className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
      <h3 className="font-serif text-lg">Recent sightings</h3>
      {/* Three possible states:
          - Loading (follow list still resolving OR query in flight):
            a short row of avatar skeletons.
          - Resolved with friends: the strip.
          - Resolved with none: a compact empty line. */}
      {!followsReady || isLoading ? (
        <AvatarStripSkeleton />
      ) : visiblePubkeys.length > 0 ? (
        <div className="flex items-center">
          {/* Overlapping strip. Each avatar slides under its *right*
              neighbour so the leftmost (first) face reads as
              primary — the Slack/Figma convention. We get this by
              using `flex-row-reverse` + negative *right* margin:
              that way the DOM-first item ends up visually leftmost
              AND, because later siblings paint on top in normal
              stacking order, the visually-leftmost avatar
              automatically sits on top of its right neighbour
              without any explicit z-index. Reading order in the
              DOM still matches visual left-to-right for screen
              readers and keyboard users. */}
          <ul className="flex flex-row-reverse justify-end">
            {visiblePubkeys.map((pubkey, i) => (
              <li
                key={pubkey}
                className={cn(i < visiblePubkeys.length - 1 && '-mr-2')}
              >
                <FriendAvatar
                  pubkey={pubkey}
                  isSelf={user.pubkey === pubkey}
                />
              </li>
            ))}
          </ul>
          {overflow > 0 ? (
            <span
              className={cn(
                'ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full',
                'bg-stone-100 text-xs font-semibold text-stone-600 ring-2 ring-background',
                'dark:bg-stone-800 dark:text-stone-200',
              )}
              title={`${overflow} more`}
              aria-label={`${overflow} more friends`}
            >
              +{overflow}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-sm italic text-stone-400 dark:text-stone-500">
          No one you follow has heard this bird yet.
        </p>
      )}
    </section>
  );
}

function AvatarStripSkeleton() {
  // Three pill-sized circles, overlapping like the real strip. Kept
  // static (no animation-staggered pulses) because the real row is
  // so compact the skeleton is only visible for a blink anyway.
  return (
    <div className="flex" aria-hidden>
      {[0, 1, 2].map((i) => (
        <Skeleton
          key={i}
          className={cn(
            'size-9 shrink-0 rounded-full ring-2 ring-background',
            i > 0 && '-ml-2',
          )}
        />
      ))}
    </div>
  );
}

interface FriendAvatarProps {
  pubkey: string;
  isSelf: boolean;
}

function FriendAvatar({ pubkey, isSelf }: FriendAvatarProps) {
  const author = useAuthor(pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;
  const displayName =
    metadata?.name ?? metadata?.display_name ?? 'Anonymous';
  const picture = metadata?.picture ?? null;

  // `title` gives a hover tooltip on desktop; `aria-label` carries
  // the same information for assistive tech. "You" is the same
  // wording used elsewhere in the dialog (e.g. the BirdFeed rows)
  // so the user recognises themselves consistently.
  const label = isSelf ? `You heard this` : `${displayName} heard this`;

  return (
    <span
      className={cn(
        'inline-flex size-9 items-center justify-center overflow-hidden rounded-full',
        'bg-linear-to-br from-stone-200 to-stone-300',
        'text-[11px] font-semibold text-stone-600',
        'ring-2 ring-background',
        'dark:from-stone-700 dark:to-stone-800 dark:text-stone-200',
      )}
      title={label}
      aria-label={label}
    >
      {picture ? (
        <img
          src={picture}
          alt=""
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <span aria-hidden>{initials(displayName)}</span>
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
