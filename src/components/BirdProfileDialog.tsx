// Birds-mode profile dialog, opened when the URL resolves to an `npub`
// or `nprofile` while Birds is the active mode. The Stars-mode analogue
// is `ProfileDetailSheet` (a dark bottom-sheet listing the author's
// constellations); this is its bird-world twin — a light/dark-aware
// centered dialog listing the species the author has detected (kind
// 2473), styled to match the Birds checklist aesthetic rather than the
// pinned-dark sky chrome.
//
// Both modes link a user's `npub` to a profile overlay so the
// AccountSwitcher's "view profile" link, feed author taps, and pasted
// profile URLs all resolve to *something* regardless of which world the
// visitor is currently in.
import { Bird, QrCode } from 'lucide-react';
import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { SmartFollowButton } from '@/components/SmartFollowButton';
import { ProfileShareDialog } from '@/components/ProfileShareDialog';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useAuthorBirdDetections,
  type AuthorDetection,
} from '@/hooks/useAuthorBirdDetections';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { cn } from '@/lib/utils';

interface BirdProfileDialogProps {
  /** Author pubkey (hex) to display, or null to keep the dialog closed. */
  pubkey: string | null;
  onClose: () => void;
}

/**
 * Dialog shell. Mirrors the open/close contract of `BirdInfoDialog`
 * (driven by a nullable subject + an `onOpenChange` close handler) so
 * BirdsIndex can wire it the same way.
 */
export function BirdProfileDialog({ pubkey, onClose }: BirdProfileDialogProps) {
  return (
    <Dialog open={!!pubkey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88dvh] gap-0 overflow-hidden p-0 sm:max-w-lg">
        {pubkey && <ProfileBody pubkey={pubkey} />}
      </DialogContent>
    </Dialog>
  );
}

function ProfileBody({ pubkey }: { pubkey: string }) {
  const { user } = useCurrentUser();
  const author = useAuthor(pubkey);
  const { data: detections, isLoading } = useAuthorBirdDetections(pubkey);

  const [shareOpen, setShareOpen] = useState(false);

  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? metadata?.display_name ?? 'Anonymous';
  const picture = metadata?.picture;
  const banner = metadata?.banner;
  const about = metadata?.about;

  const isOwnProfile = user?.pubkey === pubkey;

  useSeoMeta({
    title: `${displayName} — Birdstar`,
    description:
      about ?? `Birds spotted by ${displayName} on Birdstar.`,
  });

  const speciesCount = detections?.length ?? 0;

  return (
    <div className="flex max-h-[88dvh] flex-col">
      {/* Accessible title/description, visually replaced by the custom
          header below. */}
      <DialogHeader className="sr-only">
        <DialogTitle>{displayName}</DialogTitle>
        <DialogDescription>
          Birds spotted by {displayName} on Birdstar.
        </DialogDescription>
      </DialogHeader>

      {/* Banner + identity block */}
      <div className="relative isolate shrink-0">
        {banner ? (
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <img
              src={banner}
              alt=""
              className="h-full w-full object-cover opacity-30 dark:opacity-40"
            />
            <div className="absolute inset-0 bg-linear-to-b from-transparent to-background" />
          </div>
        ) : (
          <div className="absolute inset-0 -z-10 bg-linear-to-b from-emerald-100/70 via-sky-50/40 to-background dark:from-indigo-950/60 dark:via-indigo-950/30 dark:to-background" />
        )}

        <div className="px-6 pb-5 pt-7">
          <div className="flex items-start gap-4">
            {picture ? (
              <img
                src={picture}
                alt=""
                className="size-20 shrink-0 rounded-full object-cover shadow-lg ring-4 ring-background"
              />
            ) : (
              <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-emerald-200 to-sky-200 text-2xl font-semibold text-emerald-800 shadow-lg ring-4 ring-background dark:from-indigo-800 dark:to-indigo-900 dark:text-emerald-200">
                {initials(displayName)}
              </div>
            )}
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-1">
              <h2 className="min-w-0 flex-1 truncate font-serif text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
                {displayName}
              </h2>
              {isOwnProfile ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShareOpen(true)}
                  className="mt-1 shrink-0 gap-1.5 rounded-full font-semibold"
                >
                  <QrCode className="h-4 w-4" />
                  Share
                </Button>
              ) : (
                <SmartFollowButton
                  pubkey={pubkey}
                  size="sm"
                  className="mt-1 shrink-0"
                />
              )}
            </div>
          </div>

          {about && (
            <p className="mt-4 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-stone-700 dark:text-stone-300/90">
              {about}
            </p>
          )}
        </div>
      </div>

      {/* Species list */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
        <div className="mb-4 flex items-center gap-2">
          <Bird className="size-4 text-emerald-600 dark:text-emerald-300/80" />
          <h3 className="text-xs uppercase tracking-widest text-stone-500 dark:text-stone-400">
            {speciesCount > 0
              ? `${speciesCount} ${speciesCount === 1 ? 'species' : 'species'} heard`
              : 'Birds heard'}
          </h3>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-stone-200/70 bg-white/50 p-2.5 dark:border-indigo-900/40 dark:bg-indigo-950/30"
              >
                <Skeleton className="size-11 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : !detections || detections.length === 0 ? (
          <Card className="border-dashed bg-white/40 dark:bg-indigo-950/30">
            <CardContent className="py-10 text-center">
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {isOwnProfile
                  ? "You haven't published any bird detections yet. Go outside and find some!"
                  : `${displayName} hasn't published any bird detections yet.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {detections.map((d) => (
              <SpeciesRow key={d.id} detection={d} />
            ))}
          </div>
        )}
      </div>

      {isOwnProfile && (
        <ProfileShareDialog
          pubkey={pubkey}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </div>
  );
}

/**
 * One species the author has detected. Pulls a thumbnail from the same
 * Wikipedia summary query the birdex / dialog already cache, so repeat
 * renders are free and most thumbnails resolve instantly.
 */
function SpeciesRow({ detection }: { detection: AuthorDetection }) {
  const { data: birdInfo } = useBirdInfo(
    detection.scientificName,
    detection.commonName,
  );

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border p-2.5',
        'border-stone-200/70 bg-white/70 dark:border-indigo-900/40 dark:bg-indigo-950/40',
      )}
    >
      <span
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg',
          'bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100',
          'dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60',
        )}
      >
        {birdInfo?.imageUrl ? (
          <img
            src={birdInfo.imageUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <Bird
            className="size-5 text-emerald-700 dark:text-emerald-200"
            aria-hidden
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-50">
          {detection.commonName}
        </p>
        <p className="truncate text-xs italic text-stone-500 dark:text-stone-400">
          {detection.scientificName}
        </p>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u);
  if (parts.length === 0 || !parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
