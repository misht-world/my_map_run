#!/usr/bin/env node
/**
 * Stream GeoJSONSeq from osmium → enriched GeoJSONSeq for tippecanoe.
 *
 * Input (stdin):  one GeoJSON Feature per line, properties = raw OSM tags,
 *                 plus osmium-injected `@id` / Feature.id ("w123"/"n123"/"r123").
 * Output (stdout): one GeoJSON Feature per line with normalized TileProperties:
 *                  { osm_type, osm_id, kind, foot_tier?, is_steps?,
 *                    barrier_status?, barrier_kind?, poi_kind?, name? }
 *
 * Three feature families are emitted:
 *   - line    : runnable ways (LineString/MultiLineString) → foot_tier
 *   - barrier : gate/stile/… nodes (Point)                → barrier_status
 *   - poi     : water/shelter/viewpoint/toilets nodes (Point)
 *
 * Everything else is dropped. Counts go to stderr on completion.
 *
 * Usage:
 *   npx tsx src/normalize.ts < raw.geojsonseq > enriched.geojsonseq
 */

import { createInterface } from "node:readline";
import { stdin, stdout, stderr } from "node:process";
import { interpretFoot, interpretBarrier, interpretPoi, interpretTrack } from "@mmr/interpreter";
import type { TileProperties } from "@mmr/model";


interface InputFeature {
  type: "Feature";
  id?: string | number;
  geometry: { type?: string } | null;
  properties: Record<string, string | number> & {
    "@id"?: string | number;
    "@type"?: string;
  };
}

const counters = {
  total: 0,
  emitted: 0,
  parseErrors: 0,
  line: { designated: 0, allowed: 0 },
  track: 0,
  area: 0,
  barrier: { blocked: 0, passable: 0 },
  poi: { water: 0, shelter: 0, viewpoint: 0, toilets: 0 },
};

/**
 * Per-feature tile min-zoom. Keeping the whole European pedestrian network at
 * every zoom explodes tile size (a naive build produced 14 GB). Revealing
 * feature classes progressively as you zoom in keeps low-zoom tiles sparse
 * (small files) and matches how the data is actually used — you don't need
 * every footway visible at country scale. tippecanoe reads `feature.tippecanoe`.
 */
function tileMinZoom(props: TileProperties): number {
  if (props.is_track) return 7;               // running tracks — the core, show early
  if (props.kind === "barrier") return 12;    // gates/✕ only when zoomed in
  if (props.kind === "poi") return 12;        // water/shelter/… only when zoomed in
  if (props.is_area) return 11;
  if (props.foot_tier === "allowed") return 11; // quiet roads — the bulk
  return 10;                                   // designated pedestrian ways
}

stderr.write("[normalize] starting…\n");

const rl = createInterface({ input: stdin, crlfDelay: Infinity });

for await (const line of rl) {
  // GeoJSONSeq (RFC 8142) prefixes each record with ASCII Record Separator
  // 0x1E. Strip it (and surrounding whitespace) before parsing.
  const cleaned = line.replace(/^\x1e/, "").trim();
  if (!cleaned) continue;
  counters.total++;

  let feat: InputFeature;
  try {
    feat = JSON.parse(cleaned);
  } catch {
    counters.parseErrors++;
    continue;
  }

  const rawProps = feat.properties ?? {};

  // Parse "w123"/"n123"/"r123" (osmium --add-unique-id=type_id) into
  // separate osm_type + numeric id.
  let osmType: "way" | "relation" | "node" = "way";
  let osmId = 0;
  const featId = feat.id ?? rawProps["@id"];
  if (typeof featId === "string") {
    const prefix = featId[0];
    if (prefix === "r") osmType = "relation";
    else if (prefix === "n") osmType = "node";
    else osmType = "way";
    osmId = parseInt(featId.slice(1), 10) || 0;
  } else if (typeof featId === "number") {
    osmId = featId;
  }

  // Build a clean string-only tag map.
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    if (k.startsWith("@")) continue;
    if (typeof v === "string") tags[k] = v;
    else if (typeof v === "number") tags[k] = String(v);
  }

  if (counters.total === 1) {
    stderr.write(`[normalize] first feature id: ${JSON.stringify(feat.id)}\n`);
    stderr.write(`[normalize] first feature keys: ${JSON.stringify(Object.keys(rawProps))}\n`);
  }

  const geomType = feat.geometry?.type ?? "";
  const isLineLike = geomType === "LineString" || geomType === "MultiLineString"
    || geomType === "Polygon" || geomType === "MultiPolygon";
  const isPoint = geomType === "Point";
  const isAreaFeature = geomType === "Polygon" || geomType === "MultiPolygon" || tags["area"] === "yes";

  let props: TileProperties | null = null;
  let outGeometry: unknown = feat.geometry;

  if (isLineLike) {
    // A dedicated running track (leisure=track) is the "core" of the map and
    // may not carry a highway tag — check it independently of interpretFoot.
    const track = interpretTrack(tags);
    const foot = interpretFoot(tags);
    if (track || foot.tier) {
      const tier = foot.tier ?? "designated";
      props = { osm_type: osmType, osm_id: osmId, kind: "line", foot_tier: tier };
      if (foot.is_steps) props.is_steps = true;
      if (track) { props.is_track = true; counters.track++; }
      // Areas keep their Polygon geometry so the web style can fill them
      // (translucent). Track areas fall through to the track line layer.
      if (isAreaFeature) { props.is_area = true; counters.area++; }
      if (foot.tier) counters.line[foot.tier]++;
      // outGeometry stays feat.geometry (LineString or Polygon as osmium gave it)
    }
  } else if (isPoint) {
    // Barrier takes precedence over POI (a blocked gate matters more than a
    // co-located amenity, and they rarely overlap).
    const barrier = interpretBarrier(tags);
    if (barrier) {
      props = {
        osm_type: osmType, osm_id: osmId, kind: "barrier",
        barrier_status: barrier.status,
      };
      if (tags["barrier"]) props.barrier_kind = tags["barrier"];
      counters.barrier[barrier.status]++;
    } else {
      const poi = interpretPoi(tags);
      if (poi) {
        props = { osm_type: osmType, osm_id: osmId, kind: "poi", poi_kind: poi };
        if (tags["name"]) props.name = tags["name"];
        counters.poi[poi]++;
      }
    }
  }

  if (!props) continue;

  counters.emitted++;
  // NOTE: per-feature tippecanoe.minzoom temporarily disabled while
  // diagnosing mass feature dropping in the tile build. tileMinZoom() kept
  // for re-introduction once the root cause is confirmed.
  void tileMinZoom;
  stdout.write(JSON.stringify({
    type: "Feature",
    geometry: outGeometry,
    properties: props,
  }) + "\n");
}

stderr.write(`[normalize] done. ${JSON.stringify(counters)}\n`);
