/**
 * Parse a free-form coordinate string into (lat, lon).
 *
 * Accepts two orderings:
 *   - "47.4979, 19.0402"    → lat, lon (default assumption)
 *   - "19.0402, 47.4979"    → lon, lat — inferred only when the first
 *                             value is unambiguously a longitude (|v| > 90).
 *
 * Separators: comma, semicolon, whitespace, or any combination.
 * Returns null if the input cannot be parsed or values are out of range.
 */
export function parseCoords(input: string): { lat: number; lon: number } | null {
  if (!input) return null;
  const cleaned = input
    .replace(/[°]/g, "")
    .replace(/[;\/|]/g, ",")
    .trim();

  const parts = cleaned
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length !== 2) return null;

  const a = Number.parseFloat(parts[0]!);
  const b = Number.parseFloat(parts[1]!);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const isValidLatLon = Math.abs(a) <= 90 && Math.abs(b) <= 180;
  const isValidLonLat = Math.abs(a) <= 180 && Math.abs(b) <= 90;

  if (isValidLatLon && !isValidLonLat) return { lat: a, lon: b };
  if (isValidLonLat && !isValidLatLon) return { lat: b, lon: a };
  if (isValidLatLon) return { lat: a, lon: b };
  return null;
}
