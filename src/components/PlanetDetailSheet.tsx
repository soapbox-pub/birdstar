import { useMemo } from "react";
import {
  ExternalLink,
  Loader2,
  BookOpen,
  AlertCircle,
  Landmark,
} from "lucide-react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { useWikipediaSummary } from "@/hooks/useWikipediaSummary";
import { equatorialToHorizontal } from "@/lib/astronomy";
import {
  getPlanetInfo,
  planetPosition,
  type PlanetId,
  type PlanetInfo,
  type PlanetMythology,
} from "@/lib/planets";

interface PlanetDetailSheetProps {
  /** The planet whose sheet should be shown. `null` = sheet closed. */
  planetId: PlanetId | null;
  onClose: () => void;
  /** Viewer latitude (deg), used to compute current sky position. */
  latitude: number;
  /** Viewer longitude (deg), used to compute current sky position. */
  longitude: number;
}

/**
 * A simple SVG disk glyph matching the planet's color palette. Mirrors
 * the canvas-space rendering in `SkyMap.tsx` but without the full
 * gradient-sphere affectations — at small sizes the extra depth would
 * read as noise. Used as the header glyph.
 */
function PlanetGlyph({
  info,
  size = 44,
  withRings = false,
}: {
  info: PlanetInfo;
  size?: number;
  withRings?: boolean;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.3;
  const gradId = `planet-disk-${info.id}-${size}`;
  return (
    <svg width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id={gradId} cx="35%" cy="35%" r="70%">
          <stop offset="0%" stopColor={info.highlight} />
          <stop offset="60%" stopColor={info.color} />
          <stop offset="100%" stopColor={info.shadow} />
        </radialGradient>
      </defs>
      {/* Soft halo */}
      <circle
        cx={cx}
        cy={cy}
        r={r * 1.6}
        fill={info.color}
        opacity={0.18}
      />
      {/* Saturn-style rings, rendered beneath the disk so the planet
          sits "in front" of the ring foreground. */}
      {withRings && (
        <g transform={`rotate(-20 ${cx} ${cy})`}>
          <ellipse
            cx={cx}
            cy={cy}
            rx={r * 1.9}
            ry={r * 0.55}
            fill="none"
            stroke={info.highlight}
            strokeWidth={Math.max(1, size / 28)}
            opacity={0.7}
          />
          <ellipse
            cx={cx}
            cy={cy}
            rx={r * 1.45}
            ry={r * 0.42}
            fill="none"
            stroke={info.shadow}
            strokeWidth={Math.max(1, size / 42)}
            opacity={0.8}
          />
        </g>
      )}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${gradId})`} />
    </svg>
  );
}

/**
 * Mythology section — one per planet sheet.
 *
 * Every planet except Earth takes its English name from a Roman deity,
 * so the Roman figure is led with as the "primary" reference, with the
 * (typically more familiar to modern readers) Greek counterpart named
 * alongside. Uranus inverts the convention — it's named directly for
 * the Greek Ouranos — but we still render Roman first for layout
 * consistency and let the domain line acknowledge the reversal.
 *
 * A single Wikipedia lookup is performed against the Roman article
 * title; that's what the card body shows. The Greek name is surfaced
 * inline in the header. Putting the Greek deity in its own card would
 * double the API calls and visual weight for marginal gain.
 *
 * Lives in the same file as the main sheet because it's a private
 * implementation detail of "the planet sheet" — no reuse elsewhere.
 */
function MythologySection({
  info,
  mythology,
}: {
  info: PlanetInfo;
  mythology: PlanetMythology;
}) {
  // Try the Roman title first, and fall back to a few sensible
  // alternate forms Wikipedia has historically used for these deities
  // (e.g. "Jupiter (mythology)" redirects to "Jupiter (god)"). The
  // candidate-list pattern is already built into `useWikipediaSummary`,
  // so this costs us one fetch in the happy path.
  const candidates = useMemo(
    () => [
      mythology.romanTitle,
      `${mythology.romanName} (god)`,
      `${mythology.romanName} (mythology)`,
    ],
    [mythology.romanTitle, mythology.romanName],
  );
  const { data: wiki, isLoading, error } = useWikipediaSummary(candidates);

  // Whether the Roman and Greek deities share a name. Typically they
  // don't (Jupiter/Zeus, Venus/Aphrodite), but Mercury/Hermes and a few
  // others are close enough that a "(Greek: …)" parenthetical adds
  // nothing. Keep this case-insensitive so "Caelus" vs. "Ouranos" still
  // counts as distinct.
  const showGreekCounterpart =
    mythology.greekName.toLowerCase() !== mythology.romanName.toLowerCase();

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Landmark className="h-4 w-4 text-white/50" />
        <h3 className="text-xs uppercase tracking-widest text-white/50">
          Mythology
        </h3>
      </div>

      {isLoading && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4 flex items-center gap-3 text-sm text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading mythology…
          </CardContent>
        </Card>
      )}

      {error && !isLoading && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="p-4 flex items-start gap-3 text-sm text-white/70">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-300" />
            <div>
              <div className="font-medium text-white">
                Couldn't load the mythology article
              </div>
              <div className="text-xs mt-1 text-white/60">
                {info.name} is named after the Roman{" "}
                <span className="text-white/80">{mythology.romanName}</span>
                {showGreekCounterpart && (
                  <>
                    {" "}
                    (Greek:{" "}
                    <span className="text-white/80">{mythology.greekName}</span>
                    )
                  </>
                )}
                . {mythology.domain}.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {wiki && (
        <Card className="bg-white/5 border-white/10 overflow-hidden">
          {wiki.thumbnail && (
            <div className="relative w-full aspect-video bg-black/40">
              <img
                src={wiki.thumbnail.source}
                alt={mythology.romanName}
                // Top-align the crop. Wikipedia's mythology articles
                // typically illustrate deities with full-body classical
                // statues or paintings, where the head and shoulders
                // carry the recognition weight and a default center
                // crop lands awkwardly on the groin of nude subjects.
                className="absolute inset-0 w-full h-full object-cover object-top"
              />
              <div className="absolute inset-0 bg-linear-to-t from-slate-950/80 to-transparent" />
            </div>
          )}
          <CardContent className="p-4 space-y-3">
            <div>
              <div className="text-base font-semibold">
                {mythology.romanName}
                {showGreekCounterpart && (
                  <span className="text-white/50 font-normal">
                    {" "}· Greek: {mythology.greekName}
                  </span>
                )}
              </div>
              <div className="text-xs text-white/60 mt-0.5">
                {mythology.domain}
              </div>
            </div>
            <p className="text-sm leading-relaxed text-white/80">
              {wiki.extract}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 text-xs">
              {wiki.pageUrl && (
                <a
                  href={wiki.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sky-300 hover:text-sky-200 transition-colors"
                >
                  Read about {mythology.romanName} on Wikipedia
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {showGreekCounterpart && (
                <a
                  href={`https://en.wikipedia.org/wiki/${encodeURIComponent(
                    mythology.greekTitle.replace(/ /g, "_"),
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sky-300 hover:text-sky-200 transition-colors"
                >
                  Read about {mythology.greekName} on Wikipedia
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/**
 * Planet detail sheet. Mirrors `SunDetailSheet` in layout but scoped
 * to one planet at a time:
 *
 *   • A Wikipedia preview for the planet (`wikipediaTitle`) with a
 *     live-data readout (altitude / azimuth / declination / distance
 *     / angular diameter) embedded inside the same card. The numbers
 *     are locked to the moment the sheet opened so mid-read updates
 *     can't shift them under the user. This matches the Moon and Sun
 *     sheets, where the live figures live inside the article card
 *     rather than as a separate section above it.
 *   • A Nostr comment thread anchored to the planet's Wikidata
 *     entity URI — stable and language-neutral, matching the Sun and
 *     Moon sheets' approach.
 *
 * The sheet is controlled externally by passing `planetId` — `null`
 * keeps it closed, a `PlanetId` opens and populates it. Driving it
 * that way lets the parent share the same click handler for every
 * planet without juggling one open-state boolean per planet.
 */
export function PlanetDetailSheet({
  planetId,
  onClose,
  latitude,
  longitude,
}: PlanetDetailSheetProps) {
  const open = planetId !== null;
  const info = planetId ? getPlanetInfo(planetId) : null;

  // Snapshot sky state at open time so the readouts are stable for
  // the duration of the sheet viewing. Reopening refreshes.
  const state = useMemo(() => {
    if (!planetId) return null;
    const date = new Date();
    const pos = planetPosition(planetId, date);
    const horz = equatorialToHorizontal(pos.ra, pos.dec, latitude, longitude, date);
    return { date, pos, horz };
  }, [planetId, latitude, longitude]);

  // Wikipedia summary. The candidate list is a one-element array so
  // the summary hook's caching key stays stable across sheet reopens.
  const candidates = useMemo(
    () => (info ? [info.wikipediaTitle] : []),
    [info],
  );
  const { data: wiki, isLoading, error } = useWikipediaSummary(candidates);

  // Comment thread URL — the planet's Wikidata entity. Stable and
  // language-neutral; every Wikipedia article for this planet resolves
  // back to the same Q-number, so comments aggregate correctly across
  // the user's locale choices.
  const commentUrl = useMemo(
    () => (info ? new URL(info.wikidataUrl) : null),
    [info],
  );

  // Convenience readouts computed from the locked state.
  const altReadout = state ? `${state.horz.alt.toFixed(1)}°` : "—";
  const azReadout = state ? `${state.horz.az.toFixed(1)}°` : "—";
  const aboveHorizon = state ? state.horz.alt > 0 : false;
  const decReadout = state
    ? `${state.pos.dec >= 0 ? "+" : ""}${state.pos.dec.toFixed(2)}°`
    : "—";
  const distanceAu = state ? state.pos.distanceAu.toFixed(3) : "—";
  const distanceKm = state
    ? `${(state.pos.distanceAu * 149.5979).toFixed(1)} M km`
    : "—";
  // Angular diameters for distant planets are tiny; arcseconds are the
  // comfortable unit (vs arcmin we use for the Sun/Moon).
  const angDiameterArcsec = state
    ? (state.pos.angularDiameterDeg * 3600).toFixed(1)
    : "—";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="bg-slate-950/95 backdrop-blur-lg border-white/10 text-white p-0 h-[88dvh] max-h-[88dvh] rounded-t-3xl flex flex-col"
      >
        {info && state && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Drag handle */}
            <div className="flex items-center justify-center pt-3 pb-1 shrink-0">
              <div className="h-1.5 w-10 rounded-full bg-white/20" />
            </div>

            {/* Header: Planet identity */}
            <div className="px-5 pb-4 border-b border-white/10 shrink-0">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  <PlanetGlyph
                    info={info}
                    size={48}
                    withRings={info.id === "saturn"}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {info.name}
                  </h2>
                  <p className="text-sm text-white/60 mt-0.5">
                    {aboveHorizon ? (
                      <>
                        <span
                          className="font-medium"
                          style={{ color: info.highlight }}
                        >
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
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="p-5 space-y-5">
                {/* About-the-planet (Wikipedia). The current sky-state
                    stats grid is embedded inside this card — mirroring
                    the Moon and Sun sheets, where the live-data
                    figures live inside the article card rather than
                    as a separate section above it. Keeps the sheet's
                    primary identity ("this is about {planet}") first
                    and the concrete numbers as supporting detail. */}
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-4 w-4 text-white/50" />
                    <h3 className="text-xs uppercase tracking-widest text-white/50">
                      About {info.name}
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

                  {wiki && (
                    <Card className="bg-white/5 border-white/10 overflow-hidden">
                      {wiki.thumbnail && (
                        <div className="relative w-full aspect-video bg-black/40">
                          <img
                            src={wiki.thumbnail.source}
                            alt={info.name}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-linear-to-t from-slate-950/80 to-transparent" />
                        </div>
                      )}
                      <CardContent className="p-4 space-y-4">
                        <div>
                          <div className="text-base font-semibold">
                            {info.name}
                          </div>
                          <div className="text-xs text-white/60 mt-0.5">
                            From Wikipedia
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-white/80">
                          {wiki.extract}
                        </p>

                        {/* Live sky-state readout. Snapshot at open
                            time so the numbers don't drift while
                            reading. Matches the embedded stats grid
                            in MoonDetailSheet and SunDetailSheet. */}
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
                              {angDiameterArcsec}″
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

                        {wiki.pageUrl && (
                          <a
                            href={wiki.pageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 transition-colors"
                          >
                            Read about {info.name} on Wikipedia
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </section>

                {/* Mythology — Greco-Roman context for the planet's
                    name. Roman primary (it's the name the planet
                    actually takes), Greek counterpart surfaced inline.
                    Placed between the astronomy article and the
                    comments so the "about the body in the sky" content
                    stays above the "what humans have made of it"
                    content, with discussion at the bottom. */}
                <MythologySection info={info} mythology={info.mythology} />

                {/* Comments — anchored to the planet's Wikidata entity. */}
                {commentUrl && (
                  <section>
                    <CommentsSection
                      root={commentUrl}
                      emptyStateMessage="No comments yet"
                      emptyStateSubtitle={`Be the first to discuss ${info.name} on Nostr.`}
                    />
                  </section>
                )}
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
  );
}
