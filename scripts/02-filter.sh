#!/usr/bin/env bash
# Filter the raw OSM extract down to objects relevant to the running map:
#   - all highway=* ways         → runnable-path classification (normalize.ts)
#   - barrier nodes              → blocked / passable markers
#   - access/foot restriction nodes → blocked markers
#   - runner POI nodes           → water / shelter / viewpoint / toilets
#
# osmium tags-filter keeps the nodes referenced by matched ways by default,
# so way geometry is preserved for `osmium export`.
#
# Requires: osmium-tool
#
# Input:  data/europe-latest.osm.pbf
# Output: data/europe-filtered.osm.pbf
set -euo pipefail

DATA_DIR="${DATA_DIR:-data}"
IN="$DATA_DIR/europe-latest.osm.pbf"
OUT="$DATA_DIR/europe-filtered.osm.pbf"

if [[ ! -f "$IN" ]]; then
  echo "[filter] missing $IN — run scripts/01-fetch.sh first" >&2
  exit 1
fi

echo "[filter] osmium tags-filter"
osmium tags-filter --overwrite -o "$OUT" "$IN" \
  w/highway \
  w/leisure=track \
  r/leisure=track \
  n/barrier \
  n/access=no \
  n/access=private \
  n/foot=no \
  n/foot=private \
  n/amenity=drinking_water \
  n/amenity=water_point \
  n/amenity=shelter \
  n/amenity=toilets \
  n/amenity=fountain \
  n/man_made=water_tap \
  n/natural=spring \
  n/tourism=picnic_site \
  n/tourism=viewpoint \
  n/shelter_type

echo "[filter] done: $(du -h "$OUT" | cut -f1)"
