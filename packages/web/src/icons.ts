/**
 * POI marker icons — a single visual style and colour for all four kinds:
 * one coloured disc (POI_COLOR) with a white pictogram; only the pictogram
 * shape differs. Drawn on a canvas so we get crisp monochrome icons (no
 * multicolour emoji) that read on any basemap, including satellite.
 *
 * Returns both an ImageData (for map.addImage) and a data URL (for the
 * legend swatches) so the legend always matches the map exactly.
 */

export type PoiIconKind = "water" | "shelter" | "viewpoint" | "toilets";

const SIZE = 48; // logical px; registered at pixelRatio 2

export function makePoiIcon(kind: PoiIconKind, color: string): { imageData: ImageData; dataUrl: string } {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const cx = SIZE / 2, cy = SIZE / 2, r = 20;

  // Coloured disc with a white rim.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";

  switch (kind) {
    case "water": {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 12);
      ctx.bezierCurveTo(cx + 11, cy + 3, cx + 9, cy + 13, cx, cy + 13);
      ctx.bezierCurveTo(cx - 9, cy + 13, cx - 11, cy + 3, cx, cy - 12);
      ctx.fill();
      break;
    }
    case "shelter": {
      // Roof
      ctx.beginPath();
      ctx.moveTo(cx - 13, cy + 1);
      ctx.lineTo(cx, cy - 13);
      ctx.lineTo(cx + 13, cy + 1);
      ctx.closePath();
      ctx.fill();
      // Posts / body
      ctx.fillRect(cx - 9, cy + 1, 18, 11);
      break;
    }
    case "viewpoint": {
      // White eye almond with a hole (chip colour) as the pupil.
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy);
      ctx.quadraticCurveTo(cx, cy - 12, cx + 14, cy);
      ctx.quadraticCurveTo(cx, cy + 12, cx - 14, cy);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
    case "toilets": {
      ctx.font = "bold 18px -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("WC", cx, cy + 1);
      break;
    }
  }

  return { imageData: ctx.getImageData(0, 0, SIZE, SIZE), dataUrl: c.toDataURL() };
}

/**
 * Blocked-barrier marker — a red ✕ on a white disc. Drawn (not a basemap
 * glyph) so it renders reliably on every basemap, including satellite.
 */
export function makeBarrierIcon(color = "#d50000"): { imageData: ImageData; dataUrl: string } {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d")!;
  const cx = SIZE / 2, cy = SIZE / 2, r = 16;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();

  const d = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - d, cy - d);
  ctx.lineTo(cx + d, cy + d);
  ctx.moveTo(cx + d, cy - d);
  ctx.lineTo(cx - d, cy + d);
  ctx.stroke();

  return { imageData: ctx.getImageData(0, 0, SIZE, SIZE), dataUrl: c.toDataURL() };
}
