import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Flame,
  Mountain,
  Wind,
  Droplets,
  Calendar,
  Star as StarIcon,
  Sparkles,
  Moon as MoonIcon,
  Bird,
} from "lucide-react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { ConstellationPreview } from "@/components/ConstellationPreview";
import { BirdInfoDialog, type BirdSubject } from "@/components/BirdInfoDialog";
import { useBirdLabels } from "@/hooks/useBirdLabels";
import { useBirdInfo } from "@/hooks/useBirdInfo";
import { birdOfTheDay } from "@/lib/birdOfTheDay";
import type { BirdLabel } from "@/lib/birdnet/labels";
import { starByHip } from "@/lib/stars";
import { rulerRoute } from "@/lib/planets";
import {
  zodiacCommentUrl,
  type ZodiacElement,
  type ZodiacSign,
} from "@/lib/zodiac";
import { horoscopeFor } from "@/lib/horoscope";
import { cn } from "@/lib/utils";

interface ZodiacDetailSheetProps {
  sign: ZodiacSign | null;
  onClose: () => void;
}

/**
 * Icon + color for each elemental group. Kept as a map so the visual
 * language stays consistent whether we show a single sign or a grid of
 * them later.
 */
const ELEMENT_META: Record<
  ZodiacElement,
  { icon: typeof Flame; tint: string; label: string }
> = {
  fire: {
    icon: Flame,
    tint: "text-amber-300",
    label: "Fire",
  },
  earth: {
    icon: Mountain,
    tint: "text-emerald-300",
    label: "Earth",
  },
  air: {
    icon: Wind,
    tint: "text-sky-300",
    label: "Air",
  },
  water: {
    icon: Droplets,
    tint: "text-indigo-300",
    label: "Water",
  },
};

/**
 * Bottom-anchored detail sheet for a built-in zodiac sign.
 *
 * Presents astrology-focused metadata (element, modality, ruling planet,
 * date range), lists the bright stars that make up the stick figure, and
 * embeds a Nostr comment thread anchored to the sign's Wikipedia URL
 * (NIP-22 + NIP-73 external identifier). Using a stable URL — rather
 * than a per-install Nostr event — means every Starpoint user, and any
 * NIP-22-aware client, can discover the same conversation.
 */
export function ZodiacDetailSheet({
  sign,
  onClose,
}: ZodiacDetailSheetProps) {
  const s = sign;

  // Unique HIP numbers referenced by this figure, in first-appearance
  // order (mirrors the ConstellationDetailSheet treatment).
  const uniqueHips = useMemo(() => {
    if (!s) return [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const [a, b] of s.edges) {
      if (!seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
      if (!seen.has(b)) {
        seen.add(b);
        out.push(b);
      }
    }
    return out;
  }, [s]);

  const commentRoot = useMemo(() => (s ? zodiacCommentUrl(s.id) : null), [s]);

  // Daily horoscope for this sign. Computed locally from a frozen
  // content bank (see `@/lib/horoscope`) rather than a third-party
  // feed, so it's offline-capable, deterministic, and can't rate-limit
  // or change wording on us. We key the memo on the sign id and the
  // local calendar date so the paragraph stays stable through a
  // session but updates at local midnight if the sheet happens to be
  // left open.
  const horoscope = useMemo(() => {
    if (!s) return null;
    return horoscopeFor(s.id, new Date());
    // `s.id` plus today's date is the full input; we intentionally
    // don't re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.id]);

  const horoscopeDateLabel = useMemo(() => {
    if (!horoscope) return "";
    // Parse the ISO key as a local date (not UTC) so the label reads
    // "today" consistently with the date used to seed the horoscope.
    const [y, m, d] = horoscope.dateKey.split("-").map(Number);
    const local = new Date(y, m - 1, d);
    return local.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, [horoscope]);

  const elementMeta = s ? ELEMENT_META[s.element] : null;
  const ElementIcon = elementMeta?.icon;

  // Bird-of-the-day — picked deterministically from the BirdNET
  // roster by local calendar date. Same bird for every user on a
  // given day, independent of the zodiac sign being viewed: the
  // "daily" axis is the date, not the sign. Surfacing it here lets
  // stargazers jump into a field-guide dialog without switching to
  // Birds mode first.
  const { data: birdLabels } = useBirdLabels();
  const todaysBird = useMemo<BirdLabel | null>(() => {
    if (!birdLabels) return null;
    return birdOfTheDay(birdLabels, new Date());
    // Labels are cached with `staleTime: Infinity`, and the daily
    // seed only changes at local midnight — we intentionally don't
    // depend on a ticking date value.
  }, [birdLabels]);

  // When the user taps the bird card, open `BirdInfoDialog` on top of
  // the zodiac sheet. Using a `label`-kind subject (no detection,
  // no eventId) gives the reader the same Wikipedia summary, range
  // map, and reference song they'd see from the Birds checklist —
  // without any delete affordance since there's nothing to delete.
  const [birdSubject, setBirdSubject] = useState<BirdSubject | null>(null);

  return (
    <>
      <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="bg-slate-950/95 backdrop-blur-lg border-white/10 text-white p-0 h-[88dvh] max-h-[88dvh] rounded-t-3xl flex flex-col"
      >
        {s && commentRoot && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Drag handle */}
            <div className="flex items-center justify-center pt-3 pb-1 shrink-0">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="px-5 pb-4 border-b border-white/10 shrink-0">
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-tight truncate">
                  {s.name}
                </h2>
                <div className="flex items-center gap-1.5 mt-1 text-sm text-white/60 min-w-0">
                  <Sparkles className="h-3.5 w-3.5 text-amber-200/70 shrink-0" />
                  <span className="truncate">Zodiac sign</span>
                </div>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="p-5 space-y-5">
                {/* Hero preview — a large rendering of the figure, shown in
                    the same slot Wikipedia images occupy on star views.
                    Blurb and date range live in the card's footer so the
                    figure and the astrology one-liner read as a single
                    unit, mirroring ConstellationDetailSheet. */}
                <Card className="bg-white/5 border-white/10 overflow-hidden">
                  <div className="relative w-full aspect-4/3">
                    <ConstellationPreview
                      edges={s.edges}
                      ariaLabel={`Preview of ${s.name}`}
                      className="rounded-none!"
                      interactive
                    />
                    <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-slate-950/70 via-transparent to-transparent" />
                    {/* Glyph watermark in the corner — subtle, non-repeating
                        cue that this is the astrological sign, not just any
                        star figure. */}
                    <div
                      className="pointer-events-none absolute top-3 left-3 h-9 w-9 rounded-lg bg-black/40 backdrop-blur-sm border border-white/15 flex items-center justify-center"
                      aria-hidden
                    >
                      <span className="text-lg leading-none text-amber-100">
                        {s.glyph}
                      </span>
                    </div>
                  </div>
                  <CardContent className="p-4 space-y-3">
                    <p className="text-sm leading-relaxed text-white/85">
                      {s.blurb}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-white/60">
                      <Calendar className="h-3.5 w-3.5" />
                      <span className="tabular-nums">{s.dateRange}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Astrology facts grid */}
                <section className="grid grid-cols-3 gap-2">
                  {ElementIcon && elementMeta && (
                    <FactCard
                      label="Element"
                      value={elementMeta.label}
                      icon={
                        <ElementIcon
                          className={cn("h-4 w-4", elementMeta.tint)}
                        />
                      }
                    />
                  )}
                  <FactCard
                    label="Modality"
                    value={capitalize(s.modality)}
                  />
                  {/* Ruler links to the corresponding body's detail view
                      when we recognize the name (Sun, Moon, or one of
                      the seven planets). Otherwise it falls back to a
                      static card. */}
                  <FactCard
                    label="Ruler"
                    value={s.rulingPlanet}
                    href={rulerRoute(s.rulingPlanet) ?? undefined}
                  />
                </section>

                {/* Daily horoscope. Composed locally from a frozen
                    content bank, seeded deterministically by
                    (sign, local date) so every user sees the same
                    reading for the same sign on the same day. No
                    network calls, no third-party dependency. */}
                {horoscope && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <MoonIcon className="h-4 w-4 text-amber-200/80" />
                      <h3 className="text-xs uppercase tracking-widest text-white/50">
                        Today
                      </h3>
                      <span className="text-[10px] text-white/40 tabular-nums ml-auto truncate">
                        {horoscopeDateLabel}
                      </span>
                    </div>
                    <Card className="bg-linear-to-br from-amber-500/10 via-white/5 to-transparent border-amber-200/15">
                      <CardContent className="p-4 space-y-4">
                        <p className="text-sm leading-relaxed text-white/90">
                          {horoscope.paragraph}
                        </p>
                        <div className="flex items-center gap-4 pt-2 border-t border-white/10">
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] uppercase tracking-widest text-white/40">
                              Mood
                            </div>
                            <div className="mt-1 text-sm text-amber-100/90 font-medium capitalize truncate">
                              {horoscope.mood}
                            </div>
                          </div>
                          <div className="h-8 w-px bg-white/10" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] uppercase tracking-widest text-white/40">
                              Lucky number
                            </div>
                            <div className="mt-1 text-sm text-amber-100/90 font-medium tabular-nums">
                              {horoscope.luckyNumber}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Bird-of-the-day. Cross-promotion from Stars into
                    Birds mode: tapping the card opens the same
                    `BirdInfoDialog` the Birds checklist uses, so the
                    reader can see the Wikipedia summary, range map,
                    and reference song for a species without having to
                    switch modes. Which bird is shown is purely a
                    function of today's local date — same for every
                    user, every sign — because the "daily" axis here
                    is the calendar, not the zodiac. */}
                {todaysBird && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <Bird className="h-4 w-4 text-sky-200/80" />
                      <h3 className="text-xs uppercase tracking-widest text-white/50">
                        Today's bird
                      </h3>
                    </div>
                    <TodaysBirdCard
                      label={todaysBird}
                      onOpen={() =>
                        setBirdSubject({ kind: "label", label: todaysBird })
                      }
                    />
                  </section>
                )}

                {/* Stars in this figure */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <StarIcon className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      Stars
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {uniqueHips.map((hip) => {
                      const st = starByHip(hip);
                      const label = st?.name ?? st?.bayer ?? `HIP ${hip}`;
                      const content = (
                        <>
                          <span className="text-white/85">{label}</span>
                          {st?.constellation && (
                            <span className="text-white/40">
                              {st.constellation}
                            </span>
                          )}
                        </>
                      );
                      const classes =
                        "inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-xs";
                      if (st) {
                        return (
                          <Link
                            key={hip}
                            to={`/star/${hip}`}
                            replace
                            className={cn(
                              classes,
                              "hover:bg-white/10 hover:border-white/20 transition-colors cursor-pointer",
                            )}
                            title={`Open ${label}`}
                          >
                            {content}
                          </Link>
                        );
                      }
                      return (
                        <span
                          key={hip}
                          className={classes}
                          title={`HIP ${hip}`}
                        >
                          {content}
                        </span>
                      );
                    })}
                  </div>
                </section>

                {/* Nostr comments anchored to the sign's Wikipedia URL. */}
                <section>
                  <CommentsSection
                    root={commentRoot}
                    emptyStateMessage="No comments yet"
                    emptyStateSubtitle={`Be the first to discuss ${s.name} on Nostr.`}
                  />
                </section>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 shrink-0 bg-slate-950/80">
              <Button
                variant="outline"
                className="w-full bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>

    {/* Bird detail dialog. Rendered outside the Sheet so its own
        Radix portal can stack above the zodiac sheet. Kept mounted
        with `open` tied to `birdSubject` so Radix handles the focus
        trap, backdrop, and close-on-escape behaviour for us. */}
    <BirdInfoDialog
      subject={birdSubject}
      open={birdSubject !== null}
      onOpenChange={(o) => !o && setBirdSubject(null)}
    />
    </>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Small astrology fact card used in the 3-column summary grid. Kept
 * local: these cards aren't reused anywhere else in the app. If an
 * `href` is provided the card becomes a `<Link>` with hover feedback,
 * otherwise it's a static `<div>`.
 */
function FactCard({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-[10px] uppercase tracking-widest text-white/40">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-sm text-white/90 font-medium">
        {icon}
        <span className="truncate">{value}</span>
      </div>
    </>
  );
  const classes = "rounded-xl border border-white/10 bg-white/5 px-3 py-2.5";
  if (href) {
    return (
      <Link
        to={href}
        replace
        className={cn(
          classes,
          "block transition-colors hover:bg-white/10 hover:border-white/20 cursor-pointer",
        )}
        title={`Open ${value}`}
      >
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}

/**
 * Clickable "Today's bird" card. Shows a Wikipedia thumbnail (if one
 * exists for the species) alongside the common and scientific names.
 * Tapping it opens the shared `BirdInfoDialog` — the same dialog
 * Birds mode uses — so the reader gets the full field-guide view
 * (Wikipedia summary, iNaturalist range map, reference song) without
 * leaving the zodiac sheet.
 *
 * Uses a native `<button>` so keyboard users get the click target
 * and focus ring for free. The Wikipedia lookup uses the same
 * `useBirdInfo` hook the dialog itself will use, so by the time the
 * dialog opens the data is already cached.
 */
function TodaysBirdCard({
  label,
  onOpen,
}: {
  label: BirdLabel;
  onOpen: () => void;
}) {
  const { data: info, isLoading } = useBirdInfo(
    label.scientificName,
    label.commonName,
  );
  const imageUrl = info?.imageUrl ?? null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left rounded-xl border border-white/10 bg-white/5",
        "hover:bg-white/10 hover:border-white/20 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60",
        "overflow-hidden",
      )}
      title={`Open ${label.commonName}`}
    >
      <div className="flex items-center gap-3 p-3">
        <div
          className={cn(
            "h-14 w-14 shrink-0 rounded-lg overflow-hidden",
            "bg-linear-to-br from-sky-500/20 via-white/5 to-transparent",
            "border border-white/10 flex items-center justify-center",
          )}
          aria-hidden
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <Bird
              className={cn(
                "h-6 w-6 text-sky-200/80",
                isLoading && "animate-pulse",
              )}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white/95 truncate">
            {label.commonName}
          </div>
          <div className="text-xs text-white/55 italic truncate">
            {label.scientificName}
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-white/40 shrink-0">
          Tap
        </span>
      </div>
    </button>
  );
}
