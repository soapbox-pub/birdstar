// A subtle, inline banner shown in Birds mode when the user has captured
// birds while logged out. Those sightings are saved to the local offline
// publish queue (see birdQueueStore + useAutoPublishDetection) and will be
// published to Nostr automatically the moment the user logs in — the flush
// effect in BirdsIndex drains the queue on the logged-out → logged-in
// transition. This banner makes that value visible: it tells the user how
// many birds are waiting and gives them a one-tap path to log in via the
// embedded LoginArea.
//
// It renders nothing when the user is logged in (the queue flushes on its
// own and the banner has no purpose) or when the backlog is empty. We read
// the live count from `useQueuedDetectionCount`, which stays in sync with
// the queue via the store's change notifications.

import { CloudUpload } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useQueuedDetectionCount } from '@/hooks/useQueuedDetectionCount';
import { cn } from '@/lib/utils';

export interface PendingPublishNudgeProps {
  className?: string;
}

export function PendingPublishNudge({ className }: PendingPublishNudgeProps) {
  const { user } = useCurrentUser();
  const pending = useQueuedDetectionCount();

  // Only relevant to a logged-out user who has actually banked some
  // sightings. Logged in, the queue flushes automatically; with nothing
  // queued there's nothing to nudge about.
  if (user || pending === 0) return null;

  const birds = pending === 1 ? 'bird' : 'birds';

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-center shadow-sm backdrop-blur sm:flex-row sm:text-left dark:border-emerald-900/50 dark:bg-emerald-950/40',
        className,
      )}
    >
      <CloudUpload
        className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
        strokeWidth={2}
      />
      <p className="flex-1 text-sm leading-snug text-emerald-900 dark:text-emerald-100">
        <span className="font-semibold">
          {pending} {birds} saved
        </span>{' '}
        on this device. Log in to publish your detections and Birdex to Nostr.
      </p>
      <LoginArea className="shrink-0" />
    </div>
  );
}

export default PendingPublishNudge;
