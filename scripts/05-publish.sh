#!/usr/bin/env bash
# Publish the built PMTiles to Cloudflare R2, and the tiny extent to a GitHub
# Release (version/date marker + coverage outline).
#
# The full tileset is a few GB — far over GitHub's 2 GB release-asset limit —
# so it lives on R2 (S3-compatible). See docs/HOSTING.md for one-time setup.
#
# Requires (for the R2 upload): aws-cli, and env vars
#   R2_ACCOUNT_ID, R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# Requires (for the release): gh (GitHub CLI), authenticated.
set -euo pipefail

DATA_DIR="${DATA_DIR:-data}"
PMTILES="$DATA_DIR/europe-run.pmtiles"
EXTENT="$DATA_DIR/europe-extent.geojson"
TAG="${RELEASE_TAG:-data-$(date +%Y-%m-%d)}"
R2_MAX_BYTES="${R2_MAX_BYTES:-9000000000}"   # guard: stay under R2 free 10 GB

if [[ ! -f "$PMTILES" ]]; then
  echo "[publish] missing $PMTILES — run scripts/04-tile.sh first" >&2
  exit 1
fi

# ── Size guard — never exceed the R2 free-tier budget ──────────────────────
SIZE=$(stat -c %s "$PMTILES" 2>/dev/null || stat -f %z "$PMTILES")
echo "[publish] $PMTILES = $SIZE bytes (cap $R2_MAX_BYTES)"
if [[ "$SIZE" -gt "$R2_MAX_BYTES" ]]; then
  echo "[publish] ERROR: PMTiles exceeds R2 budget. Lower maximum-zoom or raise per-feature minzoom, then rebuild." >&2
  exit 1
fi

# ── Upload tiles to R2 ─────────────────────────────────────────────────────
if [[ -n "${R2_ACCOUNT_ID:-}" && -n "${R2_BUCKET:-}" && -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
  echo "[publish] uploading $PMTILES to R2 bucket $R2_BUCKET"
  AWS_DEFAULT_REGION=auto \
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
  AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
  aws s3 cp "$PMTILES" "s3://${R2_BUCKET}/europe-run.pmtiles" \
    --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
    --content-type application/octet-stream --no-progress
else
  echo "[publish] R2 env vars not set — skipping R2 upload (see docs/HOSTING.md)"
fi

# ── Publish extent + version to GitHub Release ─────────────────────────────
if [[ -f "$EXTENT" ]]; then
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    gh release create "$TAG" --title "Data snapshot $TAG" \
      --notes "Running overlay built on $(date -u +%Y-%m-%dT%H:%M:%SZ). Tiles hosted on Cloudflare R2." \
      "$EXTENT"
  else
    gh release upload "$TAG" "$EXTENT" --clobber
  fi
  echo "[publish] extent published to release $TAG"
fi

echo "[publish] done."
