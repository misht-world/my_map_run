import { type OsmTags, type BarrierResult, BarrierReason } from "@mmr/model";

// Barrier node types we surface. Gates/stiles/turnstiles etc. — anything a
// runner may hit on a path. `kerb` is intentionally excluded (too common,
// rarely blocks pedestrians).
const TRACKED_BARRIERS = new Set([
  "gate", "stile", "kissing_gate", "turnstile", "full-height_turnstile",
  "cattle_grid", "bollard", "block", "chain", "lift_gate", "swing_gate",
  "hampshire_gate", "wicket_gate", "sally_port", "hedge", "fence",
  "wall", "sliding_gate", "log", "debris",
]);

const footAllows = (foot: string | undefined): boolean =>
  foot === "yes" || foot === "designated" || foot === "permissive";

/**
 * Interpret a node's tags into a barrier result, or null when the node is
 * not a runner-relevant obstacle.
 *
 *   blocked  → foot=no|private, or access=no|private without a foot override.
 *   passable → a tracked barrier that a pedestrian can pass.
 */
export function interpretBarrier(tags: OsmTags): BarrierResult | null {
  const barrier = tags["barrier"];
  const foot = tags["foot"];
  const access = tags["access"];

  const footBanned = foot === "no" || foot === "private";
  const accessBanned = access === "no" || access === "private";
  const footOk = footAllows(foot);

  const isTrackedBarrier = barrier !== undefined && TRACKED_BARRIERS.has(barrier);

  // Only emit for a real barrier node, or a standalone access/foot ban node.
  if (!isTrackedBarrier && !footBanned && !accessBanned) return null;

  if (footBanned) {
    return { status: "blocked", reason: BarrierReason.FOOT_FORBIDDEN };
  }
  if (accessBanned && !footOk) {
    return { status: "blocked", reason: BarrierReason.ACCESS_FORBIDDEN };
  }

  // A barrier that a pedestrian can pass (or default-open). Non-barrier nodes
  // that reached here (foot=yes on an access node) are not obstacles → drop.
  if (!isTrackedBarrier) return null;
  return { status: "passable", reason: BarrierReason.BARRIER_PASSABLE };
}
