import maplibregl, { type Map as MLMap, type LngLat } from "maplibre-gl";
import {
  fetchRoute, geocode, toGpx, fmtDistance, fmtDuration, setStairsAllowed,
  PROFILE_LABELS, type RunProfile, type RouteResult,
} from "./routing.js";
import { autoFitShape, SHAPE_LABELS, type ShapeName } from "./shape-art.js";
import { fetchPedNetwork, type Bbox } from "./pednet.js";
import { fetchLoopData } from "./loop-data.js";
import { LOOP_SHAPES, loopWaypoints, normPerimeter, type LoopShape } from "./loop-gen.js";

/** A route point's role: start (S), via (numbered), finish (F). */
export type WpKind = "start" | "via" | "end";
interface WayPoint { lngLat: LngLat; marker: maplibregl.Marker; dot: HTMLElement; kind: WpKind; }

/** Point at bearing (deg, 0=N,90=E) and distance (m) from [lon,lat]. */
function destPoint(lon: number, lat: number, bearingDeg: number, distM: number): [number, number] {
  const R = 6371000, br = (bearingDeg * Math.PI) / 180, d = distM / R;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br));
  const λ2 = λ1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI];
}
function hav(a: number[], b: number[]): number {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (b[1]! - a[1]!) * t, dLon = (b[0]! - a[0]!) * t;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1]! * t) * Math.cos(b[1]! * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/** Collapse out-and-back spurs (U-turn spikes) from a polyline of [lon,lat,ele].
 *  A spur is where the path goes out to a dead-end tip and returns along the
 *  same nodes; a stack-based U-turn collapse removes them (incl. nested ones). */
function trimSpurs(coords: number[][]): number[][] {
  const eq = (p: number[], q: number[]) => Math.abs(p[0]! - q[0]!) < 1e-6 && Math.abs(p[1]! - q[1]!) < 1e-6;
  const st: number[][] = [];
  for (const p of coords) {
    if (st.length >= 2 && eq(p, st[st.length - 2]!)) st.pop(); // drop the spur tip
    else st.push(p);
  }
  return st;
}

/** Remove small self-crossing sub-loops (e.g. circling a junction). When the
 *  path revisits a node and the enclosed circuit is short, splice it out. The
 *  whole route's own start==end closure is preserved. */
function removeSmallLoops(coords: number[][], maxLoopM: number): number[][] {
  let c = coords;
  for (let guard = 0; guard < 50; guard++) {
    const seen = new Map<string, number>();
    let spliced = false;
    for (let i = 0; i < c.length; i++) {
      const key = `${c[i]![0]!.toFixed(6)},${c[i]![1]!.toFixed(6)}`;
      const j = seen.get(key);
      if (j !== undefined && !(j === 0 && i === c.length - 1)) {
        let len = 0;
        for (let k = j + 1; k <= i; k++) len += hav(c[k - 1]!, c[k]!);
        if (len <= maxLoopM) {
          c = [...c.slice(0, j + 1), ...c.slice(i + 1)];
          spliced = true;
          break;
        }
      }
      seen.set(key, i);
    }
    if (!spliced) break;
  }
  return c;
}

/** % of route length that retraces a segment already travelled (backtracking). */
function backtrackPct(coords: number[][]): number {
  const key = (p: number[], q: number[]) => {
    const a = `${p[0]!.toFixed(5)},${p[1]!.toFixed(5)}`, b = `${q[0]!.toFixed(5)},${q[1]!.toFixed(5)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const seen = new Map<string, number>();
  let total = 0, retraced = 0;
  for (let i = 1; i < coords.length; i++) {
    const L = hav(coords[i - 1]!, coords[i]!); total += L;
    const c = (seen.get(key(coords[i - 1]!, coords[i]!)) || 0) + 1;
    seen.set(key(coords[i - 1]!, coords[i]!), c);
    if (c > 1) retraced += L;
  }
  return total > 0 ? (100 * retraced) / total : 0;
}

/** Run `fn` over `items` with limited concurrency, calling `onEach` per finish. */
async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>, onEach: () => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
      onEach();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

export interface RoutePlanner {
  /** Add a waypoint at a map location (from the context menu). */
  add(lngLat: LngLat, role: WpKind): void;
  /** Round-trip mode takes only a start (no via / finish). */
  isLoopMode(): boolean;
}

const MAX_WP = 25;

/** Wire up the route planner UI + BRouter routing. Requires a "route"
 *  GeoJSON source already on the map (added in main.ts). */
export function initRoutePlanner(map: MLMap): RoutePlanner {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const profileSel = $("route-profile") as HTMLSelectElement;
  const searchInput = $("route-search-input") as HTMLInputElement;
  const addBtn = $("route-search-add") as HTMLButtonElement;
  const wpListEl = $("route-wp-list");
  const clearBtn = $("route-clear") as HTMLButtonElement;
  const reverseBtn = $("route-reverse") as HTMLButtonElement;
  const gpxBtn = $("route-gpx") as HTMLButtonElement;
  const statusEl = $("route-status");
  const errorEl = $("route-error");
  const modeSel = $("route-mode") as HTMLSelectElement;
  const loopCtl = $("route-loop-ctl");
  const loopDist = $("route-loop-dist") as HTMLInputElement;
  const loopDir = $("route-loop-dir") as HTMLSelectElement;
  const loopCompass = $("route-loop-compass");
  const loopGo = $("route-loop-go") as HTMLButtonElement;
  const allowStairs = $("route-allow-stairs") as HTMLInputElement;
  const ptpCtl = $("route-ptp-ctl");
  const ptpDist = $("route-ptp-dist") as HTMLInputElement;
  const ptpGo = $("route-ptp-go") as HTMLButtonElement;
  const ptpNext = $("route-ptp-next") as HTMLButtonElement;
  const shapeCtl = $("route-shape-ctl");
  const shapeName = $("route-shape-name") as HTMLSelectElement;
  const shapeDist = $("route-shape-dist") as HTMLInputElement;
  const shapeUpright = $("route-shape-upright") as HTMLInputElement;
  const shapeGo = $("route-shape-go") as HTMLButtonElement;
  const shapeProgress = $("route-shape-progress");
  const shapeBar = $("route-shape-bar");
  const busyEl = $("route-busy");
  const busyText = $("route-busy-text");
  const busyFill = $("route-busy-fill");
  const busyCancel = $("route-busy-cancel") as HTMLButtonElement;

  // Populate the profile selector.
  for (const key of ["running", "trail"] as RunProfile[]) {
    const o = document.createElement("option");
    o.value = key; o.textContent = PROFILE_LABELS[key];
    profileSel.appendChild(o);
  }
  // Populate the shape selector.
  for (const key of ["tree", "heart", "star"] as ShapeName[]) {
    const o = document.createElement("option");
    o.value = key; o.textContent = SHAPE_LABELS[key];
    shapeName.appendChild(o);
  }

  const wps: WayPoint[] = [];
  let result: RouteResult | null = null;
  // Padded A→B options (see generatePadded).
  let paddedAlts: { res: RouteResult; steps: number; park: number; signals: number; trackM: number; hasData: boolean }[] = [];
  let paddedIdx = 0;

  const isLoop = () => modeSel.value === "loop";
  const findKind = (k: WpKind) => wps.find((w) => w.kind === k);
  const lngLatOf = (w: WayPoint): [number, number] => [w.lngLat.lng, w.lngLat.lat];

  const routeSource = () => map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  const setRoute = (geo: GeoJSON.Feature | null) =>
    routeSource()?.setData({ type: "FeatureCollection", features: geo ? [geo] : [] });
  const shapeSource = () => map.getSource("shape-ideal") as maplibregl.GeoJSONSource | undefined;
  const setShapeIdeal = (coords: [number, number][] | null) =>
    shapeSource()?.setData({
      type: "FeatureCollection",
      features: coords ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] : [],
    });

  // ── Background job: centred progress overlay + cancel ─────────────────────
  // Only one generation runs at a time; starting another, editing points,
  // switching mode or pressing Cancel aborts the running one (its in-flight
  // requests are aborted via the signal).
  let job: AbortController | null = null;
  function beginJob(text: string): AbortSignal {
    job?.abort();
    job = new AbortController();
    busyText.textContent = text;
    busyFill.style.width = "0%";
    busyEl.hidden = false;
    errorEl.hidden = true;
    statusEl.hidden = true; // progress lives in the overlay meanwhile
    return job.signal;
  }
  function progress(signal: AbortSignal, text: string, frac?: number) {
    if (signal.aborted) return;
    busyText.textContent = text;
    if (frac !== undefined) busyFill.style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
  }
  function endJob(signal: AbortSignal) {
    if (job && job.signal === signal) { job = null; busyEl.hidden = true; }
  }
  function cancelJob(): boolean {
    if (!job) return false;
    job.abort(); job = null; busyEl.hidden = true;
    return true;
  }
  busyCancel.addEventListener("click", () => {
    if (cancelJob()) { statusEl.hidden = false; statusEl.textContent = "Cancelled."; }
  });

  // ── Showing a result ───────────────────────────────────────────────────────
  const isClosed = (res: RouteResult) => {
    const c = res.coords3d;
    return c.length > 3 && hav(c[0]!, c[c.length - 1]!) < 40;
  };
  function fitTo(res: RouteResult) {
    const lons = res.geometry.coordinates.map((c) => c[0]!);
    const lats = res.geometry.coordinates.map((c) => c[1]!);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 60, maxZoom: 15 });
  }
  function showRoute(res: RouteResult, text: string, fit = false) {
    result = res;
    setRoute({ type: "Feature", geometry: res.geometry, properties: {} });
    statusEl.hidden = false; statusEl.textContent = text;
    errorEl.hidden = true;
    gpxBtn.hidden = false;
    reverseBtn.hidden = !isClosed(res); // reversing only makes sense for a loop
    if (fit) fitTo(res);
  }
  function clearRouteDisplay() {
    result = null;
    setRoute(null); setShapeIdeal(null);
    statusEl.hidden = true; errorEl.hidden = true;
    gpxBtn.hidden = true; reverseBtn.hidden = true;
    paddedAlts = []; ptpNext.hidden = true;
  }
  function showError(text: string) {
    statusEl.hidden = true;
    errorEl.hidden = false; errorEl.textContent = text;
  }
  const lightsLabel = (n: number) => (n === 0 ? "no traffic lights" : n === 1 ? "1 traffic light" : `${n} traffic lights`);
  const baseStatus = (res: RouteResult) =>
    `${fmtDistance(res.distanceM)} · ↑${Math.round(res.ascentM)} m · ${fmtDuration(res.durationS)}`;

  // Run the loop the other way round: same path, reversed direction (the
  // route chevrons flip with it; ascent becomes the former descent).
  reverseBtn.addEventListener("click", () => {
    if (!result) return;
    const c3 = [...result.coords3d].reverse();
    let asc = 0;
    for (let i = 1; i < c3.length; i++) {
      const de = (c3[i]![2] ?? 0) - (c3[i - 1]![2] ?? 0);
      if (de > 0) asc += de;
    }
    const res: RouteResult = {
      geometry: { type: "LineString", coordinates: c3.map((c) => [c[0]!, c[1]!]) },
      coords3d: c3, distanceM: result.distanceM, ascentM: asc, durationS: result.durationS,
    };
    const rest = statusEl.textContent?.split(" · ").slice(3).filter((s) => s !== "reversed") ?? [];
    const wasReversed = statusEl.textContent?.includes("reversed") ?? false;
    showRoute(res, [baseStatus(res), ...rest, ...(wasReversed ? [] : ["reversed"])].join(" · "));
  });

  // ── Waypoints ──────────────────────────────────────────────────────────────
  // Each point has an explicit role: S = start, F = finish, 1…n = vias.
  // Order is kept as start, vias…, finish.

  // A fixed-size 24×24 shell is the marker's anchor target, so the
  // translate(-50%,-50%) offset never changes → no drift on zoom. Only the
  // inner dot changes size/colour per role.
  function makeMarkerEl(): { shell: HTMLElement; dot: HTMLElement } {
    const shell = document.createElement("div");
    shell.className = "route-wp-shell";
    const dot = document.createElement("div");
    dot.className = "route-wp-dot route-wp-dot--via";
    shell.appendChild(dot);
    return { shell, dot };
  }
  function labelOf(i: number): string {
    const k = wps[i]!.kind;
    if (k === "start") return "S";
    if (k === "end") return "F";
    let n = 0;
    for (let j = 0; j <= i; j++) if (wps[j]!.kind === "via") n++;
    return String(n);
  }
  function restyleMarkers() {
    wps.forEach((wp, i) => {
      wp.dot.className = `route-wp-dot route-wp-dot--${wp.kind}`;
      wp.dot.textContent = labelOf(i);
    });
  }
  function renderList() {
    wpListEl.innerHTML = "";
    wps.forEach((wp, i) => {
      const li = document.createElement("li");
      li.className = "route-wp-item";
      const label = document.createElement("span");
      label.className = `route-wp-label route-wp-label--${wp.kind}`;
      label.textContent = labelOf(i);
      const txt = document.createElement("span");
      txt.className = "route-wp-coords";
      txt.textContent = `${wp.lngLat.lat.toFixed(4)}, ${wp.lngLat.lng.toFixed(4)}`;
      const rm = document.createElement("button");
      rm.className = "route-wp-rm"; rm.textContent = "✕"; rm.title = "Remove";
      rm.addEventListener("click", () => removeWp(i));
      li.append(label, txt, rm);
      wpListEl.appendChild(li);
    });
    clearBtn.hidden = wps.length === 0;
  }

  /** Points changed (added / moved / removed): any running generation and the
   *  shown loop are stale; A→B re-routes automatically. */
  function onPointsChanged() {
    restyleMarkers();
    renderList();
    cancelJob();
    if (modeSel.value === "ptp") { void rebuild(); return; }
    clearRouteDisplay();
    if (findKind("start")) {
      statusEl.hidden = false;
      statusEl.textContent = isLoop() ? "Start set — press “Generate loop from start”." : "Start set.";
    }
  }

  /** Place a point by role: start/finish replace an existing one; vias go
   *  just before the finish. */
  function placeWp(lngLat: LngLat, kind: WpKind) {
    if (kind === "start" || kind === "end") {
      const existing = findKind(kind);
      if (existing) {
        existing.lngLat = lngLat; existing.marker.setLngLat(lngLat);
        onPointsChanged();
        return;
      }
    }
    if (wps.length >= MAX_WP) return;
    const { shell, dot } = makeMarkerEl();
    const marker = new maplibregl.Marker({ element: shell, draggable: true, anchor: "center" })
      .setLngLat(lngLat).addTo(map);
    const wp: WayPoint = { lngLat, marker, dot, kind };
    marker.on("dragend", () => { wp.lngLat = marker.getLngLat(); onPointsChanged(); });
    if (kind === "start") wps.unshift(wp);
    else if (kind === "end") wps.push(wp);
    else {
      const endIdx = wps.findIndex((w) => w.kind === "end");
      if (endIdx >= 0) wps.splice(endIdx, 0, wp); else wps.push(wp);
    }
    onPointsChanged();
  }
  /** Role for a point typed into the search box. */
  function nextKind(): WpKind {
    if (isLoop() || modeSel.value === "shape" || !findKind("start")) return "start";
    if (!findKind("end")) return "end";
    return "via";
  }
  function removeWp(i: number) {
    wps[i]?.marker.remove();
    wps.splice(i, 1);
    onPointsChanged();
  }
  function clearAll() {
    cancelJob();
    wps.forEach((w) => w.marker.remove());
    wps.length = 0;
    restyleMarkers();
    renderList();
    clearRouteDisplay();
  }

  // ── Point A→B (auto-routed as points change) ──────────────────────────────
  async function rebuild() {
    if (modeSel.value !== "ptp") return;
    paddedAlts = []; ptpNext.hidden = true;
    if (!findKind("start") || !findKind("end")) {
      clearRouteDisplay();
      if (wps.length) { statusEl.hidden = false; statusEl.textContent = findKind("start") ? "Now set a finish." : "Now set a start."; }
      return;
    }
    const signal = beginJob("Routing…");
    try {
      const res = await fetchRoute(wps.map(lngLatOf), profileSel.value as RunProfile, signal);
      if (signal.aborted) return;
      if (!res) { clearRouteDisplay(); showError("No route found (try other points / profile)."); return; }
      showRoute(res, baseStatus(res));
    } finally {
      endJob(signal);
    }
  }

  // ── Round-trip (loop) generation ────────────────────────────────────────
  interface LoopCand {
    res: RouteResult; shape: LoopShape; heading: number; size: number;
    dist: number; asc: number; bt: number; steps: number; park: number; crossings: number; notBuilt: number; poi: number; signals: number; trackM: number;
  }

  async function generateLoop() {
    const startWp = findKind("start");
    if (!startWp) { showError("Set a start point first (right-click → Route: set start)."); return; }
    const start = lngLatOf(startWp);
    const targetM = Math.max(1, Number(loopDist.value) || 5) * 1000;
    const profile = profileSel.value as RunProfile;

    const signal = beginJob("Analyzing area…");
    loopGo.disabled = true; loopGo.textContent = "Generating…";
    try {
      // Local steps + parks for scoring (best effort; falls back to distance +
      // backtrack scoring if Overpass is unavailable).
      const rM = Math.min(6000, Math.max(1500, targetM / 4));
      const dLat = rM / 111320, dLon = rM / (111320 * Math.cos((start[1] * Math.PI) / 180));
      const bbox: Bbox = { s: start[1] - dLat, w: start[0] - dLon, n: start[1] + dLat, e: start[0] + dLon };
      const data = await fetchLoopData(bbox, signal).catch(() => null);
      if (signal.aborted) return;

      // Evaluate one loop: route the shape's waypoints, clean spurs, measure.
      const evalC = async (shape: LoopShape, heading: number, size: number): Promise<LoopCand | null> => {
        if (signal.aborted) return null;
        const raw = loopWaypoints(start, LOOP_SHAPES[shape], size, heading);
        // Snap intermediate waypoints onto the network (and toward nearby
        // interesting spots); keep the start (index 0 / last) exact.
        const wp: [number, number][] = raw.map((p, i) =>
          data && i > 0 && i < raw.length - 1 ? data.attract(p[0], p[1]) : p);
        const res = await fetchRoute(wp, profile, signal);
        if (!res || res.coords3d.length < 4) return null;
        const trimmed = removeSmallLoops(trimSpurs(res.coords3d), 300);
        let dist = 0, asc = 0;
        for (let i = 1; i < trimmed.length; i++) {
          dist += hav(trimmed[i - 1]!, trimmed[i]!);
          const de = (trimmed[i]![2] ?? 0) - (trimmed[i - 1]![2] ?? 0);
          if (de > 0) asc += de;
        }
        const coords2d = trimmed.map((c) => [c[0]!, c[1]!]);
        const cleaned: RouteResult = {
          geometry: { type: "LineString", coordinates: coords2d },
          coords3d: trimmed, distanceM: dist, ascentM: asc,
          durationS: res.distanceM > 0 ? Math.round(res.durationS * (dist / res.distanceM)) : res.durationS,
        };
        return {
          res: cleaned, shape, heading, size, dist, asc, bt: backtrackPct(coords2d),
          steps: data ? data.stepHits(coords2d) : 0, park: data ? data.parkFraction(coords2d) : 0,
          crossings: data ? data.crossingHits(coords2d) : 0,
          notBuilt: data ? data.notBuiltHits(coords2d) : 0,
          poi: data ? data.poiHits(coords2d) : 0,
          signals: data ? data.signalHits(coords2d) : 0,
          trackM: data ? data.trackMeters(coords2d) : 0,
        };
      };

      // Score (lower is better). Running: flatness + stair-avoidance lead, park
      // is a bonus (doesn't override gradients), backtrack keeps it clean, and a
      // distance term nudges to the target. Trail: hills/steps fine.
      const score = (c: LoopCand): number => {
        const gradePerKm = c.asc / Math.max(0.1, c.dist / 1000);
        const distPen = 100 * (Math.abs(c.dist - targetM) / targetM);
        const notBuiltPen = c.notBuilt * 500; // any not-built way (e.g. a proposed bridge) disqualifies
        const poiBonus = Math.min(c.poi, 10) * 2.5; // reward passing interesting spots (capped)
        const trackBonus = Math.min(c.trackM, 2000) / 100; // ~4 per lap of a 400 m track
        // Continuity: a traffic light (likely stop) weighs much more than an
        // uncontrolled crossing; frequent road crossings still add up.
        if (profile === "running")
          return notBuiltPen + c.bt + gradePerKm + c.steps * 1.2 + c.signals * 3 + c.crossings * 0.8
            - c.park * 30 - poiBonus - trackBonus + distPen;
        return notBuiltPen + c.bt * 1.2 + c.signals + c.crossings * 0.3 - c.park * 20 - poiBonus - trackBonus / 2 + distPen;
      };

      const dir = loopDir.value;
      const headings = dir === "auto"
        ? [0, 60, 120, 180, 240, 300].map((h) => (h + Math.random() * 25) % 360)
        : [Number(dir) - 30, Number(dir), Number(dir) + 30];
      const shapes: LoopShape[] = ["circle", "oval", "teardrop"];
      const sizeFor = (shape: LoopShape) => targetM / (1.3 * normPerimeter(LOOP_SHAPES[shape]));

      const jobs: { shape: LoopShape; h: number }[] = [];
      for (const shape of shapes) for (const h of headings) jobs.push({ shape, h });
      const total = jobs.length + 1;
      let done = 0;
      progress(signal, "Trying loops… 0%", 0.03);
      const results = await mapPool(jobs, 4, (j) => evalC(j.shape, j.h, sizeFor(j.shape)), () => {
        done++;
        progress(signal, `Trying loops… ${Math.round((100 * done) / total)}%`, done / total);
      });
      if (signal.aborted) return;
      const cands: LoopCand[] = results.filter((c): c is LoopCand => c !== null);
      if (!cands.length) { clearRouteDisplay(); showError("Couldn't build a loop here — try another distance."); return; }

      cands.sort((a, b) => score(a) - score(b));
      let best = cands[0]!;

      // Distance refinement: re-route the winning shape/heading scaled to target.
      const scaleFix = Math.min(1.6, Math.max(0.6, targetM / Math.max(1, best.dist)));
      if (Math.abs(scaleFix - 1) > 0.08) {
        progress(signal, "Tuning distance…", 0.95);
        const c = await evalC(best.shape, best.heading, best.size * scaleFix);
        if (signal.aborted) return;
        if (c && score(c) < score(best)) best = c;
      }

      const bits = [baseStatus(best.res)];
      if (data && profile === "running") bits.push(best.steps === 0 ? "step-free" : `~${best.steps} step pts`);
      if (data) bits.push(lightsLabel(best.signals));
      if (data && best.trackM > 50) bits.push(`${Math.round(best.trackM)} m on track`);
      if (data && best.park > 0.05) bits.push(`${Math.round(best.park * 100)}% park`);
      showRoute(best.res, bits.join(" · "), true);
    } finally {
      endJob(signal);
      loopGo.disabled = false; loopGo.textContent = "Generate loop from start";
    }
  }

  // ── Shape run (GPS art) — auto-fit a template onto the running network ─────
  // (mode hidden in the UI for now; kept working)
  async function generateShape() {
    const startWp = findKind("start");
    if (!startWp) { showError("Set a start point first (right-click → Route: set start)."); return; }
    const start = lngLatOf(startWp);
    const targetM = Math.max(1, Number(shapeDist.value) || 5) * 1000;
    const profile = profileSel.value as RunProfile;
    const shape = shapeName.value as ShapeName;
    const keepUpright = shapeUpright.checked;

    shapeGo.disabled = true; shapeGo.textContent = "Searching…";
    statusEl.hidden = false; statusEl.textContent = "Loading map data…";
    shapeProgress.hidden = false; shapeBar.style.width = "0%";
    try {
      const rM = Math.min(8000, Math.max(1200, targetM * 0.35));
      const dLat = rM / 111320, dLon = rM / (111320 * Math.cos((start[1] * Math.PI) / 180));
      const bbox: Bbox = { s: start[1] - dLat, w: start[0] - dLon, n: start[1] + dLat, e: start[0] + dLon };
      const network = await fetchPedNetwork(bbox).catch(() => null);
      statusEl.textContent = network ? "Auto-fitting shape…" : "Auto-fitting shape (no prefilter)…";
      const { best } = await autoFitShape({
        start, shape, targetM, keepUpright, profile, route: (w, p) => fetchRoute(w, p), network,
        onProgress: (d, t) => { shapeBar.style.width = `${Math.round((100 * d) / t)}%`; },
      });
      if (!best) {
        clearRouteDisplay();
        showError("Couldn't fit a shape here — try a denser area, other distance or shape.");
        return;
      }
      setShapeIdeal(best.ideal);
      showRoute(best.res,
        `${fmtDistance(best.res.distanceM)} · fit ±${Math.round(best.meanDev)} m · ↑${Math.round(best.res.ascentM)} m`, true);
    } finally {
      shapeGo.disabled = false; shapeGo.textContent = "Auto-fit shape from start";
      shapeProgress.hidden = true;
    }
  }

  // ── Point A→B with a target distance (pad the mileage with detours) ───────
  function showPadded(i: number) {
    if (!paddedAlts.length) return;
    paddedIdx = ((i % paddedAlts.length) + paddedAlts.length) % paddedAlts.length;
    const a = paddedAlts[paddedIdx]!;
    const bits = [baseStatus(a.res)];
    if (paddedAlts.length > 1) bits.push(`option ${paddedIdx + 1}/${paddedAlts.length}`);
    if (a.steps === 0) bits.push("step-free");
    if (a.hasData) bits.push(lightsLabel(a.signals));
    if (a.trackM > 50) bits.push(`${Math.round(a.trackM)} m on track`);
    if (a.park > 0.05) bits.push(`${Math.round(a.park * 100)}% park`);
    showRoute(a.res, bits.join(" · "));
    ptpNext.hidden = paddedAlts.length < 2;
  }

  async function generatePadded() {
    const sWp = findKind("start"), eWp = findKind("end");
    if (!sWp || !eWp) { showError("Set a start and a finish first."); return; }
    const A = lngLatOf(sWp), B = lngLatOf(eWp);
    const targetM = Math.max(1, Number(ptpDist.value) || 10) * 1000;
    const profile = profileSel.value as RunProfile;

    const signal = beginJob("Analyzing area…");
    ptpGo.disabled = true; ptpGo.textContent = "Working…"; ptpNext.hidden = true; paddedAlts = [];
    try {
      const direct = await fetchRoute([A, B], profile, signal);
      if (signal.aborted) return;
      const d0 = direct ? direct.distanceM : hav(A, B);
      if (targetM <= d0 * 1.08) {
        // Target isn't meaningfully longer than the shortest route — just show it.
        if (direct) showRoute(direct, `${baseStatus(direct)} · shortest (raise the target to add detours)`);
        else showError("No route found.");
        return;
      }
      const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const rM = Math.min(9000, Math.max(2000, targetM / 2));
      const dLat = rM / 111320, dLon = rM / (111320 * Math.cos((mid[1] * Math.PI) / 180));
      const bbox: Bbox = { s: mid[1] - dLat, w: mid[0] - dLon, n: mid[1] + dLat, e: mid[0] + dLon };
      const data = await fetchLoopData(bbox, signal).catch(() => null);
      if (signal.aborted) return;

      // Perpendicular to A→B in metres space, for a bulging detour.
      const mLon = 111320 * Math.cos((mid[1] * Math.PI) / 180);
      const abx = (B[0] - A[0]) * mLon, aby = (B[1] - A[1]) * 111320;
      const abLen = Math.hypot(abx, aby) || 1;
      const px = -aby / abLen, py = abx / abLen;

      // One padded candidate: quadratic Bézier A→C→B, control C offset by height h.
      const build = async (side: 1 | -1, h: number) => {
        if (signal.aborted) return null;
        const cx = mid[0] + (side * h * px) / mLon, cy = mid[1] + (side * h * py) / 111320;
        const via: [number, number][] = [];
        for (const t of [0.2, 0.4, 0.6, 0.8]) {
          const mt = 1 - t;
          let lon = mt * mt * A[0] + 2 * mt * t * cx + t * t * B[0];
          let lat = mt * mt * A[1] + 2 * mt * t * cy + t * t * B[1];
          if (data) { const s = data.attract(lon, lat); lon = s[0]; lat = s[1]; }
          via.push([lon, lat]);
        }
        const res = await fetchRoute([A, ...via, B], profile, signal);
        if (!res || res.coords3d.length < 4) return null;
        const trimmed = removeSmallLoops(trimSpurs(res.coords3d), 300);
        let dist = 0, asc = 0;
        for (let i = 1; i < trimmed.length; i++) {
          dist += hav(trimmed[i - 1]!, trimmed[i]!);
          const de = (trimmed[i]![2] ?? 0) - (trimmed[i - 1]![2] ?? 0);
          if (de > 0) asc += de;
        }
        const c2 = trimmed.map((c) => [c[0]!, c[1]!]);
        const cleaned: RouteResult = {
          geometry: { type: "LineString", coordinates: c2 }, coords3d: trimmed, distanceM: dist, ascentM: asc,
          durationS: res.distanceM > 0 ? Math.round(res.durationS * (dist / res.distanceM)) : res.durationS,
        };
        return {
          res: cleaned, dist, asc,
          steps: data ? data.stepHits(c2) : 0, park: data ? data.parkFraction(c2) : 0,
          crossings: data ? data.crossingHits(c2) : 0, notBuilt: data ? data.notBuiltHits(c2) : 0,
          poi: data ? data.poiHits(c2) : 0,
          signals: data ? data.signalHits(c2) : 0,
          trackM: data ? data.trackMeters(c2) : 0,
        };
      };

      const extra = targetM - d0;
      const heights = [0.35, 0.6, 0.9, 1.25, 1.7].map((f) => f * extra);
      const jobs: { side: 1 | -1; h: number }[] = [];
      for (const side of [1, -1] as (1 | -1)[]) for (const h of heights) jobs.push({ side, h });
      let done = 0; const total = jobs.length;
      progress(signal, "Building options… 0%", 0.03);
      const results = await mapPool(jobs, 4, (j) => build(j.side, j.h), () => {
        done++;
        progress(signal, `Building options… ${Math.round((100 * done) / total)}%`, done / total);
      });
      if (signal.aborted) return;
      const cands = results.filter((c): c is NonNullable<typeof c> => c !== null);
      if (!cands.length) { showError("Couldn't build padded routes here — try another distance."); return; }
      const score = (c: (typeof cands)[number]) =>
        c.notBuilt * 500 + c.steps * 1.2 + c.signals * 3 + c.crossings * 0.8 + (c.asc / Math.max(0.1, c.dist / 1000)) * 0.5
        - c.park * 30 - Math.min(c.poi, 10) * 2.5 - Math.min(c.trackM, 2000) / 100 + 100 * (Math.abs(c.dist - targetM) / targetM);
      cands.sort((a, b) => score(a) - score(b));
      paddedAlts = cands.slice(0, 4).map((c) => ({ res: c.res, steps: c.steps, park: c.park, signals: c.signals, trackM: c.trackM, hasData: !!data }));
      showPadded(0);
    } finally {
      endJob(signal);
      ptpGo.disabled = false; ptpGo.textContent = "Pad to distance";
    }
  }

  // ── Modes & settings ───────────────────────────────────────────────────────
  function applyMode() {
    cancelJob();
    const m = modeSel.value;
    loopCtl.hidden = m !== "loop";
    shapeCtl.hidden = m !== "shape";
    ptpCtl.hidden = m !== "ptp";
    // Round trips use only a start: drop via / finish points.
    if (m !== "ptp") {
      for (let i = wps.length - 1; i >= 0; i--) {
        if (wps[i]!.kind !== "start") { wps[i]!.marker.remove(); wps.splice(i, 1); }
      }
      restyleMarkers(); renderList();
    }
    clearRouteDisplay();
    if (m === "ptp") void rebuild();
  }
  modeSel.addEventListener("change", applyMode);
  loopGo.addEventListener("click", () => void generateLoop());
  shapeGo.addEventListener("click", () => void generateShape());
  ptpGo.addEventListener("click", () => void generatePadded());
  ptpNext.addEventListener("click", () => showPadded(paddedIdx + 1));

  // Direction compass → value of the (hidden) direction select.
  const compassBtns = Array.from(loopCompass.querySelectorAll<HTMLButtonElement>("button[data-dir]"));
  for (const b of compassBtns) {
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(b.classList.contains("active")));
    b.addEventListener("click", () => {
      loopDir.value = b.dataset["dir"] ?? "auto";
      for (const x of compassBtns) {
        const on = x === b;
        x.classList.toggle("active", on);
        x.setAttribute("aria-checked", String(on));
      }
    });
  }

  /** Profile / stairs changed: A→B re-routes (it's automatic anyway); loops
   *  and padded options are only rebuilt when the user presses the button. */
  function onSettingsChanged() {
    const hadJob = cancelJob();
    if (modeSel.value === "ptp") { void rebuild(); return; }
    if (result || hadJob) {
      statusEl.hidden = false;
      statusEl.textContent = "Settings changed — press “Generate loop from start” to rebuild.";
    }
  }
  profileSel.addEventListener("change", onSettingsChanged);
  setStairsAllowed(allowStairs.checked); // sync initial state (default: off)
  allowStairs.addEventListener("change", () => {
    setStairsAllowed(allowStairs.checked);
    onSettingsChanged();
  });
  clearBtn.addEventListener("click", clearAll);
  applyMode();

  addBtn.addEventListener("click", async () => {
    const q = searchInput.value.trim();
    if (!q) return;
    addBtn.disabled = true; addBtn.textContent = "…";
    try {
      const pt = await geocode(q);
      if (!pt) { showError(`Not found: "${q}"`); return; }
      searchInput.value = "";
      placeWp(new maplibregl.LngLat(pt[0], pt[1]), nextKind());
      map.flyTo({ center: pt, zoom: Math.max(map.getZoom(), 13) });
    } finally { addBtn.disabled = false; addBtn.textContent = "Add"; }
  });
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });

  gpxBtn.addEventListener("click", () => {
    if (!result) return;
    const gpx = toGpx(result.coords3d, "my_map_run route", profileSel.value as RunProfile);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    a.download = "route.gpx"; a.click();
    URL.revokeObjectURL(a.href);
  });

  return {
    add(lngLat, r) { placeWp(lngLat, isLoop() || modeSel.value === "shape" ? "start" : r); },
    isLoopMode: () => isLoop() || modeSel.value === "shape",
  };
}
