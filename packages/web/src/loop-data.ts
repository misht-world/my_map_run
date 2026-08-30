/**
 * Local area data for smarter loop generation: where the stairs are, and where
 * the parks/green are. Fetched once per loop generation from Overpass so loop
 * candidates can be scored on step usage and park coverage (not just distance
 * and backtracking).
 */
import { PedNet, type Bbox } from "./pednet.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const M_PER_DEG_LAT = 111320;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

interface Ring { pts: number[][]; minLon: number; minLat: number; maxLon: number; maxLat: number; }

function toRing(geom: { lat: number; lon: number }[]): Ring | null {
  if (geom.length < 4) return null;
  const pts = geom.map((p) => [p.lon, p.lat]);
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lo, la] of pts) {
    if (lo! < minLon) minLon = lo!; if (lo! > maxLon) maxLon = lo!;
    if (la! < minLat) minLat = la!; if (la! > maxLat) maxLat = la!;
  }
  return { pts, minLon, minLat, maxLon, maxLat };
}

function pointInRing(lon: number, lat: number, r: Ring): boolean {
  if (lon < r.minLon || lon > r.maxLon || lat < r.minLat || lat > r.maxLat) return false;
  const p = r.pts;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i]![0]!, yi = p[i]![1]!, xj = p[j]![0]!, yj = p[j]![1]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class LoopData {
  constructor(private steps: PedNet | null, private parks: Ring[], private lat0: number) {}

  /** Number of route vertices that sit on (≤ `thresh` m from) a staircase. */
  stepHits(coords: number[][], thresh = 8): number {
    if (!this.steps) return 0;
    let n = 0;
    for (const c of coords) if (this.steps.nearestDist(c[0]!, c[1]!) < thresh) n++;
    return n;
  }

  /** Fraction of route length whose segments fall inside a park / green area. */
  parkFraction(coords: number[][]): number {
    if (!this.parks.length || coords.length < 2) return 0;
    const mLon = mPerDegLon(this.lat0);
    let total = 0, inPark = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1]!, b = coords[i]!;
      const len = Math.hypot((b[0]! - a[0]!) * mLon, (b[1]! - a[1]!) * M_PER_DEG_LAT);
      total += len;
      const mx = (a[0]! + b[0]!) / 2, my = (a[1]! + b[1]!) / 2;
      if (this.parks.some((r) => pointInRing(mx, my, r))) inPark += len;
    }
    return total > 0 ? inPark / total : 0;
  }
}

interface OverpassWay { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; }

/** Fetch steps + parks/green for a bbox, or null if Overpass is unavailable. */
export async function fetchLoopData(bbox: Bbox, signal?: AbortSignal): Promise<LoopData | null> {
  const b = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const query =
    `[out:json][timeout:60];(` +
    `way["highway"="steps"](${b});` +
    `way["leisure"~"^(park|nature_reserve|garden|recreation_ground|common)$"](${b});` +
    `way["landuse"~"^(forest|grass|recreation_ground|meadow|village_green)$"](${b});` +
    `way["natural"="wood"](${b});` +
    `);out geom tags;`;
  const lat0 = (bbox.s + bbox.n) / 2;

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: "data=" + encodeURIComponent(query),
        signal: signal ?? AbortSignal.timeout(30000),
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text[0] !== "{") continue; // an error page, not JSON — try next
      const json = JSON.parse(text) as { elements?: OverpassWay[] };

      const stepPts: [number, number][] = [];
      const parks: Ring[] = [];
      for (const el of json.elements ?? []) {
        if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
        if (el.tags?.["highway"] === "steps") {
          // Densify step ways so nearest-point distance is accurate.
          const g = el.geometry;
          const mLon = mPerDegLon(lat0);
          for (let i = 0; i < g.length; i++) {
            const p = g[i]!;
            stepPts.push([p.lon, p.lat]);
            const q = g[i + 1];
            if (!q) continue;
            const dM = Math.hypot((q.lon - p.lon) * mLon, (q.lat - p.lat) * M_PER_DEG_LAT);
            const n = Math.floor(dM / 8);
            for (let k = 1; k <= n; k++) stepPts.push([p.lon + ((q.lon - p.lon) * k) / (n + 1), p.lat + ((q.lat - p.lat) * k) / (n + 1)]);
          }
        } else {
          const r = toRing(el.geometry);
          if (r) parks.push(r);
        }
      }
      const steps = stepPts.length >= 4 ? new PedNet(stepPts, lat0) : null;
      return new LoopData(steps, parks, lat0);
    } catch {
      // try next endpoint
    }
  }
  return null;
}
