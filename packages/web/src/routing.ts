/**
 * Foot/car routing via BRouter (brouter.de) — free, keyless, elevation-aware.
 *
 * v1: point-to-point (with intermediate waypoints), three profiles, GPX
 * export with elevation. Proper grade-controlled custom profiles come later
 * (v3, slope tuning); for now we map to distinct built-in BRouter profiles.
 */

const BROUTER = "https://brouter.de/brouter";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export type RunProfile = "running" | "trail" | "auto";

// Built-in BRouter profiles (v1 approximation):
//   running → trekking   (biases to smooth/paved ways, avoids rough & steps)
//   trail   → hiking-beta (foot; prefers paths/trails, elevation-aware)
//   auto    → car-fast
const PROFILE_MAP: Record<RunProfile, string> = {
  running: "trekking",
  trail: "hiking-beta",
  auto: "car-fast",
};

export const PROFILE_LABELS: Record<RunProfile, string> = {
  running: "🏃 Running (even surfaces)",
  trail: "⛰ Trail (hills, paths)",
  auto: "🚗 Any (car)",
};

export interface RouteResult {
  /** 2-D LineString for the map. */
  geometry: GeoJSON.LineString;
  /** Raw [lon, lat, ele] points for GPX. */
  coords3d: number[][];
  distanceM: number;
  ascentM: number;
  durationS: number;
}

/** Route through the given [lon, lat] waypoints with a profile, or null. */
export async function fetchRoute(
  waypoints: [number, number][],
  profile: RunProfile,
): Promise<RouteResult | null> {
  if (waypoints.length < 2) return null;
  const lonlats = waypoints.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join("|");
  const url = `${BROUTER}?lonlats=${lonlats}&profile=${PROFILE_MAP[profile]}&alternativeidx=0&format=geojson`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(25000) });
  } catch { return null; }
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    features?: Array<{ geometry?: { coordinates?: number[][] }; properties?: Record<string, string> }>;
  };
  const f = data.features?.[0];
  const coords = f?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const p = f!.properties ?? {};
  return {
    geometry: { type: "LineString", coordinates: coords.map((c) => [c[0]!, c[1]!]) },
    coords3d: coords,
    distanceM: Number(p["track-length"]) || 0,
    ascentM: Number(p["filtered ascend"]) || 0,
    durationS: Number(p["total-time"]) || 0,
  };
}

/** Geocode free text (or "lat, lon") → [lon, lat] or null. */
export async function geocode(query: string): Promise<[number, number] | null> {
  const q = query.trim();
  const m = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(q);
  if (m) {
    const a = parseFloat(m[1]!), b = parseFloat(m[2]!);
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [b, a];
    if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return [a, b];
  }
  try {
    const r = await fetch(`${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as Array<{ lon: string; lat: string }>;
    if (!d[0]) return null;
    return [parseFloat(d[0].lon), parseFloat(d[0].lat)];
  } catch { return null; }
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600), min = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${min} min` : `${min} min`;
}

/** GPX track (with elevation) from BRouter 3-D coords. */
export function toGpx(coords3d: number[][], name: string, profile: RunProfile): string {
  const pts = coords3d.map((c) =>
    `<trkpt lat="${c[1]}" lon="${c[0]}">${c[2] !== undefined ? `<ele>${c[2]}</ele>` : ""}</trkpt>`,
  ).join("\n");
  const safe = name.replace(/[<>&]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="my_map_run" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${safe}</name><desc>Profile: ${profile}</desc></metadata>
  <trk><name>${safe}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
}
