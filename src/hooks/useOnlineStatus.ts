// Tracks whether the browser currently believes it has a network
// connection, via `navigator.onLine` plus the `online`/`offline` window
// events. Used to drive flushing of the offline bird-detection publish
// queue (see birdQueueStore + useAutoPublishDetection).
//
// `navigator.onLine` is a hint, not a guarantee — it reports the OS-level
// link state, so it can be `true` behind a captive portal or a dead
// upstream. That's fine for our purpose: we use it to *trigger* a flush
// attempt, and the actual publish either succeeds or re-queues. The cost
// of a false "online" is one failed publish attempt; we never drop data
// because of it.

import { useEffect, useState } from 'react';

function getInitialOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // `onLine` is defined everywhere we care about; default to online when
  // the property is somehow missing rather than blocking publishes.
  return navigator.onLine ?? true;
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(getInitialOnline);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
