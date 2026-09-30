#!/usr/bin/env bash
# Publish the built overlay to a GitHub Release (tag data-YYYY-MM-DD) — the
# same thing .github/workflows/data.yml does. The Pages deploy then copies the
# latest release assets next to the site (docs/HOSTING.md).
#
# The inverted overlay (only can't-run ways, tracks, steps, barriers, POI) is
# small; the guard below stops the upload if it ever nears GitHub's 2 GB
# release-asset limit.
#
# Requires: gh (GitHub CLI), authenticated.
set -euo pipefail

DATA_DIR="${DATA_DIR:-data}"
PMTILES="$DATA_DIR/europe-run.pmtiles"
EXTENT="$DATA_DIR/europe-extent.geojson"
TAG="${RELEASE_TAG:-data-$(date +%Y-%m-%d)}"
MAX_BYTES="${MAX_BYTES:-2000000000}"   # GitHub release-asset limit is 2 GiB

if [[ ! -f "$PMTILES" ]]; then
  echo "[publish] missing $PMTILES — run scripts/04-tile.sh first" >&2
  exit 1
fi

SIZE=$(stat -c %s "$PMTILES" 2>/dev/null || stat -f %z "$PMTILES")
echo "[publish] $PMTILES = $SIZE bytes (cap $MAX_BYTES)"
if [[ "$SIZE" -gt "$MAX_BYTES" ]]; then
  echo "[publish] ERROR: PMTiles exceeds the GitHub release-asset limit." >&2
  exit 1
fi

ASSETS=("$PMTILES")
[[ -f "$EXTENT" ]] && ASSETS+=("$EXTENT")

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
else
  gh release create "$TAG" --title "Data snapshot $TAG" \
    --notes "Running overlay built on $(date -u +%Y-%m-%dT%H:%M:%SZ)." \
    "${ASSETS[@]}"
fi

echo "[publish] published ${ASSETS[*]} to release $TAG"
