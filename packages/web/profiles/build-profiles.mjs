// Generates BRouter foot profiles for the running map from a base hiking profile.
//
//   node build-profiles.mjs
//
// Reads _base-hiking.brf (Poutnik's Hiking-Mountain, foot profile — already
// prefers footway/path/sidewalk over roads) and emits two tuned variants:
//   running-foot.brf — urban running: avoid steps, penalize traffic-signal /
//                      crossing nodes, no scrambling, prefer paved paths.
//   trail-foot.brf   — trail running: steps allowed, unpaved/paths fine,
//                      light crossing penalty.
//
// Re-run this whenever the base profile is updated.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const base = readFileSync(join(here, "_base-hiking.brf"), "utf8");

/** Apply the structural edits shared by both variants. */
function transform(src) {
  let s = src;

  // 1) New tunable params, injected right after the stock `allow_steps` line.
  const allowStepsLine =
    "assign   allow_steps              true   # %allow_steps% | Set to false to disallow steps | boolean";
  if (!s.includes(allowStepsLine)) throw new Error("allow_steps anchor not found");
  s = s.replace(
    allowStepsLine,
    allowStepsLine +
      "\n" +
      "assign   steps_cost               6.0    # %steps_cost% | Cost multiplier for steps when allowed (higher = avoid stairs more) | number\n" +
      "assign   crossing_penalty         120    # %crossing_penalty% | Extra cost (approx. meters) added per traffic-signal crossing node | number\n" +
      "assign   path_extra               0.0    # %path_extra% | Extra cost on highway=path, to prefer footway over path | number"
  );

  // 2) Steps: finite, tunable penalty instead of the hard 1.0/3.0 choice, so
  //    stairs are avoided but still usable when there's no alternative.
  const stepsWay =
    "else if    highway=steps then ( switch allow_steps   ( switch consider_elevation 1.0 3.0 )     100000 )";
  if (!s.includes(stepsWay)) throw new Error("steps way anchor not found");
  s = s.replace(
    stepsWay,
    "else if    highway=steps then ( switch allow_steps   steps_cost                                 100000 )"
  );

  // 2a) Hard access block. Mirror the app's interpretNoRun so the router never
  //     routes where the overlay flags "can't run": foot=no/private/use_sidepath,
  //     access=no/private/customers (no positive foot tag), or a motorway/trunk.
  //     A positive foot permission overrides. We fold a huge penalty into
  //     accesspenalty (which propagates into the final costfactor), matching the
  //     profile's existing motorway=100000 "forbidden" treatment.
  const accessLine =
    "assign accesspenalty switch footaccess 0 switch bikeaccess 4 switch foot=use_sidepath 10 switch any_hiking_route 12 switch any_cycleroute 16 100000";
  if (!s.includes(accessLine)) throw new Error("accesspenalty anchor not found");
  s = s.replace(
    accessLine,
    "assign norun\n" +
      "       if   foot=yes|designated|permissive                     then false\n" +
      "       else if foot=no|private|use_sidepath                     then true\n" +
      "       else if access=no|private|customers                      then true\n" +
      "       else if highway=motorway|motorway_link|trunk|trunk_link  then true\n" +
      "       else false\n" +
      "assign accesspenalty add ( if norun then 100000 else 0 )\n" +
      "       ( switch footaccess 0 switch bikeaccess 4 switch foot=use_sidepath 10 switch any_hiking_route 12 switch any_cycleroute 16 100000 )"
  );

  // 2b) Turn cost: wire the (currently hard-zero) turncost to the header param
  //     so we can penalize sharp/zig-zag turns per profile. BRouter scales this
  //     by the turn angle, so sharper corners cost more.
  const turnLine = "assign turncost   0 #v1.8.3";
  if (!s.includes(turnLine)) throw new Error("turncost anchor not found");
  s = s.replace(turnLine, "assign turncost   turncost_value #v1.8.3");

  // 2d) Prefer footway over path: add path_extra to highway=path only. (The
  //     final costfactor floors at 1.0, so we penalize path rather than
  //     discount footway, which would be clamped away.)
  const istrackCost =
    "( add 1.0 add tracktype_penalty add surface_penalty      add wet_penalty        SAC_scale_penalty      )";
  if (!s.includes(istrackCost)) throw new Error("istrack costfactor anchor not found");
  s = s.replace(
    istrackCost,
    "( add ( if highway=path then ( add 1.0 path_extra ) else 1.0 ) add tracktype_penalty add surface_penalty      add wet_penalty        SAC_scale_penalty      )"
  );

  // 3) Node cost: keep the access gate, add a penalty for traffic-signal /
  //    crossing nodes so routes with many light-controlled crossings cost more.
  const nodeInit = "assign initialcost switch or bikeaccess footaccess 0 1000000";
  if (!s.includes(nodeInit)) throw new Error("node initialcost anchor not found");
  s = s.replace(
    nodeInit,
    "assign accessblock switch or bikeaccess footaccess 0 1000000\n" +
      "# Only signal-controlled crossings cost extra (waiting at lights). Marked /\n" +
      "# zebra / uncontrolled crossings are free so the router crosses AT them\n" +
      "# rather than detouring to jaywalk mid-road.\n" +
      "assign crossingcost\n" +
      "       if highway=traffic_signals       then crossing_penalty\n" +
      "       else if crossing=traffic_signals then crossing_penalty\n" +
      "       else 0\n" +
      "assign initialcost add accessblock crossingcost"
  );

  return s;
}

/** Override a header param's default value in-place. */
function setParam(src, name, value) {
  // Params come in two shapes: `assign name  <val>` and `assign name = <val>`.
  const re = new RegExp(`(assign\\s+${name}\\s+)(=\\s*)?\\S+`);
  if (!re.test(src)) throw new Error(`param ${name} not found`);
  return src.replace(re, `$1$2${value}`);
}

const common = transform(base);

// --- Running: urban, avoid stairs & signals, no scrambling, prefer paved ---
let running = common;
running = setParam(running, "SAC_scale_limit", "1"); // no mountain scrambling
running = setParam(running, "SAC_scale_preferred", "0");
running = setParam(running, "steps_cost", "8.0"); // strongly avoid stairs
running = setParam(running, "crossing_penalty", "60"); // mild dislike of traffic lights (not so high it jaywalks)
running = setParam(running, "path_extra", "0.7"); // prefer footway over path (noticeable, not a ban)
running = setParam(running, "consider_town", "false");
running = setParam(running, "consider_forest", "true"); // lean to parks / green areas
running = setParam(running, "consider_river", "true"); // lean to riverside / lakeside
running = setParam(running, "consider_elevation", "true"); // prefer flatter routes
running = setParam(running, "uphillcostvalue", "10"); // stronger avoidance of climbs
running = setParam(running, "downhillcostvalue", "10"); // ...and steep descents
running = setParam(running, "turncost_value", "40"); // avoid sharp / zig-zag turns
writeFileSync(join(here, "running-foot.brf"), running);

// --- Trail: paths/hills fine, steps allowed, light crossing penalty ---
let trail = common;
trail = setParam(trail, "SAC_scale_limit", "3");
trail = setParam(trail, "SAC_scale_preferred", "1");
trail = setParam(trail, "steps_cost", "2.5"); // steps ok, mild preference away
trail = setParam(trail, "crossing_penalty", "40");
trail = setParam(trail, "consider_forest", "true"); // lean toward green areas
trail = setParam(trail, "consider_river", "true"); // lean to riverside / lakeside
writeFileSync(join(here, "trail-foot.brf"), trail);

// The app bundles the profile text; emit it as a TS module so it lives under
// the web package's src rootDir (no Vite ?raw / out-of-root import needed).
const ts =
  "// AUTO-GENERATED by profiles/build-profiles.mjs — do not edit by hand.\n" +
  "// Source: profiles/*.brf (BRouter foot profiles). Re-run the generator to update.\n" +
  "/* eslint-disable */\n" +
  `export const RUNNING_FOOT_BRF = ${JSON.stringify(running)};\n\n` +
  `export const TRAIL_FOOT_BRF = ${JSON.stringify(trail)};\n`;
writeFileSync(join(here, "..", "src", "profiles.generated.ts"), ts);

console.log("wrote running-foot.brf, trail-foot.brf and src/profiles.generated.ts");
