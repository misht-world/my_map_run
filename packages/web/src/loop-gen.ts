/**
 * Loop shapes for round-trip generation. Instead of only a circle we offer a
 * few closed outlines (circle, oval, teardrop / "carrot"); the loop generator
 * tries each in several orientations and keeps whichever routes best. Each
 * outline's first vertex is its "bottom", anchored at the start so the loop
 * bulges away in the chosen heading.
 */
export type LoopShape = "circle" | "oval" | "teardrop";

const circle = (n: number, sx = 1): [number, number][] => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([sx * Math.cos(a), Math.sin(a)]);
  }
  return pts;
};

// Fewer waypoints → BRouter has room to follow real paths in straight lines
// (too many forced points make it detour to reach each one).
export const LOOP_SHAPES: Record<LoopShape, [number, number][]> = {
  circle: circle(8),
  oval: circle(8, 1.7),
  teardrop: [
    [0, -1.3], [-0.75, -0.3], [-0.85, 0.55], [0, 1.05],
    [0.85, 0.55], [0.75, -0.3], [0, -1.3],
  ],
};

const M_PER_DEG_LAT = 111320;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** Normalized perimeter of an outline (unit space). */
export function normPerimeter(outline: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < outline.length; i++) s += Math.hypot(outline[i]![0] - outline[i - 1]![0], outline[i]![1] - outline[i - 1]![1]);
  return s;
}

/**
 * Place an outline as loop waypoints: rotate by `headingDeg` (0 = bulge north),
 * scale to `sizeM` (metres, ≈ radius), and translate so the first vertex sits
 * on `start`. Returns [lon,lat] waypoints (closed: first == last).
 */
export function loopWaypoints(
  start: [number, number], outline: [number, number][], sizeM: number, headingDeg: number,
): [number, number][] {
  const c = Math.cos((headingDeg * Math.PI) / 180), s = Math.sin((headingDeg * Math.PI) / 180);
  const mLon = mPerDegLon(start[1]);
  const raw = outline.map(([x, y]) => {
    const rx = x * c + y * s, ry = -x * s + y * c; // clockwise so heading 0 → +y (north)
    return [(rx * sizeM) / mLon, (ry * sizeM) / M_PER_DEG_LAT] as [number, number];
  });
  const first = raw[0]!;
  return raw.map(([dx, dy]) => [start[0] + dx - first[0], start[1] + dy - first[1]]);
}
