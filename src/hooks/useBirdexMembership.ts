// Manual "add to Birdex" for a single species (kind 12473). Complements
// the automatic, detection-coupled growth in useAutoPublishDetection
// (lifer → append) and the pruning in useDeleteBirdDetection (delete →
// prune): this hook lets the user add a species to their Birdex directly
// from the bird detail dialog, independent of whether they've published a
// kind 2473 detection for it.
//
// Removal is intentionally NOT offered here — the bird detail dialog's
// existing Delete action already retracts a species (and prunes it from
// the Birdex), so a second "remove" path would be redundant.
//
// A species is identified by its Wikidata entity URI — the canonical
// identity used everywhere in the app (see NIP.md §"Kind 12473 —
// Birdex"). Adding appends the species' `i`/`n` pair to the end of the
// existing entry list, preserving the historical first-seen ordering of
// everything already on the Birdex, then rebuilds and republishes the
// whole replaceable event (reusing the current Birdex, loaded via
// useBirdexEvent, as the base). Because kind 12473 is replaceable, the
// new event must carry a strictly greater created_at than the prior one
// to win relay dedup, even across clock skew between the user's devices.

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import {
  BIRDEX_KIND,
  useBirdexEvent,
  type BirdexSpeciesEntry,
} from '@/hooks/useBirdexEvent';

/** Canonical Wikidata entity URI shape per NIP.md. */
const WIKIDATA_ENTITY_URI_RE = /^https:\/\/www\.wikidata\.org\/entity\/Q\d+$/;

export interface BirdexMembershipApi {
  /** True when the given species is currently on the user's Birdex. */
  isOnBirdex: boolean;
  /** True while the Birdex event is still loading (membership unknown). */
  isLoading: boolean;
  /** Add this species to the Birdex (no-op if already present). */
  add: () => Promise<void>;
  /** True while an add publish is in flight. */
  isPending: boolean;
}

/**
 * Build the full tag set for a kind 12473 Birdex event from an ordered
 * list of species entries. Mirrors the emit logic in
 * useAutoPublishDetection / useDeleteBirdDetection: an `alt` summary plus
 * positional `i`/`n` pairs, omitting the `n` tag when no scientific name
 * is known.
 */
function buildBirdexTags(entries: BirdexSpeciesEntry[]): string[][] {
  const tags: string[][] = [['alt', `Birdex: ${entries.length} species`]];
  for (const entry of entries) {
    tags.push(['i', entry.entityUri]);
    if (entry.scientificName) tags.push(['n', entry.scientificName]);
  }
  return tags;
}

/**
 * Manual "add to Birdex" control for a single species.
 *
 * Pass the species' Wikidata `entityUri` (the canonical identity) and,
 * when known, its scientific name (stored alongside as the paired `n`
 * tag). When `entityUri` is null — e.g. Wikipedia exposed no
 * `wikibase_item` for the species — there's no stable identity to store,
 * so membership reads as false and `add` no-ops.
 */
export function useBirdexMembership(
  entityUri: string | null,
  scientificName: string | null,
): BirdexMembershipApi {
  const { user } = useCurrentUser();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { event, entries, entityUriSet, isLoading } = useBirdexEvent();

  const [isPending, setIsPending] = useState(false);

  const hasValidUri =
    typeof entityUri === 'string' && WIKIDATA_ENTITY_URI_RE.test(entityUri);
  const isOnBirdex = hasValidUri && entityUriSet.has(entityUri);

  const add = useCallback(async () => {
    if (!user) {
      toast({
        title: 'Log in to use your Birdex',
        description: 'Your Birdex is saved to your Nostr account.',
        variant: 'destructive',
      });
      return;
    }
    if (!hasValidUri || !entityUri) return;
    if (entityUriSet.has(entityUri)) return; // already there

    setIsPending(true);
    try {
      // Append to the end so the existing chronological first-seen order
      // is preserved (see NIP.md §"Entry ordering").
      const nextEntries: BirdexSpeciesEntry[] = [
        ...entries,
        { entityUri, scientificName: scientificName ?? '' },
      ];

      // Replaceable events need a strictly-greater created_at to supersede
      // the prior Birdex; max() guards against device clock skew.
      const nowSec = Math.floor(Date.now() / 1000);
      const createdAt = event
        ? Math.max(nowSec, event.created_at + 1)
        : nowSec;

      await publish({
        kind: BIRDEX_KIND,
        content: '',
        tags: buildBirdexTags(nextEntries),
        created_at: createdAt,
      });
      queryClient.invalidateQueries({
        queryKey: ['birdex-event', user.pubkey],
      });
      toast({ title: 'Added to your Birdex' });
    } catch (err) {
      console.error('Failed to add species to Birdex', err);
      toast({
        title: "Couldn't add to Birdex",
        description:
          err instanceof Error
            ? err.message
            : 'The update could not be published.',
        variant: 'destructive',
      });
    } finally {
      setIsPending(false);
    }
  }, [
    user,
    hasValidUri,
    entityUri,
    entityUriSet,
    entries,
    scientificName,
    event,
    publish,
    queryClient,
    toast,
  ]);

  return {
    isOnBirdex,
    isLoading,
    add,
    isPending,
  };
}
