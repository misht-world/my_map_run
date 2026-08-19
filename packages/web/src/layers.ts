import type { LayerSpecification, ExpressionSpecification } from "maplibre-gl";

const SOURCE = "run";
const SOURCE_LAYER = "run";

// Layer-ID groups exposed for toggle logic in main.ts.
export const TRACK_LAYER_IDS      = ["run-track-casing", "run-track"] as const;
export const DESIGNATED_LAYER_IDS = ["run-designated-casing", "run-designated", "run-area-fill", "run-area", "run-steps"] as const;
export const ALLOWED_LAYER_IDS    = ["run-allowed"] as const;
export const BARRIER_BLOCKED_IDS  = ["barrier-blocked"] as const;
export const BARRIER_PASSABLE_IDS = ["barrier-passable"] as const;
export const WATER_LAYER_IDS      = ["poi-water"] as const;
export const SHELTER_LAYER_IDS    = ["poi-shelter"] as const;
export const VIEWPOINT_LAYER_IDS  = ["poi-viewpoint"] as const;
export const TOILETS_LAYER_IDS    = ["poi-toilets"] as const;

// All four POI markers share ONE colour and style; only the pictogram differs.
export const POI_COLOR = "#37474f"; // blue-grey chip

export const COLORS = {
  runnable: "#7c1fff", // vivid violet — reads on light, dark, satellite & parks
  track:    "#ff6d00", // deep orange — dedicated running tracks (the core)
  steps:    "#000000", // black dashes for stairs
  area:     "#7c1fff", // translucent fill for area=yes (same hue as runnable)
  blocked:  "#d50000", // red ✕
  passable: "#e53935", // red dots for passable barriers
} as const;

// The overlay only shows once you've zoomed in to a place (z12+) — at lower
// zooms the whole network is an unreadable mess, and the tiles only exist at
// z12 anyway. POI/barriers already start at z12, so lines match them.
const line = { type: "line" as const, source: SOURCE, "source-layer": SOURCE_LAYER, minzoom: 12 };
const point = { source: SOURCE, "source-layer": SOURCE_LAYER } as const;

const notArea: ExpressionSpecification = ["!", ["to-boolean", ["get", "is_area"]]];
const notTrack: ExpressionSpecification = ["!", ["to-boolean", ["get", "is_track"]]];

export const overlayLayers: LayerSpecification[] = [

  // ── Allowed tier (quiet roads, no confirmed sidewalk) — dim, drawn first ──
  {
    ...line, id: "run-allowed", minzoom: 16,
    filter: ["all", ["==", ["get", "foot_tier"], "allowed"], notArea, notTrack],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.runnable,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 1.2, 16, 2],
      "line-opacity": 0.4,
    },
  },

  // ── Designated tier — thin bright line with a subtle white casing ─────────
  {
    ...line, id: "run-designated-casing", minzoom: 15,
    filter: ["all", ["==", ["get", "foot_tier"], "designated"], notArea, notTrack],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 12, 2.6, 16, 4],
      "line-opacity": 0.6,
    },
  },
  {
    ...line, id: "run-designated", minzoom: 15,
    filter: ["all", ["==", ["get", "foot_tier"], "designated"], notArea, notTrack],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.runnable,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.9, 12, 1.8, 16, 3],
      "line-opacity": 0.95,
    },
  },

  // ── Areas (pedestrian squares etc.) — translucent fill + thin outline ─────
  {
    ...point, id: "run-area-fill", type: "fill", minzoom: 16,
    filter: ["all", ["to-boolean", ["get", "is_area"]], notTrack],
    paint: {
      "fill-color": COLORS.area,
      "fill-opacity": 0.22,
    },
  },
  {
    ...line, id: "run-area", minzoom: 16,
    filter: ["all", ["to-boolean", ["get", "is_area"]], notTrack],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.area,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.2, 16, 1.8],
      "line-opacity": 0.75,
    },
  },

  // ── Running tracks (leisure=track) — the core, drawn bold on top ──────────
  {
    ...line, id: "run-track-casing", minzoom: 14,
    filter: ["to-boolean", ["get", "is_track"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.4, 12, 4, 16, 6],
      "line-opacity": 0.7,
    },
  },
  {
    ...line, id: "run-track", minzoom: 14,
    filter: ["to-boolean", ["get", "is_track"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.track,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.4, 12, 2.6, 16, 4],
      "line-opacity": 0.95,
    },
  },

  // ── Steps overlay — wider, sparse black dashes ────────────────────────────
  {
    ...line, id: "run-steps",
    minzoom: 15,
    filter: ["to-boolean", ["get", "is_steps"]],
    layout: { "line-cap": "butt" },
    paint: {
      "line-color": COLORS.steps,
      "line-width": ["interpolate", ["linear"], ["zoom"], 13, 4, 16, 7],
      "line-dasharray": [0.5, 1],
      "line-opacity": 0.9,
    },
  },

  // ── Invisible wide hit-area for easy line clicking (esp. mobile) ──────────
  {
    ...line, id: "run-hitbox", minzoom: 13,
    filter: ["==", ["get", "kind"], "line"],
    paint: { "line-color": "#000000", "line-width": 16, "line-opacity": 0 },
  },

  // ── Passable barriers — small grey dot, off by default ────────────────────
  {
    ...point, id: "barrier-passable", type: "circle", minzoom: 16,
    filter: ["all", ["==", ["get", "kind"], "barrier"], ["==", ["get", "barrier_status"], "passable"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 16, 4.5],
      "circle-color": COLORS.passable,
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.95,
    },
  },

  // ── Runner POI — single-style icon markers (icons registered in main.ts) ──
  {
    ...point, id: "poi-water", type: "symbol", minzoom: 13,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "water"]],
    layout: poiIcon("poi-water"),
  },
  {
    ...point, id: "poi-shelter", type: "symbol", minzoom: 13,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "shelter"]],
    layout: poiIcon("poi-shelter"),
  },
  {
    ...point, id: "poi-viewpoint", type: "symbol", minzoom: 13,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "viewpoint"]],
    layout: poiIcon("poi-viewpoint"),
  },
  {
    ...point, id: "poi-toilets", type: "symbol", minzoom: 13,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "toilets"]],
    layout: poiIcon("poi-toilets"),
  },

  // ── Blocked barriers — red ✕ icon (drawn in main.ts), on top of everything ─
  {
    ...point, id: "barrier-blocked", type: "symbol", minzoom: 16,
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
