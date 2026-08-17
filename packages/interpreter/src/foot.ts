import { type OsmTags, type FootResult, FootReason } from "@mmr/model";

// Highways that are never runnable — fast, high-speed motor roads.
const MOTOR_ONLY = new Set([
  "motorway", "motorway_link", "trunk", "trunk_link",
]);

// Not-yet-built / decommissioned highway values → no line.
const NON_ROAD = new Set([
  "construction", "proposed", "planned", "razed",
  "abandoned", "disused", "no", "elevator", "escalator",
]);

// Explicitly-for-pedestrians highway classes → `designated` tier.
const DESIGNATED_HW = new Set([
  "footway", "path", "pedestrian", "steps", "track", "bridleway",
  "corridor", "via_ferrata",
]);

// Quiet vehicle roads where foot is legal but not confirmed by a sidewalk
// → `allowed` tier (dimmer, separate toggle).
const ALLOWED_HW = new Set([
  "residential", "living_street", "service", "unclassified",
  "tertiary", "tertiary_link", "road", "cycleway",
]);

const footAllows = (foot: string | undefined): boolean =>
  foot === "yes" || foot === "designated" || foot === "permissive";

const footForbids = (foot: string | undefined): boolean =>
  foot === "no" || foot === "private" || foot === "use_sidepath";

/** True when the way itself carries a mapped sidewalk (not `no`/`separate`). */
function hasSidewalk(tags: OsmTags): boolean {
  const s = tags["sidewalk"];
  if (s && (s === "yes" || s === "both" || s === "left" || s === "right")) {
    return true;
  }
  for (const k of ["sidewalk:both", "sidewalk:left", "sidewalk:right"]) {
    const v = tags[k];
    if (v && v !== "no" && v !== "none" && v !== "separate") return true;
  }
  return false;
}

/**
 * Interpret OSM tags of a way into a runnable-path result.
 *
 * Returns `{ tier: null }` when the way is not runnable (the caller drops it
 * from the overlay). See docs/TAG_INTERPRETATION.md for rationale.
 */
export function interpretFoot(tags: OsmTags): FootResult {
  const highway = tags["highway"];
  const foot = tags["foot"];
  const access = tags["access"];
  const indoor = tags["indoor"];

  // Corridors (indoor connecting passages) are useful running links and are
  // kept even when tagged indoor — via highway=corridor or indoor=corridor.
  const isCorridor = highway === "corridor" || indoor === "corridor";

  if (!highway && !isCorridor) {
    return { tier: null, is_steps: false, reason: FootReason.NOT_HIGHWAY };
  }
  if (highway && NON_ROAD.has(highway)) {
    return { tier: null, is_steps: false, reason: FootReason.NOT_BUILT };
  }
  // Indoor ways are excluded — except corridors (see above).
  if (indoor === "yes" && !isCorridor) {
    return { tier: null, is_steps: false, reason: FootReason.INDOOR };
  }
  // Moving walkways / escalators.
  if (tags["conveying"] !== undefined && tags["conveying"] !== "no") {
    return { tier: null, is_steps: false, reason: FootReason.CONVEYING };
  }

  // A hard foot ban overrides everything else.
  if (footForbids(foot)) {
    return { tier: null, is_steps: false, reason: FootReason.FOOT_FORBIDDEN };
  }

  const is_steps = highway === "steps";
  const footOk = footAllows(foot);

  // Motorways/trunks: no pedestrians unless foot is explicitly allowed (rare).
  if (highway && MOTOR_ONLY.has(highway)) {
    if (footOk) {
      return { tier: "allowed", is_steps, reason: FootReason.FOOT_DESIGNATED };
    }
    return { tier: null, is_steps: false, reason: FootReason.MOTORWAY };
  }

  // access=no/private with no foot override → not runnable.
  if ((access === "no" || access === "private") && !footOk) {
    return { tier: null, is_steps: false, reason: FootReason.ACCESS_FORBIDDEN };
  }

  // ── Positive classification, most-confident first ────────────────────────
  const sidewalk = hasSidewalk(tags);

  if (footOk) {
    return { tier: "designated", is_steps, reason: FootReason.FOOT_DESIGNATED };
  }
  if (isCorridor) {
    return { tier: "designated", is_steps, reason: FootReason.DESIGNATED_HIGHWAY };
  }
  if (highway && DESIGNATED_HW.has(highway)) {
    return { tier: "designated", is_steps, reason: FootReason.DESIGNATED_HIGHWAY };
  }
  if (sidewalk) {
    return { tier: "designated", is_steps, reason: FootReason.HAS_SIDEWALK };
  }
  if (highway && ALLOWED_HW.has(highway)) {
    return { tier: "allowed", is_steps, reason: FootReason.ALLOWED_DEFAULT };
  }

  // Busy roads (primary/secondary and their links) without a sidewalk, and
  // anything else → not shown. Runners should avoid these by default.
  return { tier: null, is_steps: false, reason: FootReason.NOT_RUNNABLE };
}
