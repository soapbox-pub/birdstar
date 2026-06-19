// Deletes a confirmed bird species from the user's records: it publishes a
// NIP-09 deletion request (kind 5) for every loaded kind 2473 detection of
// that species AND republishes the user's Birdex (kind 12473) with the
// species' `i`/`n` pair removed.
//
// The species is identified by its Wikidata entity URI. That URI comes
// either directly off the detection (`entityUri`, present on history- and
// Birdex-derived detections) or, as a fallback, from the kind 2473 event
// referenced by `detection.eventId`. This means a species that lives only in
// the cumulative Birdex (its individual detections have aged off the loaded
// history, or off relays entirely) can still be deleted: there may be no
// 2473 event to retract, but the Birdex is always pruned.
//
// See useAutoPublishDetection for the mirror-image append-on-lifer flow.
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { BIRDEX_KIND } from '@/hooks/useBirdexEvent';
import type { Detection } from '@/components/BirdCard';

export interface DeleteBirdDetectionApi {
  /** Submit a deletion for the given detection's species. */
  deleteDetection: (detection: Detection) => Promise<void>;
  /** True while any deletion is in flight. */
  isDeleting: boolean;
  /** The set of keys currently being deleted (for per-card UI state). */
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

/**
 * Stable key for tracking an in-flight deletion: the underlying event id
 * when present, otherwise the species' entity URI (for Birdex-only species
 * that have no loaded 2473 event).
 */
function pendingKeyFor(detection: Detection): string | null {
  return detection.eventId ?? detection.entityUri ?? null;
}

export function useDeleteBirdDetection(): DeleteBirdDetectionApi {
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Track the set of keys with in-flight deletions. We can't rely on
  // `useMutation.variables` alone because it only reflects the most recent
  // invocation — if the user fires off two deletions in quick succession we
  // still want per-card spinners on both.
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  const mutation = useMutation({
    mutationFn: async (detection: Detection) => {
      if (!user) throw new Error('Not logged in');

      const pubkey = user.pubkey;
      const historyKey = ['bird-history', pubkey] as const;

      // Resolve the species being deleted. Prefer the URI carried on the
      // detection; fall back to the referenced 2473 event's `i` tag.
      const history = queryClient.getQueryData<NostrEvent[]>(historyKey) ?? [];
      let speciesUri = detection.entityUri ?? null;
      if (!speciesUri && detection.eventId) {
        const referenced = history.find((e) => e.id === detection.eventId);
        if (referenced) speciesUri = entityUriFromDetectionEvent(referenced);
      }

      // Retract every loaded, not-already-retracted kind 2473 event for this
      // species. When we know the URI we match on it; otherwise (no URI
      // resolvable) we fall back to just the one referenced event id.
      const alreadyRetracted = collectDeletedIds(history);
      const toRetract = new Set<string>();
      if (speciesUri) {
        for (const event of history) {
          if (event.kind !== 2473) continue;
          if (alreadyRetracted.has(event.id)) continue;
          if (entityUriFromDetectionEvent(event) === speciesUri) {
            toRetract.add(event.id);
          }
        }
      } else if (detection.eventId && !alreadyRetracted.has(detection.eventId)) {
        toRetract.add(detection.eventId);
      }

      if (toRetract.size === 0 && !speciesUri) {
        // Nothing to retract and no species to prune from the Birdex.
        throw new Error('Nothing to delete for this species');
      }

      // NIP-09: one kind 5 referencing every retracted event, with a `k`
      // tag naming the original kind so relays can hide them efficiently.
      if (toRetract.size > 0) {
        await publish({
          kind: 5,
          content: '',
          tags: [
            ...[...toRetract].map((id) => ['e', id] as string[]),
            ['k', '2473'],
          ],
        });
      }

      return { speciesUri };
    },
    // Optimistically remove the species' detections from the cached history
    // so the dex updates instantly. We snapshot the previous state for
    // rollback and for the Birdex-pruning pass in onSuccess.
    onMutate: async (detection) => {
      if (!user?.pubkey) {
        return { previous: undefined, previousBirdex: undefined, speciesUri: null };
      }

      const historyKey = ['bird-history', user.pubkey] as const;
      await queryClient.cancelQueries({ queryKey: historyKey });

      const previous = queryClient.getQueryData<NostrEvent[]>(historyKey);

      // Resolve the species so we can optimistically drop all its events.
      let speciesUri = detection.entityUri ?? null;
      if (!speciesUri && detection.eventId && previous) {
        const referenced = previous.find((e) => e.id === detection.eventId);
        if (referenced) speciesUri = entityUriFromDetectionEvent(referenced);
      }

      if (previous) {
        const next = previous.filter((e) => {
          if (e.kind !== 2473) return true;
          if (speciesUri) return entityUriFromDetectionEvent(e) !== speciesUri;
          return e.id !== detection.eventId;
        });
        queryClient.setQueryData<NostrEvent[]>(historyKey, next);
      }

      // Snapshot the Birdex event for the post-success pruning pass.
      const previousBirdex = queryClient.getQueryData<NostrEvent | null>([
        'birdex-event',
        user.pubkey,
      ]);

      return { previous, previousBirdex, speciesUri };
    },
    onError: (error, _detection, context) => {
      // Roll back the optimistic removal so the cells reappear.
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
    onSuccess: async (_data, _detection, context) => {
      const pubkey = user?.pubkey;
      if (!pubkey) return;

      // Re-fetch so the kind 5 event we just published is reflected in the
      // cache (and any other logged-in tabs pick it up too).
      queryClient.invalidateQueries({ queryKey: ['bird-history', pubkey] });

      const previousBirdex = context?.previousBirdex ?? null;
      const speciesUri = context?.speciesUri ?? null;
      if (!previousBirdex || !speciesUri) return;

      // Prune the species from the Birdex if it's there. (If it somehow
      // isn't — e.g. authored by another tool — there's nothing to do.)
      const birdexHasSpecies = previousBirdex.tags.some(
        ([name, value]) => name === 'i' && value === speciesUri,
      );
      if (!birdexHasSpecies) return;

      // Walk the Birdex tags and emit every tag that ISN'T (a) the `i` tag
      // for this species, or (b) an `n` tag positionally paired with it. We
      // also re-emit the `alt` summary with the new species count.
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

      // Replaceable events must have a strictly greater created_at to win
      // the dedup against the previous Birdex. Clock skew between devices
      // could otherwise leave the old event on the relay.
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
        // The NIP-09 deletion(s) already landed, so the underlying log is
        // correctly trimmed. The Birdex will be one species stale until the
        // event eventually resyncs. We surface this as a warning rather than
        // a toast so the primary delete action still reads as successful.
        console.warn('Failed to republish pruned Birdex', err);
      }
    },
  });

  const deleteDetection = useCallback(
    async (detection: Detection) => {
      const key = pendingKeyFor(detection);
      if (!key) return;
      setPendingIds((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      try {
        await mutation.mutateAsync(detection);
      } finally {
        setPendingIds((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
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
