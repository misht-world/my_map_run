#!/usr/bin/env bash
# Publish the built PMTiles to a GitHub Release.
#
# Requires: gh (GitHub CLI), authenticated (`gh auth login`).
#
# The release tag is derived from today's date (data-YYYY-MM-DD). If the
# release already exists, the asset is uploaded with --clobber.
set -euo pipefail

DATA_DIR="${DATA_DIR:-data}"
PMTILES="$DATA_DIR/europe-run.pmtiles"
TAG="${RELEASE_TAG:-data-$(date +%Y-%m-%d)}"

if [[ ! -f "$PMTILES" ]]; then
  echo "[publish] missing $PMTILES — run scripts/04-tile.sh first" >&2
  exit 1
fi

if ! gh release view "$TAG" >/dev/null 2>&1; then
  echo "[publish] creating release $TAG"
  gh release create "$TAG" --title "Data snapshot $TAG" \
    --notes "PMTiles running overlay built from europe-latest.osm.pbf on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
fi

echo "[publish] uploading $PMTILES to release $TAG"
gh release upload "$TAG" "$PMTILES" --clobber

echo "[publish] done. Public URL:"
gh release view "$TAG" --json assets -q '.assets[].url'
