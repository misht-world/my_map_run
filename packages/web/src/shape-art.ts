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
import type { PedNet } from "./pednet.js";

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
  /** Local network index — enables the cheap pre-filter (route only the best). */
  network?: PedNet | null;
  onProgress?: (done: number, total: number) => void;
}

export interface AutoFitResult {
  best: ShapeCandidate | null;
  alternatives: ShapeCandidate[];
}

interface Placement { center: [number, number]; size: number; rot: number; }

/** Combined ranking: fidelity first, with a gentle nudge toward the target
 *  distance (≈15 m of score per 10 % off target). */
function combined(c: ShapeCandidate, targetM: number): number {
  return c.meanDev + 150 * (Math.abs(c.res.distanceM - targetM) / targetM);
}

/**
 * Search placements and return the best-fitting runnable shape.
 *
 * With a `network` index we score MANY placements cheaply (distance of the
 * contour to the network) and route only the best handful through BRouter;
 * without it we fall back to routing a bounded coarse set directly.
 */
export async function autoFitShape(opts: AutoFitOptions): Promise<AutoFitResult> {
  const { start, shape, targetM, keepUpright, profile, route, network, onProgress } = opts;
  const outline = SHAPES[shape];
  const dense = densify(outline);
  const P0 = perimeter(outline);
  const sizeM = targetM / (1.4 * P0); // routed ≈ detour(≈1.4) × P0 × size
  const mLon = mPerDegLon(start[1]);

  // The shape closes back to its first vertex; anchor that vertex at the start
  // so the run begins/ends where the user set it.
  const anchoredCenter = (center: [number, number], size: number, rot: number): [number, number] => {
    const first = georeference(outline, center, size, rot)[0]!;
    return [center[0] + (start[0] - first[0]), center[1] + (start[1] - first[1])];
  };

  const rotations = keepUpright ? [-12, -6, 0, 6, 12] : [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  /** Grid of raw candidate centres × rotations at one size. */
  const placements = (gridN: number[], spanFactor: number): Placement[] => {
    const span = sizeM * spanFactor;
    const list: Placement[] = [];
    for (const gy of gridN) for (const gx of gridN) for (const rot of rotations) {
      list.push({ center: [start[0] + (gx * span) / mLon, start[1] + (gy * span) / M_PER_DEG_LAT], size: sizeM, rot });
    }
    return list;
  };

  const evalPlacement = async (pl: Placement): Promise<ShapeCandidate | null> => {
    const ac = anchoredCenter(pl.center, pl.size, pl.rot);
    const ideal = georeference(outline, ac, pl.size, pl.rot);
    const denseGeo = georeference(dense, ac, pl.size, pl.rot);
    const res = await route(ideal.map((p) => [p[0], p[1]]), profile);
    if (!res || res.geometry.coordinates.length < 4) return null;
    const { meanDev, maxDev } = fitScore(res.geometry.coordinates as number[][], denseGeo, ac[1]);
    return { center: ac, sizeM: pl.size, rotDeg: pl.rot, res, meanDev, maxDev, ideal };
  };

  // Pick which placements to actually route.
  let toRoute: Placement[];
  if (network) {
    // Cheap pre-filter: mean network distance over a fine, many-rotation grid.
    const pre = placements([-2, -1, 0, 1, 2], 0.3).map((pl) => {
      const ac = anchoredCenter(pl.center, pl.size, pl.rot);
      const dg = georeference(dense, ac, pl.size, pl.rot);
      let sum = 0;
      for (const p of dg) sum += network.nearestDist(p[0], p[1]);
      return { pl, pre: sum / dg.length };
    });
    pre.sort((a, b) => a.pre - b.pre);
    toRoute = pre.slice(0, 10).map((x) => x.pl);
  } else {
    toRoute = placements([-1, 0, 1], 0.6); // bounded coarse set
  }

  const total = toRoute.length + 4; // + scale-refinement budget (for progress)
  let done = 0;
  const cands: ShapeCandidate[] = [];
  for (const pl of toRoute) {
    const c = await evalPlacement(pl);
    if (c) cands.push(c);
    onProgress?.(++done, total);
  }
  if (!cands.length) return { best: null, alternatives: [] };

  // Distance refinement: re-route the top-3 placements at a size scaled toward
  // the target, so we hit the requested distance without losing fidelity.
  cands.sort((a, b) => a.meanDev - b.meanDev);
  const ref = cands[0]!;
  const scaleFix = Math.min(1.5, Math.max(0.66, targetM / Math.max(1, ref.res.distanceM)));
  if (Math.abs(scaleFix - 1) > 0.06) {
    for (const c of cands.slice(0, 3)) {
      // Recover the raw centre from the anchored one is unnecessary — re-anchor
      // works off any centre, so reuse the anchored centre as the seed.
      const nc = await evalPlacement({ center: c.center, size: sizeM * scaleFix, rot: c.rotDeg });
      if (nc) cands.push(nc);
      onProgress?.(Math.min(total, ++done), total);
    }
  }

  cands.sort((a, b) => combined(a, targetM) - combined(b, targetM));
  return { best: cands[0]!, alternatives: cands.slice(1, 5) };
}
