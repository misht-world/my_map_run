# Roadmap

## Phase 1 — Runnable map overlay (the MVP) ✅

Bright runnable-path overlay in two confidence tiers, blocked-barrier ✕,
steps highlighting, runner POI (water / shelter / viewpoint / toilets),
popups, coordinate search, URL state, monthly auto-rebuild + Pages deploy.

## Phase 2 — Route building (BRouter)

See [`ROUTING.md`](ROUTING.md).

1. Point-to-point routing with draggable, editable waypoints.
2. Round trip with a **target distance** (loop generation + convergence).
3. Runner options as profile switches: **avoid stairs**, **avoid steep
   slopes** (several strengths).
4. GPX export.
5. Bias routes toward `foot_tier=designated`.

## Phase 3 — Activity layer

1. Import the user's **own** GPX/FIT files → private blue overlay (client-side
   parsing, nothing uploaded).
2. Investigate a personal Strava heatmap via user OAuth + a small backend
   (note: this moves the project off "static and free"). A global third-party
   heatmap is not embeddable for free — see [`LIMITATIONS.md`](LIMITATIONS.md).

## Phase 4 — Reach & richness

1. More POI (benches, fountains, changing rooms, lockers).
2. Surface / lit / width attributes on runnable lines (night/trail running).
3. Global coverage beyond the Europe extract.
4. Light/dark auto theme for maximum line contrast.
