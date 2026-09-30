# my_map_run

A free, static web map of **where you can (and can't) run in Europe**, with a
**running route planner** — loops of a given distance, A→B routes, stairs /
traffic-light / hill avoidance. Built entirely from OpenStreetMap; no server,
no database, no manually curated data.

https://misht-world.github.io/my_map_run/

- Basemap: Thunderforest Landscape (default, needs a public key), OpenFreeMap
  (Bright / Light / Detailed), CyclOSM, Esri satellite.
- Overlay: our own PMTiles, built monthly from a Geofabrik OSM extract.
- Routing: [BRouter](https://brouter.de) with our own foot profiles + local
  OSM data from Overpass for scoring route candidates.
- Frontend: TypeScript + Vite + MapLibre GL.

Sister project / same architecture: [my_map-toll](https://github.com/misht-world/my_map-toll).

## What the map shows

The basemap already draws walkable paths, so the overlay only adds what a
runner needs *on top*:

- **Can't run here** — red dashed: `foot=no|private|use_sidepath`,
  `access=no|private|customers` (no foot override), motorways/trunks, and
  not-built ways (`highway=construction|proposed|…`).
- **Running tracks** (`leisure=track` + `sport=running|athletics`).
- **Steps / stairs** (dashed black).
- **Barriers** — blocked (red ✕) and, optionally, passable.
- **Runner POI** — drinking water (blue), shelter, viewpoint, toilets.
- Per-feature popup with the normalized status + lazily loaded raw OSM tags.

One **Layers & legend** block toggles each of these and shows how they look.

## Route planner

Full details: [`docs/ROUTING.md`](docs/ROUTING.md).

- **Profiles:** 🏃 *Running* (sidewalks/footways, no stairs by default, few
  traffic lights, flat, straight) and ⛰ *Trail* (paths, hills, stairs OK).
  *Allow stairs* checkbox for Running.
- **Round trip (loop):** set a start, a distance and a direction (8-sector
  compass or *Auto*) → the planner tries circle / oval / teardrop shapes in
  several headings and picks the best by stairs, climb, traffic lights, road
  crossings, backtracking, parks, running tracks and interesting spots.
  **⇄ Reverse** runs it the other way round.
- **Point A → B:** start, numbered vias, finish; auto-routes as you edit.
  Optional **target distance** pads the route with detours and offers several
  alternatives (*Other option ↻*).
- Direction chevrons on the route, centred progress overlay with **Cancel**,
  **GPX export** (with elevation).

## Run locally

```bash
npm install
npm test              # interpreter unit tests
npm run dev           # dev server at http://localhost:5173
```

The overlay needs data. Quickest: build a single-city GeoJSON preview straight
from Overpass (same interpreter as the real tiles):

```bash
npx tsx scripts/local-geojson.ts 47.49 19.02 47.54 19.10 packages/web/public/budapest-run.geojson
VITE_GEOJSON_URL=http://localhost:5173/budapest-run.geojson npm run dev
```

Or build real tiles for a small country:

```bash
GEOFABRIK_URL=https://download.geofabrik.de/europe/monaco-latest.osm.pbf npm run data:build
npx pmtiles serve data --port 8080 &
VITE_PMTILES_URL=http://localhost:8080/europe-run.pmtiles npm run dev
```

Routing works locally without any data build — it calls the public BRouter
and Overpass servers from the browser.

After changing a routing profile, regenerate it: `node packages/web/profiles/build-profiles.mjs`
(see [`docs/ROUTING.md`](docs/ROUTING.md#profiles)).

## Automated builds

Both the data pipeline and the website are built by GitHub Actions.

- **`.github/workflows/data.yml`** — rebuilds the Europe overlay monthly
  (1st of the month) and on manual trigger; publishes `europe-run.pmtiles` +
  `europe-extent.geojson` to a GitHub Release `data-YYYY-MM-DD`. The overlay is
  small (only exceptions are drawn), well under the 2 GB asset limit.
- **`.github/workflows/pages.yml`** — rebuilds the site on every push to
  `main` and after a successful data build, copies the latest release assets
  next to the site and deploys to GitHub Pages (tiles served same-origin).

Hosting details and one-time setup: [`docs/HOSTING.md`](docs/HOSTING.md).

Manual alternative (needs osmium, tippecanoe, go-pmtiles, authenticated `gh`):
`npm run data:build && npm run data:publish`.

## Project layout

```
packages/
  model/            # Types: TileProperties, NoRunResult, BarrierResult, PoiKind.
  interpreter/      # Pure OSM-tag → no-run / track / barrier / POI. Unit-tested.
  tile-builder/     # normalize.ts: enriches osmium GeoJSONSeq before tippecanoe.
  web/              # MapLibre app + route planner.
    profiles/       #   BRouter foot profiles (generated) + their generator.
    src/            #   routing, loop generation, local OSM data, UI.
  routing-adapter/  # Unused stub from the MVP (real routing lives in web/).
scripts/            # Data pipeline shell scripts + local-geojson preview.
docs/               # Architecture, tag rules, routing, hosting, limits, roadmap.
gpx/                # (git-ignored) personal tracks shared for debugging routes.
```

## Documentation

| Doc | What's in it |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, packages, tile schema, web modules |
| [`TAG_INTERPRETATION.md`](docs/TAG_INTERPRETATION.md) | How OSM tags become overlay features |
| [`ROUTING.md`](docs/ROUTING.md) | BRouter profiles, loop / A→B generation, scoring, gotchas |
| [`HOSTING.md`](docs/HOSTING.md) | Data releases, Pages deploy, keys |
| [`LIMITATIONS.md`](docs/LIMITATIONS.md) | Data and engine limits |
| [`ROADMAP.md`](docs/ROADMAP.md) | Done / next |

## License

Code: MIT. Data rendered by this site: © OpenStreetMap contributors (ODbL).
