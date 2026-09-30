/**
 * Core data model for the running map.
 *
 * Design goals (mirrors the sister project my_map-toll):
 *   - Raw OSM tags remain the source of truth (kept out of tiles, fetched
 *     lazily from Overpass on popup click).
 *   - Normalized statuses drive rendering and stay cheap to embed in tiles.
 *   - Tiles carry only the exceptions a runner needs (can't-run ways, tracks,
 *     steps, barriers, POI); routing is done in the browser (docs/ROUTING.md).
 */

// ---------------------------------------------------------------------------
// No-run ways (inverted policy)
//
// We do NOT draw the runnable network any more — the basemap shows walkable
// paths. We only overlay the ways you CANNOT run on, as a warning (red
// dashed): not-built ways (construction/proposed/…), foot=no|private|
// use_sidepath, access=no|private|customers, or a motorway/trunk.
// `foot=yes|designated|permissive` overrides (except for not-built ways).
// Runnable ways are simply not emitted; the route planner picks the route.
// ---------------------------------------------------------------------------

export interface NoRunResult {
  blocked: boolean;
  reason: NoRunReasonCode | null;
}

export const NoRunReason = {
  FOOT_FORBIDDEN: "foot=no|private|use_sidepath",
  ACCESS_FORBIDDEN: "access=no|private|customers",
  MOTORWAY: "highway=motorway|trunk",
  CONSTRUCTION: "highway=construction|proposed|disused|abandoned",
} as const;
export type NoRunReasonCode = (typeof NoRunReason)[keyof typeof NoRunReason];

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
  /** True for a way you cannot run on (foot/access ban, motorway) → red dashed. */
  blocked?: boolean;
  is_steps?: boolean;
  /** True for a dedicated running track (leisure=track). Rendered distinctly. */
  is_track?: boolean;
  /** True for an `area=yes` / polygon feature. Rendered as a thin white outline. */
  is_area?: boolean;

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
  no_run: NoRunResult;
}
