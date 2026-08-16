import type { LayerSpecification } from "maplibre-gl";

const SOURCE = "run";
const SOURCE_LAYER = "run";

// Layer-ID groups exposed for toggle logic in main.ts.
export const DESIGNATED_LAYER_IDS = ["run-designated-casing", "run-designated", "run-steps"] as const;
export const ALLOWED_LAYER_IDS    = ["run-allowed"] as const;
export const BARRIER_BLOCKED_IDS  = ["barrier-blocked"] as const;
export const BARRIER_PASSABLE_IDS = ["barrier-passable"] as const;
export const WATER_LAYER_IDS      = ["poi-water"] as const;
export const SHELTER_LAYER_IDS    = ["poi-shelter"] as const;
export const VIEWPOINT_LAYER_IDS  = ["poi-viewpoint"] as const;
export const TOILETS_LAYER_IDS    = ["poi-toilets"] as const;

// Palette — bright, high-contrast on the muted Positron basemap, and
// distinct from the red barrier cross.
export const COLORS = {
  runnable: "#00c2a8", // turquoise — "you can run here"
  steps:    "#00695c", // darker teal dash overlay
  blocked:  "#d50000", // red ✕
  passable: "#9e9e9e",
  water:    "#1e88e5",
  shelter:  "#6d4c41",
  viewpoint:"#8e24aa",
  toilets:  "#00897b",
} as const;

const line = { type: "line" as const, source: SOURCE, "source-layer": SOURCE_LAYER, minzoom: 6 };
const point = { source: SOURCE, "source-layer": SOURCE_LAYER } as const;

export const overlayLayers: LayerSpecification[] = [

  // ── Allowed tier (quiet roads, no confirmed sidewalk) — dim, drawn first ──
  {
    ...line, id: "run-allowed",
    filter: ["==", ["get", "foot_tier"], "allowed"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.runnable,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 2.5, 16, 4],
      "line-opacity": 0.4,
    },
  },

  // ── Designated tier — bright line with a white casing for contrast ────────
  {
    ...line, id: "run-designated-casing",
    filter: ["==", ["get", "foot_tier"], "designated"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 5.5, 16, 9],
      "line-opacity": 0.7,
    },
  },
  {
    ...line, id: "run-designated",
    filter: ["==", ["get", "foot_tier"], "designated"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.runnable,
      "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 12, 3.2, 16, 6],
      "line-opacity": 0.95,
    },
  },

  // ── Steps overlay — dashed, on top of the runnable line ───────────────────
  {
    ...line, id: "run-steps",
    minzoom: 13,
    filter: ["to-boolean", ["get", "is_steps"]],
    layout: { "line-cap": "butt" },
    paint: {
      "line-color": COLORS.steps,
      "line-width": ["interpolate", ["linear"], ["zoom"], 13, 3, 16, 6],
      "line-dasharray": [1, 1],
      "line-opacity": 0.95,
    },
  },

  // ── Invisible wide hit-area for easy line clicking (esp. mobile) ──────────
  {
    ...line, id: "run-hitbox",
    filter: ["in", ["get", "foot_tier"], ["literal", ["designated", "allowed"]]],
    paint: { "line-color": "#000000", "line-width": 18, "line-opacity": 0 },
  },

  // ── Passable barriers — small grey dot, off by default ────────────────────
  {
    ...point, id: "barrier-passable", type: "circle", minzoom: 13,
    filter: ["all", ["==", ["get", "kind"], "barrier"], ["==", ["get", "barrier_status"], "passable"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 16, 5],
      "circle-color": COLORS.passable,
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 1,
      "circle-opacity": 0.85,
    },
  },

  // ── Runner POI circles ────────────────────────────────────────────────────
  {
    ...point, id: "poi-water", type: "circle", minzoom: 12,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "water"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7],
      "circle-color": COLORS.water,
      "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.95,
    },
  },
  {
    ...point, id: "poi-shelter", type: "circle", minzoom: 12,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "shelter"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7],
      "circle-color": COLORS.shelter,
      "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.95,
    },
  },
  {
    ...point, id: "poi-viewpoint", type: "circle", minzoom: 12,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "viewpoint"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7],
      "circle-color": COLORS.viewpoint,
      "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.95,
    },
  },
  {
    ...point, id: "poi-toilets", type: "circle", minzoom: 12,
    filter: ["all", ["==", ["get", "kind"], "poi"], ["==", ["get", "poi_kind"], "toilets"]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 7],
      "circle-color": COLORS.toilets,
      "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.95,
    },
  },

  // ── Blocked barriers — red ✕, drawn on top of everything ──────────────────
  // Uses the basemap glyph set (Noto) via text-field, so no sprite needed.
  {
    ...point, id: "barrier-blocked", type: "symbol", minzoom: 12,
    filter: ["all", ["==", ["get", "kind"], "barrier"], ["==", ["get", "barrier_status"], "blocked"]],
    layout: {
      "text-field": "✕",
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 12, 16, 20],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": COLORS.blocked,
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.6,
    },
  },
];
