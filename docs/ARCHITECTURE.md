# Architecture

A three-layer system on top of a monorepo, mirroring the sister project
`my_map-toll`. Each layer has one responsibility and one direction of
dependency.

```
┌───────────────────────────────────────────────────────────────┐
│  OpenStreetMap (Geofabrik extract)                            │
└─────────────┬─────────────────────────────────────────────────┘
              │  scripts/01-fetch.sh, 02-filter.sh
              ▼
┌───────────────────────────────────────────────────────────────┐
│  Normalization (packages/tile-builder + packages/interpreter) │
│   raw OSM tags → { kind, foot_tier | barrier_status | poi_kind } │
└─────────────┬─────────────────────────────────────────────────┘
              │  tippecanoe, pmtiles  (scripts/04-tile.sh)
              ▼
┌───────────────────────────────────────────────────────────────┐
│  Delivery: europe-run.pmtiles on Cloudflare R2 (docs/HOSTING)  │
└─────────────┬─────────────────────────────────────────────────┘
              │  static fetch via pmtiles protocol
              ▼
┌───────────────────────────────────────────────────────────────┐
│  Web (packages/web): MapLibre + OpenFreeMap basemap +         │
│                      our runnable overlay                     │
└───────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Depends on | Purpose |
|---|---|---|
| `@mmr/model` | — | Types, tiers, reason codes, `TileProperties`. Zero runtime deps. |
| `@mmr/interpreter` | `model` | Pure functions: `interpretFoot`, `interpretBarrier`, `interpretPoi`. Fully unit-tested. |
| `@mmr/tile-builder` | `model`, `interpreter` | Node stream (`normalize.ts`) enriching GeoJSON before tippecanoe. |
| `@mmr/web` | `model` | MapLibre app. Types only from `model`, no build-time code. |
| `@mmr/routing-adapter` | `model` | Stub for the future BRouter foot-routing integration. |

## Why this split

- **Interpreter is isolated and pure.** Runnable/barrier/POI logic is a pure
  function of OSM tags, so it is unit-tested and could also run client-side.
- **Raw tags never reach tiles.** Tiles carry only `osm_id`, `kind`, and the
  small normalized fields. The popup fetches full tags from Overpass on
  demand, keeping tiles small.
- **Basemap is not ours.** OpenFreeMap provides the global background for
  free; we build and host only the runnable overlay — a static site.
- **Routing adapter exists but is empty.** It marks the extension point.
  When routing lands, `tile-builder`/`web` don't change.

## Tile schema

A single vector layer `run`; features are discriminated by `kind`:

| `kind` | fields | geometry |
|---|---|---|
| `line` | `foot_tier` (`designated`\|`allowed`), `is_steps?` | LineString |
| `barrier` | `barrier_status` (`blocked`\|`passable`), `barrier_kind?` | Point |
| `poi` | `poi_kind` (`water`\|`shelter`\|`viewpoint`\|`toilets`), `name?` | Point |

## What's intentionally NOT here (MVP)

- No server, API, or database.
- No manually-curated data layer — OSM is the sole source of truth.
- No routing yet — only the architectural seam (`@mmr/routing-adapter`).
- No third-party activity heatmap (see `LIMITATIONS.md`).
