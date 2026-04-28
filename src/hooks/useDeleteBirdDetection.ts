// Publishes a NIP-09 deletion request (kind 5) for a previously published
// bird detection (kind 2473). The caller supplies the detection whose
// `eventId` points at the event to be deleted; we optimistically remove it
// from the cached history so the UI updates instantly, with a rollback on
// publish failure.
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import type { Detection } from '@/components/BirdCard';

export interface DeleteBirdDetectionApi {
  /** Submit a deletion request for the given detection. Requires `eventId`. */
  deleteDetection: (detection: Detection) => Promise<void>;
  /** True while any deletion is in flight. */
  isDeleting: boolean;
  /** The set of event ids currently being deleted (for per-card UI state). */
  pendingIds: ReadonlySet<string>;
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

      // NIP-09: include a `k` tag with the original kind so relays can
      // efficiently determine which events to hide.
      await publish({
        kind: 5,
        content: '',
        tags: [
          ['e', detection.eventId],
          ['k', '2473'],
        ],
      });
    },
    // Optimistically remove the detection from the cached bird-history
    // events so the card vanishes immediately.
    onMutate: async (detection) => {
      if (!user?.pubkey || !detection.eventId) return { previous: undefined };

      const queryKey = ['bird-history', user.pubkey] as const;
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<NostrEvent[]>(queryKey);
      if (previous) {
        queryClient.setQueryData<NostrEvent[]>(
          queryKey,
          previous.filter((e) => e.id !== detection.eventId),
        );
      }
      return { previous };
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
    onSuccess: () => {
      // Re-fetch so the kind 5 event we just published is reflected in
      // the cache (and any other logged-in tabs pick it up too).
      if (user?.pubkey) {
        queryClient.invalidateQueries({
          queryKey: ['bird-history', user.pubkey],
        });
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
