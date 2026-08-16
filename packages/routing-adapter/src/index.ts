/**
 * Routing adapter — intentionally a stub in the MVP (see docs/ROUTING.md).
 *
 * This package pins the architectural boundary between the data/normalization
 * layer and a future foot-routing engine. The chosen engine is **BRouter**
 * (keyless, free, profile-scriptable — it can block `highway=steps` and
 * penalize elevation, which maps directly to the planned
 * "avoid stairs" / "avoid steep slopes" runner options).
 *
 * Keeping the interface here now means:
 *   - the engine choice stays swappable,
 *   - tile-builder / web never depend on a routing engine,
 *   - adding routing (point-to-point, round-trip with target distance,
 *     draggable waypoints) is a self-contained change.
 */

/** Prebuilt BRouter profiles surfaced to the user as checkboxes. */
export type RunProfile =
  | "running"            // default foot profile tuned for running
  | "running-no-stairs"  // blocks highway=steps
  | "running-flat";      // heavy uphill/downhill cost to avoid steep slopes

export interface RouteRequest {
  /** [lon, lat] waypoints in order. */
  waypoints: [number, number][];
  profile: RunProfile;
  /** For round trips: target loop distance in metres. */
  targetDistanceM?: number;
}

export interface RouteResult {
  geometry: GeoJSON.LineString;
  distanceM: number;
  ascentM?: number;
}

/**
 * Compute a foot route. Not implemented in the MVP.
 */
export function computeRoute(_req: RouteRequest): Promise<RouteResult> {
  throw new Error("computeRoute is not implemented in the MVP. See docs/ROUTING.md.");
}
