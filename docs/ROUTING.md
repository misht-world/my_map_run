# Routing

Route planning runs entirely in the browser against public, keyless services:

- **[BRouter](https://brouter.de)** computes the actual paths, with **our own
  foot profiles** uploaded at runtime.
- **Overpass** supplies local OSM data (stairs, crossings, lights, parks,
  tracks, POI, not-built ways, the path network) that we use to **score and
  choose between route candidates** — things BRouter can't express.

Code: `packages/web/src/routing.ts`, `route-planner.ts`, `loop-gen.ts`,
`loop-data.ts`, `pednet.ts`; profiles in `packages/web/profiles/`.
(`packages/routing-adapter` is an unused stub left from the MVP.)

## Modes (UI)

| Mode | Points | What it does |
|---|---|---|
| **Round trip (loop)** | start only | Generates a loop of the target distance from the start, on the button. Direction: 8-sector compass or *Auto*. **⇄ Reverse** flips the running direction. |
| **Point A → B** | start (S), vias (1, 2…), finish (F) | Auto-routes through the points as you add/drag them. Optional **target distance** → *Pad to distance* adds detours; *Other option ↻* cycles up to 4 alternatives. |
| Shape run (GPS art) | start | Fits a tree/heart/star onto the network (`shape-art.ts`). **Hidden** in the UI; code kept. |

Common behaviour:

- Profile / *Allow stairs* changes re-route A→B automatically but **never
  auto-generate a loop** — press *Generate* again.
- Generation is a **cancelable job**: a centred overlay shows progress and a
  *Cancel* button; editing points, switching mode or cancelling aborts it
  (an `AbortSignal` runs through `fetchRoute` and `fetchLoopData`), so no
  stale route appears later.
- The route line has **direction chevrons**; GPX export includes elevation.
- Status line: distance · ascent · time, plus (when local data loaded)
  `step-free` / `~N step pts`, `N traffic lights`, `… m on track`, `% park`.

## Profiles

Two BRouter foot profiles are generated from Poutnik's *Hiking-Mountain* base:

```bash
node packages/web/profiles/build-profiles.mjs
# → profiles/running-foot.brf, profiles/trail-foot.brf,
#   src/profiles.generated.ts (bundled into the app)
```

The generator applies structural edits to the base and then sets parameters:

| Param | Running | Trail | Meaning |
|---|---|---|---|
| `norun` gate | on | on | Mirrors the overlay's *can't run*: `highway=construction\|proposed\|abandoned` (checked first), then `foot=no\|private\|use_sidepath`, `access=no\|private\|customers` without a positive `foot`, motorway/trunk. Adds 100000 (≈ forbidden). |
| `allow_steps` | **false** | true | Stairs forbidden for Running unless *Allow stairs* is ticked (the app flips this in the uploaded text). |
| `steps_cost` | 14 | 2.5 | Stair cost multiplier when stairs are allowed. |
| `crossing_penalty` | 15 | 15 | Extra cost **per traffic-signal node** (`highway=traffic_signals`, `crossing=traffic_signals`). Marked/uncontrolled crossings are free, so the route crosses *at* them, not mid-road. |
| `path_extra` | 0.7 | 0 | Footway preferred over `highway=path`. |
| `service_extra` | 0.8 | 0.3 | Service/access roads only when no footway/path alternative. |
| `turncost_value` | 60 | 0 | Prefer straight lines over zig-zags. |
| `consider_elevation`, up/downhill cost | on, 10 | off | Flatter routes. |
| `consider_forest` / `consider_river` | on | on | Park / riverside lean (only water has an effect — see below). |
| `hiking_routes_preference` | 1.2 | 0.5 | Follow mapped foot/hiking networks. |
| `SAC_scale_limit` | 1 | 3 | No scrambling for Running. |

**Upload & fallback.** `routing.ts` uploads the profile text once per session
(cached per variant, e.g. running with/without stairs) and routes with the
returned `profileid`. If the upload or route fails it retries once, then falls
back to BRouter's built-in `hiking-beta` (which **uses stairs and ignores all
our tuning**).

### BRouter gotchas (learned the hard way)

- **Unknown tag values/keys break the profile at *route* time, not upload.**
  The upload returns a `profileid` *plus* an `error`, and every route then 500s
  → silent fallback to `hiking-beta`. Known offenders: `highway=disused|razed|planned`,
  `crossing=controlled`, and the keys `leisure` and `sport` don't exist in
  BRouter's lookup table. **Always verify a profile edit actually routes**
  (upload, then request a route and check for 200), not just that it uploads.
- **Node costs are per node.** OSM often splits one signalled crossing into
  3–5 `crossing=traffic_signals` nodes (lanes, tram tracks). A large per-node
  light penalty (40) made routes zig-zag around junctions to a crossing that
  happened to be tagged differently. Keep it small (15); count lights **per
  crossing** in candidate scoring instead.
- **Costfactor floors at 1.0**, so preferring a way type must be done by
  *penalising* the alternatives (`path_extra`, `service_extra`), not by
  discounting the preferred one.
- **No park/forest data on the public server** — `estimated_forest_class` is
  essentially empty, so `consider_forest` has no effect; only
  `consider_river` does. Parks are handled in candidate scoring.

## Local data for scoring (`loop-data.ts`)

One Overpass query per generation, for a bbox around the start (loop) or the
A→B midpoint (padded), with three mirrors and a 15 s timeout each:

| Data | Used for |
|---|---|
| Runnable `highway=*` network | `snap()` guide waypoints onto paths (≤ 60 m) |
| `highway=steps` | `stepHits()` — route vertices on stairs |
| `highway=crossing` nodes | `crossingHits()` — uncontrolled crossings, clustered 30 m |
| `highway=traffic_signals`, `crossing=traffic_signals\|controlled` | `signalHits()` — traffic lights, clustered 30 m (one crossing = one light) |
| parks / forest / grass polygons | `parkFraction()` |
| `leisure=track` + `sport=running\|athletics` | `trackMeters()` |
| construction / proposed / … ways | `notBuiltHits()` — disqualifies a candidate |
| viewpoints, springs, caves, water, monuments… | `attract()` guide waypoints within 40 m of a POI; `poiHits()` bonus |

If Overpass fails, generation still works; candidates are then ranked by
distance and backtracking only (no stairs/lights/park info in the status).

## Round-trip generation (`generateLoop`)

1. Load local data (above).
2. Build candidates: 3 outlines (`loop-gen.ts`: circle, oval, teardrop) × 6
   headings (*Auto*, jittered) or 3 headings around the chosen compass
   direction. Each outline is scaled to the target distance and anchored so
   its first vertex is the start.
3. Snap/attract the intermediate waypoints, route each candidate through
   BRouter (pool of 4 concurrent requests), then clean it: `trimSpurs`
   (out-and-back spikes) and `removeSmallLoops` (< 300 m self-loops).
4. Score (lower is better), Running:

   ```
   500·notBuilt + backtrack% + ascent/km + 1.2·stairPts
   + 3·lights + 0.8·crossings − 30·parkShare − 2.5·min(poi,10)
   − min(trackM,2000)/100 + 100·|dist − target|/target
   ```

   Trail keeps hills and stairs: `500·notBuilt + 1.2·backtrack + lights +
   0.3·crossings − 20·parkShare − poiBonus − trackBonus/2 + distPen`.
5. Re-route the winner scaled toward the target distance if it's > 8 % off,
   keep whichever scores better.

## Point A → B with a target distance (`generatePadded`)

The shortest route is shown automatically. With a target longer than it,
*Pad to distance* builds quadratic-Bézier bulges on both sides of A→B at five
heights (4 guide points each, snapped/attracted), routes them, scores them like
loops (without backtracking), and keeps the best 4 as cyclable options.

## Verifying changes

- Profiles: after `build-profiles.mjs`, upload each `.brf` and request a route
  (see the gotchas) — a 200 with a geometry is the only proof it works.
- Behaviour: compare old vs new profile on the same waypoints and measure
  stairs / lights / service share against Overpass data; user GPX tracks go in
  `gpx/` (git-ignored) for reproducing reported issues.
