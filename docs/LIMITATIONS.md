# Known limitations

## Data completeness (OSM)

- **Sidewalks are under-mapped.** Many perfectly runnable streets have no
  `sidewalk` tag, so they only appear in the dimmer `allowed` tier (or, for
  busy `primary`/`secondary` roads, not at all). A missing line is not proof
  you can't run somewhere.
- **Access and barriers are patchy.** A gate with no `foot`/`access` tag is
  shown as *passable* even if it is locked in reality; verify on the ground.
- **POI coverage varies wildly** by region — drinking-water and toilet
  density on the map reflects mapping effort, not reality.

## No third-party activity heatmap

A "load a blue heatmap of other people's runs" layer is **not feasible for a
free, static, keyless site**:

- The only global running heatmap is **Strava's**, which requires a logged-in
  session and whose Terms/API licensing forbid embedding or redistributing
  its tiles on a public site.
- There is no free, keyless, redistributable global run-track tile source.

What *is* feasible (Phase 3, see ROADMAP): let a user load **their own**
GPX/FIT files and draw them as a private blue overlay in the browser. A
personal Strava heatmap would require the user's OAuth and a small backend —
which would move the project off "static and free".

## Basemap / rendering

- The blocked-barrier ✕ uses the basemap glyph set (Noto). If a future
  basemap style ships without that glyph range, switch to a registered sprite
  image instead.
- Overpass availability governs the raw-tag popup; if Overpass is down, the
  popup still shows the normalized status and links, just not the full tags.
