// Publishes a NIP-09 deletion request (kind 5) for a previously published
// bird detection (kind 2473). The caller supplies the detection whose
// `eventId` points at the event to be deleted; we optimistically remove it
// from the cached history so the UI updates instantly, with a rollback on
// publish failure.
//
// When the detection being deleted is the user's *last* remaining
// sighting of its species, we also republish their Birdex (kind 12473)
// with that species' `i`/`n` pair removed — keeping the on-relay
// Birdex consistent with the underlying detection log per NIP.md
// §"Kind 12473 — Birdex / Deletion". See also useAutoPublishDetection
// for the mirror-image append-on-lifer flow.
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { BIRDEX_KIND } from '@/hooks/useBirdexEvent';
import type { Detection } from '@/components/BirdCard';

export interface DeleteBirdDetectionApi {
  /** Submit a deletion request for the given detection. Requires `eventId`. */
  deleteDetection: (detection: Detection) => Promise<void>;
  /** True while any deletion is in flight. */
  isDeleting: boolean;
  /** The set of event ids currently being deleted (for per-card UI state). */
  pendingIds: ReadonlySet<string>;
}

/** Canonical Wikidata entity URI shape per NIP.md. */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

/** Return the first `i` tag on a kind 2473 event that looks like a
 * Wikidata entity URI, or null. Mirrors the validation in
 * useBirdHistory.eventToDetection but doesn't require the rest of the
 * detection to be well-formed — all we need is the species identity. */
function entityUriFromDetectionEvent(event: NostrEvent): string | null {
  if (event.kind !== 2473) return null;
  for (const [name, value] of event.tags) {
    if (name !== 'i') continue;
    if (typeof value !== 'string') continue;
    if (!WIKIDATA_ENTITY_URI_RE.test(value)) continue;
    return value;
  }
  return null;
}

/** Collect ids referenced by NIP-09 `e` tags on kind 5 events. */
function collectDeletedIds(events: readonly NostrEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.kind !== 5) continue;
    for (const [name, value] of event.tags) {
      if (name === 'e' && typeof value === 'string') ids.add(value);
    }
  }
  return ids;
}

export function useDeleteBirdDetection(): DeleteBirdDetectionApi {
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Track the set of event ids with in-flight deletion requests. We can't
  // rely on `useMutation.variables` alone because it only reflects the
  // most recent invocation — if the user fires off two deletions in quick
  // succession we still want per-card spinners on both cards.
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  const mutation = useMutation({
    mutationFn: async (detection: Detection) => {
      if (!user) throw new Error('Not logged in');
      if (!detection.eventId) {
        throw new Error('Detection has no underlying event to delete');
      }

      const deletedEventId = detection.eventId;

      // NIP-09: include a `k` tag with the original kind so relays can
      // efficiently determine which events to hide. The paired
      // Birdex-pruning republish (when this was the user's last
      // sighting of the species) lives in onSuccess so it only runs
      // after the deletion itself has landed — see below.
      await publish({
        kind: 5,
        content: '',
        tags: [
          ['e', deletedEventId],
          ['k', '2473'],
        ],
      });
    },
    // Optimistically remove the detection from the cached bird-history
    // events so the card vanishes immediately. We capture the previous
    // snapshot for rollback AND for the Birdex-pruning decision in
    // onSuccess (reading the cache after optimistic removal would
    // hide the event we need to identify the species of).
    onMutate: async (detection) => {
      if (!user?.pubkey || !detection.eventId) {
        return { previous: undefined, previousBirdex: undefined };
      }

      const historyKey = ['bird-history', user.pubkey] as const;
      await queryClient.cancelQueries({ queryKey: historyKey });

      const previous = queryClient.getQueryData<NostrEvent[]>(historyKey);
      if (previous) {
        queryClient.setQueryData<NostrEvent[]>(
          historyKey,
          previous.filter((e) => e.id !== detection.eventId),
        );
      }

      // Snapshot the Birdex event for the post-success pruning pass
      // (and for rollback if the pruning republish itself ever needs
      // one in the future).
      const previousBirdex = queryClient.getQueryData<NostrEvent | null>([
        'birdex-event',
        user.pubkey,
      ]);

      return { previous, previousBirdex };
    },
    onError: (error, _detection, context) => {
      // Roll back the optimistic removal so the card reappears.
      if (user?.pubkey && context?.previous) {
        queryClient.setQueryData(['bird-history', user.pubkey], context.previous);
      }
      console.error('Failed to delete bird detection', error);
      toast({
        title: "Couldn't delete",
        description:
          error instanceof Error
            ? error.message
            : 'The deletion request could not be published.',
        variant: 'destructive',
      });
    },
    onSuccess: async (_data, detection, context) => {
      const pubkey = user?.pubkey;
      if (!pubkey) return;

      // Re-fetch so the kind 5 event we just published is reflected in
      // the cache (and any other logged-in tabs pick it up too).
      queryClient.invalidateQueries({ queryKey: ['bird-history', pubkey] });

      // If we have a pre-delete snapshot and a Birdex, check whether
      // the just-deleted species has any surviving sightings. If not,
      // republish the Birdex without that species.
      const previous = context?.previous;
      const previousBirdex = context?.previousBirdex ?? null;
      if (!previous || !previousBirdex || !detection.eventId) return;

      const deletedEvent = previous.find((e) => e.id === detection.eventId);
      if (!deletedEvent) return;
      const speciesUri = entityUriFromDetectionEvent(deletedEvent);
      if (!speciesUri) return;

      // Gather the set of ids that were already retracted before this
      // deletion, and add the id we just retracted on top.
      const retractedIds = collectDeletedIds(previous);
      retractedIds.add(detection.eventId);

      // Is there any other non-retracted kind 2473 event from this
      // author whose `i` tag matches the same species? If so, the
      // species still belongs on the Birdex.
      const stillSeen = previous.some((event) => {
        if (event.kind !== 2473) return false;
        if (retractedIds.has(event.id)) return false;
        return entityUriFromDetectionEvent(event) === speciesUri;
      });
      if (stillSeen) return;

      // Check the Birdex actually contains this species. If it
      // somehow doesn't (e.g. auto-publish raced with the delete, or
      // the user's Birdex was authored by another tool), there's
      // nothing to prune.
      const birdexHasSpecies = previousBirdex.tags.some(
        ([name, value]) => name === 'i' && value === speciesUri,
      );
      if (!birdexHasSpecies) return;

      // Walk the Birdex tags and emit every tag that ISN'T (a) the
      // `i` tag for this species, or (b) an `n` tag positionally
      // paired with it. We also drop the existing `alt` tag and
      // re-emit it with the new species count so the summary stays
      // accurate for clients that render it.
      const keptPairs: Array<{ i: string; n: string | null }> = [];
      const existingTags = previousBirdex.tags;
      for (let idx = 0; idx < existingTags.length; idx++) {
        const tag = existingTags[idx];
        if (tag[0] !== 'i') continue;
        const uri = tag[1];
        if (typeof uri !== 'string') continue;
        if (!WIKIDATA_ENTITY_URI_RE.test(uri)) continue;
        if (uri === speciesUri) continue;

        const next = existingTags[idx + 1];
        const scientificName =
          next && next[0] === 'n' && typeof next[1] === 'string'
            ? next[1]
            : null;
        keptPairs.push({ i: uri, n: scientificName });
      }

      const newTags: string[][] = [
        ['alt', `Birdex: ${keptPairs.length} species`],
      ];
      for (const entry of keptPairs) {
        newTags.push(['i', entry.i]);
        if (entry.n) newTags.push(['n', entry.n]);
      }

      // Replaceable events must have a strictly greater created_at to
      // win the dedup against the previous Birdex. Clock skew between
      // devices could otherwise leave the old event on the relay.
      const nowSec = Math.floor(Date.now() / 1000);
      const createdAt = Math.max(nowSec, previousBirdex.created_at + 1);

      try {
        await publish({
          kind: BIRDEX_KIND,
          content: '',
          tags: newTags,
          created_at: createdAt,
        });
        queryClient.invalidateQueries({ queryKey: ['birdex-event', pubkey] });
      } catch (err) {
        // The NIP-09 deletion already landed, so the underlying log
        // is correctly trimmed. The Birdex will be one species stale
        // until the user either retries (deletes another detection
        // for the same species — there are none — or hears a fresh
        // lifer) or the event eventually gets resynced. We surface
        // this as a warning rather than a toast so the primary delete
        // action still reads as successful.
        console.warn('Failed to republish pruned Birdex', err);
      }
    },
  });

  const deleteDetection = useCallback(
    async (detection: Detection) => {
      if (!detection.eventId) return;
      const eventId = detection.eventId;
      setPendingIds((prev) => {
        if (prev.has(eventId)) return prev;
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });
      try {
        await mutation.mutateAsync(detection);
      } finally {
        setPendingIds((prev) => {
          if (!prev.has(eventId)) return prev;
          const next = new Set(prev);
          next.delete(eventId);
          return next;
        });
      }
    },
    [mutation],
  );

  return {
    deleteDetection,
    isDeleting: pendingIds.size > 0,
    pendingIds,
  };
}
