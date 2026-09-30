# Tag interpretation

How OSM tags become the features in the overlay tiles. The logic lives in
`packages/interpreter/src/`, is unit-tested in `packages/interpreter/test/`
(`npm test`), and is applied by `packages/tile-builder/src/normalize.ts`
(and by `scripts/local-geojson.ts` for the city preview).

**Policy (inverted):** the basemap already shows walkable paths, so runnable
ways are *not* emitted. Lines are emitted only for running tracks, steps, and
ways you **can't** run on. Points are emitted for barriers and runner POI.

For each line-like feature `normalize.ts` checks, in order:

1. `interpretTrack` → `is_track` (orange line),
2. else `interpretNoRun` blocked → `blocked` (red dashed; `is_steps` kept),
3. else `highway=steps` → `is_steps` (black dashes),
4. else dropped.

`area=yes` adds `is_area`. For points: `interpretBarrier` first, then
`interpretPoi`.

## Can't run here — `interpretNoRun`

Applied to `highway=*` ways; returns `{ blocked, reason }`. First match wins:

1. No `highway` → not blocked.
2. `highway=service` with `service=driveway|parking_aisle|alley|drive-through`
   → never emitted.
3. **Not built:** `highway=construction|proposed|disused|abandoned|razed|planned`
   → blocked (`CONSTRUCTION`), **even with `foot=designated`** — on a
   construction way that's the planned state, not walkable today.
4. `foot=yes|designated|permissive` → not blocked (overrides the rest).
5. `foot=no|private|use_sidepath` → blocked (`FOOT_FORBIDDEN`).
6. `access=no|private|customers` → blocked (`ACCESS_FORBIDDEN`).
7. `highway=motorway|motorway_link|trunk|trunk_link` → blocked (`MOTORWAY`).
8. Otherwise not blocked.

The routing profiles mirror this as their `norun` gate (see
[`ROUTING.md`](ROUTING.md)) — except that BRouter only knows
`construction|proposed|abandoned` among the not-built values.

## Running tracks — `interpretTrack`

`leisure=track` **and** `sport` containing `running` or `athletics`
(`;`/`,`-separated lists allowed). Without an explicit running sport,
`leisure=track` also covers ski slopes, horse/cycle/motor tracks, so those are
not shown. Tracks are routable only if they also carry a `highway` tag; the
route planner rewards metres run on them (BRouter itself doesn't see `leisure`).

## Barriers — `interpretBarrier`

Applied to nodes; returns `{ status, reason }` or `null`.

- **Skipped entirely:** any node with `door=*` or `entrance=*` (building /
  home entrances, e.g. `barrier=gate` + `entrance=home`), and `indoor=yes`.
- Tracked types: `gate, stile, kissing_gate, turnstile, full-height_turnstile,
  cattle_grid, bollard, block, chain, lift_gate, swing_gate, hampshire_gate,
  wicket_gate, sally_port, hedge, fence, wall, sliding_gate, log, debris`
  (`kerb` intentionally excluded — too common).
- **`blocked`** (red ✕): `foot=no|private`, or `access=no|private|customers`
  without a `foot=yes|designated|permissive` override. Also for a standalone
  access/foot-ban node without a `barrier` tag.
- **`passable`**: any other tracked barrier. Hidden by default.

## Runner POI — `interpretPoi`

Applied to nodes; `indoor=yes` is skipped. First match wins (water is most
useful mid-run):

| `poi_kind` | matched tags |
|---|---|
| `water` | `amenity=drinking_water\|water_point`; `man_made=water_tap` (unless `drinking_water=no`); `natural=spring` + `drinking_water=yes`; `amenity=fountain` + `drinking_water=yes` |
| `shelter` | `amenity=shelter`; any `shelter_type=*`; `tourism=picnic_site` |
| `viewpoint` | `tourism=viewpoint` |
| `toilets` | `amenity=toilets` |

## Pipeline filter

`scripts/02-filter.sh` keeps `w/highway`, `w|r/leisure=track`, barrier nodes,
`access`/`foot` ban nodes and the POI node tags above; everything else is
dropped before normalization.
