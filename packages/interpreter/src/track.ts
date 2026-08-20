import { type OsmTags } from "@mmr/model";

/**
 * Is this a dedicated running / athletics track? We require `leisure=track`
 * together with `sport=running` (or `athletics`). Without an explicit running
 * sport, `leisure=track` also covers ski slopes, horse/cycle tracks, etc., so
 * we don't show those.
 */
export function interpretTrack(tags: OsmTags): boolean {
  if (tags["leisure"] !== "track") return false;
  const sport = tags["sport"];
  if (!sport) return false;
  const parts = sport.split(/[;,]/).map((p) => p.trim().toLowerCase());
  return parts.some((p) => p === "running" || p === "athletics");
}
