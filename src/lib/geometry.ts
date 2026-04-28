/**
 * Pure 2D geometry helpers used by the sky-map pointer hit-test.
 *
 * These live in their own module so they can be unit-tested without
 * pulling the canvas-dependent `SkyMap` component into Vitest. All
 * functions operate on plain `{ x, y }` points and screen-pixel
 * coordinates; no astronomy, no canvas, no DOM.
 */

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Perpendicular distance from a point to a line segment, in the same
 * units as the inputs. Degenerate (zero-length) segments fall back to
 * the point-to-endpoint distance rather than returning NaN.
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  // Project (p - a) onto (b - a), clamped to [0, 1] so we get the
  // distance to the *segment*, not the infinite line through it.
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Andrew's monotone-chain convex hull. Returns the hull vertices in
 * counter-clockwise order in standard math coords (which reads as
 * clockwise on a screen-Y-down canvas — the winding is consistent,
 * which is all the even-odd point-in-polygon test needs).
 *
 * The input is copied before sorting so the caller's array is never
 * mutated. Collinear points on a hull edge are dropped (strict `<= 0`
 * cross-product rejection), giving the tightest possible bounding
 * shape for the hit-test — no redundant vertices to scan past.
 *
 * Inputs of fewer than three points are returned as-is (nothing to
 * hull).
 */
export function convexHull(input: ReadonlyArray<Point2>): Point2[] {
  if (input.length < 3) return input.slice();
  const pts = input.slice().sort((p, q) => p.x - q.x || p.y - q.y);

  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  // Drop the last point of each half — it's repeated as the first
  // point of the other half.
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Even-odd-rule point-in-polygon test. The polygon must have at least
 * three vertices, given as an ordered ring (first vertex is NOT
 * repeated at the end; we wrap internally). Winding direction is
 * irrelevant for even-odd.
 */
export function pointInPolygon(
  px: number,
  py: number,
  poly: ReadonlyArray<Point2>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    const intersect =
      pi.y > py !== pj.y > py &&
      px < ((pj.x - pi.x) * (py - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}
