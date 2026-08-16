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
import { interpretFoot, interpretBarrier, interpretPoi } from "@mmr/interpreter";
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
  barrier: { blocked: 0, passable: 0 },
  poi: { water: 0, shelter: 0, viewpoint: 0, toilets: 0 },
};

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
  const isLine = geomType === "LineString" || geomType === "MultiLineString";
  const isPoint = geomType === "Point";

  let props: TileProperties | null = null;

  if (isLine) {
    // Runnable way?
    const foot = interpretFoot(tags);
    if (foot.tier) {
      props = { osm_type: osmType, osm_id: osmId, kind: "line", foot_tier: foot.tier };
      if (foot.is_steps) props.is_steps = true;
      counters.line[foot.tier]++;
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
  stdout.write(JSON.stringify({ type: "Feature", geometry: feat.geometry, properties: props }) + "\n");
}

stderr.write(`[normalize] done. ${JSON.stringify(counters)}\n`);
