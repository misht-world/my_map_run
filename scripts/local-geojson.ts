#!/usr/bin/env node
/**
 * Local preview helper — build a normalized GeoJSON overlay for ONE area
 * directly from the Overpass API, without the osmium/tippecanoe/pmtiles
 * pipeline. Uses the exact same interpreter as the real tile build, so what
 * you see locally matches production.
 *
 * Usage:
 *   npx tsx scripts/local-geojson.ts <south> <west> <north> <east> <out.geojson>
 *
 * Example (central Budapest incl. Margaret Island & City Park):
 *   npx tsx scripts/local-geojson.ts 47.49 19.02 47.54 19.10 \
 *     packages/web/public/budapest-run.geojson
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { interpretFoot, interpretBarrier, interpretPoi, interpretTrack } from "@mmr/interpreter";
import type { TileProperties } from "@mmr/model";

const [s, w, n, e, outPath] = process.argv.slice(2);
if (!s || !w || !n || !e || !outPath) {
  console.error("Usage: tsx scripts/local-geojson.ts <south> <west> <north> <east> <out.geojson>");
  process.exit(1);
}
const bbox = `${s},${w},${n},${e}`; // Overpass order: south,west,north,east

const OVERPASS_ENDPOINTS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];

const query = `
[out:json][timeout:180];
(
  way["highway"](${bbox});
  way["leisure"="track"](${bbox});
  way["indoor"="corridor"](${bbox});
  relation["highway"](${bbox});
  relation["leisure"="track"](${bbox});
  node["barrier"](${bbox});
  node["access"~"^(no|private)$"](${bbox});
  node["foot"~"^(no|private)$"](${bbox});
  node["amenity"~"^(drinking_water|water_point|shelter|toilets|fountain)$"](${bbox});
  node["man_made"="water_tap"](${bbox});
  node["natural"="spring"](${bbox});
  node["tourism"~"^(picnic_site|viewpoint)$"](${bbox});
  node["shelter_type"](${bbox});
);
out geom tags;
`;

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
}

type Pt = [number, number];

/** Stitch member way segments into closed rings (best-effort ring assembly). */
function assembleRings(segments: Pt[][]): Pt[][] {
  const pool = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const rings: Pt[][] = [];
  const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
  while (pool.length) {
    let ring = pool.shift()!;
    let extended = true;
    while (extended && !same(ring[0]!, ring[ring.length - 1]!)) {
      extended = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i]!;
        const end = ring[ring.length - 1]!;
        if (same(s[0]!, end)) { ring = ring.concat(s.slice(1)); pool.splice(i, 1); extended = true; break; }
        if (same(s[s.length - 1]!, end)) { ring = ring.concat(s.slice().reverse().slice(1)); pool.splice(i, 1); extended = true; break; }
      }
    }
    if (ring.length >= 4) {
      if (!same(ring[0]!, ring[ring.length - 1]!)) ring.push(ring[0]!);
      rings.push(ring);
    }
  }
  return rings;
}

async function fetchOverpass(): Promise<{ elements?: OverpassElement[] }> {
  let lastErr = "";
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.error(`[local] querying ${url} …`);
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "my_map_run-local/0.1 (https://github.com/misht-world/my_map_run)",
          "Accept": "application/json",
        },
        body: "data=" + encodeURIComponent(query),
      });
      if (resp.ok) return (await resp.json()) as { elements?: OverpassElement[] };
      lastErr = `HTTP ${resp.status} from ${url}`;
      console.error(`[local] ${lastErr}, trying next endpoint…`);
    } catch (err) {
      lastErr = `${url}: ${(err as Error).message}`;
      console.error(`[local] ${lastErr}, trying next endpoint…`);
    }
  }
  throw new Error(`All Overpass endpoints failed. Last: ${lastErr}`);
}

async function main() {
  console.error(`[local] bbox ${bbox}`);
  const json = await fetchOverpass();
  const elements = json.elements ?? [];
  console.error(`[local] received ${elements.length} elements`);

  const features: GeoJSON.Feature[] = [];
  const counters = {
    line: { designated: 0, allowed: 0 },
    track: 0,
    area: 0,
    barrier: { blocked: 0, passable: 0 },
    poi: { water: 0, shelter: 0, viewpoint: 0, toilets: 0 },
  };

  for (const el of elements) {
    const tags = el.tags ?? {};
    let props: TileProperties | null = null;
    let geometry: GeoJSON.Geometry | null = null;

    if (el.type === "way" && el.geometry && el.geometry.length >= 2) {
      const track = interpretTrack(tags);
      const foot = interpretFoot(tags);
      if (track || foot.tier) {
        const tier = foot.tier ?? "designated";
        props = { osm_type: "way", osm_id: el.id, kind: "line", foot_tier: tier };
        if (foot.is_steps) props.is_steps = true;
        if (track) { props.is_track = true; counters.track++; }
        const isArea = tags["area"] === "yes";
        if (isArea) { props.is_area = true; counters.area++; }
        if (foot.tier) counters.line[foot.tier]++;
        const ring = el.geometry.map((p) => [p.lon, p.lat] as [number, number]);
        if (isArea) {
          const first = ring[0]!, last = ring[ring.length - 1]!;
          const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
          geometry = { type: "Polygon", coordinates: [closed] };
        } else {
          geometry = { type: "LineString", coordinates: ring };
        }
      }
    } else if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      const barrier = interpretBarrier(tags);
      if (barrier) {
        props = { osm_type: "node", osm_id: el.id, kind: "barrier", barrier_status: barrier.status };
        if (tags["barrier"]) props.barrier_kind = tags["barrier"];
        counters.barrier[barrier.status]++;
      } else {
        const poi = interpretPoi(tags);
        if (poi) {
          props = { osm_type: "node", osm_id: el.id, kind: "poi", poi_kind: poi };
          if (tags["name"]) props.name = tags["name"];
          counters.poi[poi]++;
        }
      }
      if (props) geometry = { type: "Point", coordinates: [el.lon, el.lat] };
    } else if (el.type === "relation" && el.members) {
      // Multipolygon areas (e.g. highway=pedestrian squares, leisure=track).
      const track = interpretTrack(tags);
      const foot = interpretFoot(tags);
      if (track || foot.tier) {
        const toSeg = (m: { geometry?: { lat: number; lon: number }[] }): Pt[] =>
          (m.geometry ?? []).map((p) => [p.lon, p.lat] as Pt);
        const outer = el.members.filter((m) => m.type === "way" && m.role !== "inner").map(toSeg);
        const inner = el.members.filter((m) => m.type === "way" && m.role === "inner").map(toSeg);
        const outerRings = assembleRings(outer);
        const innerRings = assembleRings(inner);
        if (outerRings.length) {
          const tier = foot.tier ?? "designated";
          props = { osm_type: "relation", osm_id: el.id, kind: "line", foot_tier: tier, is_area: true };
          counters.area++;
          if (track) { props.is_track = true; counters.track++; }
          if (foot.tier) counters.line[foot.tier]++;
          const coordinates = outerRings.length === 1
            ? [[outerRings[0]!, ...innerRings]]
            : outerRings.map((r) => [r]);
          geometry = { type: "MultiPolygon", coordinates: coordinates as GeoJSON.Position[][][] };
        }
      }
    }

    if (props && geometry) {
      features.push({ type: "Feature", geometry, properties: props as unknown as GeoJSON.GeoJsonProperties });
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ type: "FeatureCollection", features }));
  console.error(`[local] wrote ${features.length} features → ${outPath}`);
  console.error(`[local] ${JSON.stringify(counters)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
