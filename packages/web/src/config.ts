/**
 * Runtime configuration. Values are baked in at build time via Vite env vars.
 *
 * On GitHub Pages: VITE_PMTILES_URL = "/my_map_run/europe-run.pmtiles"
 * (same origin — no CORS/redirect issues with range requests).
 *
 * Locally: run `npm run dev` — the map loads but the overlay is empty unless
 * you set VITE_PMTILES_URL in .env.local to a local file served over http.
 */

const env = import.meta.env;

export const config = {
  /** URL of the runnable-overlay PMTiles file. In production this is set via
   *  VITE_PMTILES_URL (pages.yml) to the Cloudflare R2 public URL — the full
   *  tileset is a few GB, far over GitHub's 2 GB release-asset limit, so it is
   *  hosted on R2 (see docs/HOSTING.md). The fallback is only for ad-hoc use;
   *  local dev/preview normally uses VITE_GEOJSON_URL instead. */
  pmtilesUrl:
    env.VITE_PMTILES_URL ??
    "https://github.com/misht-world/my_map_run/releases/latest/download/europe-run.pmtiles",

  /** Dev/preview only: if set, load a normalized GeoJSON FeatureCollection
   *  (same schema as the tiles) as the overlay instead of PMTiles. Used to
   *  preview a single city without the full osmium/tippecanoe pipeline —
   *  see scripts/local-geojson.ts. Empty in production. */
  geojsonUrl: env.VITE_GEOJSON_URL ?? "",

  /** URL of the data-coverage outline (Geofabrik europe.poly → GeoJSON). */
  extentUrl:
    env.VITE_EXTENT_URL ??
    "https://github.com/misht-world/my_map_run/releases/latest/download/europe-extent.geojson",

  /** Basemap style JSON — OpenFreeMap, free, keyless, global vector tiles.
   *  Default: Bright. */
  basemapStyleUrl:
    env.VITE_BASEMAP_STYLE ?? "https://tiles.openfreemap.org/styles/bright",

  /** Data snapshot date (release tag) and site build date, injected at build. */
  dataDate:  env.VITE_DATA_DATE  ?? "",
  buildDate: env.VITE_BUILD_DATE ?? "",

  /** Overpass API for lazy-fetching raw tags by osm_id on popup click. */
  overpassUrl:
    env.VITE_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",

  /** Initial map view when no URL hash is present (centered on Europe). */
  defaultView: { center: [10, 50] as [number, number], zoom: 5 },
};
