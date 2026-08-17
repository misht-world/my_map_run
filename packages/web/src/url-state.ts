/**
 * Two-way binding between the URL hash and the map's viewport + active
 * layers. Format:
 *
 *   #map=<zoom>/<lat>/<lon>&layers=designated,allowed,barriers,water,…&v=1
 *
 * The hash is the single source of truth: read on startup, written on every
 * relevant change (debounced), and listened to for external changes
 * (back/forward, pasted links).
 */

export interface LayerState {
  tracks: boolean;          // dedicated running tracks (leisure=track)
  designated: boolean;
  allowed: boolean;
  barriers: boolean;        // blocked barriers (red ✕)
  passableBarriers: boolean;
  water: boolean;
  shelter: boolean;
  viewpoint: boolean;
  toilets: boolean;
}

export interface UrlState {
  zoom: number;
  lat: number;
  lon: number;
  layers: LayerState;
}

const LAYER_KEYS: (keyof LayerState)[] = [
  "tracks", "designated", "allowed", "barriers", "passableBarriers",
  "water", "shelter", "viewpoint", "toilets",
];

export function parseHash(hash: string, fallback: UrlState): UrlState {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(h);
  const out: UrlState = {
    zoom: fallback.zoom,
    lat: fallback.lat,
    lon: fallback.lon,
    layers: { ...fallback.layers },
  };

  const map = params.get("map");
  if (map) {
    const [z, lat, lon] = map.split("/").map(Number);
    if ([z, lat, lon].every((n) => Number.isFinite(n))) {
      out.zoom = z!;
      out.lat = lat!;
      out.lon = lon!;
    }
  }

  const layers = params.get("layers");
  if (layers !== null) {
    const set = new Set(layers.split(",").map((s) => s.trim()).filter(Boolean));
    // v=1 : the layer list is authoritative for all current layers.
    const v = parseInt(params.get("v") ?? "0", 10);
    const authoritative = v >= 1;
    for (const key of LAYER_KEYS) {
      out.layers[key] = set.has(key) ? true : (authoritative ? false : fallback.layers[key]);
    }
  }

  return out;
}

export function formatHash(state: UrlState): string {
  const mapParam = `${state.zoom.toFixed(2)}/${state.lat.toFixed(5)}/${state.lon.toFixed(5)}`;
  const active = LAYER_KEYS.filter((k) => state.layers[k]);
  const params = new URLSearchParams();
  params.set("map", mapParam);
  params.set("layers", active.join(","));
  params.set("v", "1");
  return "#" + params.toString();
}
