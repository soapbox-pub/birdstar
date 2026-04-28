import { useMemo } from "react";
import {
  ExternalLink,
  Loader2,
  BookOpen,
  AlertCircle,
  CalendarDays,
  Eclipse,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { useWikipediaSummary } from "@/hooks/useWikipediaSummary";
import { moonPhase, moonPosition } from "@/lib/moon";
import { describeFullMoon, type NamedFullMoon } from "@/lib/moonNames";
import {
  INTERMEDIATE_PHASE_CONTENT,
  WIKIPEDIA_ATTRIBUTION,
  type IntermediatePhaseKey,
} from "@/lib/moonPhaseContent";
import {
  upcomingTotalLunarEclipses,
  formatLunarTotalityDuration,
  type TotalLunarEclipse,
} from "@/lib/lunarEclipses";

interface MoonDetailSheetProps {
  /** Whether the sheet is open. */
  open: boolean;
  onClose: () => void;
}

/**
 * The Moon's Wikidata entity URI (Q405). Used as the stable, canonical,
 * language-neutral root for the comment thread regardless of which
 * phase-specific Wikipedia article happens to be on display. The sheet
 * is about *the Moon* — phase is just a time-varying attribute — so
 * the conversation should not be split across phase articles.
 */
const MOON_WIKIDATA_URL = "https://www.wikidata.org/entity/Q405";

/**
 * Join a list with commas and a trailing "and" — e.g.
 *   ["A"]            → "A"
 *   ["A", "B"]       → "A and B"
 *   ["A", "B", "C"]  → "A, B, and C"
 */
function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Human-friendly relative-time label for an upcoming date. Favours
 * "tomorrow" / "in 3 days" / "in 2 weeks" / "in 5 months" /
 * "in 2 years" over exact dates, which are noisy when the number
 * is small but unreadable when it's very large.
 *
 * The Moon sheet uses this for upcoming total lunar eclipses, which
 * can be anywhere from days to years away — hence the explicit
 * month and year buckets. Must stay in sync with the equivalent
 * helper in `SunDetailSheet.tsx`; splitting them into a shared
 * utility would just add import overhead for two near-trivial
 * functions.
 */
function formatRelative(date: Date, now: Date = new Date()): string {
  const ms = date.getTime() - now.getTime();
  const minutes = Math.round(ms / 60_000);
  const hours = Math.round(ms / 3_600_000);
  const days = Math.round(ms / 86_400_000);

  if (minutes < 60) {
    if (minutes < 1) return "now";
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }
  if (hours < 24) {
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `in ${weeks} weeks`;
  }
  const months = Math.round(days / 30);
  if (months < 24) return `in ${months} months`;
  const years = Math.round(days / 365);
  return years === 1 ? "in 1 year" : `in ${years} years`;
}

/**
 * Absolute-date label for the same upcoming date — used as the
 * secondary text under the relative label, so both readings are
 * available at a glance.
 */
function formatAbsolute(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** One of the eight named phases in the standard lunar calendar. */
type PhaseKey =
  | "new"
  | "waxing-crescent"
  | "first-quarter"
  | "waxing-gibbous"
  | "full"
  | "waning-gibbous"
  | "last-quarter"
  | "waning-crescent";

interface PhaseInfo {
  key: PhaseKey;
  /** Human-readable name shown in the header. */
  name: string;
  /**
   * Ordered list of Wikipedia article titles to try. The first title
   * that returns a non-disambiguation article wins. English Wikipedia
   * only has dedicated articles for "New moon" and "Full moon"; all
   * six intermediate phases redirect to the general "Lunar phase"
   * article (verified against the REST summary API). So `wikiTitles`
   * is at most two entries: the dedicated article (if any) followed
   * by "Lunar phase" as a guaranteed fallback.
   */
  wikiTitles: string[];
  /**
   * Whether this phase has its own Wikipedia article. When `false` the
   * Wikipedia card is framed as general "about lunar phases" background
   * rather than as an article about this phase specifically — Wikipedia
   * simply doesn't have one, and the UI shouldn't imply otherwise.
   */
  hasDedicatedArticle: boolean;
}

const PHASE_INFO: Record<PhaseKey, PhaseInfo> = {
  "new": {
    key: "new",
    name: "New moon",
    wikiTitles: ["New moon"],
    hasDedicatedArticle: true,
  },
  "waxing-crescent": {
    key: "waxing-crescent",
    name: "Waxing crescent",
    // No dedicated article on en.wiki — redirects to "Lunar phase".
    wikiTitles: ["Lunar phase"],
    hasDedicatedArticle: false,
  },
  "first-quarter": {
    key: "first-quarter",
    name: "First quarter",
    wikiTitles: ["Lunar phase"],
    hasDedicatedArticle: false,
  },
  "waxing-gibbous": {
    key: "waxing-gibbous",
    name: "Waxing gibbous",
    wikiTitles: ["Lunar phase"],
    hasDedicatedArticle: false,
  },
  "full": {
    key: "full",
    name: "Full moon",
    wikiTitles: ["Full moon"],
    hasDedicatedArticle: true,
  },
  "waning-gibbous": {
    key: "waning-gibbous",
    name: "Waning gibbous",
    wikiTitles: ["Lunar phase"],
    hasDedicatedArticle: false,
  },
  "last-quarter": {
    key: "last-quarter",
    name: "Last quarter",
    wikiTitles: ["Lunar phase"],
    hasDedicatedArticle: false,
  },
  "waning-crescent": {
    key: "waning-crescent",
    name: "Waning crescent",
    wikiTitles: ["Lunar phase"],
    hasDedicatedArticle: false,
  },
};

/**
 * Classify the Moon's current phase into one of the eight named phases.
 * Thresholds match the standard 8-wedge lunar calendar: narrow windows
 * around the four principal phases (new / first quarter / full / last
 * quarter), with crescent/gibbous filling in between.
 */
function classifyPhase(ageDays: number, illumination: number): PhaseInfo {
  if (illumination >= 0.995) return PHASE_INFO.full;
  if (illumination <= 0.01) return PHASE_INFO.new;

  const waxing = ageDays < 14.7653;
  // Quarter phases: within ~6 hours of exactly 50% illumination.
  if (illumination > 0.48 && illumination < 0.52) {
    return waxing ? PHASE_INFO["first-quarter"] : PHASE_INFO["last-quarter"];
  }

  if (illumination < 0.5) {
    return waxing ? PHASE_INFO["waxing-crescent"] : PHASE_INFO["waning-crescent"];
  }
  return waxing ? PHASE_INFO["waxing-gibbous"] : PHASE_INFO["waning-gibbous"];
}

/**
 * A small SVG rendering of the Moon with the correct current phase.
 * Mirrors the `<canvas>` terminator math in `SkyMap.tsx` but simplified:
 * we don't need to worry about screen orientation here, so the bright
 * limb always points right. Used as the header glyph in the detail sheet.
 */
function PhaseGlyph({
  illumination,
  phaseAngleDeg,
  size = 40,
}: {
  illumination: number;
  phaseAngleDeg: number;
  size?: number;
}) {
  const R = size / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;

  // Same signed terminator half-width as the main Moon renderer. The
  // sign of cosI distinguishes gibbous (positive, ellipse bulges into
  // dark side) from crescent (negative, ellipse carves bright side).
  const cosI = Math.cos((phaseAngleDeg * Math.PI) / 180);
  const terminator = R * cosI;
  const rx = Math.max(0.01, Math.abs(terminator)); // SVG dislikes rx=0
  // `sweep-flag` for the terminator arc: 1 = clockwise-ish traversal
  // that passes through the dark side (gibbous), 0 = the other way
  // (crescent). Anchoring the flag to the sign of the terminator
  // matches SVG's sweep convention in a y-down coordinate system.
  const sweep = terminator >= 0 ? 0 : 1;

  // Essentially-full: just a bright disk.
  if (illumination >= 0.995) {
    return (
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={cx} cy={cy} r={R} fill="#f3ecd0" />
      </svg>
    );
  }
  // Essentially-new: dark disk with a faint rim.
  if (illumination <= 0.005) {
    return (
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={cx}
          cy={cy}
          r={R}
          fill="#1a1812"
          stroke="rgba(220,220,220,0.35)"
          strokeWidth="1"
        />
      </svg>
    );
  }

  // Path: start at the top of the disk (cx, cy - R), arc clockwise to
  // the bottom via the bright limb on the right (+x), then return to
  // the top via the terminator ellipse on the left. Same construction
  // as the canvas version.
  const d = [
    `M ${cx} ${cy - R}`,
    `A ${R} ${R} 0 0 1 ${cx} ${cy + R}`,
    `A ${rx} ${R} 0 0 ${sweep} ${cx} ${cy - R}`,
    "Z",
  ].join(" ");

  return (
    <svg width={size} height={size} aria-hidden="true">
      {/* Dark side (earthshine) */}
      <circle cx={cx} cy={cy} r={R} fill="#2a2722" />
      {/* Lit side */}
      <path d={d} fill="#f3ecd0" />
    </svg>
  );
}

/**
 * A small SVG "blood moon" glyph — the characteristic copper-red
 * disc of a total lunar eclipse. Rendered at a fixed "deep
 * totality" appearance: a radial gradient from an amber core
 * through rust-red at the limb, with no bright rim (the Moon is
 * completely inside Earth's umbra, illuminated only by sunlight
 * refracted through our atmosphere). Used as the row leader on
 * the upcoming-eclipses list — visually distinct from the plain
 * `PhaseGlyph` so the list reads as "something special" at a
 * glance, and colour-coded to match the "blood moon" nickname
 * every layperson already knows.
 */
function BloodMoonGlyph({ size = 28 }: { size?: number }) {
  const R = size / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  // Unique id per size so multiple glyphs on the same page don't
  // collide in the SVG defs namespace.
  const uid = `bloodmoon-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <defs>
        {/* Amber core fading through copper to deep rust at the
            limb. Mirrors the appearance of mid-totality, when
            long-wavelength sunlight refracted around Earth's
            limb is the only thing illuminating the lunar
            surface. */}
        <radialGradient id={`${uid}-disk`} cx="45%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#e8a060" />
          <stop offset="55%" stopColor="#c0502c" />
          <stop offset="100%" stopColor="#5c1a0e" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={R} fill={`url(#${uid}-disk)`} />
      {/* Very soft outer glow to suggest the Moon sitting inside
          Earth's penumbra, visible as the slight halo during
          totality. Low opacity so it doesn't compete with the
          disc. */}
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="#8a2e1a"
        strokeWidth={Math.max(0.6, size * 0.03)}
        opacity="0.45"
      />
    </svg>
  );
}

/**
 * One row in the upcoming total-lunar-eclipses list. Extracted as
 * its own component so the visibility description can have its own
 * line with comfortable line-wrapping, rather than being crammed
 * into a single-line truncated ellipsis. Each row is a hit target —
 * tapping opens NASA's hosted visibility map for that specific
 * eclipse, which is the most useful next step for a user curious
 * about "will I see it from here?".
 *
 * The NASA URL template for lunar eclipses mirrors the solar one:
 *
 *   https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE<YYYY><Mon><DD><X>.pdf
 *
 * …with X = T for total. Rather than linking directly to the PDF
 * we point to the human-readable HTML catalog page for the decade,
 * which includes visibility maps for every eclipse in context.
 */
function LunarEclipseListItem({ eclipse }: { eclipse: TotalLunarEclipse }) {
  // Link to NASA's per-eclipse figure (geometry + visibility map).
  // Slug format: LE<YYYY><Mon><DD><X>.pdf — same conventions as the
  // solar side, with X = "T" for total.
  const monthAbbr = eclipse.date.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const year = eclipse.date.getUTCFullYear();
  const day = eclipse.date.getUTCDate().toString().padStart(2, "0");
  const nasaUrl = `https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE${year}${monthAbbr}${day}T.pdf`;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="flex-shrink-0 mt-0.5">
        <BloodMoonGlyph size={32} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <a
            href={nasaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium hover:text-sky-200 transition-colors inline-flex items-center gap-1"
          >
            {formatAbsolute(eclipse.date)}, {year}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
          <span className="text-xs text-white/70 tabular-nums flex-shrink-0">
            {formatRelative(eclipse.date)}
          </span>
        </div>
        <div className="text-xs text-white/60 mt-1 leading-relaxed">
          <span className="text-white/75">Total lunar eclipse</span>
          <span className="text-white/40"> · </span>
          {eclipse.visibilityDescription}
        </div>
        <div className="text-[11px] text-white/45 mt-1 tabular-nums">
          Totality {formatLunarTotalityDuration(eclipse.totalityDurationSeconds)}
        </div>
      </div>
    </li>
  );
}

/**
 * Moon detail sheet. Shows the Moon's *current phase* — name, glyph,
 * and illumination in a compact sticky header — then pulls the
 * Wikipedia article that most closely matches that phase (not the
 * generic article about the Moon as a body). Comments are anchored to
 * that article's Wikidata entity URI so each phase has its own
 * language-neutral, rename-stable discussion thread.
 *
 * Phase math is computed once when the sheet opens; the Moon's
 * illumination drifts at ~3%/day, so there's no benefit to re-ticking
 * while the sheet is open.
 */
export function MoonDetailSheet({
  open,
  onClose,
}: MoonDetailSheetProps) {
  // Lock the phase to "now at open time". If the user keeps the sheet
  // open across a phase transition (rare — takes hours to days), they
  // can close and reopen to refresh. Keeping this stable avoids any
  // risk of the Wikipedia article / comment thread swapping out
  // underneath them mid-read.
  //
  // Also caches the next four total lunar eclipses (for the
  // "Upcoming" section) and — if the sheet is opened during a full
  // moon — the named-full-moon descriptor (e.g. "Harvest Moon",
  // "Blue Moon"). The upcoming list intentionally surfaces *only*
  // total lunar eclipses ("blood moons"): the sheet mirrors the Sun
  // page's "rare and worth travelling for" framing, and weekly
  // principal-phase transitions would dilute that. Partial and
  // penumbral lunar eclipses are likewise omitted — a partial
  // shadow on the Moon reads visually as "a smudge", not a
  // spectacle.
  //
  // All recomputation is O(a few Meeus series plus a table lookup),
  // so cheap.
  const phaseState = useMemo(() => {
    if (!open) return null;
    const date = new Date();
    const pos = moonPosition(date);
    const phase = moonPhase(date, pos);
    const info = classifyPhase(phase.ageDays, phase.illumination);
    const eclipses = upcomingTotalLunarEclipses(date, 4);
    // Only resolve the cultural name when we're actually *at* full —
    // "Beaver Moon" is meaningful only on/around the full moon. For
    // anything else we suppress it to keep the header focused.
    const namedMoon: NamedFullMoon | null =
      info.key === "full" ? describeFullMoon(date) : null;
    return { pos, phase, info, eclipses, namedMoon };
  }, [open]);

  // Wikipedia article candidates. All eight phases fetch an article
  // — but what we *do* with the result differs:
  //
  //  - New moon & full moon: render the full preview (image, extract,
  //    'Read on Wikipedia' link) from the dedicated per-phase article.
  //    For named full moons (Harvest, Blue, Wolf, …) we prefer the
  //    cultural article over the generic 'Full moon'.
  //  - Six intermediate phases: fetch 'Lunar phase' so we can show its
  //    header image and an outbound link to the article, but we ignore
  //    the fetched extract entirely — the descriptive prose comes from
  //    our local bundle (src/lib/moonPhaseContent.ts) so the phrase
  //    'Lunar phase' never appears in visible text.
  const candidates = useMemo(() => {
    if (!phaseState) return [];
    const base = phaseState.info.wikiTitles;
    if (phaseState.namedMoon?.wikipediaTitle) {
      return [phaseState.namedMoon.wikipediaTitle, ...base];
    }
    return base;
  }, [phaseState]);
  const { data: wiki, isLoading, error } = useWikipediaSummary(candidates);

  // Second fetch: the Wikipedia article for the Moon itself (Q405),
  // shown as an "About the Moon" section above the per-phase content.
  // This is the canonical entity the comment thread is anchored to,
  // so it also serves as a visual header that reinforces the sheet's
  // primary identity: "this is about the Moon, these are its phases".
  // Candidate list is constant; fetched once per session and cached
  // by tanstack-query regardless of which phase is open.
  const moonCandidates = useMemo(() => ["Moon"], []);
  const { data: moonWiki } = useWikipediaSummary(moonCandidates);

  /**
   * Heading shown on the article card — always the phase (or named-
   * moon) label, never the Wikipedia article's own displaytitle. This
   * ensures the UI never shows "Lunar phase" even as a header.
   */
  const articleDisplayTitle = useMemo(() => {
    if (!phaseState) return "";
    return phaseState.namedMoon?.name ?? phaseState.info.name;
  }, [phaseState]);

  /**
   * Local content for the six phases without a dedicated Wikipedia
   * article. `null` for new moon / full moon (they use the Wikipedia
   * fetch above instead).
   */
  const localContent = useMemo(() => {
    if (!phaseState) return null;
    if (phaseState.info.hasDedicatedArticle) return null;
    // Every non-dedicated phase key is an IntermediatePhaseKey.
    const key = phaseState.info.key as IntermediatePhaseKey;
    return INTERMEDIATE_PHASE_CONTENT[key];
  }, [phaseState]);

  // Comment thread URL — ALWAYS the Moon's Wikidata entity, never the
  // per-phase article. The sheet is about the Moon; phase is just a
  // time-varying display attribute. Anchoring comments to the current
  // phase's article would fragment the conversation across up to three
  // different Wikidata entities (Q108566 new moon, Q104641 full moon,
  // Q26388 lunar phase) depending on which phase the user happened to
  // open the sheet on — not what we want. Q405 is stable, canonical,
  // and language-neutral.
  const commentUrl = useMemo(
    () => new URL(MOON_WIKIDATA_URL),
    [],
  );

  const illumPct = phaseState
    ? (phaseState.phase.illumination * 100).toFixed(0)
    : "0";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Use dvh so the sheet fits inside the currently-visible
        // viewport on mobile (same approach as StarDetailSheet).
        className="bg-slate-950/95 backdrop-blur-lg border-white/10 text-white p-0 h-[88dvh] max-h-[88dvh] rounded-t-3xl flex flex-col"
      >
        {phaseState && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Drag handle */}
            <div className="flex items-center justify-center pt-3 pb-1 flex-shrink-0">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>

            {/* Header: phase identity */}
            <div className="px-5 pb-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  <PhaseGlyph
                    illumination={phaseState.phase.illumination}
                    phaseAngleDeg={phaseState.phase.phaseAngleDeg}
                    size={44}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    The Moon
                  </h2>
                  <p className="text-sm text-white/60 mt-0.5">
                    {/* When it's a named full moon (Harvest, Blue, Wolf,
                        …), surface that name prominently alongside the
                        phase. Everything else keeps the plain phase +
                        illumination readout. */}
                    {phaseState.namedMoon ? (
                      <>
                        <span className="text-amber-200/90 font-medium">
                          {phaseState.namedMoon.name}
                        </span>
                        {" · "}
                        <span>{phaseState.info.name}</span>
                        {" · "}
                        <span className="tabular-nums">
                          {illumPct}% illuminated
                        </span>
                      </>
                    ) : (
                      <>
                        <span>{phaseState.info.name}</span>
                        {" · "}
                        <span className="tabular-nums">
                          {illumPct}% illuminated
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              {/* Folklore strip: if a full moon has notable alternate
                  names (Sturgeon & "Red Moon" for August, etc.), drop
                  them in small below the identity row. Only shown on
                  full moons since that's the only time we surface
                  names. The phase-specific blurb itself is kept out
                  of the sticky header — it lives in the (more
                  expansive) "About this phase" card below, so the
                  header stays compact and the sheet can scroll
                  sooner. */}
              {phaseState.namedMoon &&
                phaseState.namedMoon.altNames.length > 0 && (
                  <p className="mt-3 text-xs text-white/45">
                    Also known as{" "}
                    {joinWithAnd(phaseState.namedMoon.altNames)}.
                  </p>
                )}
            </div>

            {/* Scrollable content: Wikipedia + Nostr comments */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="p-5 space-y-5">
                {/* About-the-Moon section. Shows the Wikipedia preview
                    for the Moon itself (Q405) — the canonical entity
                    the comment thread is anchored to. Rendered above
                    the per-phase content so the primary identity of
                    the sheet reads as "the Moon" first, with the
                    current phase as a refinement. Silently omits
                    itself if the fetch hasn't resolved or failed —
                    not worth blocking the rest of the sheet on. */}
                {moonWiki && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="h-4 w-4 text-white/50" />
                      <h3 className="text-xs uppercase tracking-widest text-white/50">
                        About the Moon
                      </h3>
                    </div>
                    <Card className="bg-white/5 border-white/10 overflow-hidden">
                      {moonWiki.thumbnail && (
                        <div className="relative w-full aspect-[16/9] bg-black/40">
                          <img
                            src={moonWiki.thumbnail.source}
                            alt="The Moon"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                        </div>
                      )}
                      <CardContent className="p-4 space-y-3">
                        <div>
                          <div className="text-base font-semibold">
                            The Moon
                          </div>
                          <div className="text-xs text-white/60 mt-0.5">
                            From Wikipedia
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-white/80">
                          {moonWiki.extract}
                        </p>
                        {moonWiki.pageUrl && (
                          <a
                            href={moonWiki.pageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 transition-colors"
                          >
                            Read about the Moon on Wikipedia
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* About-this-phase section.
                    - New moon & full moon: fetches the dedicated
                      Wikipedia article (and, for named full moons,
                      prefers the cultural article like "Harvest Moon").
                    - Six intermediate phases: renders bundled local
                      content from src/lib/moonPhaseContent.ts. We
                      deliberately do NOT fall back to the generic
                      "Lunar phase" article — the user's requirement
                      is that no part of that article's text or title
                      ever appears in the UI. */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      About this phase
                    </h3>
                  </div>

                  {/* Wikipedia-fetched path (new moon / full moon). */}
                  {phaseState.info.hasDedicatedArticle && (
                    <>
                      {isLoading && (
                        <Card className="bg-white/5 border-white/10">
                          <CardContent className="p-4 flex items-center gap-3 text-sm text-white/70">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading article…
                          </CardContent>
                        </Card>
                      )}

                      {error && !isLoading && (
                        <Card className="bg-white/5 border-white/10">
                          <CardContent className="p-4 flex items-start gap-3 text-sm text-white/70">
                            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-300" />
                            <div>
                              <div className="font-medium text-white">
                                Couldn't load the article
                              </div>
                              <div className="text-xs mt-1 text-white/60">
                                Try again once you're back online.
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {wiki && (
                        <Card className="bg-white/5 border-white/10 overflow-hidden">
                          {wiki.thumbnail && (
                            <div className="relative w-full aspect-[16/9] bg-black/40">
                              <img
                                src={wiki.thumbnail.source}
                                alt={articleDisplayTitle}
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                            </div>
                          )}
                          <CardContent className="p-4 space-y-3">
                            <div>
                              {/* Heading always shows the phase or
                                  named-moon label, never the fetched
                                  article's displaytitle. */}
                              <div className="text-base font-semibold">
                                {articleDisplayTitle}
                              </div>
                              <div className="text-xs text-white/60 mt-0.5">
                                From Wikipedia
                              </div>
                            </div>
                            <p className="text-sm leading-relaxed text-white/80">
                              {wiki.extract}
                            </p>
                            {wiki.pageUrl && (
                              <a
                                href={wiki.pageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 transition-colors"
                              >
                                {`Read about the ${articleDisplayTitle.toLowerCase()} on Wikipedia`}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}

                  {/* Local-content path (six intermediate phases). The
                      descriptive prose comes entirely from our local
                      bundle so the phrase 'Lunar phase' never appears
                      in rendered text. The visual anchor at the top
                      of the card is a large-scale render of the
                      current phase itself (same PhaseGlyph used in
                      the header, scaled up and centred on a dark
                      backdrop) — avoids pulling any image from the
                      generic Wikipedia article. The 'Read on
                      Wikipedia' link at the bottom still uses the
                      fetched pageUrl for a live, canonical target. */}
                  {localContent && (
                    <Card className="bg-white/5 border-white/10 overflow-hidden">
                      <div className="relative w-full aspect-[16/9] bg-gradient-to-b from-slate-950 via-slate-900 to-black flex items-center justify-center">
                        <PhaseGlyph
                          illumination={phaseState.phase.illumination}
                          phaseAngleDeg={phaseState.phase.phaseAngleDeg}
                          size={180}
                        />
                      </div>
                      <CardContent className="p-4 space-y-4">
                        <div>
                          <div className="text-base font-semibold">
                            {articleDisplayTitle}
                          </div>
                          <div className="text-xs text-white/60 mt-0.5">
                            {localContent.visibility}
                          </div>
                        </div>

                        {/* Description paragraphs. */}
                        <div className="space-y-3 text-sm leading-relaxed text-white/80">
                          {localContent.description.map((para, idx) => (
                            <p key={idx}>{para}</p>
                          ))}
                        </div>

                        {/* Quick-facts grid. */}
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-2 border-t border-white/10 text-xs">
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Illuminated
                            </dt>
                            <dd className="text-white/85 mt-0.5">
                              {localContent.illuminated}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Visibility
                            </dt>
                            <dd className="text-white/85 mt-0.5">
                              {localContent.visibility}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Moonrise
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {localContent.moonriseTime}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Culmination
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {localContent.culminationTime}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Moonset
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {localContent.moonsetTime}
                            </dd>
                          </div>
                        </dl>

                        {/* Outbound link. Prefer the live page URL
                            returned by the fetch; fall back to the
                            hard-coded section anchor so a failed fetch
                            doesn't strand the user without a link.
                            Visible label is neutral either way. */}
                        <a
                          href={wiki?.pageUrl ?? WIKIPEDIA_ATTRIBUTION.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 transition-colors"
                        >
                          Read more on Wikipedia
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </CardContent>
                    </Card>
                  )}
                </section>

                {/* Upcoming total lunar eclipses — pulled from the
                    bundled NASA catalog. Mirrors the Sun page's
                    approach of surfacing only the travel-worthy
                    spectacle: total lunar eclipses ("blood moons")
                    only. Partial and penumbral eclipses are
                    deliberately omitted; principal phase transitions
                    (new / full / quarter) happen weekly and belong
                    to the realm of "calendar trivia" rather than
                    "rare event worth marking". Tapping an entry
                    opens NASA's visibility diagram for that
                    specific eclipse. */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Eclipse className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      Upcoming total lunar eclipses
                    </h3>
                  </div>
                  {phaseState.eclipses.length === 0 ? (
                    // Past-the-end fallback: the table is finite,
                    // and if the runtime clock is so far in the
                    // future that nothing remains we'd rather say
                    // so directly than render an empty card.
                    <Card className="bg-white/5 border-white/10">
                      <CardContent className="p-4 flex items-start gap-3 text-sm text-white/70">
                        <CalendarDays className="h-4 w-4 mt-0.5 text-white/50" />
                        <div>
                          <div className="font-medium text-white">
                            No eclipses in our table
                          </div>
                          <div className="text-xs mt-1 text-white/60">
                            Starpoint ships with NASA's published
                            list through the late 2050s. Check{" "}
                            <a
                              href="https://eclipse.gsfc.nasa.gov/LEcat5/LEcatalog.html"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-300 hover:text-sky-200"
                            >
                              eclipse.gsfc.nasa.gov
                            </a>{" "}
                            for events beyond that horizon.
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="bg-white/5 border-white/10 overflow-hidden">
                      <ul className="divide-y divide-white/10">
                        {phaseState.eclipses.map((eclipse) => (
                          <LunarEclipseListItem
                            key={eclipse.date.getTime()}
                            eclipse={eclipse}
                          />
                        ))}
                      </ul>
                    </Card>
                  )}
                  <p className="mt-2 text-[10px] text-white/35 leading-relaxed">
                    Eclipse predictions by Fred Espenak and Jean
                    Meeus (NASA/GSFC).
                  </p>
                </section>

                {/* Comments — anchored to the Moon itself (Q405), not
                    to whatever phase article is currently on display. */}
                <section>
                  <CommentsSection
                    root={commentUrl}
                    emptyStateMessage="No comments yet"
                    emptyStateSubtitle="Be the first to discuss the Moon on Nostr."
                  />
                </section>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 flex-shrink-0 bg-slate-950/80">
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
  );
}
