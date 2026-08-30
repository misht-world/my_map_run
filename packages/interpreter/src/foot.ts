import { type OsmTags, type NoRunResult, NoRunReason } from "@mmr/model";

// Big motor roads pedestrians can't run on.
const MOTOR_ONLY = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link",
]);

// Ways that don't physically exist as a usable path yet / any more. Blocked
// regardless of foot=* (a construction footway with foot=designated is the
// PLANNED state — you still can't walk it today).
const NOT_BUILT = new Set([
  "construction", "proposed", "disused", "abandoned", "razed", "planned",
]);

// service=* spurs we never show at all (neither as no-run nor otherwise).
const EXCLUDED_SERVICE = new Set([
  "driveway", "parking_aisle", "alley", "drive-through", "drive_through",
]);

const footAllows = (foot: string | undefined): boolean =>
  foot === "yes" || foot === "designated" || foot === "permissive";

/**
 * Policy (inverted): we no longer draw the whole runnable network — the
 * basemap shows walkable paths. Instead we overlay only the ways you
 * **cannot** run on, as a warning (red dashed). Everything runnable is
 * simply not emitted. Routing (later) decides the actual route.
 *
 * Returns `{ blocked: true }` for a way a runner cannot use:
 *   - foot = no / private / use_sidepath, or
 *   - access = no / private / customers (without a foot override), or
 *   - a motorway / trunk (+links).
 * `foot = yes|designated|permissive` overrides everything → not blocked.
 * Driveways / parking aisles / alleys are never emitted.
 */
export function interpretNoRun(tags: OsmTags): NoRunResult {
  const highway = tags["highway"];
  if (!highway) return { blocked: false, reason: null };

  const service = tags["service"];
  if (highway === "service" && service !== undefined && EXCLUDED_SERVICE.has(service)) {
    return { blocked: false, reason: null };
  }

  const foot = tags["foot"];
  const access = tags["access"];

  // Not-yet-built / no-longer-there ways: blocked even with foot=designated.
  if (NOT_BUILT.has(highway)) {
    return { blocked: true, reason: NoRunReason.CONSTRUCTION };
  }

  // A positive foot permission means you CAN run — never a warning.
  if (footAllows(foot)) return { blocked: false, reason: null };

  if (foot === "no" || foot === "private" || foot === "use_sidepath") {
    return { blocked: true, reason: NoRunReason.FOOT_FORBIDDEN };
  }
  if (access === "no" || access === "private" || access === "customers") {
    return { blocked: true, reason: NoRunReason.ACCESS_FORBIDDEN };
  }
  if (MOTOR_ONLY.has(highway)) {
    return { blocked: true, reason: NoRunReason.MOTORWAY };
  }
  return { blocked: false, reason: null };
}
