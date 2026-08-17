import { type OsmTags } from "@mmr/model";

// Sports that clearly are NOT running tracks (motorsport, cycling ovals, etc.).
const NON_RUNNING_SPORTS = new Set([
  "motor", "karting", "cycling", "bmx", "motocross", "horse_racing",
  "horse", "ice_skating", "dog_racing", "greyhound_racing", "speedway",
]);

/**
 * Is this feature a dedicated running / athletics track (the "core" of a
 * running map)? Matches `leisure=track` unless it is explicitly a non-running
 * sport track. Running / athletics / multi (or no sport tag) all qualify.
 */
export function interpretTrack(tags: OsmTags): boolean {
  if (tags["leisure"] !== "track") return false;
  const sport = tags["sport"];
  if (!sport) return true; // bare leisure=track is almost always athletics
  const parts = sport.split(/[;,]/).map((p) => p.trim().toLowerCase());
  if (parts.some((p) => p === "running" || p === "athletics" || p === "multi")) return true;
  if (parts.some((p) => NON_RUNNING_SPORTS.has(p))) return false;
  return true; // unknown sport → keep (benefit of the doubt)
}
