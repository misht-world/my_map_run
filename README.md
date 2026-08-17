# my_map_run

A free, static web map of **where you can run in Europe** — a bright overlay
of pedestrian-runnable ways built entirely from OpenStreetMap, plus
blocked-barrier markers and runner points of interest. No server, no database,
no manually curated data.

https://misht-world.github.io/my_map_run/ *(after first deploy)*

- Basemap: [OpenFreeMap](https://openfreemap.org/) (free, keyless).
- Overlay: our own PMTiles, built from a Geofabrik OSM extract.
- Frontend: TypeScript + Vite + MapLibre GL.

Sister project / same architecture: [my_map-toll](https://github.com/misht-world/my_map-toll).

## What works today (MVP)

- Interactive map of Europe with a **bright runnable-path overlay**, in two
  confidence tiers, each toggleable:
  - **Runnable — pedestrian ways** (bright): footways, paths, tracks,
    pedestrian streets, and roads with a mapped sidewalk.
  - **Runnable — quiet roads** (dim): residential/living-street/service/etc.
    where foot access is not forbidden but no sidewalk is mapped.
- **Blocked barriers** (gates/stiles/turnstiles tagged `foot=no|private` or
  with access closed) marked with a **red ✕**. Passable barriers optional.
- **Steps / stairs** highlighted with a dashed overlay.
- **Runner POI layers**: 💧 drinking water, ⛺ shelter/gazebo, 👁 viewpoints,
  🚻 toilets — each toggleable.
- Per-feature popup: normalized status + lazy-loaded raw OSM tags (Overpass)
  + link to openstreetmap.org.
- Coordinate search, URL state (`#map=…&layers=…`), shareable link, cursor
  readout, right-click to copy coordinates.

## Not in the MVP (planned — see docs/ROADMAP.md)

- **Route building** (point-to-point and round-trip with a target distance,
  draggable waypoints) via **BRouter**, with runner options:
  *avoid stairs* and *avoid steep slopes*. Engine seam: `@mmr/routing-adapter`.
- **Your own activity tracks** as a blue overlay (GPX/FIT import). A global
  third-party heatmap (e.g. Strava) cannot be embedded for free/legally —
  see [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

## Classification rules

How OSM tags become runnable tiers / barriers / POI is documented in
[`docs/TAG_INTERPRETATION.md`](docs/TAG_INTERPRETATION.md) and unit-tested in
`packages/interpreter/test/`.

## Run locally

```bash
npm install
npm test              # interpreter unit tests
npm run dev           # dev server at http://localhost:5173
```

Without a PMTiles overlay the map still loads (empty overlay). To see data,
build a small extract and point the app at it:

```bash
# Build one small country locally (fast):
GEOFABRIK_URL=https://download.geofabrik.de/europe/monaco-latest.osm.pbf npm run data:build

# Serve the tiles and run the app against them:
npx pmtiles serve data --port 8080 &      # serves europe-run.pmtiles
VITE_PMTILES_URL=http://localhost:8080/europe-run.pmtiles npm run dev
```

## Automated builds (recommended)

Both the data pipeline and the website are built by GitHub Actions — your PC
is not involved.

- **`.github/workflows/data.yml`** — rebuilds the Europe PMTiles overlay
  monthly (and on manual trigger). The complete tileset (~GBs, kept without
  dropping) is uploaded to **Cloudflare R2** — it is far over GitHub's 2 GB
  release-asset limit; only the tiny coverage outline goes to a GitHub Release.
  One-time R2 setup: [`docs/HOSTING.md`](docs/HOSTING.md).
- **`.github/workflows/pages.yml`** — rebuilds the static website on every
  push to `main` and after a successful data build, deploys to GitHub Pages.

One-time repo setup:

1. **Settings → Pages → Source**: *GitHub Actions*.
2. **Actions → Build data tiles → Run workflow** once to produce the first
   PMTiles release (~40–90 min for all of Europe).

## Manual data build (optional)

Prerequisites: [osmium-tool](https://osmcode.org/osmium-tool/),
[tippecanoe](https://github.com/felt/tippecanoe),
[go-pmtiles](https://github.com/protomaps/go-pmtiles),
[gh](https://cli.github.com/), Node 20+.

```bash
npm run data:build     # fetch → filter → normalize → tile
npm run data:publish   # gh release upload
```

## Project layout

```
packages/
  model/            # Types: FootTier, BarrierStatus, PoiKind, TileProperties.
  interpreter/      # Pure OSM-tag → runnable/barrier/POI. Unit-tested.
  tile-builder/     # Node stream that enriches GeoJSON before tippecanoe.
  web/              # MapLibre + PMTiles + OpenFreeMap.
  routing-adapter/  # Stub for the future BRouter integration.
scripts/            # Shell scripts for the data pipeline.
docs/               # Architecture, tag rules, routing plan, limitations, roadmap.
```

## License

Code: MIT. Data rendered by this site: © OpenStreetMap contributors (ODbL).
