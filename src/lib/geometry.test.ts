import { describe, it, expect } from "vitest";

import {
  convexHull,
  pointInPolygon,
  pointToSegmentDistance,
} from "./geometry";

describe("pointToSegmentDistance", () => {
  it("returns the perpendicular distance to a line the point projects onto", () => {
    // Segment along y=0 from x=0 to x=10; tap at (5, 3) — foot lands on
    // the segment, so distance is just 3.
    expect(pointToSegmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it("returns the endpoint distance when the tap projects past an end", () => {
    // Same segment; tap at (-4, 0) — foot lands before x=0, so the
    // closest point on the segment is (0,0) and distance is 4.
    expect(pointToSegmentDistance(-4, 0, 0, 0, 10, 0)).toBe(4);
    // And past the far end.
    expect(pointToSegmentDistance(14, 0, 0, 0, 10, 0)).toBe(4);
  });

  it("falls back to a point distance when the segment has zero length", () => {
    // Degenerate segment (same endpoint twice). Must not divide by zero.
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });

  it("is symmetric in the endpoints", () => {
    const a = pointToSegmentDistance(2, 7, 0, 0, 10, 0);
    const b = pointToSegmentDistance(2, 7, 10, 0, 0, 0);
    expect(a).toBeCloseTo(b);
  });
});

describe("convexHull", () => {
  it("returns at most the input when fewer than 3 points are given", () => {
    expect(convexHull([])).toEqual([]);
    const one = [{ x: 1, y: 2 }];
    expect(convexHull(one)).toEqual(one);
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(convexHull(two)).toEqual(two);
  });

  it("returns the outer corners of a square, dropping any interior point", () => {
    const input = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior — must not appear on the hull
    ];
    const hull = convexHull(input);
    expect(hull).toHaveLength(4);
    // The interior point should not be in the hull.
    expect(hull.find((p) => p.x === 5 && p.y === 5)).toBeUndefined();
    // All four corners should be present.
    for (const corner of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]) {
      expect(
        hull.some((p) => p.x === corner.x && p.y === corner.y),
        `corner (${corner.x}, ${corner.y}) missing from hull`,
      ).toBe(true);
    }
  });

  it("does not mutate its input", () => {
    const input = [
      { x: 3, y: 1 },
      { x: 0, y: 0 },
      { x: 2, y: 4 },
      { x: 5, y: 2 },
    ];
    const snapshot = input.map((p) => ({ ...p }));
    convexHull(input);
    expect(input).toEqual(snapshot);
  });

  it("drops collinear points on hull edges", () => {
    // A rectangle with an extra point on the bottom edge. The extra
    // collinear point should not appear as a distinct hull vertex.
    const input = [
      { x: 0, y: 0 },
      { x: 5, y: 0 }, // collinear with (0,0) and (10,0)
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const hull = convexHull(input);
    expect(hull).toHaveLength(4);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns true for a clearly interior point", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it("returns false for a clearly exterior point", () => {
    expect(pointInPolygon(-1, 5, square)).toBe(false);
    expect(pointInPolygon(11, 5, square)).toBe(false);
    expect(pointInPolygon(5, -1, square)).toBe(false);
    expect(pointInPolygon(5, 11, square)).toBe(false);
  });

  it("handles a non-convex (concave) polygon correctly", () => {
    // An L-shape made of two arms meeting at the origin.
    const l = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 10 },
      { x: 0, y: 10 },
    ];
    // A point in the horizontal arm.
    expect(pointInPolygon(7, 1, l)).toBe(true);
    // A point in the vertical arm.
    expect(pointInPolygon(1, 7, l)).toBe(true);
    // A point in the "notch" of the L (outside).
    expect(pointInPolygon(7, 7, l)).toBe(false);
  });
});
