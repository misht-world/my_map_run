# Hosting

Everything is served from **GitHub**: the overlay tiles are a GitHub Release
asset, copied into the GitHub Pages site at deploy time and served from the
same origin (no CORS / redirect issues with PMTiles range requests).

> History: while the MVP drew the whole pedestrian network the tileset was
> ~14 GB and was moved to Cloudflare R2. After the inverted-overlay change
> (only *can't-run* ways, tracks, steps, barriers, POI) it fits a GitHub
> Release again, and R2 is no longer used.

## Data release (`.github/workflows/data.yml`)

- Runs on the 1st of every month (04:23 UTC) and on manual trigger.
- Downloads `europe-latest.osm.pbf` from Geofabrik (curl retries on transient
  5xx), filters with osmium, normalizes, builds `europe-run.pmtiles` with
  tippecanoe, and converts Geofabrik's `europe.poly` into
  `europe-extent.geojson` (the dashed coverage outline).
- Publishes both files to a Release tagged **`data-YYYY-MM-DD`**.
- Manual inputs for test builds: `geofabrik_url` (e.g. a single country) and
  `out_name` (anything other than `europe-run.pmtiles` skips publishing).

## Site deploy (`.github/workflows/pages.yml`)

- Runs on every push to `main`, manually, and after a successful data build.
- Runs `npm test`, builds the site with:
  - `VITE_BASE=/my_map_run/`
  - `VITE_PMTILES_URL=/my_map_run/europe-run.pmtiles` and
    `VITE_EXTENT_URL=/my_map_run/europe-extent.geojson` (same origin)
  - `VITE_DATA_DATE` = latest release tag, `VITE_BUILD_DATE` = today
  - `VITE_THUNDERFOREST_KEY` from the repo **variable** `THUNDERFOREST_KEY`
- Downloads the latest release's `europe-run.pmtiles` + `europe-extent.geojson`
  into `dist/` and deploys to GitHub Pages.

## One-time setup

1. **Settings → Pages → Source:** *GitHub Actions*.
2. **Settings → Secrets and variables → Actions → Variables:** add
   `THUNDERFOREST_KEY` (public key for the Landscape basemap; without it the
   site falls back to OpenFreeMap Bright and hides the Landscape option).
3. **Actions → Build data tiles → Run workflow** once to create the first
   data release (Europe takes a while; a single country is quick).

## External services used at runtime (all public)

| Service | Used for |
|---|---|
| GitHub Pages | site + tiles |
| OpenFreeMap, CyclOSM, Esri, Thunderforest | basemaps |
| brouter.de | routing (profile upload + route) |
| Overpass (3 mirrors) | local data for route scoring; raw tags in popups |
| Nominatim | place search in the route planner |
