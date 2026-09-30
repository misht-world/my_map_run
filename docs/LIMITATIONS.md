# Known limitations

## Data completeness (OSM)

- **The overlay only flags exceptions.** A way without a red dashed line is
  not a guarantee you can run there — access, sidewalks and barriers are
  incompletely mapped. Verify on the ground.
- **Access and barriers are patchy.** A gate with no `foot`/`access` tag is
  shown as *passable* even if it is locked in reality.
- **Tagging varies.** One signalled crossing may be mapped as several nodes,
  or with the older `crossing=controlled`; running tracks are often plain
  areas without a `highway` tag and can't be routed on.
- **POI coverage varies wildly** by region — it reflects mapping effort.

## Routing engine (public BRouter)

- **Unknown tag values break a profile** at route time (e.g.
  `highway=disused`, `crossing=controlled`, keys `leisure`/`sport`); the app
  then silently falls back to the built-in `hiking-beta` profile, which uses
  stairs and none of our tuning. See [`ROUTING.md`](ROUTING.md#brouter-gotchas-learned-the-hard-way).
- **No park/forest data** on the public server (`estimated_forest_class` is
  empty): park preference can only be done in our candidate scoring, and only
  works where parks are mapped as polygons. Real per-way green preference would
  need a self-hosted BRouter — decided against for now.
- **Node penalties are per node**, so traffic-light avoidance in the profile
  is kept deliberately mild; the per-crossing count lives in scoring.
- **Stairs** are forbidden for Running by default, but if they are the only
  connection a route will still use them (cost, not a hard wall).
- Public servers (BRouter, Overpass, Nominatim) have no SLA. When Overpass is
  slow or down, loops are still generated but without stairs / lights / park /
  POI information (the status line then shows only distance, ascent, time).
- Loop generation takes ~10–40 s (one Overpass query + ~18 BRouter routes);
  it can be cancelled at any time.

## No third-party activity heatmap

A "heatmap of other people's runs" layer is **not feasible for a free,
static, keyless site**: Strava's heatmap requires a login and its terms forbid
embedding or redistributing tiles; there's no free redistributable global
run-track source. Recognised foot/hiking route networks are used as a proxy
(`hiking_routes_preference`). Loading a user's **own** GPX/FIT files as a
private overlay is feasible (see ROADMAP).

## Rendering

- The dashed coverage outline is Geofabrik's `europe.poly`; outside it the
  overlay has no data.
- The raw-tag popup depends on Overpass; if it's down the popup still shows
  the normalized status and links.
