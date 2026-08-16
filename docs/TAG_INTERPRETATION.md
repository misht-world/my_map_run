# Tag interpretation

How OSM tags become the normalized fields embedded in tiles. The logic lives
in `packages/interpreter/src/` and is unit-tested in
`packages/interpreter/test/`. Confidence tiers (rather than a single
yes/no) let the user trade coverage against certainty via layer toggles —
the same "explicit vs ambiguous" idea used in `my_map-toll`.

## Runnable ways — `interpretFoot`

Applied to `highway=*` ways. Produces `{ tier, is_steps, reason }`, where
`tier` is `designated`, `allowed`, or `null` (drop the way).

Priority order (first match wins):

1. **Drop** — no `highway`, or a not-built/decommissioned value
   (`construction`, `proposed`, `abandoned`, `razed`, `disused`, `no`).
2. **Drop** — `foot=no|private|use_sidepath` (a hard foot ban overrides all).
3. `highway=motorway|trunk` (+`_link`) → **drop** (no pedestrians), unless
   `foot=yes|designated|permissive` (rare) → `allowed`.
4. `access=no|private` **and** no `foot=yes|designated|permissive` → **drop**.
5. **`designated`** if any of:
   - `foot=yes|designated|permissive`, or
   - `highway ∈ {footway, path, pedestrian, steps, track, bridleway,
     corridor, via_ferrata}`, or
   - a mapped sidewalk (`sidewalk=yes|both|left|right` or
     `sidewalk:left|right|both` ≠ `no|none|separate`).
6. **`allowed`** if `highway ∈ {residential, living_street, service,
   unclassified, tertiary, tertiary_link, road, cycleway}`.
7. Otherwise **drop** — notably `primary`/`secondary` (and links) **without**
   a mapped sidewalk: busy roads a runner should avoid.

`is_steps = highway === "steps"` — carried into tiles for a dashed render and,
later, an "avoid stairs" routing profile.

### Notes / known trade-offs

- Sidewalk tagging is sparse. A busy road with an unmapped sidewalk is
  dropped (false negative) rather than drawn as if runnable (false positive)
  — the `allowed` tier + toggle is the release valve for quieter roads.
- `cycleway` is placed in `allowed` (foot rules vary by country); a cycleway
  explicitly `foot=designated|yes` is promoted to `designated`.

## Barriers — `interpretBarrier`

Applied to nodes. Produces `{ status, reason }` or `null`.

- Tracked barrier types: `gate, stile, kissing_gate, turnstile,
  full-height_turnstile, cattle_grid, bollard, block, chain, lift_gate,
  swing_gate, hampshire_gate, wicket_gate, sally_port, hedge, fence, wall,
  sliding_gate, log, debris`. (`kerb` is intentionally excluded — too common.)
- **`blocked`** (red ✕) — `foot=no|private`, or `access=no|private` without a
  `foot=yes|designated|permissive` override. Also emitted for a standalone
  `access=no|private` / `foot=no|private` node even without a `barrier` tag.
- **`passable`** — a tracked barrier a pedestrian can pass. Off by default.

## Runner POI — `interpretPoi`

Applied to nodes. First match wins (water is most useful mid-run):

| `poi_kind` | matched tags |
|---|---|
| `water` | `amenity=drinking_water\|water_point`; `man_made=water_tap` (unless `drinking_water=no`); `natural=spring` + `drinking_water=yes`; `amenity=fountain` + `drinking_water=yes` |
| `shelter` | `amenity=shelter`; any `shelter_type=*`; `tourism=picnic_site` |
| `viewpoint` | `tourism=viewpoint` |
| `toilets` | `amenity=toilets` |
