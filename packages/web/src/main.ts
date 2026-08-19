import maplibregl, { Map as MLMap, Popup } from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { TileProperties } from "@mmr/model";

import { config } from "./config.js";
import {
  overlayLayers,
  TRACK_LAYER_IDS, DESIGNATED_LAYER_IDS, ALLOWED_LAYER_IDS,
  BARRIER_BLOCKED_IDS, BARRIER_PASSABLE_IDS,
  WATER_LAYER_IDS, SHELTER_LAYER_IDS, VIEWPOINT_LAYER_IDS, TOILETS_LAYER_IDS,
  POI_COLOR,
} from "./layers.js";
import { makePoiIcon, makeBarrierIcon, type PoiIconKind } from "./icons.js";
import { parseCoords } from "./search.js";
import { parseHash, formatHash, type UrlState, type LayerState } from "./url-state.js";
import { renderPopup } from "./popup.js";

// ---------------------------------------------------------------------------
// PMTiles protocol
// ---------------------------------------------------------------------------
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// ---------------------------------------------------------------------------
// Toggle wiring — one table drives HTML ids, url-state keys and layer groups.
// ---------------------------------------------------------------------------
interface ToggleDef {
  key: keyof LayerState;
  el: HTMLInputElement;
  ids: readonly string[];
}
const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const toggles: ToggleDef[] = [
  { key: "tracks",           el: el("toggle-tracks"),     ids: TRACK_LAYER_IDS },
  { key: "designated",       el: el("toggle-designated"), ids: DESIGNATED_LAYER_IDS },
  { key: "allowed",          el: el("toggle-allowed"),    ids: ALLOWED_LAYER_IDS },
  { key: "barriers",         el: el("toggle-barriers"),   ids: BARRIER_BLOCKED_IDS },
  { key: "passableBarriers", el: el("toggle-passable"),   ids: BARRIER_PASSABLE_IDS },
  { key: "water",            el: el("toggle-water"),      ids: WATER_LAYER_IDS },
  { key: "shelter",          el: el("toggle-shelter"),    ids: SHELTER_LAYER_IDS },
  { key: "viewpoint",        el: el("toggle-viewpoint"),  ids: VIEWPOINT_LAYER_IDS },
  { key: "toilets",          el: el("toggle-toilets"),    ids: TOILETS_LAYER_IDS },
];

function currentLayerState(): LayerState {
  return toggles.reduce((acc, t) => { acc[t.key] = t.el.checked; return acc; }, {} as LayerState);
}

// ---------------------------------------------------------------------------
// Initial state from URL hash
// ---------------------------------------------------------------------------
const defaultState: UrlState = {
  zoom: config.defaultView.zoom,
  lat: config.defaultView.center[1],
  lon: config.defaultView.center[0],
  layers: {
    tracks: true, designated: true, allowed: true, barriers: true, passableBarriers: false,
    water: true, shelter: true, viewpoint: true, toilets: true,
  },
};
const initial = parseHash(window.location.hash, defaultState);
for (const t of toggles) t.el.checked = initial.layers[t.key];

// Persisted basemap style (survives F5).
const STYLE_KEY = "mmr:basemapStyle";
const savedStyle = (() => {
  try { return localStorage.getItem(STYLE_KEY) || config.basemapStyleUrl; }
  catch { return config.basemapStyleUrl; }
})();

// ---------------------------------------------------------------------------
// Basemap style resolution — OpenFreeMap vector URLs, plus an inline Esri
// World Imagery raster style for the "satellite" option (free, keyless).
// ---------------------------------------------------------------------------
function resolveStyle(value: string): string | maplibregl.StyleSpecification {
  if (value !== "satellite") return value;
  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      "esri-imagery": {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [{ id: "esri-imagery", type: "raster", source: "esri-imagery" }],
  };
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const map = new MLMap({
  container: "map",
  style: resolveStyle(savedStyle),
  center: [initial.lon, initial.lat],
  zoom: initial.zoom,
  attributionControl: { compact: true },
  dragRotate: false,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
}), "top-right");
// Scale bar — bottom-centre and wider (CSS centres the bottom-left slot).
map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 180 }), "bottom-left");

// Cache the extent GeoJSON so we don't refetch on every style switch.
let extentGeoJson: object | null = null;
async function loadExtent() {
  if (extentGeoJson) return extentGeoJson;
  try {
    const r = await fetch(config.extentUrl);
    if (!r.ok) return null;
    extentGeoJson = await r.json();
    return extentGeoJson;
  } catch { return null; }
}

// Re-add overlay on both initial load and every setStyle() (style.load fires
// for both; setStyle strips custom sources/layers).
const POI_KINDS: PoiIconKind[] = ["water", "shelter", "viewpoint", "toilets"];

function addOverlay() {
  // Register single-style POI icons + the blocked-barrier icon (idempotent
  // across style reloads, and independent of basemap glyph availability).
  for (const k of POI_KINDS) {
    const imgId = "poi-" + k;
    if (!map.hasImage(imgId)) {
      map.addImage(imgId, makePoiIcon(k, POI_COLOR).imageData, { pixelRatio: 2 });
    }
  }
  if (!map.hasImage("barrier-blocked-icon")) {
    map.addImage("barrier-blocked-icon", makeBarrierIcon().imageData, { pixelRatio: 2 });
  }

  // Dev/preview: a normalized GeoJSON overlay (single city) instead of PMTiles.
  // MapLibre ignores `source-layer` on GeoJSON sources, but we strip it anyway
  // so the layer specs stay valid for both source types.
  const useGeojson = config.geojsonUrl !== "";
  if (!map.getSource("run")) {
    if (useGeojson) {
      map.addSource("run", {
        type: "geojson",
        data: config.geojsonUrl,
        attribution: "© OpenStreetMap contributors (ODbL)",
      });
    } else {
      map.addSource("run", {
        type: "vector",
        url: "pmtiles://" + config.pmtilesUrl,
        attribution: "© OpenStreetMap contributors (ODbL)",
      });
    }
  }
  for (const layer of overlayLayers) {
    if (map.getLayer(layer.id)) continue;
    if (useGeojson) {
      const { "source-layer": _sl, ...rest } = layer as typeof layer & { "source-layer"?: string };
      map.addLayer(rest);
    } else {
      map.addLayer(layer);
    }
  }

  loadExtent().then((geo) => {
    if (!geo) return;
    if (!map.getSource("extent")) {
      map.addSource("extent", { type: "geojson", data: geo as never });
    }
    if (!map.getLayer("extent-outline")) {
      map.addLayer({
        id: "extent-outline",
        type: "line",
        source: "extent",
        paint: {
          "line-color": "#1a1a1a", "line-width": 2, "line-opacity": 0.4,
          "line-dasharray": [4, 3],
        },
      });
    }
  });

  applyLayerVisibility();
}
map.on("style.load", addOverlay);

// ---------------------------------------------------------------------------
// Layer toggles
// ---------------------------------------------------------------------------
function applyLayerVisibility() {
  for (const t of toggles) {
    const v = t.el.checked ? "visible" : "none";
    for (const id of t.ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
  }
  syncHash();
}
for (const t of toggles) t.el.addEventListener("change", applyLayerVisibility);

// ---------------------------------------------------------------------------
// Basemap style switcher — a top-right map control (layers-style button).
// Hovering/clicking the button reveals the basemap choices, like the
// familiar "layers" overlay control on other maps.
// ---------------------------------------------------------------------------
const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: "https://tiles.openfreemap.org/styles/positron", label: "Light" },
  { value: "https://tiles.openfreemap.org/styles/liberty",  label: "Detailed" },
  { value: "https://tiles.openfreemap.org/styles/bright",   label: "Bright" },
  { value: "satellite",                                     label: "Satellite" },
];
const LAYERS_ICON =
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>` +
  `<polyline points="2 17 12 22 22 17"></polyline>` +
  `<polyline points="2 12 12 17 22 12"></polyline></svg>`;

function makeStyleControl(): maplibregl.IControl {
  let container: HTMLElement;
  return {
    onAdd() {
      container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group style-ctrl";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = "Basemap style";
      btn.setAttribute("aria-label", "Basemap style");
      btn.className = "style-ctrl-btn";
      btn.innerHTML = LAYERS_ICON;

      const menu = document.createElement("div");
      menu.className = "style-ctrl-menu";
      menu.hidden = true;

      for (const o of STYLE_OPTIONS) {
        const label = document.createElement("label");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "basemap";
        radio.value = o.value;
        radio.checked = o.value === savedStyle;
        radio.addEventListener("change", () => {
          try { localStorage.setItem(STYLE_KEY, o.value); } catch { /* ignore */ }
          map.setStyle(resolveStyle(o.value), { diff: false });
          menu.hidden = true;
        });
        label.append(radio, document.createTextNode(" " + o.label));
        menu.appendChild(label);
      }

      btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
      document.addEventListener("click", (e) => {
        if (!container.contains(e.target as Node)) menu.hidden = true;
      });

      container.append(btn, menu);
      return container;
    },
    onRemove() { container.remove(); },
  };
}
map.addControl(makeStyleControl(), "top-right");

// ---------------------------------------------------------------------------
// Click → popup
// ---------------------------------------------------------------------------
const clickLayers = [
  "run-hitbox", "run-area-fill",
  ...BARRIER_BLOCKED_IDS, ...BARRIER_PASSABLE_IDS,
  ...WATER_LAYER_IDS, ...SHELTER_LAYER_IDS, ...VIEWPOINT_LAYER_IDS, ...TOILETS_LAYER_IDS,
];
const hoverLayers = clickLayers.filter((id) => id !== "run-hitbox" && id !== "run-area-fill");

map.on("click", (e) => {
  const features = map.queryRenderedFeatures(e.point, { layers: clickLayers });
  if (features.length === 0) return;
  // Prefer point features (barrier/POI) over the line hitbox when stacked.
  const preferred = features.find((f) => (f.properties as { kind?: string }).kind !== "line") ?? features[0]!;
  const props = preferred.properties as unknown as TileProperties;
  new Popup({ maxWidth: "300px" })
    .setLngLat(e.lngLat)
    .setDOMContent(renderPopup(props, e.lngLat))
    .addTo(map);
});
map.on("mouseenter", hoverLayers, () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", hoverLayers, () => { map.getCanvas().style.cursor = ""; });

// ---------------------------------------------------------------------------
// Coordinate search
// ---------------------------------------------------------------------------
const form = document.getElementById("coord-form") as HTMLFormElement;
const coordInput = document.getElementById("coord-input") as HTMLInputElement;
const coordError = document.getElementById("coord-error") as HTMLElement;
let searchMarker: maplibregl.Marker | null = null;

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const parsed = parseCoords(coordInput.value);
  if (!parsed) {
    coordError.textContent = "Could not parse coordinates. Try: 47.4979, 19.0402";
    coordError.hidden = false;
    return;
  }
  coordError.hidden = true;
  map.flyTo({ center: [parsed.lon, parsed.lat], zoom: Math.max(map.getZoom(), 14) });
  searchMarker?.remove();
  searchMarker = new maplibregl.Marker({ color: "#00897b" }).setLngLat([parsed.lon, parsed.lat]).addTo(map);
});

// ---------------------------------------------------------------------------
// Cursor coordinates + context menu (right-click / long-press → copy)
// ---------------------------------------------------------------------------
const cursorEl = document.getElementById("cursor-coords") as HTMLElement;
map.on("mousemove", (e) => {
  cursorEl.textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
});

// Live zoom readout so the user can reason about scale / layer thresholds.
const zoomBadge = document.getElementById("zoom-badge") as HTMLElement;
const updateZoomBadge = () => { zoomBadge.textContent = `z${map.getZoom().toFixed(1)}`; };
map.on("zoom", updateZoomBadge);
updateZoomBadge();

const ctxMenu = document.getElementById("map-ctx-menu") as HTMLElement;
let ctxLngLat: maplibregl.LngLat | null = null;
function showCtxMenu(lngLat: maplibregl.LngLat, x: number, y: number) {
  ctxLngLat = lngLat;
  const rect = map.getContainer().getBoundingClientRect();
  ctxMenu.style.left = `${x - rect.left}px`;
  ctxMenu.style.top = `${y - rect.top}px`;
  ctxMenu.hidden = false;
}
function hideCtxMenu() { ctxMenu.hidden = true; }
map.on("contextmenu", (e) => {
  e.preventDefault();
  showCtxMenu(e.lngLat, e.originalEvent.clientX, e.originalEvent.clientY);
});
map.on("click", hideCtxMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCtxMenu(); });

let longPressTimer: number | undefined;
let longPressPos = { x: 0, y: 0 };
map.getCanvas().addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0]!;
  longPressPos = { x: t.clientX, y: t.clientY };
  longPressTimer = window.setTimeout(() => {
    const rect = map.getContainer().getBoundingClientRect();
    const pt = map.unproject([longPressPos.x - rect.left, longPressPos.y - rect.top]);
    showCtxMenu(pt, longPressPos.x, longPressPos.y);
  }, 600);
}, { passive: true });
map.getCanvas().addEventListener("touchmove", () => window.clearTimeout(longPressTimer), { passive: true });
map.getCanvas().addEventListener("touchend", () => window.clearTimeout(longPressTimer), { passive: true });

ctxMenu.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-action]") as HTMLButtonElement | null;
  if (!btn || !ctxLngLat) return;
  hideCtxMenu();
  if (btn.dataset["action"] === "copy") {
    const text = `${ctxLngLat.lat.toFixed(5)}, ${ctxLngLat.lng.toFixed(5)}`;
    try { await navigator.clipboard.writeText(text); cursorEl.textContent = `Copied: ${text}`; }
    catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// URL hash sync
// ---------------------------------------------------------------------------
let hashTimer: number | undefined;
function syncHash() {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const c = map.getCenter();
    const next = formatHash({ zoom: map.getZoom(), lat: c.lat, lon: c.lng, layers: currentLayerState() });
    if (next !== window.location.hash) history.replaceState(null, "", next);
  }, 200);
}
map.on("moveend", syncHash);
map.on("zoomend", syncHash);

window.addEventListener("hashchange", () => {
  const s = parseHash(window.location.hash, defaultState);
  map.jumpTo({ center: [s.lon, s.lat], zoom: s.zoom });
  for (const t of toggles) t.el.checked = s.layers[t.key];
  applyLayerVisibility();
});

// ---------------------------------------------------------------------------
// Share link
// ---------------------------------------------------------------------------
const shareBtn = document.getElementById("share-link") as HTMLButtonElement;
shareBtn.addEventListener("click", async () => {
  window.clearTimeout(hashTimer);
  const c = map.getCenter();
  const hash = formatHash({ zoom: map.getZoom(), lat: c.lat, lon: c.lng, layers: currentLayerState() });
  const url = `${window.location.origin}${window.location.pathname}${hash}`;
  try {
    await navigator.clipboard.writeText(url);
    shareBtn.textContent = "Copied!";
    window.setTimeout(() => (shareBtn.textContent = "Copy shareable link"), 1500);
  } catch { shareBtn.textContent = "Copy failed"; }
});

// ---------------------------------------------------------------------------
// Version labels
// ---------------------------------------------------------------------------
const vApp = document.getElementById("v-app");
const vData = document.getElementById("v-data");
const vBuild = document.getElementById("v-build");
if (vApp) vApp.textContent = "v" + __APP_VERSION__;
if (vData) vData.textContent = config.dataDate || "unknown";
if (vBuild) vBuild.textContent = config.buildDate || "dev";

// Fill legend POI swatches with the exact same icons drawn on the map.
document.querySelectorAll<HTMLElement>(".sw-poi[data-poi]").forEach((elm) => {
  const kind = elm.dataset["poi"] as PoiIconKind;
  elm.style.backgroundImage = `url(${makePoiIcon(kind, POI_COLOR).dataUrl})`;
});

// ---------------------------------------------------------------------------
// Mobile panel toggle
// ---------------------------------------------------------------------------
const panel = document.getElementById("panel") as HTMLElement;
const panelToggle = document.getElementById("panel-toggle") as HTMLButtonElement;
if (window.matchMedia("(max-width: 600px)").matches) {
  panel.classList.add("collapsed");
  panelToggle.textContent = "☰";
}
panelToggle.addEventListener("click", () => {
  panel.classList.toggle("collapsed");
  panelToggle.textContent = panel.classList.contains("collapsed") ? "☰" : "✕";
});
