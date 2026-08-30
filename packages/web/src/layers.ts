import type { LayerSpecification, ExpressionSpecification } from "maplibre-gl";

const SOURCE = "run";
const SOURCE_LAYER = "run";

// Layer-ID groups exposed for toggle logic in main.ts.
export const BLOCKED_LAYER_IDS    = ["run-blocked-casing", "run-blocked"] as const;
export const TRACK_LAYER_IDS      = ["run-track-casing", "run-track"] as const;
export const STEPS_LAYER_IDS      = ["run-steps"] as const;
export const BARRIER_BLOCKED_IDS  = ["barrier-blocked"] as const;
export const BARRIER_PASSABLE_IDS = ["barrier-passable"] as const;
export const WATER_LAYER_IDS      = ["poi-water"] as const;
export const SHELTER_LAYER_IDS    = ["poi-shelter"] as const;
export const VIEWPOINT_LAYER_IDS  = ["poi-viewpoint"] as const;
export const TOILETS_LAYER_IDS    = ["poi-toilets"] as const;

// All four POI markers share ONE colour and style; only the pictogram differs.
export const POI_COLOR = "#37474f"; // blue-grey chip

export const COLORS = {
  noRun:    "#e53935", // red dashed — you cannot run here
  track:    "#ff6d00", // deep orange — dedicated running tracks
  steps:    "#000000", // black rungs for stairs
  blocked:  "#d50000", // red ✕ (blocked barrier)
  passable: "#e53935", // red dots (passable barrier)
} as const;

const line = { type: "line" as const, source: SOURCE, "source-layer": SOURCE_LAYER, minzoom: 12 };
const point = { source: SOURCE, "source-layer": SOURCE_LAYER, minzoom: 12 } as const;

const isBlocked: ExpressionSpecification = ["to-boolean", ["get", "blocked"]];
const isTrack: ExpressionSpecification = ["to-boolean", ["get", "is_track"]];
const isSteps: ExpressionSpecification = ["to-boolean", ["get", "is_steps"]];

export const overlayLayers: LayerSpecification[] = [

  // ── No-run ways (foot/access ban, motorway) — red dashed warning ──────────
  // White solid casing underneath so the red dashes stand out on busy
  // basemaps (Landscape/CyclOSM).
  {
    ...line, id: "run-blocked-casing",
    filter: ["all", isBlocked, ["!", isSteps]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3.6, 16, 6.5],
      "line-opacity": 0.85,
    },
  },
  {
    ...line, id: "run-blocked",
    filter: ["all", isBlocked, ["!", isSteps]],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-color": COLORS.noRun,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.8, 16, 3.4],
      "line-dasharray": [2.4, 1.8],
      "line-opacity": 1,
    },
  },

  // ── Running tracks (leisure=track) — bold orange with a white casing ──────
  {
    ...line, id: "run-track-casing",
    filter: isTrack,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4, 16, 7],
      "line-opacity": 0.75,
    },
  },
  {
    ...line, id: "run-track",
    filter: isTrack,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.track,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.6, 16, 4.5],
      "line-opacity": 0.95,
    },
  },

  // ── Steps / stairs — dense black rungs ────────────────────────────────────
  {
    ...line, id: "run-steps",
    filter: ["all", isSteps, ["!", isBlocked]],
    layout: { "line-cap": "butt" },
    paint: {
      "line-color": COLORS.steps,
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4, 18, 13],
      "line-dasharray": [0.35, 0.45],
      "line-opacity": 1,
    },
  },

  // ── Invisible wide hit-area for easy line clicking ────────────────────────
  {
    ...line, id: "run-hitbox",
    filter: ["==", ["get", "kind"], "line"],
    paint: { "line-color": "#000000", "line-width": 16, "line-opacity": 0 },
  },

  // ── Passable barriers — red dots (off by default) ─────────────────────────
  {
    ...point, id: "barrier-passable", type: "circle",
    filter: ["all", ["==", ["get", "kind"], "barrier"], ["==", ["get", "barrier_status"], "passable"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 16, 4.5],
      "circle-color": COLORS.passable,
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.95,
    },
  },

  // ── Runner POI — single-style icon markers (icons registered in main.ts) ──
  {
    ...point, id: "poi-water", type: "symbol",
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "water"]],
    layout: poiIcon("poi-water"),
  },
  {
    ...point, id: "poi-shelter", type: "symbol",
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "shelter"]],
    layout: poiIcon("poi-shelter"),
  },
  {
    ...point, id: "poi-viewpoint", type: "symbol",
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "viewpoint"]],
    layout: poiIcon("poi-viewpoint"),
  },
  {
    ...point, id: "poi-toilets", type: "symbol",
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "toilets"]],
    layout: poiIcon("poi-toilets"),
  },

  // ── Shape-run ideal outline — faint dashed target, under the route ────────
  {
    id: "shape-ideal-line", type: "line", source: "shape-ideal",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#7a7a7a",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 16, 2.5],
      "line-dasharray": [2, 2],
      "line-opacity": 0.7,
    },
  },

  // ── Planned route (BRouter) — blue line with white casing, on top ─────────
  {
    id: "route-casing", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 12],
      "line-opacity": 0.9,
    },
  },
  {
    id: "route-line", type: "line", source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#1565c0",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
      "line-opacity": 0.95,
    },
  },

  // ── Blocked barriers — red ✕ icon (drawn in main.ts), on top ──────────────
  {
    ...point, id: "barrier-blocked", type: "symbol",
    filter: ["all", ["==", ["get", "kind"], "barrier"], ["==", ["get", "barrier_status"], "blocked"]],
    layout: {
      "icon-image": "barrier-blocked-icon",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 0.9],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  },
];

function poiIcon(image: string): LayerSpecification["layout"] {
  return {
    "icon-image": image,
    "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 1.05],
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
}
