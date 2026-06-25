// Tracks how many bird detections are currently waiting in the offline
// publish queue (see birdQueueStore). This is the backlog a user has built
// up while offline OR while logged out — sightings that have been captured
// locally but not yet published to Nostr.
//
// The queue is mutated imperatively from the publish pipeline (enqueue on
// capture-while-offline / capture-while-logged-out, remove on a successful
// flush), not through React state, so we subscribe to the store's change
// notifications to stay live and re-read the count on each change. We also
// re-read on mount so the very first render reflects anything left over
// from a previous session.

import { useEffect, useState } from 'react';
import {
  getQueuedCount,
  subscribeQueueChanged,
} from '@/lib/birdQueueStore';

export function useQueuedDetectionCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      void getQueuedCount().then((next) => {
        if (!cancelled) setCount(next);
      });
    };

    // Initial read + subscribe to subsequent enqueue/remove/clear events.
    refresh();
    const unsubscribe = subscribeQueueChanged(refresh);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return count;
}
