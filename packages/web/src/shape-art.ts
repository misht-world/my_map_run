/**
 * "Shape run" (GPS art) — auto-fit a template outline onto the running network.
 *
 * Given a start, a shape template and a target distance, we search over
 * placements (centre × scale × rotation), route each candidate through the
 * running profile, and score how well the routed line matches the ideal
 * outline. The best-fitting runnable route wins.
 *
 * v1 routes every candidate through BRouter (coarse→fine, bounded count). A
 * later pass can pre-filter candidates against a local pedestrian graph
 * (Overpass) so BRouter is only hit for the top few.
 */
import type { RouteResult, RunProfile } from "./routing.js";

export type ShapeName = "tree" | "heart" | "star";

/** Normalized, closed outlines in a unit-ish box (x right, y up). */
export const SHAPES: Record<ShapeName, [number, number][]> = {
  tree: [
    [0, 1], [-0.25, 0.45], [-0.12, 0.45], [-0.4, 0], [-0.2, 0],
    [-0.55, -0.5], [-0.12, -0.5], [-0.12, -0.8], [0.12, -0.8], [0.12, -0.5],
    [0.55, -0.5], [0.2, 0], [0.4, 0], [0.12, 0.45], [0.25, 0.45], [0, 1],
  ],
  heart: [
    [0, -0.7], [-0.55, -0.1], [-0.75, 0.35], [-0.55, 0.72], [-0.25, 0.72],
    [0, 0.45], [0.25, 0.72], [0.55, 0.72], [0.75, 0.35], [0.55, -0.1], [0, -0.7],
  ],
  star: (() => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const r = i % 2 === 0 ? 1 : 0.42;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  })(),
};

export const SHAPE_LABELS: Record<ShapeName, string> = {
  tree: "🎄 Christmas tree",
  heart: "❤ Heart",
  star: "★ Star",
};

const M_PER_DEG_LAT = 111320;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** Densify an outline by inserting points so no edge is longer than `step`. */
function densify(pts: [number, number][], step = 0.04): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let t = 0; t < n; t++) out.push([a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Perimeter of a normalized outline (unit-space). */
function perimeter(pts: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return s;
}

/** Place a normalized outline on the map: rotate, scale to `sizeM`, centre. */
function georeference(
  outline: [number, number][], center: [number, number], sizeM: number, rotDeg: number,
): [number, number][] {
  const [cx, cy] = center;
  const c = Math.cos((rotDeg * Math.PI) / 180), s = Math.sin((rotDeg * Math.PI) / 180);
  const mLon = mPerDegLon(cy);
  return outline.map(([x, y]) => {
    const rx = x * c - y * s, ry = x * s + y * c;
    return [cx + (rx * sizeM) / mLon, cy + (ry * sizeM) / M_PER_DEG_LAT] as [number, number];
  });
}

/** Metres from point p to segment a–b (local equirectangular around lat). */
function pointToSeg(p: number[], a: number[], b: number[], mLon: number): number {
  const ax = a[0]! * mLon, ay = a[1]! * M_PER_DEG_LAT;
  const bx = b[0]! * mLon, by = b[1]! * M_PER_DEG_LAT;
  const px = p[0]! * mLon, py = p[1]! * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / L;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How well a routed line matches a (georeferenced) dense contour, in metres. */
function fitScore(routed: number[][], contour: number[][], lat: number): { meanDev: number; maxDev: number } {
  const mLon = mPerDegLon(lat);
  let sum = 0, max = 0;
  for (const p of contour) {
    let best = Infinity;
    for (let i = 1; i < routed.length; i++) {
      const d = pointToSeg(p, routed[i - 1]!, routed[i]!, mLon);
      if (d < best) best = d;
    }
    sum += best;
    if (best > max) max = best;
  }
  return { meanDev: sum / contour.length, maxDev: max };
}

export interface ShapeCandidate {
  center: [number, number];
  sizeM: number;
  rotDeg: number;
  res: RouteResult;
  meanDev: number;
  maxDev: number;
  /** Ideal outline (georeferenced), for optional display. */
  ideal: [number, number][];
}

export interface AutoFitOptions {
  start: [number, number];
  shape: ShapeName;
  targetM: number;
  /** true = keep roughly upright (small rotations only); false = any rotation. */
  keepUpright: boolean;
  profile: RunProfile;
  route: (wps: [number, number][], profile: RunProfile) => Promise<RouteResult | null>;
  onProgress?: (done: number, total: number) => void;
}

export interface AutoFitResult {
  best: ShapeCandidate | null;
  alternatives: ShapeCandidate[];
}

/**
 * Search placements and return the best-fitting runnable shape.
 * Coarse pass over centre×rotation at an estimated size, then a fine pass
 * around the best (tighter centre grid, nearby rotations, scale nudge).
 */
export async function autoFitShape(opts: AutoFitOptions): Promise<AutoFitResult> {
  const { start, shape, targetM, keepUpright, profile, route, onProgress } = opts;
  const outline = SHAPES[shape];
  const dense = densify(outline);
  const P0 = perimeter(outline);

  // Size estimate: routed length ≈ detour × (P0 × size). Assume detour ≈ 1.4.
  let sizeM = targetM / (1.4 * P0);

  // The shape closes back to its first point; anchor that first point at the
  // start so the run begins/ends where the user set it. We translate the whole
  // placement so the outline's first vertex sits on `start`.
  const anchoredCenter = (center: [number, number], sizeGuess: number, rot: number): [number, number] => {
    const g = georeference(outline, center, sizeGuess, rot);
    const first = g[0]!;
    return [center[0] + (start[0] - first[0]), center[1] + (start[1] - first[1])];
  };

  const rotations = keepUpright ? [-12, 0, 12] : [0, 45, 90, 135, 180, 225, 270, 315];
  const spanM = sizeM * 0.6; // coarse centre offsets scale with the shape
  const mLon = mPerDegLon(start[1]);
  const offsets: [number, number][] = [];
  for (const gy of [-1, 0, 1]) for (const gx of [-1, 0, 1]) {
    offsets.push([(gx * spanM) / mLon, (gy * spanM) / M_PER_DEG_LAT]);
  }

  const evalPlacement = async (center: [number, number], size: number, rot: number): Promise<ShapeCandidate | null> => {
    const ac = anchoredCenter(center, size, rot);
    const ideal = georeference(outline, ac, size, rot);
    const denseGeo = georeference(dense, ac, size, rot);
    const res = await route(ideal.map((p) => [p[0], p[1]]), profile);
    if (!res || res.geometry.coordinates.length < 4) return null;
    const { meanDev, maxDev } = fitScore(res.geometry.coordinates as number[][], denseGeo, ac[1]);
    return { center: ac, sizeM: size, rotDeg: rot, res, meanDev, maxDev, ideal };
  };

  const cands: ShapeCandidate[] = [];
  const coarse = offsets.flatMap((off) => rotations.map((rot) => ({ off, rot })));
  const total = coarse.length + 12; // + fine pass budget (approx, for progress)
  let done = 0;

  for (const { off, rot } of coarse) {
    const center: [number, number] = [start[0] + off[0], start[1] + off[1]];
    const c = await evalPlacement(center, sizeM, rot);
    if (c) cands.push(c);
    onProgress?.(++done, total);
  }
  if (!cands.length) return { best: null, alternatives: [] };

  cands.sort((a, b) => a.meanDev - b.meanDev);
  const top = cands[0]!;

  // Scale nudge toward the target distance around the best placement.
  const scaleFix = Math.min(1.5, Math.max(0.66, targetM / Math.max(1, top.res.distanceM)));
  const fineSizes = [sizeM, sizeM * scaleFix];
  const fineRots = keepUpright ? [top.rotDeg - 8, top.rotDeg, top.rotDeg + 8] : [top.rotDeg - 25, top.rotDeg, top.rotDeg + 25];
  const fineOffsets: [number, number][] = [];
  const fspan = spanM * 0.5;
  for (const gy of [-1, 0, 1]) for (const gx of [-1, 0, 1]) {
    fineOffsets.push([top.center[0] + (gx * fspan) / mLon, top.center[1] + (gy * fspan) / M_PER_DEG_LAT]);
  }
  // Keep the fine pass bounded: best-rotation over a tight centre grid at two sizes.
  for (const size of fineSizes) {
    for (const center of fineOffsets) {
      const c = await evalPlacement(center, size, top.rotDeg);
      if (c) cands.push(c);
      onProgress?.(Math.min(total, ++done), total);
    }
  }
  // A couple of rotation probes at the best centre/size.
  for (const rot of fineRots) {
    const c = await evalPlacement(top.center, top.res.distanceM > targetM ? sizeM * scaleFix : sizeM, rot);
    if (c) cands.push(c);
    onProgress?.(Math.min(total, ++done), total);
  }

  cands.sort((a, b) => a.meanDev - b.meanDev);
  return { best: cands[0]!, alternatives: cands.slice(1, 5) };
}
