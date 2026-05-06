// Long-running background subscription for kind 2473 (Bird Detection)
// events published by the logged-in user's follows, surfacing each new
// event to a caller-supplied handler so the UI can render a live toast
// ("your friend just heard an American Robin!").
//
// Design notes:
//
//   - Uses `nostr.req()` — a streaming, NIP-01 REQ subscription — rather
//     than `nostr.query()` which resolves to a one-shot snapshot. We
//     want the tab to keep receiving events as they are published by
//     friends throughout the session.
//
//   - `since: <sub-open time>` combined with `limit: 0` means "send me
//     no stored events, only brand-new ones that arrive after the
//     subscription is open". This keeps the first-load UX quiet: the
//     user doesn't get a stream of toasts for every bird their friends
//     heard yesterday. Per NIP-01, relays are free to still send a
//     small number of stored events to a brand-new REQ even when
//     `limit: 0` is set; we defensively drop any event whose
//     `created_at` is older than our local "subscription opened"
//     timestamp so the invariant is enforced client-side too.
//
//   - Authors list is derived from the user's NIP-02 follow list (kind
//     3). We subscribe only when there's at least one follow — no
//     follows ⇒ nothing to listen for. A `useFollowList` refetch that
//     swaps the follow set causes the effect to tear down the old REQ
//     and open a new one with the new authors.
//
//   - Deduplicates on event id in-session so a relay that replays the
//     same event across reconnects won't fire the handler twice.
import { useNostr } from '@nostrify/react';
import { useEffect, useRef } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/hooks/useFollowList';

export interface UseFollowsBirdDetectionsOptions {
  /**
   * Called once per unique kind 2473 event received from a follow.
   * The callback is invoked from an async iterator loop — implementers
   * should treat it as fire-and-forget and avoid throwing.
   *
   * The identity of this callback doesn't matter: the hook stashes the
   * latest reference in a ref so a parent that passes a fresh inline
   * closure on every render still doesn't force the REQ to tear down
   * and re-open.
   */
  onDetection: (event: NostrEvent) => void;
}

export function useFollowsBirdDetections({
  onDetection,
}: UseFollowsBirdDetectionsOptions): void {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { data: follows } = useFollowList();

  // Keep the latest callback in a ref so changing it doesn't force the
  // subscription to restart. REQ subscriptions are relatively
  // expensive to reopen (round-trip to every relay, re-subscribes to
  // every author) and we don't want consumers to pay that cost for
  // an inline arrow function.
  const onDetectionRef = useRef(onDetection);
  useEffect(() => {
    onDetectionRef.current = onDetection;
  }, [onDetection]);

  // Authors list fingerprint: re-subscribing is only correct when the
  // actual set of followed pubkeys changes. `follows` is a `Set` so
  // identity changes on every query refetch even when contents are
  // identical — joining the sorted values gives a stable key that
  // only flips when membership actually changes.
  const authors = follows ? [...follows].sort() : null;
  const authorsKey = authors?.join(',') ?? '';

  useEffect(() => {
    if (!user) return;
    if (!authors || authors.length === 0) return;

    // Snapshot "now" at subscription-open time. We use this both as
    // the `since` filter to the relay (server-side cutoff) AND as a
    // client-side guard below (defense-in-depth in case a relay
    // ignores the `since` hint or returns slightly older events).
    const openedAt = Math.floor(Date.now() / 1000);

    const ac = new AbortController();
    const seen = new Set<string>();

    (async () => {
      try {
        const iter = nostr.req(
          [
            {
              kinds: [2473],
              authors,
              since: openedAt,
              // limit: 0 — we don't want any historical replay. Only
              // events relays accept after the subscription is open.
              // See header comment for the client-side belt-and-
              // braces enforcement.
              limit: 0,
            },
          ],
          { signal: ac.signal },
        );

        for await (const msg of iter) {
          if (msg[0] !== 'EVENT') continue;
          const event = msg[2];

          // Dedup against in-session replays (relay reconnects,
          // duplicate forwarding between relays in the pool).
          if (seen.has(event.id)) continue;
          seen.add(event.id);

          // Defensive cutoff: some relays don't honor `since`
          // strictly. A bird heard before the app opened isn't
          // "live" news the user needs to hear about right now.
          if (event.created_at < openedAt) continue;

          // Defensive kind check. The REQ filter constrains this,
          // but relays occasionally return events outside the
          // requested filters — particularly public ones with lax
          // validation. Checking here means any downstream UI can
          // trust the event's shape.
          if (event.kind !== 2473) continue;

          try {
            onDetectionRef.current(event);
          } catch (err) {
            // Never let a handler exception break the iterator.
            console.warn('useFollowsBirdDetections handler threw', err);
          }
        }
      } catch (err) {
        // Aborts throw here; that's expected during cleanup.
        if (ac.signal.aborted) return;
        console.warn('useFollowsBirdDetections subscription error', err);
      }
    })();

    return () => {
      ac.abort();
    };
    // authorsKey stands in for `authors` — the effect only needs to
    // restart when membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostr, user?.pubkey, authorsKey]);
}
