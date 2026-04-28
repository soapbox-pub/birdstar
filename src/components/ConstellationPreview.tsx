import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { starByHip, type Star } from "@/lib/starsData";

interface ConstellationPreviewProps {
  /**
   * The edges of the constellation figure as pairs of HIP numbers. Accepted
   * as a read-only shape so the same preview works for both mutable
   * `CustomConstellation["edges"]` (drafts, published custom figures) and
   * the frozen `ZodiacSign["edges"]` baked into the built-in catalog.
   */
  edges: EdgeList;
  className?: string;
  /** Accessible label. Defaults to a generic description. */
  ariaLabel?: string;
  /**
   * If true, stars light up on hover/focus and a small floating label shows
   * the star's name, constellation, and magnitude. Intended for the large
   * hero-card presentations; disabled by default so list-row thumbnails stay
   * purely decorative and don't compete with their parent click target.
   */
  interactive?: boolean;
}

type EdgeList = ReadonlyArray<readonly [number, number]>;

interface ResolvedStar {
  hip: number;
  ra: number; // hours
  dec: number; // degrees
  mag: number;
}

const DEG = Math.PI / 180;
const HOUR = (15 * Math.PI) / 180; // 1h = 15° in radians

/**
 * SVG thumbnail of a custom constellation, rendered at whatever size its
 * container imposes via `className` (the SVG fills its box).
 *
 * The figure is gnomonically projected onto a tangent plane centered on the
 * centroid of its stars (on the unit sphere), then normalized to fit the
 * viewBox with equal aspect so shapes are never distorted. Stars are sized
 * by apparent magnitude so bright anchor stars stand out, and the brightest
 * few get a soft glow to evoke a real sky.
 *
 * When `interactive` is enabled, each figure star becomes hoverable/tappable
 * and reveals a small in-SVG label with the star's identity and magnitude.
 */
export function ConstellationPreview({
  edges,
  className,
  ariaLabel = "Constellation preview",
  interactive = false,
}: ConstellationPreviewProps) {
  // A stable unique id keeps multiple previews on the page from colliding on
  // the shared <filter> id.
  const rawId = useId();
  const uid = rawId.replace(/:/g, "");
  const glowId = `cp-glow-${uid}`;

  const projected = useMemo(() => project(edges), [edges]);
  const [hoveredHip, setHoveredHip] = useState<number | null>(null);

  if (!projected || projected.points.size === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-white/10 bg-white/[0.02]",
          className,
        )}
        aria-label={ariaLabel}
        role="img"
      />
    );
  }

  const { points, edges: projEdges, backgroundStars } = projected;
  const hovered = hoveredHip != null ? points.get(hoveredHip) : undefined;
  const hoveredStar = hoveredHip != null ? starByHip(hoveredHip) : undefined;

  return (
    <div
      className={cn(
        // Background gradient lives on the wrapper so it always fills the
        // container regardless of the container's aspect ratio. The figure
        // SVG is letterboxed on top with `meet` so shapes never distort.
        "relative w-full h-full rounded-xl ring-1 ring-white/10 overflow-hidden",
        "bg-[radial-gradient(ellipse_at_50%_40%,_#1e1b4b_0%,_#0b1026_55%,_#020617_100%)]",
        className,
      )}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Background field stars — cover the whole container so corners never
          look bare, even in non-square aspect ratios. */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
        aria-hidden
      >
        <g fill="rgba(255, 255, 255, 0.5)">
          {backgroundStars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />
          ))}
        </g>
      </svg>

      {/* Figure — preserves aspect so stick-figures never distort. */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full"
        // Clear hover state when the cursor leaves the SVG entirely, so the
        // label never sticks around after the user moves away.
        onPointerLeave={interactive ? () => setHoveredHip(null) : undefined}
      >
        <defs>
          <filter
            id={glowId}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="1.1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Edges */}
        <g
          stroke="rgba(253, 230, 138, 0.8)" // amber-200
          strokeWidth={0.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          // Edges must not intercept pointer events or they'd steal hover
          // from the stars sitting on top of them.
          pointerEvents="none"
        >
          {projEdges.map((e, i) => (
            <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          ))}
        </g>

        {/* Figure stars with soft glow */}
        <g fill="rgb(254, 243, 199)" filter={`url(#${glowId})`}>
          {Array.from(points.values()).map((p) => {
            const isHovered = interactive && p.hip === hoveredHip;
            return (
              <circle
                key={p.hip}
                cx={p.x}
                cy={p.y}
                r={isHovered ? p.r * 1.35 : p.r}
                fill={isHovered ? "#fff7cc" : undefined}
                pointerEvents="none"
              />
            );
          })}
        </g>

        {/* Invisible hit areas — only when interactive. Larger than the
            visible dot so they're comfortable to hover on small previews
            and tappable on touch. Sit above the glow layer so pointer
            events reliably land on the circle closest to the cursor. */}
        {interactive && (
          <g fill="transparent" style={{ cursor: "pointer" }}>
            {Array.from(points.values()).map((p) => {
              const label = labelForHip(p.hip);
              return (
                <circle
                  key={p.hip}
                  cx={p.x}
                  cy={p.y}
                  // ~3.5 viewBox units ≈ 14px on a 400px-wide preview.
                  r={Math.max(p.r * 1.6, 3.5)}
                  onPointerEnter={() => setHoveredHip(p.hip)}
                  onFocus={() => setHoveredHip(p.hip)}
                  onBlur={() => setHoveredHip(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                >
                  {/* Native SVG tooltip as a graceful fallback for screen
                      readers and when custom label rendering fails. */}
                  <title>{label}</title>
                </circle>
              );
            })}
          </g>
        )}

        {/* Hover readout — a small label tile pinned next to the hovered
            star. Rendered inside the SVG so it scales with the preview and
            stays inside the rounded container without portal plumbing. */}
        {interactive && hovered && hoveredStar && (
          <StarLabel star={hoveredStar} x={hovered.x} y={hovered.y} />
        )}
      </svg>
    </div>
  );
}

/**
 * Tiny in-SVG label that appears next to the currently hovered figure star.
 * Auto-flips horizontally and vertically so it always stays inside the
 * preview's 100×100 viewBox regardless of which star is being inspected.
 */
function StarLabel({
  star,
  x,
  y,
}: {
  star: Star;
  /** Anchor point in viewBox coords (centre of the star). */
  x: number;
  y: number;
}) {
  const title = star.name ?? star.bayer ?? `HIP ${star.hip}`;
  const subtitle = [star.constellation, `mag ${star.mag.toFixed(1)}`]
    .filter(Boolean)
    .join(" · ");

  // Heuristic label width in viewBox units. We can't measure text in SVG
  // without a mount-and-measure dance, so estimate from character count.
  // Pleasantly overshoots for short labels and is good enough for layout.
  const charW = 1.55;
  const padX = 2.5;
  const lineH = 4;
  const titleW = Math.max(title.length, 6) * charW;
  const subtitleW = subtitle.length * charW * 0.85;
  const boxW = Math.min(56, Math.max(titleW, subtitleW) + padX * 2);
  const boxH = subtitle ? lineH * 2 + 3 : lineH + 3;

  const OFFSET = 4; // gap between the star and the label
  // Prefer placing the label to the right of the star; flip to the left if
  // there isn't room. Same deal vertically — prefer below, flip above.
  let boxX = x + OFFSET;
  if (boxX + boxW > 98) boxX = x - OFFSET - boxW;
  if (boxX < 2) boxX = 2;

  let boxY = y + OFFSET;
  if (boxY + boxH > 98) boxY = y - OFFSET - boxH;
  if (boxY < 2) boxY = 2;

  const titleY = boxY + padX + 2.3;
  const subtitleY = titleY + lineH - 0.2;

  return (
    <g pointerEvents="none" className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
      <rect
        x={boxX}
        y={boxY}
        width={boxW}
        height={boxH}
        rx={1.8}
        ry={1.8}
        fill="rgba(2, 6, 23, 0.85)"
        stroke="rgba(253, 230, 138, 0.45)"
        strokeWidth={0.3}
      />
      <text
        x={boxX + padX}
        y={titleY}
        fill="#fef3c7"
        fontSize={3.2}
        fontWeight={600}
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        {title}
      </text>
      {subtitle && (
        <text
          x={boxX + padX}
          y={subtitleY}
          fill="rgba(255,255,255,0.6)"
          fontSize={2.5}
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          {subtitle}
        </text>
      )}
    </g>
  );
}

function labelForHip(hip: number): string {
  const s = starByHip(hip);
  if (!s) return `HIP ${hip}`;
  const primary = s.name ?? s.bayer ?? `HIP ${hip}`;
  const parts = [primary];
  if (s.constellation) parts.push(s.constellation);
  parts.push(`mag ${s.mag.toFixed(1)}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

interface ProjectedPoint {
  hip: number;
  x: number;
  y: number;
  /** radius in viewBox units */
  r: number;
}

interface ProjectedEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface BackgroundStar {
  x: number;
  y: number;
  r: number;
  o: number;
}

interface ProjectionResult {
  points: Map<number, ProjectedPoint>;
  edges: ProjectedEdge[];
  backgroundStars: BackgroundStar[];
}

function project(edges: EdgeList): ProjectionResult | null {
  // Collect unique stars referenced by the figure.
  const stars = new Map<number, ResolvedStar>();
  for (const [a, b] of edges) {
    if (!stars.has(a)) {
      const s = starByHip(a);
      if (s) stars.set(a, { hip: s.hip, ra: s.ra, dec: s.dec, mag: s.mag });
    }
    if (!stars.has(b)) {
      const s = starByHip(b);
      if (s) stars.set(b, { hip: s.hip, ra: s.ra, dec: s.dec, mag: s.mag });
    }
  }
  if (stars.size === 0) return null;

  // Compute mean unit-vector to use as the projection's tangent point. This
  // handles wrap-around at RA=0h/24h naturally and the north/south poles
  // without special-casing.
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const s of stars.values()) {
    const raRad = s.ra * HOUR;
    const decRad = s.dec * DEG;
    const cosDec = Math.cos(decRad);
    mx += cosDec * Math.cos(raRad);
    my += cosDec * Math.sin(raRad);
    mz += Math.sin(decRad);
  }
  const norm = Math.hypot(mx, my, mz) || 1;
  mx /= norm;
  my /= norm;
  mz /= norm;

  // Recover centroid RA/Dec from the mean unit vector.
  const centerDec = Math.asin(Math.max(-1, Math.min(1, mz)));
  const centerRa = Math.atan2(my, mx);
  const sinC = Math.sin(centerDec);
  const cosC = Math.cos(centerDec);

  // Gnomonic projection onto tangent plane at (centerRa, centerDec). Produces
  // straight lines for great-circle segments, which is the desired look for a
  // stylized thumbnail.
  const raw = new Map<number, { x: number; y: number; mag: number }>();
  for (const s of stars.values()) {
    const ra = s.ra * HOUR;
    const dec = s.dec * DEG;
    const cosDec = Math.cos(dec);
    const sinDec = Math.sin(dec);
    const dRa = ra - centerRa;
    const cosDRa = Math.cos(dRa);
    const sinDRa = Math.sin(dRa);
    const cosDistance = sinC * sinDec + cosC * cosDec * cosDRa;
    // Skip stars on the opposite side of the sphere — shouldn't happen for a
    // real constellation figure, but guards against degenerate input.
    if (cosDistance <= 1e-6) continue;
    const x = (cosDec * sinDRa) / cosDistance;
    const y = (cosC * sinDec - sinC * cosDec * cosDRa) / cosDistance;
    // Flip x so RA increases to the left (the conventional sky orientation:
    // east on the left when looking up at the tangent plane from below).
    raw.set(s.hip, { x: -x, y, mag: s.mag });
  }
  if (raw.size === 0) return null;

  // Compute bounding box.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of raw.values()) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const PADDING = 14; // viewBox units on each side
  const AVAILABLE = 100 - PADDING * 2;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  // Uniform scale so the figure fits within the padded area on both axes
  // while preserving aspect. For single-point (or degenerate) figures fall
  // back to a centered dot.
  const span = Math.max(spanX, spanY);
  const scale = span > 1e-9 ? AVAILABLE / span : 0;
  // Center the figure in the remaining space.
  const offsetX = (AVAILABLE - spanX * scale) / 2 + PADDING;
  const offsetY = (AVAILABLE - spanY * scale) / 2 + PADDING;

  const points = new Map<number, ProjectedPoint>();
  for (const [hip, p] of raw) {
    const x = (p.x - minX) * scale + offsetX;
    // SVG y grows downward; invert to put north-ish stars on top.
    const y = 100 - ((p.y - minY) * scale + offsetY);
    points.set(hip, { hip, x, y, r: magToRadius(p.mag) });
  }

  const projEdges: ProjectedEdge[] = [];
  for (const [a, b] of edges) {
    const pa = points.get(a);
    const pb = points.get(b);
    if (!pa || !pb) continue;
    projEdges.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y });
  }

  // Deterministic scatter of faint background stars for a night-sky feel.
  // Seeded from the edge pairs so the same figure always renders identically.
  const backgroundStars = makeBackgroundStars(edges, points);

  return { points, edges: projEdges, backgroundStars };
}

function makeBackgroundStars(
  edges: EdgeList,
  figure: Map<number, ProjectedPoint>,
): BackgroundStar[] {
  let seed = 2166136261;
  for (const [a, b] of edges) {
    seed ^= a * 16777619;
    seed = Math.imul(seed, 16777619);
    seed ^= b * 2246822519;
    seed = Math.imul(seed, 16777619);
  }
  const rand = mulberry32(seed >>> 0);

  const MIN_DIST = 5; // viewBox units of clearance from figure stars
  const out: BackgroundStar[] = [];
  const figurePts = Array.from(figure.values());
  let attempts = 0;
  while (out.length < 22 && attempts < 120) {
    attempts++;
    const x = rand() * 100;
    const y = rand() * 100;
    let tooClose = false;
    for (const p of figurePts) {
      if (Math.hypot(p.x - x, p.y - y) < MIN_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    out.push({
      x,
      y,
      r: 0.2 + rand() * 0.5,
      o: 0.3 + rand() * 0.55,
    });
  }
  return out;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Map apparent magnitude to a preview dot radius (viewBox units). Brighter
 * stars (lower magnitude) get larger dots, clamped so a hypothetical mag~6
 * star is still visible and mag~0 stars don't dominate the thumbnail.
 */
function magToRadius(mag: number): number {
  // mag 0 -> 2.3, mag 3 -> 1.4, mag 6 -> 0.8
  const r = 2.3 - 0.25 * mag;
  if (r < 0.8) return 0.8;
  if (r > 2.4) return 2.4;
  return r;
}
