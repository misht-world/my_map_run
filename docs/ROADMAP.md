# Roadmap

## Phase 1 — Overlay ✅

Inverted overlay (*can't run* ways, running tracks, steps, blocked/passable
barriers, runner POI), popups with lazy raw tags, coordinate search, URL
state, share link, basemap switcher (Landscape / OpenFreeMap / CyclOSM /
satellite), monthly auto-rebuild + Pages deploy.

## Phase 2 — Route planner (BRouter) ✅

See [`ROUTING.md`](ROUTING.md).

- Custom Running / Trail foot profiles: no stairs by default (toggle), no-run
  gate incl. not-built ways, mild traffic-light penalty, footway over path
  over service road, flatter and straighter routes.
- Round trip with a target distance: circle / oval / teardrop candidates,
  8-sector direction compass, scoring on stairs, climb, lights, crossings,
  backtracking, parks, running tracks, POI; reverse direction.
- Point A → B with numbered vias, auto re-route, optional padding to a target
  distance with alternatives.
- Direction chevrons, cancelable generation with progress overlay, GPX export.

## Next

1. Tune scoring weights on more real tracks (users drop GPX into `gpx/`).
2. Slider(s) for the main trade-offs (e.g. *flatter ↔ more interesting*,
   lights strictness) instead of fixed weights.
3. Shape run (GPS art): search over a start **area** rather than a fixed
   point, allow stairs for art routes; then unhide the mode.
4. Show the route's lights / stairs / crossings as markers on the map.
5. Remove leftovers: `packages/routing-adapter` stub,
   `tile-builder/src/prune-deadends.ts`.

## Later

1. Import the user's **own** GPX/FIT files → private overlay (client-side).
2. More POI (benches, fountains, changing rooms, lockers).
3. Surface / lit attributes for night and trail running.
4. Coverage beyond the Europe extract.
