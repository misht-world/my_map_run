#!/usr/bin/env node
/**
 * Remove short dead-end spurs from the enriched runnable lines.
 *
 * A "spur" is a short line whose endpoint is not shared with any other
 * runnable line (endpoint degree 1). Because non-runnable roads, driveways,
 * excluded ways and blocked gates are NOT emitted as runnable lines, a
 * footway that merely bumps into one of them also has a degree-1 endpoint —
 * so this naturally covers "ends at a road / no-access gate" too.
 *
 * Two passes over a FILE (not a stream, so we can read it twice):
 *   Pass 1: count runnable-line endpoints in a fixed-size saturating hash
 *           table (bounded memory; hash collisions only ever *inflate* a
 *           count, so a spur may be missed but a through-path is never wrongly
 *           removed — safe/conservative).
 *   Pass 2: drop a line if it is shorter than DEADEND_MAX_M and at least one
 *           endpoint has degree 1. Everything else passes through unchanged.
 *
 * Usage: tsx prune-deadends.ts <in.geojsonseq> <out.geojsonseq>
 * Env:   DEADEND_MAX_M (default 30) — set 0 to disable (pass-through).
 */

import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { stderr } from "node:process";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  stderr.write("Usage: tsx prune-deadends.ts <in.geojsonseq> <out.geojsonseq>\n");
  process.exit(1);
}
const MAX_M = Number(process.env["DEADEND_MAX_M"] ?? "30");

const SIZE = 1 << 28; // 268M slots, 256 MB Uint8Array
const counts = new Uint8Array(SIZE);

function idx(lon: number, lat: number): number {
  // OSM node coords are exact, so ways sharing a node hash identically.
  const x = Math.round(lon * 1e7) | 0;
  const y = Math.round(lat * 1e7) | 0;
  let h = (Math.imul(x, 2654435761) ^ Math.imul(y, 40503)) >>> 0;
  return h % SIZE;
}
function bump(i: number) { if (counts[i]! < 255) counts[i]!++; }

interface Feat {
  geometry: { type?: string; coordinates?: number[][] } | null;
  properties?: { kind?: string; is_track?: boolean; is_area?: boolean };
}

/** A line eligible for spur pruning: a plain runnable LineString (not a
 *  track, not an area). Returns [ [lon,lat] endpoints, lengthMetres ] or null. */
function eligible(f: Feat): { a: number[]; b: number[]; len: number } | null {
  const p = f.properties ?? {};
  if (p.kind !== "line" || p.is_track || p.is_area) return null;
  const g = f.geometry;
  if (!g || g.type !== "LineString" || !g.coordinates || g.coordinates.length < 2) return null;
  const c = g.coordinates;
  const a = c[0]!, b = c[c.length - 1]!;
  if (a[0] === b[0] && a[1] === b[1]) return null; // closed loop — not a spur
  // Length (short-circuit once past the threshold).
  let len = 0;
  for (let i = 1; i < c.length; i++) {
    len += haversine(c[i - 1]!, c[i]!);
    if (len >= MAX_M) break;
  }
  return { a, b, len };
}

function haversine(p: number[], q: number[]): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (q[1]! - p[1]!) * toR, dLon = (q[0]! - p[0]!) * toR;
  const lat1 = p[1]! * toR, lat2 = q[1]! * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function forEachLine(path: string, fn: (line: string) => void) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const cleaned = line.replace(/^\x1e/, "").trim();
    if (cleaned) fn(cleaned);
  }
}

async function main() {
  if (!(MAX_M > 0)) {
    // Disabled — just copy through.
    await forEachLine(inPath!, () => {});
    stderr.write("[prune] DEADEND_MAX_M=0 → disabled; copying is caller's job\n");
    process.exit(0);
  }

  stderr.write(`[prune] pass 1: counting endpoints (max spur ${MAX_M} m)…\n`);
  await forEachLine(inPath!, (raw) => {
    let f: Feat;
    try { f = JSON.parse(raw); } catch { return; }
    const g = f.geometry;
    if (!g || g.type !== "LineString" || !g.coordinates || g.coordinates.length < 2) return;
    const p = f.properties ?? {};
    if (p.kind !== "line" || p.is_track || p.is_area) return;
    const c = g.coordinates;
    bump(idx(c[0]![0]!, c[0]![1]!));
    bump(idx(c[c.length - 1]![0]!, c[c.length - 1]![1]!));
  });

  stderr.write("[prune] pass 2: dropping short spurs…\n");
  const out = createWriteStream(outPath!);
  let total = 0, dropped = 0;
  await forEachLine(inPath!, (raw) => {
    total++;
    let f: Feat;
    try { f = JSON.parse(raw); } catch { out.write(raw + "\n"); return; }
    const e = eligible(f);
    if (e && e.len < MAX_M) {
      const da = counts[idx(e.a[0]!, e.a[1]!)]! === 1;
      const db = counts[idx(e.b[0]!, e.b[1]!)]! === 1;
      if (da || db) { dropped++; return; } // short + dangling → drop
    }
    out.write(raw + "\n");
  });
  await new Promise<void>((r) => out.end(r));
  stderr.write(`[prune] done. total ${total}, dropped spurs ${dropped}\n`);
}

main().catch((e) => { stderr.write(String(e) + "\n"); process.exit(1); });
