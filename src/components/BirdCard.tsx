import { memo } from 'react';
import { Bird } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useBirdInfo } from '@/hooks/useBirdInfo';
import { cn } from '@/lib/utils';

export interface Detection {
  /** Monotonically increasing id so React can key the list. */
  id: string;
  scientificName: string;
  commonName: string;
  timestamp: number;
  /**
   * The underlying Nostr event id, when this detection came from a
   * persisted kind 2473 event. Session-only detections that haven't been
   * published yet (or never will be, e.g. when logged out) omit this.
   */
  eventId?: string;
  /**
   * The species' canonical Wikidata entity URI, when known. Present on
   * detections derived from a kind 2473 event (`i` tag) and on detections
   * synthesized from the user's kind 12473 Birdex. Lets the delete path
   * identify the species to prune from the Birdex even when no underlying
   * 2473 `eventId` is loaded.
   */
  entityUri?: string;
}

interface BirdCardProps {
  detection: Detection;
  /**
   * Fired when the user clicks anywhere on the card. The parent is
   * expected to open a details dialog — the card itself is purely a
   * presentation layer.
   */
  onSelect?: (detection: Detection) => void;
}

function BirdCardImpl({ detection, onSelect }: BirdCardProps) {
  const { data, isLoading } = useBirdInfo(
    detection.scientificName,
    detection.commonName,
  );
  const timeStr = new Date(detection.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // The card behaves as a single button when a click handler is provided;
  // nested interactive elements used to complicate the semantics here, but
  // since we stripped the Wikipedia link + delete button out there's
  // nothing left to conflict with the outer button role.
  const interactive = Boolean(onSelect);

  const cardInner = (
    <>
      {/* h-full so the image panel stretches to fill the card's full
          height even when the text panel is taller than the image's
          intrinsic aspect ratio would otherwise allow. */}
      <div className="flex h-full gap-0">
        {/* Image panel */}
        <div className="relative w-36 shrink-0 overflow-hidden bg-linear-to-br from-emerald-100 via-sky-100 to-amber-100 sm:w-48 dark:from-indigo-900 dark:via-indigo-800 dark:to-amber-900/60">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : data?.imageUrl ? (
            <img
              src={data.imageUrl}
              alt={detection.commonName}
              className="h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <BirdGlyph />
            </div>
          )}
          {/* Subtle gradient overlay at the bottom for legibility of any overlaid chips */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/30 to-transparent" />
          <div className="absolute bottom-2 left-2 font-mono text-[10px] uppercase tracking-wider text-white/80">
            {timeStr}
          </div>
        </div>

        {/* Content panel */}
        <CardContent className="flex min-w-0 flex-1 flex-col gap-2 p-4">
          <div className="min-w-0">
            <h3 className="truncate font-serif text-lg font-semibold leading-tight text-stone-900 dark:text-stone-50">
              {detection.commonName}
            </h3>
            <p className="truncate text-xs italic text-stone-500 dark:text-stone-400">
              {detection.scientificName}
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-1.5 pt-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : data?.extract ? (
            <p className="line-clamp-3 text-sm leading-relaxed text-stone-600 dark:text-stone-300">
              {data.extract}
            </p>
          ) : (
            <p className="text-sm italic text-stone-400 dark:text-stone-500">
              No Wikipedia summary available.
            </p>
          )}
        </CardContent>
      </div>
    </>
  );

  const cardClasses = cn(
    'group/card relative animate-card-in overflow-hidden border-stone-200/70 bg-white/80 shadow-lg shadow-stone-900/5 backdrop-blur-sm transition-all duration-300',
    'hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-900/10',
    'dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:shadow-black/40 dark:hover:shadow-amber-500/10',
    interactive && 'cursor-pointer',
  );

  if (interactive) {
    // A native <button> gives us the correct semantics for a whole-card
    // tap target — the previous hover-only trash affordance didn't work
    // on touch devices. We replicate Card's visual styling here rather
    // than nesting a Card inside the button (Card itself is a <div> and
    // doesn't support `asChild`).
    return (
      <button
        type="button"
        onClick={() => onSelect?.(detection)}
        aria-label={`Show details for ${detection.commonName}`}
        className={cn(
          // Match Card's base look so this button reads as a card.
          'rounded-lg border bg-card text-left text-card-foreground shadow-sm',
          'w-full',
          cardClasses,
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-white dark:focus-visible:ring-amber-400/60 dark:focus-visible:ring-offset-[#0d1230]',
        )}
      >
        {cardInner}
      </button>
    );
  }

  return <Card className={cardClasses}>{cardInner}</Card>;
}

// Memoized so the 60 Hz-ish re-renders of the parent page don't force
// every card (plus its Wikipedia data query) to rerender. Detections are
// value objects, so a shallow prop compare is sufficient.
export const BirdCard = memo(BirdCardImpl, (prev, next) => {
  const a = prev.detection;
  const b = next.detection;
  return (
    a.id === b.id &&
    a.scientificName === b.scientificName &&
    a.commonName === b.commonName &&
    a.timestamp === b.timestamp &&
    a.eventId === b.eventId &&
    prev.onSelect === next.onSelect
  );
});

function BirdGlyph() {
  return (
    <Bird
      aria-hidden
      strokeWidth={1.5}
      className="h-16 w-16 text-emerald-700/50 dark:text-amber-300/50"
    />
  );
}
