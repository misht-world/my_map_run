/**
 * Local area data for smarter loop generation: where the stairs are, and where
 * the parks/green are. Fetched once per loop generation from Overpass so loop
 * candidates can be scored on step usage and park coverage (not just distance
 * and backtracking).
 */
import { PedNet, type Bbox } from "./pednet.js";
import { timeoutSignal } from "./routing.js";

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

const RUNNABLE =
  "footway|path|pedestrian|steps|track|cycleway|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|road";

export class LoopData {
  constructor(
    private steps: PedNet | null,
    private parks: Ring[],
    private lat0: number,
    private network: PedNet | null = null,
    private crossings: PedNet | null = null,
    private notBuilt: PedNet | null = null,
    private pois: PedNet | null = null,
    private signals: PedNet | null = null,
    private tracks: PedNet | null = null,
  ) {}

  /** Snap toward an interesting POI (viewpoint, spring, cave, water…) if one is
   *  within `radiusM`, else fall back to the plain network snap. Used to nudge a
   *  guide waypoint so the route passes by scenic/useful spots. */
  attract(lon: number, lat: number, radiusM = 40): [number, number] {
    if (this.pois) {
      const q = this.pois.nearest(lon, lat);
      if (q) {
        const mLon = mPerDegLon(this.lat0);
        const d = Math.hypot((lon - q[0]) * mLon, (lat - q[1]) * M_PER_DEG_LAT);
        if (d <= radiusM) return this.network ? (this.network.nearest(q[0], q[1]) ?? q) : q;
      }
    }
    return this.snap(lon, lat);
  }

  /** Route vertices that pass close (≤ `thresh` m) to an interesting POI. */
  poiHits(coords: number[][], thresh = 25): number {
    if (!this.pois) return 0;
    let n = 0;
    for (const c of coords) if (this.pois.nearestDist(c[0]!, c[1]!) < thresh) n++;
    return n;
  }

  /** Route vertices on a not-built way (construction/proposed/… — e.g. a
   *  proposed bridge). Any hit should disqualify a loop candidate. */
  notBuiltHits(coords: number[][], thresh = 12): number {
    if (!this.notBuilt) return 0;
    let n = 0;
    for (const c of coords) if (this.notBuilt.nearestDist(c[0]!, c[1]!) < thresh) n++;
    return n;
  }

  /** How many crossings / lights of `net` the route passes (within `thresh` m).
   *  OSM often splits ONE crossing into several signal nodes (one per lane or
   *  tram track), so matched nodes closer than `mergeM` count as one. */
  private distinctNear(net: PedNet | null, coords: number[][], thresh: number, mergeM = 30): number {
    if (!net) return 0;
    const mLon = mPerDegLon(this.lat0);
    const seen = new Map<string, [number, number]>();
    for (const c of coords) {
      const p = net.nearest(c[0]!, c[1]!);
      if (!p) continue;
      if (Math.hypot((c[0]! - p[0]) * mLon, (c[1]! - p[1]) * M_PER_DEG_LAT) < thresh) seen.set(`${p[0]},${p[1]}`, p);
    }
    // Greedy clustering of the matched nodes.
    const centres: [number, number][] = [];
    for (const p of seen.values()) {
      const near = centres.some((q) => Math.hypot((p[0] - q[0]) * mLon, (p[1] - q[1]) * M_PER_DEG_LAT) < mergeM);
      if (!near) centres.push(p);
    }
    return centres.length;
  }

  /** Uncontrolled / marked road crossings the route uses (no traffic light). */
  crossingHits(coords: number[][], thresh = 5): number {
    return this.distinctNear(this.crossings, coords, thresh);
  }

  /** Traffic lights the route passes (signal-controlled crossings and signal
   *  nodes on roads) — each one is a potential stop. */
  signalHits(coords: number[][], thresh = 5): number {
    return this.distinctNear(this.signals, coords, thresh);
  }

  /** Metres of the route that run on a running / athletics track. */
  trackMeters(coords: number[][], thresh = 8): number {
    if (!this.tracks || coords.length < 2) return 0;
    const mLon = mPerDegLon(this.lat0);
    let m = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1]!, b = coords[i]!;
      const mx = (a[0]! + b[0]!) / 2, my = (a[1]! + b[1]!) / 2;
      if (this.tracks.nearestDist(mx, my) < thresh) m += Math.hypot((b[0]! - a[0]!) * mLon, (b[1]! - a[1]!) * M_PER_DEG_LAT);
    }
    return m;
  }

  /** Snap a point to the nearest runnable network vertex (≤ 60 m), else itself. */
  snap(lon: number, lat: number): [number, number] {
    if (!this.network) return [lon, lat];
    const p = this.network.nearest(lon, lat);
    if (!p) return [lon, lat];
    const mLon = mPerDegLon(this.lat0);
    const d = Math.hypot((lon - p[0]) * mLon, (lat - p[1]) * M_PER_DEG_LAT);
    return d <= 60 ? p : [lon, lat];
  }

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

interface OverpassEl { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; lat?: number; lon?: number; }

/** Fetch steps + parks/green for a bbox, or null if Overpass is unavailable. */
export async function fetchLoopData(bbox: Bbox, signal?: AbortSignal): Promise<LoopData | null> {
  const b = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const query =
    `[out:json][timeout:60];(` +
    `way["highway"~"^(${RUNNABLE})$"](${b});` +
    `way["leisure"~"^(park|nature_reserve|garden|recreation_ground|common)$"](${b});` +
    `way["landuse"~"^(forest|grass|recreation_ground|meadow|village_green)$"](${b});` +
    `way["natural"="wood"](${b});` +
    `way["highway"~"^(construction|proposed|planned|razed|disused|abandoned)$"](${b});` +
    `node["highway"="crossing"](${b});` +
    `node["highway"="traffic_signals"](${b});` +
    // Running / athletics tracks (BRouter doesn't carry leisure/sport tags, so
    // tracks are rewarded here in candidate scoring instead of in the profile).
    `way["leisure"="track"]["sport"~"running|athletics"](${b});` +
    // Interesting spots to route past.
    `node["tourism"~"^(viewpoint|attraction|artwork)$"](${b});` +
    `node["natural"~"^(cave_entrance|spring|waterfall|peak|arch|geyser)$"](${b});` +
    `node["amenity"~"^(drinking_water|fountain)$"](${b});` +
    `node["man_made"~"^(water_tap|water_well)$"](${b});` +
    `node["historic"~"^(monument|memorial|castle|ruins|monastery|archaeological_site)$"](${b});` +
    `);out geom tags;`;
  const lat0 = (bbox.s + bbox.n) / 2;
  const mLon = mPerDegLon(lat0);
  const densify = (g: { lat: number; lon: number }[], out: [number, number][]) => {
    for (let i = 0; i < g.length; i++) {
      const p = g[i]!;
      out.push([p.lon, p.lat]);
      const q = g[i + 1];
      if (!q) continue;
      const dM = Math.hypot((q.lon - p.lon) * mLon, (q.lat - p.lat) * M_PER_DEG_LAT);
      const n = Math.floor(dM / 12);
      for (let k = 1; k <= n; k++) out.push([p.lon + ((q.lon - p.lon) * k) / (n + 1), p.lat + ((q.lat - p.lat) * k) / (n + 1)]);
    }
  };

  for (const url of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) return null;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: "data=" + encodeURIComponent(query),
        signal: timeoutSignal(15000, signal), // slow mirror → try the next one sooner
      });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text[0] !== "{") continue; // an error page, not JSON — try next
      const json = JSON.parse(text) as { elements?: OverpassEl[] };

      const NOTBUILT = new Set(["construction", "proposed", "planned", "razed", "disused", "abandoned"]);
      const stepPts: [number, number][] = [];
      const netPts: [number, number][] = [];
      const crossPts: [number, number][] = [];
      const signalPts: [number, number][] = [];
      const trackPts: [number, number][] = [];
      const poiPts: [number, number][] = [];
      const notBuiltPts: [number, number][] = [];
      const parks: Ring[] = [];
      for (const el of json.elements ?? []) {
        if (el.type === "node" && el.lon !== undefined && el.lat !== undefined) {
          const t = el.tags ?? {};
          // "controlled" is the older tag for a signal-controlled crossing.
          if (t["highway"] === "traffic_signals" || t["crossing"] === "traffic_signals" || t["crossing"] === "controlled") signalPts.push([el.lon, el.lat]);
          else if (t["highway"] === "crossing") crossPts.push([el.lon, el.lat]);
          else poiPts.push([el.lon, el.lat]); // interesting spot
          continue;
        }
        if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
        const hw = el.tags?.["highway"];
        if (el.tags?.["leisure"] === "track") {
          densify(el.geometry, trackPts);
          if (hw) densify(el.geometry, netPts); // a routable track is also network
        } else if (hw && NOTBUILT.has(hw)) {
          densify(el.geometry, notBuiltPts);  // not walkable (don't snap here)
        } else if (hw) {
          densify(el.geometry, netPts);       // runnable network (for snapping)
          if (hw === "steps") densify(el.geometry, stepPts); // stairs (for scoring)
        } else {
          const r = toRing(el.geometry);
          if (r) parks.push(r);
        }
      }
      const steps = stepPts.length >= 4 ? new PedNet(stepPts, lat0) : null;
      const network = netPts.length >= 20 ? new PedNet(netPts, lat0) : null;
      const crossings = crossPts.length >= 1 ? new PedNet(crossPts, lat0) : null;
      const notBuilt = notBuiltPts.length >= 2 ? new PedNet(notBuiltPts, lat0) : null;
      const pois = poiPts.length >= 1 ? new PedNet(poiPts, lat0) : null;
      const signals = signalPts.length >= 1 ? new PedNet(signalPts, lat0) : null;
      const tracks = trackPts.length >= 2 ? new PedNet(trackPts, lat0) : null;
      return new LoopData(steps, parks, lat0, network, crossings, notBuilt, pois, signals, tracks);
    } catch {
      // try next endpoint
    }
  }
  return null;
}
