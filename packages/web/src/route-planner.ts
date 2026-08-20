import maplibregl, { type Map as MLMap, type LngLat } from "maplibre-gl";
import {
  fetchRoute, geocode, toGpx, fmtDistance, fmtDuration,
  PROFILE_LABELS, type RunProfile, type RouteResult,
} from "./routing.js";

interface WayPoint { lngLat: LngLat; marker: maplibregl.Marker; dot: HTMLElement; }

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

  profileSel.addEventListener("change", () => void rebuild());
  clearBtn.addEventListener("click", clearAll);

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
