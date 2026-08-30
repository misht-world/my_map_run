import maplibregl, { type Map as MLMap, type LngLat } from "maplibre-gl";
import {
  fetchRoute, geocode, toGpx, fmtDistance, fmtDuration,
  PROFILE_LABELS, type RunProfile, type RouteResult,
} from "./routing.js";
import { autoFitShape, SHAPE_LABELS, type ShapeName } from "./shape-art.js";
import { fetchPedNetwork, type Bbox } from "./pednet.js";

interface WayPoint { lngLat: LngLat; marker: maplibregl.Marker; dot: HTMLElement; }

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

export interface RoutePlanner {
  /** Add a waypoint at a map location (from the context menu). */
  add(lngLat: LngLat, role: "start" | "via" | "end"): void;
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
  const gpxBtn = $("route-gpx") as HTMLButtonElement;
  const statusEl = $("route-status");
  const errorEl = $("route-error");
  const modeSel = $("route-mode") as HTMLSelectElement;
  const loopCtl = $("route-loop-ctl");
  const loopDist = $("route-loop-dist") as HTMLInputElement;
  const loopDir = $("route-loop-dir") as HTMLSelectElement;
  const loopGo = $("route-loop-go") as HTMLButtonElement;
  const shapeCtl = $("route-shape-ctl");
  const shapeName = $("route-shape-name") as HTMLSelectElement;
  const shapeDist = $("route-shape-dist") as HTMLInputElement;
  const shapeUpright = $("route-shape-upright") as HTMLInputElement;
  const shapeGo = $("route-shape-go") as HTMLButtonElement;
  const shapeProgress = $("route-shape-progress");
  const shapeBar = $("route-shape-bar");

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

  const routeSource = () => map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  const setRoute = (geo: GeoJSON.Feature | null) =>
    routeSource()?.setData({ type: "FeatureCollection", features: geo ? [geo] : [] });
  const shapeSource = () => map.getSource("shape-ideal") as maplibregl.GeoJSONSource | undefined;
  const setShapeIdeal = (coords: [number, number][] | null) =>
    shapeSource()?.setData({
      type: "FeatureCollection",
      features: coords ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] : [],
    });

  function role(i: number): "start" | "via" | "end" {
    if (i === 0) return "start";
    if (i === wps.length - 1 && wps.length > 1) return "end";
    return "via";
  }

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
  function restyleMarkers() {
    wps.forEach((wp, i) => {
      const r = role(i);
      wp.dot.className = `route-wp-dot route-wp-dot--${r}`;
      wp.dot.textContent = r === "start" ? "S" : r === "end" ? "F" : "";
    });
  }

  function addWp(lngLat: LngLat, index?: number) {
    if (wps.length >= MAX_WP) return;
    const at = index === undefined ? wps.length : Math.max(0, Math.min(index, wps.length));
    const { shell, dot } = makeMarkerEl();
    const marker = new maplibregl.Marker({ element: shell, draggable: true, anchor: "center" })
      .setLngLat(lngLat).addTo(map);
    marker.on("dragend", () => {
      const wp = wps.find((w) => w.marker === marker);
      if (wp) { wp.lngLat = marker.getLngLat(); void rebuild(); }
    });
    wps.splice(at, 0, { lngLat, marker, dot });
    restyleMarkers();
    renderList();
    void rebuild();
  }
  function removeWp(i: number) {
    wps[i]?.marker.remove();
    wps.splice(i, 1);
    restyleMarkers();
    renderList();
    void rebuild();
  }
  function clearAll() {
    wps.forEach((w) => w.marker.remove());
    wps.length = 0;
    result = null;
    setRoute(null);
    setShapeIdeal(null);
    renderList();
    statusEl.hidden = true;
    errorEl.hidden = true;
    gpxBtn.hidden = true;
  }

  function renderList() {
    wpListEl.innerHTML = "";
    wps.forEach((wp, i) => {
      const li = document.createElement("li");
      li.className = "route-wp-item";
      const label = document.createElement("span");
      label.className = `route-wp-label route-wp-label--${role(i)}`;
      label.textContent = role(i) === "start" ? "S" : role(i) === "end" ? "F" : String(i);
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

  async function rebuild() {
    if (modeSel.value === "loop") return; // loops are generated by the button
    errorEl.hidden = true;
    if (wps.length < 2) { setRoute(null); statusEl.hidden = true; gpxBtn.hidden = true; result = null; return; }
    statusEl.hidden = false; statusEl.textContent = "Routing…";
    const pts = wps.map((w) => [w.lngLat.lng, w.lngLat.lat] as [number, number]);
    const res = await fetchRoute(pts, profileSel.value as RunProfile);
    if (!res) {
      result = null; setRoute(null); gpxBtn.hidden = true;
      statusEl.hidden = true;
      errorEl.hidden = false; errorEl.textContent = "No route found (try other points / profile).";
      return;
    }
    result = res;
    setRoute({ type: "Feature", geometry: res.geometry, properties: {} });
    statusEl.textContent = `${fmtDistance(res.distanceM)} · ↑${Math.round(res.ascentM)} m · ${fmtDuration(res.durationS)}`;
    gpxBtn.hidden = false;
  }

  // ── Round-trip (loop) generation ────────────────────────────────────────
  async function generateLoop() {
    errorEl.hidden = true;
    if (wps.length < 1) {
      errorEl.hidden = false;
      errorEl.textContent = "Set a start point first (right-click → Route: set start).";
      return;
    }
    const start: [number, number] = [wps[0]!.lngLat.lng, wps[0]!.lngLat.lat];
    const targetM = Math.max(1, Number(loopDist.value) || 5) * 1000;
    const profile = profileSel.value as RunProfile;

    // One loop candidate: ring of K points around a circle that passes through
    // the start (centre one radius away in `heading`). Returns route + backtrack%.
    const K = 5;
    async function build(heading: number, scale: number): Promise<{ res: RouteResult; bt: number } | null> {
      const r = (targetM / (2 * Math.PI)) * scale;
      const center = destPoint(start[0], start[1], heading, r);
      const startBearingFromC = heading + 180;
      const stepDeg = 360 / (K + 1);
      const ring: [number, number][] = [];
      for (let i = 1; i <= K; i++) ring.push(destPoint(center[0], center[1], startBearingFromC + i * stepDeg, r));
      const res = await fetchRoute([start, ...ring, start], profile);
      return res ? { res, bt: backtrackPct(res.geometry.coordinates) } : null;
    }

    loopGo.disabled = true; loopGo.textContent = "Generating…";
    statusEl.hidden = false; statusEl.textContent = "Finding a clean loop…";
    try {
      // Priority: a CLEAN loop (little backtracking) over an exact distance.
      // Phase 1 — rank several headings by backtrack at a base scale.
      const dir = loopDir.value;
      const headings = dir === "auto"
        ? [0, 60, 120, 180, 240, 300].map((h) => (h + Math.random() * 30) % 360)
        : [Number(dir) - 35, Number(dir), Number(dir) + 35];
      const cands: { heading: number; res: RouteResult; bt: number }[] = [];
      for (const h of headings) {
        const c = await build(h, 0.8);
        if (c) cands.push({ heading: h, res: c.res, bt: c.bt });
      }
      if (!cands.length) {
        statusEl.hidden = true; gpxBtn.hidden = true; result = null; setRoute(null);
        errorEl.hidden = false; errorEl.textContent = "Couldn't build a loop here — try another distance.";
        return;
      }
      // Lowest backtrack wins; distance is a tiebreaker.
      cands.sort((a, b) => (a.bt - b.bt) || (Math.abs(a.res.distanceM - targetM) - Math.abs(b.res.distanceM - targetM)));
      // For running, among the acceptably-clean candidates prefer the flattest
      // direction (ascent per km). The ring is placed geometrically, so the
      // per-way elevation penalty can't stop 'auto' sending the loop uphill —
      // choosing the flattest heading here does.
      const gradeOf = (c: { res: RouteResult }) => c.res.ascentM / Math.max(0.1, c.res.distanceM / 1000);
      let chosen = cands[0]!;
      if (profile === "running" && cands.length > 1) {
        const minBt = cands[0]!.bt;
        const clean = cands.filter((c) => c.bt <= minBt + 12);
        clean.sort((a, b) => gradeOf(a) - gradeOf(b));
        chosen = clean[0]!;
      }

      // Phase 2 — scale that heading toward the target, keeping backtrack low.
      let best: RouteResult | null = chosen.res, bestBt = chosen.bt;
      let scale = 0.8 * Math.min(1.6, Math.max(0.6, targetM / chosen.res.distanceM));
      statusEl.textContent = "Tuning distance…";
      for (let iter = 0; iter < 3; iter++) {
        scale = Math.min(2.5, Math.max(0.25, scale));
        const c = await build(chosen.heading, scale);
        if (!c) break;
        // Accept only if it doesn't get noticeably more backtracky.
        if (c.bt <= bestBt + 6) { best = c.res; bestBt = c.bt; }
        if (Math.abs(c.res.distanceM - targetM) / targetM < 0.12) break;
        scale *= Math.min(1.7, Math.max(0.6, targetM / c.res.distanceM));
      }
      if (!best) {
        statusEl.hidden = true; gpxBtn.hidden = true; result = null; setRoute(null);
        errorEl.hidden = false;
        errorEl.textContent = "Couldn't build a loop here — try another direction / distance.";
        return;
      }
      // Remove out-and-back spurs + small self-loops, then recompute stats.
      const origDist = best.distanceM;
      const trimmed = removeSmallLoops(trimSpurs(best.coords3d), 300);
      let dist = 0, asc = 0;
      for (let i = 1; i < trimmed.length; i++) {
        dist += hav(trimmed[i - 1]!, trimmed[i]!);
        const de = (trimmed[i]![2] ?? 0) - (trimmed[i - 1]![2] ?? 0);
        if (de > 0) asc += de;
      }
      best = {
        geometry: { type: "LineString", coordinates: trimmed.map((c) => [c[0]!, c[1]!]) },
        coords3d: trimmed,
        distanceM: dist,
        ascentM: asc,
        durationS: origDist > 0 ? Math.round(best.durationS * (dist / origDist)) : best.durationS,
      };

      result = best;
      setRoute({ type: "Feature", geometry: best.geometry, properties: {} });
      const off = Math.abs(best.distanceM - targetM) / targetM;
      const note = off > 0.2 ? ` (target ${loopDist.value} km — kept the loop clean)` : "";
      statusEl.textContent =
        `${fmtDistance(best.distanceM)} · ↑${Math.round(best.ascentM)} m · ${fmtDuration(best.durationS)}${note}`;
      gpxBtn.hidden = false;
      const lons = best.geometry.coordinates.map((c) => c[0]!);
      const lats = best.geometry.coordinates.map((c) => c[1]!);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 60, maxZoom: 15 });
    } finally {
      loopGo.disabled = false; loopGo.textContent = "Generate loop from start";
    }
  }

  // ── Shape run (GPS art) — auto-fit a template onto the running network ─────
  async function generateShape() {
    errorEl.hidden = true;
    if (wps.length < 1) {
      errorEl.hidden = false;
      errorEl.textContent = "Set a start point first (right-click → Route: set start).";
      return;
    }
    const start: [number, number] = [wps[0]!.lngLat.lng, wps[0]!.lngLat.lat];
    const targetM = Math.max(1, Number(shapeDist.value) || 5) * 1000;
    const profile = profileSel.value as RunProfile;
    const shape = shapeName.value as ShapeName;
    const keepUpright = shapeUpright.checked;

    shapeGo.disabled = true; shapeGo.textContent = "Searching…";
    statusEl.hidden = false; statusEl.textContent = "Loading map data…";
    shapeProgress.hidden = false; shapeBar.style.width = "0%";
    try {
      // Pull the local pedestrian network to pre-filter placements (best effort;
      // falls back to routing a coarse set if Overpass is unavailable).
      const rM = Math.min(8000, Math.max(1200, targetM * 0.35));
      const dLat = rM / 111320, dLon = rM / (111320 * Math.cos((start[1] * Math.PI) / 180));
      const bbox: Bbox = { s: start[1] - dLat, w: start[0] - dLon, n: start[1] + dLat, e: start[0] + dLon };
      const network = await fetchPedNetwork(bbox).catch(() => null);
      statusEl.textContent = network ? "Auto-fitting shape…" : "Auto-fitting shape (no prefilter)…";
      const { best } = await autoFitShape({
        start, shape, targetM, keepUpright, profile, route: fetchRoute, network,
        onProgress: (d, t) => { shapeBar.style.width = `${Math.round((100 * d) / t)}%`; },
      });
      if (!best) {
        setRoute(null); setShapeIdeal(null); result = null; gpxBtn.hidden = true;
        statusEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = "Couldn't fit a shape here — try a denser area, other distance or shape.";
        return;
      }
      result = best.res;
      setShapeIdeal(best.ideal);
      setRoute({ type: "Feature", geometry: best.res.geometry, properties: {} });
      statusEl.textContent =
        `${fmtDistance(best.res.distanceM)} · fit ±${Math.round(best.meanDev)} m · ↑${Math.round(best.res.ascentM)} m`;
      gpxBtn.hidden = false;
      const lons = best.res.geometry.coordinates.map((c) => c[0]!);
      const lats = best.res.geometry.coordinates.map((c) => c[1]!);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 60, maxZoom: 16 });
    } finally {
      shapeGo.disabled = false; shapeGo.textContent = "Auto-fit shape from start";
      shapeProgress.hidden = true;
    }
  }

  function applyMode() {
    const m = modeSel.value;
    loopCtl.hidden = m !== "loop";
    shapeCtl.hidden = m !== "shape";
    setRoute(null); setShapeIdeal(null); statusEl.hidden = true; errorEl.hidden = true; gpxBtn.hidden = true; result = null;
  }
  modeSel.addEventListener("change", applyMode);
  loopGo.addEventListener("click", () => void generateLoop());
  shapeGo.addEventListener("click", () => void generateShape());

  profileSel.addEventListener("change", () => {
    if (modeSel.value === "loop") void generateLoop();
    else if (modeSel.value === "ptp") void rebuild();
    // shape mode: the user re-runs via the Auto-fit button
  });
  clearBtn.addEventListener("click", clearAll);
  applyMode();

  addBtn.addEventListener("click", async () => {
    const q = searchInput.value.trim();
    if (!q) return;
    addBtn.disabled = true; addBtn.textContent = "…";
    try {
      const pt = await geocode(q);
      if (!pt) { errorEl.hidden = false; errorEl.textContent = `Not found: "${q}"`; return; }
      searchInput.value = "";
      addWp(new maplibregl.LngLat(pt[0], pt[1]));
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
    add(lngLat, r) {
      if (r === "start") addWp(lngLat, 0);
      else if (r === "end") addWp(lngLat, wps.length);
      else addWp(lngLat, wps.length >= 2 ? wps.length - 1 : wps.length);
    },
  };
}
