// Global listener that subscribes (via `useFollowsBirdDetections`) to
// kind 2473 events authored by the logged-in user's follows and
// renders a rich toast for each one. Mounted once, high in the tree
// (next to the <Toaster />) so it runs in both Birds and Stars modes —
// a friend hearing a bird is interesting regardless of which view
// you're in.
//
// Anatomy of the toast:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ [friend pfp][bird thumb]  Friend name                    │
//   │                           heard an American Robin        │
//   └──────────────────────────────────────────────────────────┘
//
// Tapping the bird thumbnail or the species line opens the shared
// BirdInfoDialog for that species — the same dialog the birdex uses —
// so the user can confirm, listen to the reference song, read the
// Wikipedia summary, etc. The friend's portrait and name are not
// interactive; Birdstar doesn't yet have a per-user profile page so
// tapping them would have no destination.
//
// The toast is compact: a single row, ~44px portraits, tight
// spacing. The "rich" part is the two overlapping portraits and the
// Wikipedia thumbnail; the copy stays to two short lines.
import { useCallback, useState } from 'react';
import { Bird } from 'lucide-react';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';

import {
  BirdInfoDialog,
  type BirdSubject,
} from '@/components/BirdInfoDialog';
import type { Detection } from '@/components/BirdCard';
import { useAuthor } from '@/hooks/useAuthor';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { useFollowsBirdDetections } from '@/hooks/useFollowsBirdDetections';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

/** How long a friend-detection toast stays visible, in ms. */
const TOAST_DURATION_MS = 8000;

interface ParsedDetection {
  eventId: string;
  pubkey: string;
  timestamp: number;
  scientificName: string;
  commonName: string;
}

/**
 * Extract a {@link ParsedDetection} from a kind 2473 event, or null
 * when the event lacks the minimum required fields.
 *
 * `commonName` is best-effort: we parse it out of the NIP-31 `alt`
 * tag ("Bird detection: American Robin (Turdus migratorius)") which
 * Birdstar itself always emits, and fall back to the scientific name
 * when the alt tag is missing or doesn't match the expected shape
 * (e.g. an event published by another client with a different alt
 * style).
 */
function parseDetection(event: NostrEvent): ParsedDetection | null {
  let scientificName = '';
  let alt = '';
  for (const [name, value] of event.tags) {
    if (name === 'n' && typeof value === 'string') scientificName = value;
    if (name === 'alt' && typeof value === 'string') alt = value;
  }
  if (!scientificName) return null;

  // "Bird detection: American Robin (Turdus migratorius)" → "American Robin".
  // The trailing parens disambiguate the common name from the colon-
  // prefixed category label, so a simple capture before the last
  // "(...)" is enough.
  let commonName = scientificName;
  const m = alt.match(/^Bird detection:\s+(.+?)\s+\([^)]+\)\s*$/);
  if (m) commonName = m[1];

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    timestamp: event.created_at * 1000,
    scientificName,
    commonName,
  };
}

export function FollowDetectionToaster() {
  const { toast } = useToast();
  const [selectedSubject, setSelectedSubject] = useState<BirdSubject | null>(
    null,
  );

  const openDialog = useCallback((detection: Detection) => {
    setSelectedSubject({ kind: 'detection', detection });
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setSelectedSubject(null);
  }, []);

  const onDetection = useCallback(
    (event: NostrEvent) => {
      const parsed = parseDetection(event);
      if (!parsed) return;

      const detection: Detection = {
        id: parsed.eventId,
        scientificName: parsed.scientificName,
        commonName: parsed.commonName,
        timestamp: parsed.timestamp,
        eventId: parsed.eventId,
      };

      toast({
        duration: TOAST_DURATION_MS,
        // The whole rich layout — avatars, names, species — lives
        // in the description slot so we keep full control of the
        // markup. We deliberately don't supply a `title` so the
        // toast is a single compact block of content rather than a
        // title + description stack with built-in spacing between
        // them.
        description: (
          <FollowDetectionToastBody
            detection={detection}
            pubkey={parsed.pubkey}
            onOpen={openDialog}
          />
        ),
      });
    },
    [toast, openDialog],
  );

  useFollowsBirdDetections({ onDetection });

  return (
    <BirdInfoDialog
      subject={selectedSubject}
      open={selectedSubject !== null}
      onOpenChange={handleDialogOpenChange}
    />
  );
}

interface FollowDetectionToastBodyProps {
  detection: Detection;
  /** Pubkey of the friend who published the detection. Used to fetch
   *  their NIP-01 profile metadata (picture, name). */
  pubkey: string;
  /** Called when the user taps the bird thumb or the species line. */
  onOpen: (detection: Detection) => void;
}

function FollowDetectionToastBody({
  detection,
  pubkey,
  onOpen,
}: FollowDetectionToastBodyProps) {
  const author = useAuthor(pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;

  const displayName =
    metadata?.name ?? metadata?.display_name ?? 'Anonymous';
  const friendPicture = metadata?.picture ?? null;

  // Shared with BirdCard / BirdInfoDialog — cached by React Query so
  // by the time the user taps through to the dialog the Wikipedia
  // lookup is already warm.
  const { data: birdInfo } = useBirdInfo(
    detection.scientificName,
    detection.commonName,
  );

  return (
    <div className="flex items-center gap-3">
      {/* Two overlapping circular portraits: friend on the left, bird
          on the right, nudged inwards so they visually interlock.
          The bird portrait is the primary tap target — the rest of
          the app follows the same "the bird image is the entry
          point into the bird" convention. */}
      <div className="relative flex shrink-0 items-center">
        <Avatar
          src={friendPicture}
          alt={displayName}
          className="size-11 ring-2 ring-background"
        />
        <button
          type="button"
          onClick={() => onOpen(detection)}
          aria-label={`Open info about ${detection.commonName}`}
          className={cn(
            '-ml-3 inline-flex size-11 items-center justify-center overflow-hidden rounded-full',
            'ring-2 ring-background transition-transform',
            'hover:scale-105 active:scale-95',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
            'bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100',
            'dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60',
          )}
        >
          {birdInfo?.imageUrl ? (
            <img
              src={birdInfo.imageUrl}
              alt={detection.commonName}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <Bird
              className="size-5 text-emerald-700 dark:text-emerald-200"
              aria-hidden
            />
          )}
        </button>
      </div>

      {/* Copy column. Two tight lines: friend name on top, species
          on bottom. The species line is a secondary tap target so a
          user who swipes the text (on mobile) still gets the
          dialog. */}
      <div className="min-w-0 flex-1 leading-snug">
        <p className="truncate text-sm font-semibold text-foreground">
          {displayName}
        </p>
        <button
          type="button"
          onClick={() => onOpen(detection)}
          className={cn(
            'block max-w-full truncate text-left text-sm text-muted-foreground',
            'underline-offset-2 hover:underline focus:outline-none focus-visible:underline',
          )}
        >
          heard{' '}
          <span className="font-medium text-foreground">
            {vowelArticle(detection.commonName)} {detection.commonName}
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Small circular avatar. Falls back to initials on a tinted
 * background when `src` is missing — same pattern we use elsewhere
 * in the app.
 */
function Avatar({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center overflow-hidden rounded-full',
        'bg-linear-to-br from-stone-200 to-stone-300',
        'text-xs font-semibold text-stone-600',
        'dark:from-stone-700 dark:to-stone-800 dark:text-stone-200',
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <span aria-hidden>{initials(alt)}</span>
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

/**
 * "an American Robin" vs. "a Northern Cardinal". Cheap vowel-start
 * check — not perfect English ("an hour", "a university") but good
 * enough for bird common names, which are overwhelmingly concrete
 * nouns.
 */
function vowelArticle(word: string): string {
  if (!word) return 'a';
  return /^[aeiouAEIOU]/.test(word) ? 'an' : 'a';
}
