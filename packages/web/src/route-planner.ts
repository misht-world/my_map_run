import maplibregl, { type Map as MLMap, type LngLat } from "maplibre-gl";
import {
  fetchRoute, geocode, toGpx, fmtDistance, fmtDuration,
  PROFILE_LABELS, type RunProfile, type RouteResult,
} from "./routing.js";

interface WayPoint { lngLat: LngLat; marker: maplibregl.Marker; dot: HTMLElement; }

/** Point at bearing (deg, 0=N,90=E) and distance (m) from [lon,lat]. */
function destPoint(lon: number, lat: number, bearingDeg: number, distM: number): [number, number] {
  const R = 6371000, br = (bearingDeg * Math.PI) / 180, d = distM / R;
  const φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br));
  const λ2 = λ1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI];
}
function distM(a: [number, number], b: [number, number]): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
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

  // Populate the profile selector.
  for (const key of ["running", "trail"] as RunProfile[]) {
    const o = document.createElement("option");
    o.value = key; o.textContent = PROFILE_LABELS[key];
    profileSel.appendChild(o);
  }

  const wps: WayPoint[] = [];
  let result: RouteResult | null = null;

  const routeSource = () => map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  const setRoute = (geo: GeoJSON.Feature | null) =>
    routeSource()?.setData({ type: "FeatureCollection", features: geo ? [geo] : [] });

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
    const heading = loopDir.value === "auto" ? Math.random() * 360 : Number(loopDir.value);
    const profile = profileSel.value as RunProfile;

    loopGo.disabled = true; loopGo.textContent = "Generating…";
    statusEl.hidden = false; statusEl.textContent = "Building loop…";
    try {
      let scale = 0.78, best: RouteResult | null = null, bestErr = Infinity;
      for (let iter = 0; iter < 6; iter++) {
        const r = (targetM / (2 * Math.PI)) * scale;
        const center = destPoint(start[0], start[1], heading, r);
        const tri = [0, 120, 240].map((a) => destPoint(center[0], center[1], heading + a, r));
        // order nearest → farthest → other so the loop heads out and back
        const sorted = tri.map((p) => ({ p, d: distM(start, p) })).sort((x, y) => x.d - y.d);
        const ordered = [sorted[0]!.p, sorted[2]!.p, sorted[1]!.p];
        const res = await fetchRoute([start, ...ordered, start], profile);
        if (!res) { scale *= 1.15; continue; }
        const err = Math.abs(res.distanceM - targetM) / targetM;
        if (err < bestErr) { bestErr = err; best = res; }
        if (err < 0.1) break;
        scale *= Math.min(2, Math.max(0.5, targetM / res.distanceM));
        scale = Math.min(2.5, Math.max(0.25, scale));
      }
      if (!best) {
        statusEl.hidden = true; gpxBtn.hidden = true; result = null; setRoute(null);
        errorEl.hidden = false;
        errorEl.textContent = "Couldn't build a loop here — try another direction / distance.";
        return;
      }
      result = best;
      setRoute({ type: "Feature", geometry: best.geometry, properties: {} });
      statusEl.textContent =
        `${fmtDistance(best.distanceM)} · ↑${Math.round(best.ascentM)} m · ${fmtDuration(best.durationS)}`;
      gpxBtn.hidden = false;
      const lons = best.geometry.coordinates.map((c) => c[0]!);
      const lats = best.geometry.coordinates.map((c) => c[1]!);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 60, maxZoom: 15 });
    } finally {
      loopGo.disabled = false; loopGo.textContent = "Generate loop from start";
    }
  }

  function applyMode() {
    const loop = modeSel.value === "loop";
    loopCtl.hidden = !loop;
    setRoute(null); statusEl.hidden = true; errorEl.hidden = true; gpxBtn.hidden = true; result = null;
  }
  modeSel.addEventListener("change", applyMode);
  loopGo.addEventListener("click", () => void generateLoop());

  profileSel.addEventListener("change", () => { modeSel.value === "loop" ? void generateLoop() : void rebuild(); });
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
