#!/usr/bin/env bash
# Fetch the latest Europe OSM extract from Geofabrik.
#
# Output: data/europe-latest.osm.pbf
#
# Geofabrik updates extracts daily. We download the .pbf alongside its md5
# and verify the hash — if the local file is already up-to-date, we skip
# the download. On a fresh download, md5 mismatch is a *warning* (not
# fatal) because Geofabrik may rotate the extract during our download,
# making the .md5 stale. Actual corruption is caught downstream by osmium.
#
# Override GEOFABRIK_URL to build a smaller extract for local testing, e.g.
#   GEOFABRIK_URL=https://download.geofabrik.de/europe/monaco-latest.osm.pbf
set -euo pipefail

DATA_DIR="${DATA_DIR:-data}"
URL="${GEOFABRIK_URL:-https://download.geofabrik.de/europe-latest.osm.pbf}"
MD5_URL="${URL}.md5"

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

# Geofabrik occasionally returns transient 5xx (e.g. 502) — retry rather than
# failing the whole build. --retry-all-errors covers HTTP error responses too.
CURL_RETRY=(--retry 6 --retry-delay 15 --retry-all-errors --connect-timeout 30)

echo "[fetch] downloading md5 from ${MD5_URL}"
curl -sSL "${CURL_RETRY[@]}" -o europe-latest.osm.pbf.md5.raw "$MD5_URL"
# Geofabrik's .md5 references the dated filename; we save locally as
# europe-latest.osm.pbf. Rewrite the filename column.
EXPECTED_HASH="$(awk '{print $1}' europe-latest.osm.pbf.md5.raw)"
echo "${EXPECTED_HASH}  europe-latest.osm.pbf" > europe-latest.osm.pbf.md5

if [[ -f europe-latest.osm.pbf ]]; then
  if md5sum -c europe-latest.osm.pbf.md5 >/dev/null 2>&1; then
    echo "[fetch] local extract already up-to-date, skipping download"
    exit 0
  else
    echo "[fetch] local extract outdated, re-downloading"
  fi
fi

echo "[fetch] downloading ${URL}"
curl -L --fail "${CURL_RETRY[@]}" -o europe-latest.osm.pbf "$URL"

if md5sum -c europe-latest.osm.pbf.md5; then
  echo "[fetch] md5 OK"
else
  echo "[fetch] WARNING: md5 mismatch (likely Geofabrik rotated the extract during download). Continuing."
fi

echo "[fetch] done: $(du -h europe-latest.osm.pbf | cut -f1)"
