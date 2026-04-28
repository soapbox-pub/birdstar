// Dialog that shows the full Wikipedia summary for a bird — either one
// the user has just heard (a `Detection`) or one they haven't heard yet (a
// plain `BirdLabel` from the checklist roster). Opens when the user taps a
// roster cell, a "rare finds" card, or the "album art" in the player bar.
// Reuses the same `useBirdInfo` query that powers the roster so the data
// is already cached by the time the dialog opens.
//
// The dialog surfaces two field-guide affordances for every bird,
// heard or not:
//   1. An observation-density map (`ObservationMap`) showing where
//      the species has actually been recorded by iNaturalist's
//      community, centered on the user's region when available.
//      Replaces the old text-based "Where to find it" callout that
//      heuristically extracted habitat/range sentences from the
//      Wikipedia lede — a map is more honest ("birds are actually
//      here") and conveys range at a glance.
//   2. A reference song player sourced from
//      Wikipedia/Wikimedia Commons (preferred) or iNaturalist
//      research-grade observations (fallback) via `useBirdSound`.
// An earlier version only showed these for unheard birds on the
// theory that once you've heard a bird the search is over, but that
// was wrong: users want to confirm they heard *this* song (not a
// similar species), look up where else to find it, and the heard
// state should add information, not remove it.
//
// When the subject is backed by a real Nostr event (a Detection with
// `eventId`) and the parent supplies an `onDelete` callback, a destructive
// action appears at the bottom of the dialog so the user can retract
// their published sighting.
import { HelpCircle, Loader2, Play, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Detection } from '@/components/BirdCard';
import type { BirdLabel } from '@/lib/birdnet/labels';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ObservationMap, MAP_ATTRIBUTION } from '@/components/ObservationMap';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { useBirdSound, type BirdSound } from '@/hooks/useBirdSound';
import { useInatTaxonId } from '@/hooks/useInatTaxonId';
import { useRegisterSongPlayback } from '@/hooks/useSongPlayback';
import { cn } from '@/lib/utils';

/**
 * Subject of the dialog. Either a heard detection (has a timestamp +
 * confidence, possibly an eventId) or a not-yet-heard roster entry (just
 * a label). Both share `commonName` + `scientificName` which is all the
 * Wikipedia lookup and header rendering need.
 */
export type BirdSubject =
  | { kind: 'detection'; detection: Detection }
  | { kind: 'label'; label: BirdLabel; isRare?: boolean }
  // A species currently accumulating toward the confirmation
  // threshold but not yet confirmed. Opened when the user taps the
  // player-bar "album art" thumbnail during its pending state: the
  // thumbnail is the only surface in the app that exposes pending
  // species (the roster only cares about confirmed/heard status and
  // the pendingLeader is intentionally transient). The dialog
  // shows the same Wikipedia/sound/map content as a confirmed
  // sighting, but the footer swaps in an amber "Unconfirmed
  // sighting" row instead of the Nostr-published row since there's
  // no event (and no Detection) to act on yet.
  | {
      kind: 'pending';
      label: BirdLabel;
      /** `sum / CONFIRMATION_THRESHOLD`, clamped to [0, 1]. */
      progress: number;
    };

interface BirdInfoDialogProps {
  subject: BirdSubject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional deletion handler. Only shown when the subject is a detection
   * with an `eventId` — there's nothing to delete for session-only or
   * not-yet-heard species.
   */
  onDelete?: (detection: Detection) => void;
  /** True while a deletion is in flight for this detection. */
  isDeleting?: boolean;
}

export function BirdInfoDialog({
  subject,
  open,
  onOpenChange,
  onDelete,
  isDeleting,
}: BirdInfoDialogProps) {
  const { commonName, scientificName } = getNames(subject);

  // Passing null values keeps the query disabled until we have a real
  // subject, which avoids any spurious Wikipedia lookups.
  const { data, isLoading } = useBirdInfo(scientificName, commonName);

  const detection = subject?.kind === 'detection' ? subject.detection : null;
  const isRare = subject?.kind === 'label' ? (subject.isRare ?? false) : false;
  // Pending = species currently accumulating but not yet over the
  // confirmation threshold. Surfaced only via the player-bar album
  // art's new clickable state; we use it here to swap the footer's
  // "Published to Nostr" row for an amber "Unconfirmed sighting"
  // note explaining the ? badge on the thumbnail.
  const pendingProgress =
    subject?.kind === 'pending' ? subject.progress : null;

  // Reference recording — Wikipedia/Commons first, iNaturalist
  // fallback. See `useBirdSound.ts`. Common name is passed through
  // as a tiebreaker for the Wikipedia article lookup; scientific
  // name alone works for most species but some articles live under
  // the common name. Enabled whenever we have a scientific name to
  // look up — heard birds get the player too so users can confirm
  // they heard *this* song vs. a similar species.
  const { data: sound, isLoading: isSoundLoading } = useBirdSound(
    subject ? scientificName : null,
    subject ? commonName : null,
  );

  const canDelete = Boolean(onDelete && detection?.eventId);

  const song = useSongPlayer(sound, isSoundLoading);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The default top-right X sits directly on the banner image, where
          its contrast depends on whatever pixels happen to be under it.
          We replace it with a dedicated circular button below that
          carries its own background so it's always legible.

          The dialog is capped at the visual viewport minus a 1rem
          breathing margin on each side (`100dvh-2rem`). `dvh` tracks
          the mobile browser's *dynamic* viewport so the cap shrinks
          when the URL bar expands, preventing the delete/wiki row
          from vanishing beneath it. The content is a flex column so
          the banner can stay a fixed 192px and the scroll lives in
          the inner content region — critical for finding-mode dialogs
          that stack extract + habitat + audio player on short phones. */}
      <DialogContent
        className={cn(
          'max-w-lg overflow-hidden p-0',
          // Override shadcn's default `grid gap-4` — we need flex for
          // the pinned-banner + scrolling-body layout, and the gap
          // would add a 16px strip between them.
          'flex max-h-[calc(100dvh-2rem)] flex-col gap-0',
        )}
        showCloseButton={false}
      >
        {subject ? (
          <>
            {/* Banner image. Use the Wikipedia image if we have one, else a
                tinted gradient so the dialog never looks broken.
                `shrink-0` pins the banner at 192px so the flex parent
                gives the remaining height to the scrolling body. */}
            <div className="relative h-48 w-full shrink-0 overflow-hidden bg-gradient-to-br from-emerald-100 via-sky-100 to-amber-100 dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : data?.imageUrl ? (
                <img
                  src={data.imageUrl}
                  alt={commonName ?? ''}
                  // Anchor the crop at the upper third of the image
                  // (`50% 33%` — horizontally centered, vertically
                  // biased toward the top). Wikipedia bird portraits
                  // place the subject's head in the upper half of the
                  // frame, so the default `50% 50%` would crop the
                  // face off in our short banner. `object-top` (0%)
                  // went too far the other way and pressed the bird's
                  // head against the frame edge, losing the little bit
                  // of sky/headroom that makes the composition look
                  // intentional. 33% leaves that headroom while still
                  // keeping the head safely in view.
                  className="h-full w-full object-cover object-[50%_25%]"
                  loading="lazy"
                />
              ) : null}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />

              {/* "Rare find" chip overlay — shown for out-of-region heard
                  birds so the context from the roster carries through
                  into the detail dialog. */}
              {isRare ? (
                <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white shadow-md ring-1 ring-white/20 backdrop-blur-sm">
                  <Sparkles className="h-3 w-3" aria-hidden />
                  Rare find
                </div>
              ) : null}

              <DialogClose
                aria-label="Close"
                className={cn(
                  // Circular backdrop keeps the X legible regardless of
                  // whatever species photo is behind it.
                  'absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full',
                  'bg-black/50 text-white shadow-md ring-1 ring-white/10 backdrop-blur-sm',
                  'transition-colors hover:bg-black/70 hover:text-white',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-0',
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </DialogClose>
            </div>

            {/* Body — scrolls independently of the banner when the
                combined content overflows the viewport. `min-h-0` is
                the escape hatch flex needs to actually honor
                `overflow-y-auto` on this child (without it, the child
                would size to content and push past the parent cap). */}
            <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-6 pt-4 min-h-0">
              {/* Header row. Title + scientific name stack on the
                  left; the song play button sits on the right,
                  vertically centered across the two lines. Keeping
                  the button inline with the name makes it feel like
                  a primary action on "this bird" rather than a
                  separate UI element — the eye takes the title and
                  the control as one unit. The button is dropped
                  entirely when there's no usable recording
                  (`song.button` returns null), so the header
                  collapses back to plain typography. */}
              <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0 text-left">
                <div className="min-w-0 flex-1 space-y-1">
                  <DialogTitle className="font-serif text-2xl">
                    {commonName}
                  </DialogTitle>
                  <DialogDescription className="italic text-stone-500 dark:text-stone-400">
                    {scientificName}
                  </DialogDescription>
                </div>
                {song.button}
              </DialogHeader>

              {/* Hidden audio element must be mounted somewhere in
                  the dialog tree for `audioRef` inside the hook to
                  resolve. Placement doesn't affect layout
                  (`className="hidden"` on the element itself). */}
              {song.audio}

              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : data?.extract ? (
                <CollapsibleProse
                  text={data.extract}
                  collapseThreshold={120}
                  className="text-sm leading-relaxed text-stone-700 dark:text-stone-200"
                />
              ) : (
                <p className="text-sm italic text-stone-400 dark:text-stone-500">
                  No Wikipedia summary available for this species.
                </p>
              )}

              {/* Observation-density map. Shows iNat's heatmap of
                  where this species has actually been recorded,
                  centered on the user's region when available. Works
                  as the "where to find it" affordance — a map of
                  real observations communicates range more
                  viscerally than a prose paragraph, and remains
                  useful even for species whose Wikipedia article
                  doesn't have tidy habitat sentences. See
                  ObservationMap.tsx for the Leaflet setup details.
                  Attribution (CARTO/OSM/iNat) is rendered in the
                  shared SourcesLine footer below, not inline. */}
              <ObservationMap scientificName={scientificName} />

              {/* Footer region. Two possible rows, both optional:
                  - A "Published to Nostr" line for detections backed
                    by a Nostr event, with an inline Delete action
                    that opens a confirmation dialog.
                  - A sources footer crediting Wikipedia (info),
                    Commons/iNaturalist (song), and the map tile
                    providers, collapsed onto one line.

                  These were previously separate blocks with their
                  own borders and padding. Collapsing them into a
                  single small-text stack at the bottom of the card
                  keeps the dialog focused on the bird, not on
                  metadata and chrome. */}
              <BirdInfoFooter
                detection={detection}
                canDelete={canDelete}
                isDeleting={isDeleting}
                onDelete={onDelete}
                wikiUrl={data?.wikiUrl ?? null}
                sound={song.sound}
                scientificName={scientificName}
                pendingProgress={pendingProgress}
              />
            </div>
          </>
        ) : (
          // Edge case: dialog opened with no subject (shouldn't happen in
          // practice since the trigger is disabled in that state).
          <div className="p-8 text-center text-sm text-stone-500">
            No bird selected.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getNames(subject: BirdSubject | null): {
  commonName: string | null;
  scientificName: string | null;
} {
  if (!subject) return { commonName: null, scientificName: null };
  if (subject.kind === 'detection') {
    return {
      commonName: subject.detection.commonName,
      scientificName: subject.detection.scientificName,
    };
  }
  // Both 'label' and 'pending' carry a BirdLabel.
  return {
    commonName: subject.label.commonName,
    scientificName: subject.label.scientificName,
  };
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Text block with inline "Read more" / "Read less" expansion.
 *
 * Below `collapseThreshold` characters, renders the whole text as a
 * single paragraph with no toggle (nothing to hide).
 *
 * Above the threshold, renders a truncated version with the toggle
 * appearing *inline* at the end of the visible text — matching the
 * Twitter/Facebook convention where "…more" reads as part of the
 * final sentence rather than hanging below it as a separate control.
 *
 * Truncation rules:
 *   - Slice to the nearest whitespace at or before the threshold so
 *     words aren't chopped in half ("…habit" vs. "…habitat").
 *   - Strip trailing punctuation from the slice so we don't end up
 *     with ugly combinations like ",…" or ".…".
 *   - Append a one-character ellipsis then the toggle. The ellipsis
 *     is a real character in the DOM so screen readers voice the
 *     truncation.
 *
 * When expanded, the toggle moves to the end of the full text on the
 * same line where the text happens to wrap — so "Read less" sits
 * naturally after the last sentence rather than on its own line.
 * That symmetry is what makes the two states feel like the same
 * control, not two different layouts.
 */
function CollapsibleProse({
  text,
  collapseThreshold,
  className,
  toneClass = 'text-emerald-700 hover:text-emerald-800 dark:text-amber-300 dark:hover:text-amber-200',
}: {
  text: string;
  collapseThreshold: number;
  className?: string;
  /** Tailwind classes for the inline toggle colour, tuned per
   *  callout (emerald-only for the habitat card, emerald/amber
   *  default for body text). */
  toneClass?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = text.length > collapseThreshold;

  // Reset collapse state when the text itself changes (species
  // switch). Prevents the dialog from inheriting "expanded" from a
  // previous bird whose extract may have been much longer.
  useEffect(() => {
    setExpanded(false);
  }, [text]);

  if (!shouldCollapse) {
    return <p className={className}>{text}</p>;
  }

  // Find the nearest whitespace at or before the threshold. The
  // fallback to `collapseThreshold` covers the degenerate case of a
  // very long first word (~never happens in Wikipedia prose but
  // better safe than crashing).
  const truncated = expanded ? text : truncateAtWordBoundary(text, collapseThreshold);

  const toggle = (
    <button
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      aria-expanded={expanded}
      // Inline link affordance: underlined, sits on the same
      // baseline as the surrounding text. A leading space keeps it
      // separated from the ellipsis (or final period when expanded)
      // without needing a non-breaking space hack.
      className={cn(
        'ml-1 align-baseline text-sm font-semibold underline-offset-2 hover:underline',
        'transition-colors focus:outline-none focus-visible:underline',
        toneClass,
      )}
    >
      {expanded ? 'Read less' : 'Read more'}
    </button>
  );

  return (
    <p className={className}>
      {truncated}
      {!expanded ? '…' : null}
      {toggle}
    </p>
  );
}

/**
 * Slice `text` to at most `max` characters, backing up to the last
 * whitespace so we don't cut a word in half, then strip trailing
 * punctuation (commas, semicolons, periods) so the ellipsis reads
 * cleanly.
 */
function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s,;:.!?]+$/u, '');
}

/**
 * Bottom-of-dialog footer. Replaces the old stack of (confidence +
 * timestamp), ("Read on Wikipedia"), (delete row), (iNat attribution)
 * — four separate blocks with their own padding and borders — with a
 * single compact region.
 *
 * Up to two optional rows, both small text:
 *   1. Status/provenance line. For detections with an eventId: the
 *      Nostr publish timestamp with an inline Delete button. Delete
 *      opens an AlertDialog for confirmation. For unpublished
 *      detections (logged-out users) and not-yet-heard labels:
 *      nothing (the timestamp alone is low-value UI noise, and the
 *      fact that a bird is unheard is already conveyed by the
 *      absence of the emerald "heard" badge on its roster tile).
 *   2. Sources footer. Single bullet-separated line crediting the
 *      content providers: Wikipedia for the text, Wikimedia
 *      Commons or iNaturalist for the song, and the map tile
 *      providers. Each link is independently omitted if the
 *      corresponding data is unavailable (e.g. species with no
 *      Wikipedia page, or no usable recording from either
 *      provider).
 *
 * The confidence score is deliberately dropped. It was useful in
 * the roster chronology view but not here — the user is looking at
 * a single bird they tapped, not comparing detections, and BirdNET
 * scores aren't calibrated probabilities anyway (they're relative
 * within a single inference, not absolute "% chance it was this
 * bird").
 *
 * The old "Detected at …" timestamp becomes "Published to Nostr at
 * …" for detections that have a Nostr event. The value is the same
 * number — `detection.timestamp` is already the Nostr event's
 * created_at (set at publish time in `useAutoPublishDetection` and
 * read back from `event.created_at * 1000` in `useBirdHistory`) —
 * but the label is honest about what the timestamp represents:
 * when the observation was published to the network, not some
 * abstract "first heard" moment.
 */
function BirdInfoFooter({
  detection,
  canDelete,
  isDeleting,
  onDelete,
  wikiUrl,
  sound,
  scientificName,
  pendingProgress,
}: {
  detection: Detection | null;
  canDelete: boolean;
  isDeleting?: boolean;
  onDelete?: (detection: Detection) => void;
  wikiUrl: string | null;
  sound: BirdSound | null;
  /**
   * Forwarded to {@link SourcesLine} so it can render the map
   * provider credits (CARTO + OpenStreetMap + iNaturalist grid) on
   * the same bullet-separated line as the Wikipedia + song credits.
   * Null when no bird is selected.
   */
  scientificName: string | null;
  /**
   * When non-null, the subject is a *pending* species (accumulating
   * toward the confirmation threshold but not yet confirmed). The
   * footer renders an amber "Unconfirmed sighting" row in the same
   * slot that would otherwise hold "Published to Nostr" — matching
   * the yellow ? badge on the player-bar album art so the two
   * surfaces tell the same story. Pending and published are
   * mutually exclusive by construction: a pending species has no
   * Detection, so `canDelete` is necessarily false.
   */
  pendingProgress: number | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const showPublishedRow = canDelete && detection;
  const showPendingRow = pendingProgress !== null;
  // Sources are always shown when there's a scientific name, because
  // the observation map is always rendered and its CARTO/OSM credit
  // is required by ToS. wikiUrl and sound are optional additions to
  // the same line.
  const showSources = Boolean(scientificName || wikiUrl || sound);

  // If there's nothing to show, render nothing. Keeps the dialog
  // body from ending with dead whitespace for edge-case species
  // (no Wikipedia, no iNat sound).
  if (!showPublishedRow && !showPendingRow && !showSources) return null;

  return (
    <div className="space-y-1.5 border-t border-stone-200/60 pt-3 text-xs text-stone-500 dark:border-indigo-900/50 dark:text-stone-400">
      {showPendingRow ? (
        // Amber "Unconfirmed sighting" row. Uses the same semantic
        // slot as the "Published to Nostr" row below — both are
        // status-of-this-observation metadata — with an inline
        // HelpCircle that visually matches the ? badge rendered on
        // the player-bar album art. Copy frames accumulating
        // detections as potential false positives so users know a
        // partial-confidence sighting isn't yet trustworthy.
        <div
          className={cn(
            'flex items-start gap-2 rounded-md px-2.5 py-2',
            'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
            'dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900/60',
          )}
        >
          <HelpCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1 leading-snug">
            <span className="font-semibold">
              Unconfirmed sighting — possible false positive.
            </span>{' '}
            <span>Capture more samples to confirm.</span>
          </div>
        </div>
      ) : null}

      {showPublishedRow ? (
        <div className="flex items-center gap-1.5">
          <span>Published to Nostr at {formatTime(detection.timestamp)}</span>
          <span className="text-stone-300 dark:text-stone-600" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isDeleting}
            className={cn(
              'inline-flex items-center gap-1 text-rose-600 underline-offset-2',
              'hover:underline disabled:opacity-60 disabled:hover:no-underline',
              'focus:outline-none focus-visible:underline',
              'dark:text-rose-400',
            )}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Deleting…
              </>
            ) : (
              'Delete'
            )}
          </button>
        </div>
      ) : null}

      {showSources ? (
        <SourcesLine
          wikiUrl={wikiUrl}
          sound={sound}
          scientificName={scientificName}
        />
      ) : null}

      {/* Delete confirmation. AlertDialog is a separate Radix
          primitive that stacks on top of the species Dialog — its
          portal escapes the dialog's DOM subtree, so the confirm
          click doesn't bubble into the outer dialog's close-on-
          outside-click handler. */}
      {showPublishedRow ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this sighting?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes your published Nostr event. Deletion
                isn't guaranteed — some relays may keep a copy
                indefinitely.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false);
                  onDelete?.(detection);
                }}
                className={cn(
                  'bg-rose-600 text-white hover:bg-rose-700',
                  'dark:bg-rose-600 dark:text-white dark:hover:bg-rose-700',
                )}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

/**
 * Single-line sources credit at the bottom of the dialog. Reads like:
 *
 *   Info from Wikipedia · Song (Commons): © Jane Doe, CC BY-SA 3.0 ·
 *   Map: CARTO, OpenStreetMap, iNaturalist
 *
 * Each piece links to its source (the Wikipedia article, the song's
 * Commons/iNat file page, and the respective provider attribution
 * pages). Individual pieces are omitted when their data is
 * unavailable — e.g. a species with no English Wikipedia article
 * still gets the song and map credits, a species with no recording
 * from either provider still gets wiki + map credits, etc.
 *
 * The song piece uses the full provider attribution string as its
 * link text so license compliance (visible credit) is preserved in
 * a single affordance — the user sees who recorded it, which
 * source hosts it, and can click through to verify.
 *
 * The map piece covers tile providers (CARTO basemap, OpenStreetMap
 * basemap data) plus iNaturalist for the observation grid overlay.
 * All three require visible attribution by ToS; we render them in
 * this shared footer rather than in a caption directly under the
 * map so the dialog has one unified "sources" strip at the bottom
 * instead of micro-captions scattered throughout.
 */
function SourcesLine({
  wikiUrl,
  sound,
  scientificName,
}: {
  wikiUrl: string | null;
  sound: BirdSound | null;
  /**
   * Used to look up the iNat taxon id so we can link "iNaturalist"
   * in the map credit directly to the species page. Null when no
   * bird is selected (in which case no map credit is shown, since
   * no map is visible either).
   */
  scientificName: string | null;
}) {
  // Reuse the same lookup the map does. React Query caches it, so
  // the second subscriber here doesn't trigger a second network
  // request — this is effectively free.
  const { data: taxonId } = useInatTaxonId(scientificName);

  const pieces: React.ReactNode[] = [];

  if (wikiUrl) {
    pieces.push(
      <span key="wiki">
        Info from{' '}
        <a
          href={wikiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'text-stone-600 underline-offset-2 hover:underline',
            'dark:text-stone-300',
          )}
        >
          Wikipedia
        </a>
      </span>,
    );
  }

  if (sound) {
    // Label the song credit by source so readers can tell where the
    // recording came from at a glance. `observationUrl` points at
    // either the iNat observation page or the Commons file-
    // description page — both are license-compliant attribution
    // targets. Wording stays short ("Song (Commons)" /
    // "Song (iNaturalist)") because this line is already busy
    // with multiple bullet-separated credits.
    const sourceLabel =
      sound.source === 'wikipedia' ? 'Commons' : 'iNaturalist';
    pieces.push(
      <span key="song">
        Song ({sourceLabel}):{' '}
        <a
          href={sound.observationUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={sound.attribution}
          className={cn(
            'text-stone-600 underline-offset-2 hover:underline',
            'dark:text-stone-300',
          )}
        >
          {sound.attribution}
        </a>
      </span>,
    );
  }

  // Map credits. Always present when a bird is selected, since the
  // observation map is always rendered in the dialog body above. The
  // three providers are comma-separated inside a single "Map:" piece
  // rather than each getting their own top-level bullet — keeps the
  // row from exploding to 5+ bullets on every bird.
  if (scientificName) {
    const mapLinkClass = cn(
      'text-stone-600 underline-offset-2 hover:underline',
      'dark:text-stone-300',
    );
    pieces.push(
      <span key="map">
        Map:{' '}
        <a
          href={MAP_ATTRIBUTION.carto}
          target="_blank"
          rel="noopener noreferrer"
          className={mapLinkClass}
        >
          CARTO
        </a>
        ,{' '}
        <a
          href={MAP_ATTRIBUTION.osm}
          target="_blank"
          rel="noopener noreferrer"
          className={mapLinkClass}
        >
          OpenStreetMap
        </a>
        {taxonId != null ? (
          <>
            ,{' '}
            <a
              href={MAP_ATTRIBUTION.inat(taxonId)}
              target="_blank"
              rel="noopener noreferrer"
              className={mapLinkClass}
            >
              iNaturalist
            </a>
          </>
        ) : null}
      </span>,
    );
  }

  if (pieces.length === 0) return null;

  // Render as plain inline text flow (not flex) so the browser can
  // wrap lines anywhere -- between pieces, inside a piece, even
  // inside a link's text. Earlier versions used `flex flex-wrap`
  // with each piece as an `inline-flex` container, which meant each
  // piece was a single unbreakable flex item: a long username like
  // "Song: © Someone With A Very Long Name, CC BY-NC" would
  // overflow horizontally instead of wrapping mid-credit.
  //
  // Fix: normal inline flow, with the bullet as a regular inline
  // character between pieces. The parent uses `break-words` so
  // extra-long tokens (e.g. accidental URLs in a username field)
  // still wrap rather than pushing the dialog wider than the
  // viewport on mobile.
  return (
    <p className="break-words text-[11px] leading-snug text-stone-400 dark:text-stone-500">
      {pieces.map((piece, i) => (
        <span key={i}>
          {i > 0 ? (
            <span
              className="mx-1.5 text-stone-300 dark:text-stone-600"
              aria-hidden
            >
              ·
            </span>
          ) : null}
          {piece}
        </span>
      ))}
    </p>
  );
}

/**
 * Song playback controller.
 *
 * This hook returns three rendered pieces plus the raw sound data so
 * the dialog can place each element wherever it fits best:
 *
 *   - `button`: circular toggle in the dialog header. Animated
 *     equaliser bars live *inside* the circle when playing,
 *     replacing the play triangle. One hit region, no ambiguity.
 *   - `audio`: the hidden <audio> element. Mounted anywhere in the
 *     dialog tree (placement doesn't affect layout since
 *     display=none), but it must be mounted for `audioRef` to
 *     resolve.
 *   - `sound`: the raw BirdSound (or null) — exposed so the footer
 *     can render its own attribution line using the source URL
 *     (Commons or iNat) and attribution text.
 *
 * Historical note: earlier versions rendered the attribution
 * themselves as a separate `attribution` ReactNode. The footer
 * needs to interleave the song credit with the Wikipedia credit on
 * a single bullet-separated line, so we now hand the raw data back
 * to the caller instead.
 */
function useSongPlayer(
  sound: BirdSound | null | undefined,
  isLoading: boolean,
): {
  button: React.ReactNode;
  audio: React.ReactNode;
  sound: BirdSound | null;
} {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Tell the rest of the app ("the microphone recorder, really")
  // that audio playback is live so it can mute itself and avoid a
  // feedback loop. Register/unregister is driven purely by the
  // existing isPlaying state -- no manual bookkeeping, no risk of
  // leaking a registration if playback ends in an unusual way
  // (source error, component unmount mid-song, etc). The hook's
  // useEffect cleanup handles all those paths.
  useRegisterSongPlayback(isPlaying);

  // Reset to paused state whenever the source changes (e.g. opening
  // the dialog on a different species). Without this, switching
  // birds while one is playing would leave `isPlaying=true` pointing
  // at a stale audio element.
  useEffect(() => {
    setIsPlaying(false);
  }, [sound?.audioUrl]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      // play() returns a Promise that rejects if autoplay is
      // blocked or the source fails to load. Swallow the rejection
      // — the button returns to play state and the user can retry.
      el.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false),
      );
    }
  };

  if (isLoading) {
    return {
      button: <Skeleton className="h-10 w-10 shrink-0 rounded-full" />,
      audio: null,
      sound: null,
    };
  }

  if (!sound) {
    return { button: null, audio: null, sound: null };
  }

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-label={isPlaying ? 'Pause reference song' : 'Play reference song'}
      aria-pressed={isPlaying}
      className={cn(
        'group/song inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
        'bg-amber-500 text-white shadow-md ring-1 ring-amber-400/40',
        'transition-[transform,background-color,box-shadow] duration-200',
        'hover:bg-amber-600 hover:shadow-lg active:scale-95',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2',
        'focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0d1230]',
        'dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300',
      )}
    >
      {isPlaying ? (
        // Animated equaliser bars live INSIDE the button when
        // playing. Same click target toggles playback; the bars
        // double as the "audio is active" indicator. No separate
        // element, no ambiguity about what to tap to stop.
        <EqualiserBars />
      ) : (
        // Nudge the play triangle right by 1px so it looks
        // optically centered inside the circle (the glyph's
        // centroid sits left of its bounding box).
        <Play className="h-4 w-4 translate-x-[1px] fill-current" aria-hidden />
      )}
    </button>
  );

  const audio = (
    <audio
      ref={audioRef}
      src={sound.audioUrl}
      preload="none"
      // Loop the reference recording. Bird songs from Commons and
      // iNaturalist are typically a few seconds of a single song
      // phrase, and the dialog's job here is "let the user hear
      // this call repeatedly while they compare it to what they
      // just heard outside" -- a one-shot playback is too short to
      // be useful
      // for that. The user explicitly pauses (same button,
      // equaliser → play glyph) when they're done. Because the
      // element never fires `ended` while looping, no onEnded
      // handler is needed; `onPause` still flips the state back.
      loop
      onPause={() => setIsPlaying(false)}
      onPlay={() => setIsPlaying(true)}
      className="hidden"
    >
      Your browser does not support embedded audio.
    </audio>
  );

  return { button, audio, sound };
}

/**
 * Four vertical bars bouncing with staggered CSS animations. Used
 * inside the song button to indicate active playback. Colour is
 * `currentColor` so it inherits the button's text colour (white on
 * amber in light mode, amber-950 in dark mode).
 */
function EqualiserBars() {
  // Heights at rest aren't rendered here — the bars are only drawn
  // when this component is mounted, i.e. during playback. The
  // staggered delays + slightly different animation phases create
  // the organic "audio is playing" rhythm.
  const delays = ['0ms', '120ms', '60ms', '180ms'];
  return (
    <span
      className="flex h-4 items-end gap-[2px]"
      aria-hidden
    >
      {delays.map((delay, i) => (
        <span
          key={i}
          className="block w-[2px] animate-pulse-bar rounded-full bg-current"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}
