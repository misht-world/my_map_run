/**
 * Foot routing via BRouter (brouter.de) — free, keyless, elevation-aware.
 *
 * Both profiles are custom *pedestrian* profiles (see profiles/*.brf), derived
 * from Poutnik's Hiking-Mountain foot profile — they prefer footways, sidewalks
 * and park paths over the carriageway, and:
 *   running → avoids steps and traffic-signal / at-grade crossings, no
 *             scrambling, leans to paved paths.
 *   trail   → allows steps and unpaved paths / hills, leans to green areas.
 * The profile text is uploaded to BRouter once per session (cached by id); if
 * the upload is unavailable we fall back to a built-in foot profile.
 */
import { RUNNING_FOOT_BRF, TRAIL_FOOT_BRF } from "./profiles.generated.js";

const BROUTER = "https://brouter.de/brouter";
const BROUTER_UPLOAD = "https://brouter.de/brouter/profile";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export type RunProfile = "running" | "trail";

const PROFILE_BRF: Record<RunProfile, string> = {
  running: RUNNING_FOOT_BRF,
  trail: TRAIL_FOOT_BRF,
};
// If the custom-profile upload is blocked (CORS/offline), fall back to a
// built-in *foot* profile — still path/sidewalk-preferring, unlike trekking.
const PROFILE_FALLBACK: Record<RunProfile, string> = {
  running: "hiking-beta",
  trail: "hiking-beta",
};

export const PROFILE_LABELS: Record<RunProfile, string> = {
  running: "🏃 Running (sidewalks/paths, avoids stairs & lights)",
  trail: "⛰ Trail (paths, hills, steps ok)",
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

// Session cache of uploaded custom-profile ids, keyed by cacheKey (includes the
// stairs toggle so running-with-stairs and running-without are cached apart).
const uploadedIds: Record<string, string> = {};
const uploadFailed: Record<string, boolean> = {};

// Running forbids stairs by default; the UI can opt in.
let stairsAllowed = false;
const cacheKey = (profile: RunProfile) => `${profile}:${profile === "running" && stairsAllowed ? 1 : 0}`;

/** Toggle stair use for the running profile (clears its cached upload). */
export function setStairsAllowed(v: boolean): void {
  if (v === stairsAllowed) return;
  stairsAllowed = v;
  for (const k of ["running:0", "running:1"]) { delete uploadedIds[k]; delete uploadFailed[k]; }
}

/** Profile text to upload — running flips allow_steps on when stairs allowed. */
function profileBody(profile: RunProfile): string {
  if (profile === "running" && stairsAllowed) {
    return PROFILE_BRF.running.replace(/(assign\s+allow_steps\s+)false/, "$1true");
  }
  return PROFILE_BRF[profile];
}

/** Upload the custom profile (once per session/variant) and return its id. */
async function uploadProfile(profile: RunProfile): Promise<string | null> {
  const key = cacheKey(profile);
  if (uploadedIds[key]) return uploadedIds[key]!;
  if (uploadFailed[key]) return null;
  try {
    const r = await fetch(BROUTER_UPLOAD, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: profileBody(profile),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { profileid?: string };
    if (!j.profileid) throw new Error("no id");
    uploadedIds[key] = j.profileid;
    return j.profileid;
  } catch {
    uploadFailed[key] = true; // fall back for the rest of the session
    return null;
  }
}

/** Single BRouter route request for a resolved profile id/name. */
async function routeOnce(lonlats: string, brouterProfile: string): Promise<RouteResult | null> {
  const url = `${BROUTER}?lonlats=${lonlats}&profile=${brouterProfile}&alternativeidx=0&format=geojson`;
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

/** Route through the given [lon, lat] waypoints with a profile, or null. */
export async function fetchRoute(
  waypoints: [number, number][],
  profile: RunProfile,
): Promise<RouteResult | null> {
  if (waypoints.length < 2) return null;
  const lonlats = waypoints.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join("|");

  const customId = await uploadProfile(profile);
  if (customId) {
    const r = await routeOnce(lonlats, customId);
    if (r) return r;
    // The server may have evicted the uploaded profile — re-upload once.
    delete uploadedIds[cacheKey(profile)];
    const id2 = await uploadProfile(profile);
    if (id2) {
      const r2 = await routeOnce(lonlats, id2);
      if (r2) return r2;
    }
  }
  // Last resort: built-in foot profile.
  return routeOnce(lonlats, PROFILE_FALLBACK[profile]);
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
