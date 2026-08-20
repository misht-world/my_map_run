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
      // Gazebo — a pointed roof on open posts (no walls).
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy - 2);
      ctx.lineTo(cx, cy - 14);
      ctx.lineTo(cx + 14, cy - 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - 13, cy - 2, 26, 2.5);   // roof base bar
      ctx.fillRect(cx - 10, cy + 1, 2.5, 12);   // left post
      ctx.fillRect(cx + 7.5, cy + 1, 2.5, 12);  // right post
      break;
    }
    case "viewpoint": {
      // Binoculars — two rounded white barrels with a bridge.
      const barrel = (bx: number) => {
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(bx - 4.5, cy - 9, 9, 18, 4);
        else ctx.rect(bx - 4.5, cy - 9, 9, 18);
        ctx.fill();
        // lens hole in chip colour
        ctx.beginPath();
        ctx.arc(bx, cy + 4.5, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = "#ffffff";
      };
      barrel(cx - 5.5);
      barrel(cx + 5.5);
      ctx.fillRect(cx - 5.5, cy - 7, 11, 3.4); // bridge
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
