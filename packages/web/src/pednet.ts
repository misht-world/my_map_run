/**
 * Local pedestrian-network index for the shape-run pre-filter.
 *
 * Fetches runnable ways in a bounding box from Overpass, densifies them into a
 * point cloud, and buckets the points into a grid hash so we can answer
 * "how far is this point from the network?" in ~O(1). That lets the shape
 * auto-fit score hundreds of candidate placements cheaply, and only send the
 * best few to BRouter for real routing.
 */

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Runnable highways (pedestrian-usable); motorway/trunk excluded — can't run.
const RUNNABLE =
  "footway|path|pedestrian|steps|track|cycleway|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|road";

const M_PER_DEG_LAT = 111320;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

export interface Bbox { s: number; w: number; n: number; e: number; }

export class PedNet {
  private cells = new Map<string, number[]>(); // key → [lon,lat,lon,lat,…]
  private readonly cellDeg: number;
  readonly pointCount: number;

  constructor(points: [number, number][], private readonly lat0: number) {
    // ~40 m cells (in latitude degrees); lon handled by the same span near lat0.
    this.cellDeg = 40 / M_PER_DEG_LAT;
    for (const [lon, lat] of points) {
      const key = this.key(lon, lat);
      let arr = this.cells.get(key);
      if (!arr) { arr = []; this.cells.set(key, arr); }
      arr.push(lon, lat);
    }
    this.pointCount = points.length;
  }

  private key(lon: number, lat: number): string {
    return `${Math.floor(lon / this.cellDeg)},${Math.floor(lat / this.cellDeg)}`;
  }

  /** Nearest indexed point + its distance (m), searching outward by cell rings. */
  private nearestPoint(lon: number, lat: number): { d: number; p: [number, number] | null } {
    const mLon = mPerDegLon(this.lat0);
    const cx = Math.floor(lon / this.cellDeg), cy = Math.floor(lat / this.cellDeg);
    let best = Infinity, bp: [number, number] | null = null;
    for (let ring = 0; ring <= 6; ring++) {
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          // Only the outer shell of each ring (cells not covered by smaller rings).
          if (ring > 0 && gx > cx - ring && gx < cx + ring && gy > cy - ring && gy < cy + ring) continue;
          const arr = this.cells.get(`${gx},${gy}`);
          if (!arr) continue;
          for (let i = 0; i < arr.length; i += 2) {
            const d = Math.hypot((lon - arr[i]!) * mLon, (lat - arr[i + 1]!) * M_PER_DEG_LAT);
            if (d < best) { best = d; bp = [arr[i]!, arr[i + 1]!]; }
          }
        }
      }
      // Once we have a hit and searched one extra ring beyond it, stop.
      if (best < Infinity && ring >= 1) break;
    }
    return { d: best, p: bp };
  }

  /** Metres to the nearest network point. */
  nearestDist(lon: number, lat: number): number {
    return this.nearestPoint(lon, lat).d;
  }

  /** Nearest indexed network point (for snapping waypoints), or null. */
  nearest(lon: number, lat: number): [number, number] | null {
    return this.nearestPoint(lon, lat).p;
  }
}

/** Densify a way's vertices so no gap between points exceeds `stepM` metres. */
function densifyWay(geom: { lat: number; lon: number }[], stepM: number, out: [number, number][], lat0: number): void {
  const mLon = mPerDegLon(lat0);
  for (let i = 0; i < geom.length; i++) {
    const p = geom[i]!;
    out.push([p.lon, p.lat]);
    const q = geom[i + 1];
    if (!q) continue;
    const dM = Math.hypot((q.lon - p.lon) * mLon, (q.lat - p.lat) * M_PER_DEG_LAT);
    const n = Math.floor(dM / stepM);
    for (let k = 1; k <= n; k++) {
      out.push([p.lon + ((q.lon - p.lon) * k) / (n + 1), p.lat + ((q.lat - p.lat) * k) / (n + 1)]);
    }
  }
}

interface OverpassWay { type: string; geometry?: { lat: number; lon: number }[]; }

/** Fetch + index the runnable pedestrian network in a bbox, or null on failure. */
export async function fetchPedNetwork(bbox: Bbox, signal?: AbortSignal): Promise<PedNet | null> {
  const b = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const query = `[out:json][timeout:60];way["highway"~"^(${RUNNABLE})$"](${b});out geom;`;
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
      const json = (await resp.json()) as { elements?: OverpassWay[] };
      const pts: [number, number][] = [];
      for (const el of json.elements ?? []) {
        if (el.type === "way" && el.geometry && el.geometry.length >= 2) {
          densifyWay(el.geometry, 18, pts, lat0);
        }
      }
      if (pts.length < 50) return null; // too sparse to be useful
      return new PedNet(pts, lat0);
    } catch {
      // try next endpoint
    }
  }
  return null;
}
