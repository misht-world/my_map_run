# Routing plan (Phase 2 — not in the MVP)

Route building is deliberately deferred, exactly as in `my_map-toll`. The
architectural seam is `@mmr/routing-adapter` (`computeRoute`, `RunProfile`).

## Engine choice: BRouter

**BRouter** ([brouter.de](https://brouter.de)) is the recommended engine:

- **Free and keyless** — a public routing server exists, so the site stays a
  static, free deployment (no API key baked into the client, no backend).
- **Profile-scriptable** — BRouter profiles are small scripts with direct
  control over cost. This maps 1:1 to the runner options the user asked for:
  - **Avoid stairs** — block/penalize `highway=steps` in the profile.
  - **Avoid steep slopes** — BRouter has built-in elevation data and cost
    knobs (`uphillcost`, `downhillcost`, `elevationpenalty`), so we can offer
    several strengths of "prefer flat".
- Foot profiles are mature; GPX export is native.

Prebuilt profiles surface to the user as checkboxes (`RunProfile` in the
adapter): `running`, `running-no-stairs`, `running-flat` (with levels).

### Why not GraphHopper / Valhalla / OSRM?

- **GraphHopper** has a native round-trip (target-distance loop) — attractive
  for circular routes — but grade-based avoidance is awkward on the free API,
  and it needs an API key (rate limits, key in the client).
- **Valhalla** pedestrian costing lacks a direct max-grade knob.
- **OSRM** public demo serves the car profile only.

## Features to build

- **Point-to-point** with draggable waypoints; re-route on drag.
- **Round trip with a target distance** — BRouter has no native round-trip, so
  generate candidate via-points around the start under the target distance,
  route through them, and iterate to converge on the requested length.
- **Edit track points** — add/remove/reorder waypoints (the waypoint-list UI
  from `my_map-toll`'s route planner can be lifted over).
- **GPX export** of the resulting route.

The overlay already tells the router where running is sensible: a future step
can bias routes toward `foot_tier=designated` and away from dropped roads.
