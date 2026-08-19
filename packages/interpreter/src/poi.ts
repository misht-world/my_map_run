import { type OsmTags, type PoiKind } from "@mmr/model";

/**
 * Classify a node as a runner-relevant point of interest, or null.
 *
 * Priority: water first (most useful mid-run), then shelter, viewpoint,
 * toilets. A node matching several categories takes the first.
 */
export function interpretPoi(tags: OsmTags): PoiKind | null {
  // Indoor POI (inside buildings, e.g. a mall drinking fountain) aren't
  // useful for an outdoor running map.
  if (tags["indoor"] === "yes") return null;

  const amenity = tags["amenity"];
  const tourism = tags["tourism"];
  const manMade = tags["man_made"];
  const natural = tags["natural"];

  // ── Drinking water ───────────────────────────────────────────────────────
  if (amenity === "drinking_water" || amenity === "water_point") return "water";
  if (manMade === "water_tap" && tags["drinking_water"] !== "no") return "water";
  if (natural === "spring" && tags["drinking_water"] === "yes") return "water";
  // A fountain is only water if explicitly potable.
  if (amenity === "fountain" && tags["drinking_water"] === "yes") return "water";

  // ── Shelter / gazebo / picnic shelter ─────────────────────────────────────
  if (amenity === "shelter") return "shelter";
  if (tags["shelter_type"]) return "shelter";
  if (tourism === "picnic_site") return "shelter";

  // ── Viewpoint ─────────────────────────────────────────────────────────────
  if (tourism === "viewpoint") return "viewpoint";

  // ── Toilets ───────────────────────────────────────────────────────────────
  if (amenity === "toilets") return "toilets";

  return null;
}
