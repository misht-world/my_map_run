#!/usr/bin/env bash
# Normalize filtered OSM data and build PMTiles.
#
# Requires: osmium-tool, tippecanoe, pmtiles (go-pmtiles CLI), node 20+.
#
# Input:  data/europe-filtered.osm.pbf
# Output: data/europe-run.pmtiles
set -euo pipefail

DATA_DIR="${DATA_DIR:-data}"
IN="$DATA_DIR/europe-filtered.osm.pbf"
GEOJSONSEQ="$DATA_DIR/europe-enriched.geojsonseq"
MBTILES="$DATA_DIR/europe-run.mbtiles"
PMTILES="$DATA_DIR/europe-run.pmtiles"

if [[ ! -f "$IN" ]]; then
  echo "[tile] missing $IN — run scripts/02-filter.sh first" >&2
  exit 1
fi

echo "[tile] normalizing tags → enriched GeoJSONSeq"
osmium export "$IN" -f geojsonseq --add-unique-id=type_id --overwrite \
  | npx tsx packages/tile-builder/src/normalize.ts \
  > "$GEOJSONSEQ"

echo "[tile] tippecanoe → mbtiles"
# Layer name 'run' is referenced by the web style (packages/web/src/layers.ts).
# The runnable network needs higher zoom than the toll map: -Z6 -z14.
# Keep EVERY feature — no dropping. BOTH --no-tile-size-limit AND
# --no-feature-limit are required: with only the byte cap off, dense city
# tiles still hit the 200k-features/tile cap and tippecanoe drops globally.
# The full tileset is hosted on Cloudflare R2 (docs/HOSTING.md), not GitHub.
# maxzoom z12 keeps it inside R2's free tier; per-feature minzoom (normalize.ts)
# keeps low zooms small. Browser overzooms for close-up detail.
tippecanoe \
  --force \
  --layer=run \
  --minimum-zoom=6 \
  --maximum-zoom=12 \
  --no-tile-size-limit \
  --no-feature-limit \
  --simplification=10 \
  --read-parallel \
  --attribute-type=osm_id:int \
  -o "$MBTILES" \
  "$GEOJSONSEQ"

echo "[tile] mbtiles → pmtiles"
pmtiles convert --force "$MBTILES" "$PMTILES"
rm -f "$MBTILES"

echo "[tile] done: $(du -h "$PMTILES" | cut -f1)"
