import { useMemo, type ReactElement } from "react";
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
import { equatorialToHorizontal } from "@/lib/astronomy";
import { sunPosition } from "@/lib/sun";
import {
  upcomingSolarEclipses,
  formatEclipseDuration,
  solarEclipsePeakLabel,
  solarEclipseTypeLabel,
  solarEclipseNasaCode,
  type SolarEclipse,
} from "@/lib/solarEclipses";

interface SunDetailSheetProps {
  /** Whether the sheet is open. */
  open: boolean;
  onClose: () => void;
  /** Viewer latitude (deg), used to compute current sky position. */
  latitude: number;
  /** Viewer longitude (deg), used to compute current sky position. */
  longitude: number;
}

/**
 * The Sun's Wikidata entity URI (Q525). Used as the stable, canonical,
 * language-neutral root for the comment thread. Mirrors the way the
 * Moon sheet anchors its discussion to Q405.
 */
const SUN_WIKIDATA_URL = "https://www.wikidata.org/entity/Q525";

/**
 * Human-friendly relative-time label for an upcoming date.
 * Intentionally identical to the one in `MoonDetailSheet` — they
 * serve the same purpose (compact "in 3 days" readouts in a list of
 * upcoming celestial events) and splitting them into a shared
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

/** Absolute-date label for the same upcoming date. */
function formatAbsolute(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * A small SVG sun glyph with a central disk and 12 rays. Mirrors the
 * canvas-space rendering in `SkyMap.tsx` but is simpler: we don't need
 * a halo or a corona gradient at tiny sizes, and the rays read best
 * when they're solid, slightly-tapered spokes at fixed angles. Used as
 * the header glyph and in the upcoming-events list.
 */
function SunGlyph({ size = 40 }: { size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const diskR = size * 0.28;
  const rayInner = size * 0.33;
  const rayOuter = size * 0.48;
  const rays = 12;
  const rayNodes: ReactElement[] = [];
  for (let i = 0; i < rays; i++) {
    const ang = (i / rays) * Math.PI * 2;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    rayNodes.push(
      <line
        key={i}
        x1={cx + c * rayInner}
        y1={cy + s * rayInner}
        x2={cx + c * rayOuter}
        y2={cy + s * rayOuter}
        stroke="#f5c45a"
        strokeWidth={Math.max(1, size / 28)}
        strokeLinecap="round"
      />,
    );
  }
  return (
    <svg width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id={`sun-disk-${size}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff7d8" />
          <stop offset="70%" stopColor="#ffd97a" />
          <stop offset="100%" stopColor="#f5a64a" />
        </radialGradient>
      </defs>
      {rayNodes}
      <circle cx={cx} cy={cy} r={diskR} fill={`url(#sun-disk-${size})`} />
    </svg>
  );
}

/**
 * A small SVG "eclipsed sun" glyph, rendered in one of three variants
 * matching the central eclipse types. Used as the row leader on the
 * eclipses list — visually distinct from the plain `SunGlyph` used
 * elsewhere so the list reads as "something special" at a glance,
 * and specifically distinguishes total from annular from hybrid at
 * a glance:
 *
 *   - total:   dark lunar silhouette perfectly centred over the Sun,
 *              ringed by a bright chromosphere and pearly corona.
 *   - annular: the "ring of fire" — dark Moon in front of a visible
 *              bright solar annulus; no extended corona (the
 *              photosphere is never fully covered).
 *   - hybrid:  a blend — partial corona, thinned bright rim —
 *              reflecting that a hybrid is total along some parts
 *              of its path and annular along others.
 */
function EclipsedSunGlyph({
  size = 28,
  type,
}: {
  size?: number;
  type: "total" | "annular" | "hybrid";
}) {
  const cx = size / 2;
  const cy = size / 2;
  // The Moon silhouette. Sized to leave room for a thin, bright
  // ring and, in the total/hybrid variants, a broader corona beyond.
  const moonR = size * 0.32;
  // Unique ids per size + type so multiple glyphs on the same page
  // don't collide in the SVG defs namespace.
  const uid = `eclipse-${type}-${size}`;

  if (type === "annular") {
    // Ring-of-fire: bright solar annulus visible around the Moon,
    // no extended corona (the photosphere is never fully covered
    // during an annular, so there's no corona to see).
    const sunR = size * 0.44;
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`${uid}-ring`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff7d8" />
            <stop offset="60%" stopColor="#ffd97a" />
            <stop offset="100%" stopColor="#f5a64a" />
          </radialGradient>
        </defs>
        {/* Bright solar disk — the larger outer circle. */}
        <circle cx={cx} cy={cy} r={sunR} fill={`url(#${uid}-ring)`} />
        {/* Moon silhouette centred inside, leaving a bright annulus. */}
        <circle cx={cx} cy={cy} r={moonR} fill="#0a0a0f" />
      </svg>
    );
  }

  if (type === "hybrid") {
    // Hybrid: thin bright rim on one side (the "annular" part of
    // the path) blending into a faint partial corona on the other
    // (the "total" part). Achieved by drawing a small bright crescent
    // and a reduced-opacity corona.
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`${uid}-corona`} cx="50%" cy="50%" r="50%">
            <stop
              offset={`${(moonR / (size / 2)) * 100}%`}
              stopColor="#ffffff"
              stopOpacity="0"
            />
            <stop
              offset={`${(moonR / (size / 2)) * 100 + 2}%`}
              stopColor="#fff7e0"
              stopOpacity="0.6"
            />
            <stop offset="70%" stopColor="#ffe9a8" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#ffd97a" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Reduced corona */}
        <circle cx={cx} cy={cy} r={size / 2 - 0.5} fill={`url(#${uid}-corona)`} />
        {/* Thin bright rim — slightly thicker than total, to hint at
            the annular side of the hybrid path. */}
        <circle
          cx={cx}
          cy={cy}
          r={moonR + Math.max(0.8, size * 0.045)}
          fill="none"
          stroke="#ffd97a"
          strokeWidth={Math.max(1, size * 0.06)}
          opacity="0.9"
        />
        {/* Moon silhouette */}
        <circle cx={cx} cy={cy} r={moonR} fill="#0a0a0f" />
      </svg>
    );
  }

  // Default: total. Dark lunar silhouette perfectly centred over
  // the solar disk, ringed by a bright white "diamond-ring" inner
  // chromosphere and a softer pearly outer corona that fades into
  // space.
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <defs>
        {/* Outer corona: pearly white fading to nothing. Reaches
            almost to the edge of the glyph. */}
        <radialGradient id={`${uid}-corona`} cx="50%" cy="50%" r="50%">
          <stop
            offset={`${(moonR / (size / 2)) * 100}%`}
            stopColor="#ffffff"
            stopOpacity="0"
          />
          <stop
            offset={`${(moonR / (size / 2)) * 100 + 2}%`}
            stopColor="#fff7e0"
            stopOpacity="0.95"
          />
          <stop offset="70%" stopColor="#ffe9a8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffd97a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Corona halo — drawn first, behind the Moon */}
      <circle cx={cx} cy={cy} r={size / 2 - 0.5} fill={`url(#${uid}-corona)`} />
      {/* Bright chromosphere ring right at the Moon's limb */}
      <circle
        cx={cx}
        cy={cy}
        r={moonR + Math.max(0.6, size * 0.025)}
        fill="none"
        stroke="#ffffff"
        strokeWidth={Math.max(0.8, size * 0.035)}
        opacity="0.95"
      />
      {/* Moon silhouette, centred — this is what makes it read as a
          *total* eclipse rather than a partial/crescent. */}
      <circle cx={cx} cy={cy} r={moonR} fill="#0a0a0f" />
    </svg>
  );
}

/**
 * One row in the upcoming-eclipses list. Extracted as its own
 * component primarily so the path-description can be given its own
 * line with comfortable line-wrapping, rather than being crammed
 * into a single-line truncated ellipsis. Every eclipse's row is a
 * hit target — tapping opens NASA's hosted Google-maps view of the
 * central path for that specific eclipse, which is by far the most
 * useful next step for a user curious about "can I get there?".
 *
 * The row leader glyph and label adapt to the eclipse type so the
 * list reads cleanly when it interleaves totals, annulars, and
 * hybrids (which happens in practice — annulars and totals
 * alternate roughly every six months in most years).
 */
function EclipseListItem({ eclipse }: { eclipse: SolarEclipse }) {
  // NASA path maps are at stable URLs of the form
  // https://eclipse.gsfc.nasa.gov/SEgoogle/SEgoogle2001/SE<YYYY><Mon><DD><X>google.html
  // — the month is a three-letter English abbreviation, day is
  // zero-padded, and the trailing <X> is T / A / H for total,
  // annular, hybrid respectively.
  const monthAbbr = eclipse.date.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const year = eclipse.date.getUTCFullYear();
  const day = eclipse.date.getUTCDate().toString().padStart(2, "0");
  const code = solarEclipseNasaCode(eclipse.type);
  const nasaUrl = `https://eclipse.gsfc.nasa.gov/SEgoogle/SEgoogle2001/SE${year}${monthAbbr}${day}${code}google.html`;
  const peakLabel = solarEclipsePeakLabel(eclipse.type);
  const typeLabel = solarEclipseTypeLabel(eclipse.type);

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="flex-shrink-0 mt-0.5">
        <EclipsedSunGlyph size={32} type={eclipse.type} />
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
          {/* Type prefix makes the list self-explanatory when rows
              of different types sit side-by-side. Path description
              follows as a gentle secondary line. */}
          <span className="text-white/75">{typeLabel}</span>
          <span className="text-white/40"> · </span>
          {eclipse.pathDescription}
        </div>
        <div className="text-[11px] text-white/45 mt-1 tabular-nums">
          {peakLabel} up to {formatEclipseDuration(eclipse.durationSeconds)}
        </div>
      </div>
    </li>
  );
}

/**
 * Sun detail sheet. Mirrors `MoonDetailSheet` in layout and behaviour
 * but drops the phase apparatus (the Sun doesn't have one) and
 * replaces "Upcoming phases" with "Upcoming solar eclipses" — all
 * three central types (total, annular, hybrid). Equinoxes and
 * solstices are intentionally omitted: they're calendar trivia for
 * most viewers, whereas a central solar eclipse is the kind of
 * event that gets its own trip. Partial eclipses are also omitted —
 * they're geometrically common and visually far less striking than
 * any of the three central types.
 *
 * Everything else is parallel: a Wikipedia preview of the Sun
 * article itself (Q525) with the live sky-position readout embedded
 * inside it (matching how the Moon sheet embeds its live numbers
 * inside the phase card), and a Nostr comment thread anchored to
 * Q525.
 *
 * All computations are locked to "now at open time" so mid-read
 * updates can't swap content out underneath the user. The altitude
 * / azimuth readout therefore reflects the moment the sheet opened
 * rather than tracking live — reopening the sheet refreshes it.
 */
export function SunDetailSheet({
  open,
  onClose,
  latitude,
  longitude,
}: SunDetailSheetProps) {
  // Lock the Sun state to "now at open time". Reopening refreshes.
  // `eclipses` is the next few central solar eclipses (total,
  // annular, or hybrid) pulled from the bundled NASA table —
  // deliberately *not* computed from the lunar ephemeris, because
  // NASA's canonical table is the reference everyone compares
  // against and it carries path geometry and type classification
  // that can't be derived without a substantial dedicated
  // algorithm.
  const state = useMemo(() => {
    if (!open) return null;
    const date = new Date();
    const pos = sunPosition(date);
    const horz = equatorialToHorizontal(pos.ra, pos.dec, latitude, longitude, date);
    const eclipses = upcomingSolarEclipses(date, 4);
    return { date, pos, horz, eclipses };
  }, [open, latitude, longitude]);

  // Fetch the Wikipedia "Sun" article. Candidate list is constant, so
  // this caches across sessions via tanstack-query.
  const sunCandidates = useMemo(() => ["Sun"], []);
  const { data: sunWiki, isLoading, error } = useWikipediaSummary(sunCandidates);

  // Comment thread URL — the Sun's Wikidata entity. Stable and
  // language-neutral, matching the Moon sheet's approach.
  const commentUrl = useMemo(() => new URL(SUN_WIKIDATA_URL), []);

  // Convenience readouts computed from the locked state.
  const altReadout = state ? `${state.horz.alt.toFixed(1)}°` : "—";
  const azReadout = state ? `${state.horz.az.toFixed(1)}°` : "—";
  const aboveHorizon = state ? state.horz.alt > 0 : false;
  const distanceAu = state ? state.pos.distanceAu.toFixed(4) : "—";
  const distanceKm = state
    ? `${(state.pos.distanceKm / 1_000_000).toFixed(2)} M km`
    : "—";
  const angDiameterArcmin = state
    ? (state.pos.angularDiameterDeg * 60).toFixed(1)
    : "—";
  const decReadout = state
    ? `${state.pos.dec >= 0 ? "+" : ""}${state.pos.dec.toFixed(2)}°`
    : "—";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="bg-slate-950/95 backdrop-blur-lg border-white/10 text-white p-0 h-[88dvh] max-h-[88dvh] rounded-t-3xl flex flex-col"
      >
        {state && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Drag handle */}
            <div className="flex items-center justify-center pt-3 pb-1 flex-shrink-0">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>

            {/* Header: Sun identity */}
            <div className="px-5 pb-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  <SunGlyph size={44} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    The Sun
                  </h2>
                  <p className="text-sm text-white/60 mt-0.5">
                    {aboveHorizon ? (
                      <>
                        <span className="text-amber-200/90 font-medium">
                          Above the horizon
                        </span>
                        {" · "}
                        <span className="tabular-nums">
                          altitude {altReadout}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>Below the horizon</span>
                        {" · "}
                        <span className="tabular-nums">
                          altitude {altReadout}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              {/* No blurb paragraph here: the header is kept to just
                  the glyph + title + one-line status so the sticky
                  section stays compact. Longer explanatory prose
                  belongs in the scrollable cards below. */}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="p-5 space-y-5">
                {/* About-the-Sun section (Wikipedia Q525). The
                    current-sky stats grid is embedded inside this
                    card — mirroring the Moon sheet, where the
                    live-data figures live inside the phase card
                    rather than as a separate "Right now" section
                    above it. This keeps the sheet's primary identity
                    ("this is about the Sun") as the first thing the
                    reader encounters, with the concrete numbers as
                    supporting detail. */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      About the Sun
                    </h3>
                  </div>

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

                  {sunWiki && (
                    <Card className="bg-white/5 border-white/10 overflow-hidden">
                      {sunWiki.thumbnail && (
                        <div className="relative w-full aspect-[16/9] bg-black/40">
                          <img
                            src={sunWiki.thumbnail.source}
                            alt="The Sun"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                        </div>
                      )}
                      <CardContent className="p-4 space-y-4">
                        <div>
                          <div className="text-base font-semibold">
                            The Sun
                          </div>
                          <div className="text-xs text-white/60 mt-0.5">
                            From Wikipedia
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-white/80">
                          {sunWiki.extract}
                        </p>

                        {/* Live sky-state readout. Snapshot at open
                            time so the numbers don't drift while
                            reading. Matches the embedded stats grid
                            in MoonDetailSheet for visual parity. */}
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-2 border-t border-white/10 text-xs">
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Altitude
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {altReadout}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Azimuth
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {azReadout}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Declination
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {decReadout}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Angular diameter
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {angDiameterArcmin}′
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Distance
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {distanceAu} AU
                            </dd>
                          </div>
                          <div>
                            <dt className="text-white/45 uppercase tracking-wider text-[10px]">
                              Distance (km)
                            </dt>
                            <dd className="text-white/85 mt-0.5 tabular-nums">
                              {distanceKm}
                            </dd>
                          </div>
                        </dl>

                        {sunWiki.pageUrl && (
                          <a
                            href={sunWiki.pageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 transition-colors"
                          >
                            Read about the Sun on Wikipedia
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </section>

                {/* Upcoming solar eclipses — pulled from the bundled
                    NASA catalog. Includes total, annular, and hybrid
                    central eclipses. Each row shows the date, the
                    type, the peak duration, and the region the
                    path crosses; tapping the date opens NASA's
                    Google-maps overlay of the central path. */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Eclipse className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      Upcoming solar eclipses
                    </h3>
                  </div>
                  {state.eclipses.length === 0 ? (
                    // Past-the-end fallback: the table is finite, and
                    // if the runtime clock is so far in the future
                    // that nothing remains we'd rather say so
                    // directly than render an empty card.
                    <Card className="bg-white/5 border-white/10">
                      <CardContent className="p-4 flex items-start gap-3 text-sm text-white/70">
                        <CalendarDays className="h-4 w-4 mt-0.5 text-white/50" />
                        <div>
                          <div className="font-medium text-white">
                            No eclipses in our table
                          </div>
                          <div className="text-xs mt-1 text-white/60">
                            Birdstar ships with NASA's published list
                            through the late 2050s. Check{" "}
                            <a
                              href="https://eclipse.gsfc.nasa.gov/SEcat5/SEcatalog.html"
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
                        {state.eclipses.map((eclipse) => (
                          <EclipseListItem
                            key={eclipse.date.getTime()}
                            eclipse={eclipse}
                          />
                        ))}
                      </ul>
                    </Card>
                  )}
                  <p className="mt-2 text-[10px] text-white/35 leading-relaxed">
                    Eclipse predictions by Fred Espenak (NASA/GSFC).
                  </p>
                </section>

                {/* Comments — anchored to the Sun itself (Q525). */}
                <section>
                  <CommentsSection
                    root={commentUrl}
                    emptyStateMessage="No comments yet"
                    emptyStateSubtitle="Be the first to discuss the Sun on Nostr."
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
