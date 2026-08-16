import type { LngLat } from "maplibre-gl";
import type { TileProperties } from "@mmr/model";
import { config } from "./config.js";

const POI_LABELS: Record<string, { icon: string; title: string; hint: string }> = {
  water:     { icon: "💧", title: "Drinking water", hint: "Tap / fountain marked as drinkable in OSM. Verify on site." },
  shelter:   { icon: "⛺", title: "Shelter / gazebo", hint: "Covered spot to wait out rain or rest." },
  viewpoint: { icon: "👁", title: "Viewpoint", hint: "Scenic outlook worth a detour." },
  toilets:   { icon: "🚻", title: "Toilets", hint: "Public toilets (hours/fee may apply)." },
};

export function renderPopup(props: TileProperties, lngLat: LngLat): HTMLElement {
  const root = document.createElement("div");
  root.className = "popup";
  const lines: string[] = [];

  // ── Runnable line ─────────────────────────────────────────────────────────
  if (props.kind === "line") {
    if (props.foot_tier === "designated") {
      lines.push(`<div class="popup-status">🏃 Runnable — pedestrian way</div>`,
        `<div class="popup-reason">Explicitly for / open to pedestrians (footway, path, or a road with a sidewalk).</div>`);
    } else {
      lines.push(`<div class="popup-status">🏃 Runnable — quiet road</div>`,
        `<div class="popup-reason">Foot access is not forbidden, but no sidewalk is mapped. Watch for traffic.</div>`);
    }
    if (props.is_steps) {
      lines.push(`<div class="popup-status">🪜 Steps / stairs</div>`);
    }
  }

  // ── Barrier ───────────────────────────────────────────────────────────────
  if (props.kind === "barrier") {
    const bk = props.barrier_kind ? ` (${escapeHtml(props.barrier_kind)})` : "";
    if (props.barrier_status === "blocked") {
      lines.push(`<div class="popup-status popup-blocked">⛔ No pedestrian access${bk}</div>`,
        `<div class="popup-reason">Barrier tagged foot=no / private, or access closed. You likely cannot pass here on foot.</div>`);
    } else {
      lines.push(`<div class="popup-status">🚶 Passable barrier${bk}</div>`,
        `<div class="popup-reason">A gate/stile a pedestrian can pass. Slows you down but not blocked.</div>`);
    }
  }

  // ── POI ───────────────────────────────────────────────────────────────────
  if (props.kind === "poi" && props.poi_kind) {
    const p = POI_LABELS[props.poi_kind];
    const name = props.name ? `: ${escapeHtml(props.name)}` : "";
    if (p) {
      lines.push(`<div class="popup-status">${p.icon} ${p.title}${name}</div>`,
        `<div class="popup-reason">${p.hint}</div>`);
    }
  }

  const hasValidId = props.osm_id && props.osm_id !== 0;
  const lat = lngLat.lat.toFixed(6);
  const lng = lngLat.lng.toFixed(6);

  lines.push(`<div class="popup-meta" data-role="meta"></div>`);

  lines.push(
    `<div class="popup-links">` +
    `<a class="popup-link" href="https://maps.google.com/?q=${lat},${lng}&z=16" target="_blank" rel="noopener">Open in Google Maps ↗</a>`,
  );
  if (hasValidId) {
    lines.push(
      `<a class="popup-link" href="https://www.openstreetmap.org/${props.osm_type}/${props.osm_id}" target="_blank" rel="noopener">Open on OpenStreetMap ↗</a>`,
    );
  }
  lines.push(`</div>`);

  if (hasValidId) {
    lines.push(
      `<details class="popup-tags" data-role="tags-details">` +
      `<summary>All OSM tags</summary>` +
      `<div data-role="tags"><em>Loading tags…</em></div>` +
      `</details>`,
    );
  }

  root.innerHTML = lines.join("");

  if (hasValidId) {
    const tagsEl = root.querySelector<HTMLElement>('[data-role="tags"]');
    const detailsEl = root.querySelector<HTMLElement>('[data-role="tags-details"]');
    const metaEl = root.querySelector<HTMLElement>('[data-role="meta"]');
    if (tagsEl) {
      fetchRawTags(props.osm_type ?? "way", props.osm_id)
        .then((tags) => {
          if (metaEl) {
            metaEl.innerHTML = renderMeta(tags, props.kind === "poi");
            if (!metaEl.innerHTML) metaEl.remove();
          }
          tagsEl.innerHTML = renderTagsTable(tags);
          if (!tagsEl.innerHTML) detailsEl?.remove();
        })
        .catch(() => detailsEl?.remove());
    }
  }

  return root;
}

function renderMeta(tags: Record<string, string>, skipName: boolean): string {
  const parts: string[] = [];
  const name = tags["name"] ?? tags["name:en"];
  if (name && !skipName) parts.push(`<div class="popup-name">${escapeHtml(name)}</div>`);

  const links: string[] = [];
  const web = tags["website"] ?? tags["url"] ?? tags["contact:website"];
  if (web && /^https?:\/\//i.test(web)) {
    links.push(`<a class="popup-link" href="${escapeHtml(web)}" target="_blank" rel="noopener">Website ↗</a>`);
  }
  if (links.length) parts.push(`<div class="popup-sources">${links.join("")}</div>`);
  return parts.join("");
}

async function fetchRawTags(osmType: string, osmId: number): Promise<Record<string, string>> {
  const query = `[out:json][timeout:10];${osmType}(${osmId});out tags;`;
  const resp = await fetch(config.overpassUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = (await resp.json()) as { elements?: Array<{ tags?: Record<string, string> }> };
  return json.elements?.[0]?.tags ?? {};
}

function renderTagsTable(tags: Record<string, string>): string {
  const keys = Object.keys(tags).filter((k) => !k.startsWith("@")).sort();
  if (!keys.length) return "";
  return `<table>${keys.map((k) =>
    `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(tags[k] ?? "")}</td></tr>`,
  ).join("")}</table>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
