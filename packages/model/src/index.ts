/**
 * Core data model for the running map.
 *
 * Design goals (mirrors the sister project my_map-toll):
 *   - Raw OSM tags remain the source of truth (kept out of tiles, fetched
 *     lazily from Overpass on popup click).
 *   - Normalized statuses drive rendering and stay cheap to embed in tiles.
 *   - The model is prepared "to grow": a future routing engine reads the
 *     same normalized `foot_tier` / `is_steps` fields (see docs/ROUTING.md).
 */

// ---------------------------------------------------------------------------
// Runnable ways — confidence tiers
//
// `designated` — explicitly meant for / open to pedestrians (footway, path,
//   pedestrian, steps, track, bridleway; or foot=yes|designated|permissive;
//   or a road with a mapped sidewalk). Rendered as a bright line, on by default.
//
// `allowed` — foot access is not forbidden but not confirmed by a sidewalk
//   (quiet roads: residential, living_street, service, unclassified, tertiary,
//   cycleway). Rendered dimmer, behind its own toggle. This is the
//   "you can run here, but it isn't mapped as pedestrian" tier.
//
// A way that is neither (motorway/trunk, foot=no, access=private without a
// foot override, primary/secondary without a sidewalk, not-yet-built roads)
// produces `null` and is dropped from the overlay.
// ---------------------------------------------------------------------------

export type FootTier = "designated" | "allowed";

export interface FootResult {
  /** Rendering tier, or null when the way is not runnable (drop it). */
  tier: FootTier | null;
  /** True for highway=steps — rendered as a dashed overlay; a future
   *  "avoid stairs" routing profile keys off this. */
  is_steps: boolean;
  /** Stable code explaining the decision (for popup + audits). */
  reason: FootReasonCode | null;
}

export const FootReason = {
  FOOT_DESIGNATED: "foot=designated|yes|permissive",
  DESIGNATED_HIGHWAY: "highway=footway|path|pedestrian|steps|track|bridleway",
  HAS_SIDEWALK: "sidewalk=yes|both|left|right",
  ALLOWED_DEFAULT: "quiet_road+foot_not_forbidden",
  // Exclusion reasons (tier === null)
  NOT_HIGHWAY: "no highway tag",
  NOT_BUILT: "construction|proposed|abandoned|razed|disused",
  FOOT_FORBIDDEN: "foot=no|private|use_sidepath",
  MOTORWAY: "highway=motorway|trunk (no pedestrians)",
  ACCESS_FORBIDDEN: "access=no|private (no foot override)",
  NOT_RUNNABLE: "busy road without sidewalk / not pedestrian",
} as const;
export type FootReasonCode = (typeof FootReason)[keyof typeof FootReason];

// ---------------------------------------------------------------------------
// Barriers (nodes) — gates / stiles / turnstiles etc.
// ---------------------------------------------------------------------------

export type BarrierStatus =
  | "blocked"   // no pedestrian access → red ✕
  | "passable"; // barrier exists but foot can pass (dimmer, off by default)

export interface BarrierResult {
  status: BarrierStatus;
  reason: BarrierReasonCode;
}

export const BarrierReason = {
  FOOT_FORBIDDEN: "foot=no|private",
  ACCESS_FORBIDDEN: "access=no|private (no foot override)",
  BARRIER_PASSABLE: "barrier present, foot can pass",
} as const;
export type BarrierReasonCode = (typeof BarrierReason)[keyof typeof BarrierReason];

// ---------------------------------------------------------------------------
// Points of interest for runners (nodes)
// ---------------------------------------------------------------------------

export type PoiKind = "water" | "shelter" | "viewpoint" | "toilets";

// ---------------------------------------------------------------------------
// Tile properties — the only fields embedded into the overlay PMTiles.
// ---------------------------------------------------------------------------

export interface TileProperties {
  osm_type: "way" | "relation" | "node";
  osm_id: number;
  /** Discriminator between the three feature families. */
  kind: "line" | "barrier" | "poi";

  // kind === "line"
  foot_tier?: FootTier;
  is_steps?: boolean;

  // kind === "barrier"
  barrier_status?: BarrierStatus;
  /** Raw barrier=* value (gate, stile, …) for the popup. */
  barrier_kind?: string;

  // kind === "poi"
  poi_kind?: PoiKind;

  /** OSM name=* when present (POI labels). */
  name?: string;
}

export type OsmTags = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------
// Segment — logical model consumed by the future routing adapter.
// Only a subset reaches the vector tiles (see TileProperties above).
// ---------------------------------------------------------------------------

export interface Segment {
  osm_type: "way" | "relation";
  osm_id: number;
  foot: FootResult;
}
