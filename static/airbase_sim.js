// The airbase security simulator: four stationary cameras fixed along the perimeter
// line, two patrol robots riding a straight rail below it, and whatever is moving in the
// ground above.
//
// THE LAYOUT, IN ONE SENTENCE. The canvas is divided by a horizontal line: the airbase is
// BELOW it, the hostile exterior is ABOVE it, and every one of the six sensors is mounted
// on or just behind that line looking up into the exterior. Intruders come from the top
// edge and walk down through the line.
//
// WHY THAT ORIENTATION DOES THE GEOMETRY WORK FOR US. A camera is a wedge anchored at a
// point on the line, aimed straight up. Near the line the wedge is only a few px wide, so
// the four cameras leave real GAPS low down even though their sectors overlap at range.
// An intruder can therefore be inside the wire and invisible — not because a random roll
// said so, but because no camera's triangle contains that point. That is the demo's
// subject and it is a property of the drawing, which the tests check.
//
// WHAT THIS MODULE OWNS, AND WHAT IT DOES NOT. It owns geometry, the six sensors, the
// intruder tracks, sensor health, and the raw reports each unit produces. It does NOT own
// the verdict: whether those reports mean danger, not sure or safe is declared as axioms
// in airbase_ontology.js. The split is the same one traffic_sim.js makes — this file
// produces facts, the ontology decides what they mean. Imports run one way.
//
// THE SIX UNITS ARE NOT INTERCHANGEABLE. A camera watches one fixed wedge of the exterior
// and cannot classify what it sees. A rail patrol sees a radius around its position and,
// at close range, classifies the contact as a person or a vehicle. That difference is why
// the demo has a corroboration rule at all: a camera contact is a report, a patrol
// classification is an identification.
//
// NOTHING HERE TOUCHES THE DOM OR THE NETWORK, so `node --test test_airbase_sim.mjs`
// drives this module rather than a copy of it. The seeded PRNG (shared with the other
// simulators) makes a scenario replay identically in the browser and the harness.
//
// THE SIM KNOWS THE GROUND TRUTH AND THE MODEL NEVER SEES IT. `truthFor()` is for the
// page's own readout; `buildState()` contains only what the sensors reported. A test
// asserts that an intruder the sensors cannot see leaves the state unchanged — if that
// ever fails, the state has become a cheat sheet rather than an observation.

import { mulberry32 } from "./rng.js";

export { mulberry32 };

// ---- canvas + the perimeter line ------------------------------------------------------

export const W = 620;
export const H = 460;
export const CANVAS_BG = "#0b1220";

/**
 * The horizontal line the whole demo is built around.
 *
 * `FENCE_Y` is the wire. Everything above it is exterior; everything below it is the
 * airbase. The rail sits just behind the wire so the patrols read as a second, mobile
 * line of defence rather than as traffic on the fence.
 */
export const FENCE_Y = 292;
export const FENCE_X0 = 56;
export const FENCE_X1 = 564;

export const RAIL_Y = 330;
export const RAIL_X0 = FENCE_X0;
export const RAIL_X1 = FENCE_X1;
export const RAIL_MID = (RAIL_X0 + RAIL_X1) / 2;
export const RAIL_PAD = 26;          // how far a patrol stops from the rail's end
export const ROBOT_R = 8;
export const ROBOT_SPEED = 54;       // px per second

/** The airbase itself: the fenced ground below the line. */
export const BASE = Object.freeze({ x0: FENCE_X0, y0: FENCE_Y, x1: FENCE_X1, y1: 442 });

export const CAMERA_HALF_FOV = (34 * Math.PI) / 180;   // 34 degrees either side of up
export const CAMERA_RANGE = 232;                       // px, measured from the fence line
export const CAMERA_LEN = 10;                          // housing is a small block on the line
export const CAMERA_WID = 14;

/**
 * How thick the perimeter WALL is drawn.
 *
 * The cameras and the wall are one structure: the four units are mounted on it, and the
 * wall is what separates the exterior from the base. The rail is a separate track further
 * inside — `RAIL_Y` — and it is only there for the patrols. Keeping the two visually and
 * nominally distinct is the point; the wall is not a rail.
 */
export const WALL_HEIGHT = 12;

export const RAIL_RANGE = 105;       // a patrol sees this far around itself
// How close a patrol must be to name a track. Measured from the rail, so an intruder at
// the wall is ~52 px away directly above it and further as the patrol sweeps — 62 px only
// allowed classification on the few frames a patrol was almost exactly beneath a target,
// and a track at a wall end was never identified at all. 110 px covers a patrol anywhere
// within a third of the rail of the target.
export const CLASSIFY_RANGE = 110;

export const CONTACT_WINDOW_MS = 3500;  // a report stays live this long after last seeing it
export const CONTACT_FADED_MS = 12000;  // and is remembered this long for `contact_age`

// Speeds are per SECOND and the canvas is 460 px tall, so these numbers are the whole
// pacing of the demo: at 26 px/s a full approach took minutes and the page looked frozen.
// 78 px/s crosses the 276 px from the top edge to the wire in ~3.5 s.
export const INTRUDER_SPEED = 78;        // px per second
export const INTRUDER_R = 5;
// SPAWNING is spaced against the loiter, not against the walk-in. With a three-minute
// loiter a 20 s spawn gap would put four intruders at the wall inside a minute and hold
// them there; this keeps it to roughly one at the wall, occasionally two, which is what a
// perimeter watch actually looks like.
export const SPAWN_MIN_MS = 45000;
export const SPAWN_MAX_MS = 80000;
export const SPAWN_RETRY_MS = 4000;       // how soon to try again when the wall is occupied
export const FIRST_SPAWN_MS = 3000;
export const MAX_INTRUDERS = 4;

// ---- the interceptor -------------------------------------------------------------------
//
// WHAT IT IS FOR. A confirmed intruder used to stand at the wire until its dwell timer ran
// out and then walk back out, so the demo spent most of its time showing a resolved danger
// with nothing happening. The interceptor closes that loop: when the rule says DANGER and
// an intruder is on the base side of the wire, a vehicle drives to it, freezes it, and a
// fresh intruder takes its place.
//
// IT IS TRIGGERED BY THE VERDICT, NOT BY A TIMER. The page calls `intercept()` only when
// the ENFORCED verdict is danger — so removing the danger-granting axioms in the live
// editor visibly stops the response too, which is the point of declaring the rule rather
// than writing an `if`. The sim owns the vehicle's motion and the freeze; it does not
// decide when to send it.
//
export const INTERCEPT_SPEED = 250;      // px per second, deliberately faster than an intruder
// Far enough behind the rail that the vehicle never overlaps a patrol: they are drawn at
// RAIL_Y with a 26 px radius, so the road sits a clear band below them.
export const INTERCEPT_Y = RAIL_Y + 62;
export const INTERCEPT_FREEZE_MS = 2200; // how long it holds an intruder before taking it
export const INTERCEPT_REACH = 14;       // px, close enough to clamp on
export const INTERCEPT_DEPART_X = -40;   // where the vehicle starts and returns to

// ---- the searchlight tower ---------------------------------------------------------------
//
// A tower in the middle of the lower airbase. It is a RESPONSE, not a sensor: it does not
// add to what the six units report and it is not part of the state the model reads. It
// lights the wall when a track is being dealt with, and stays lit until that track is
// gone — so the page shows the perimeter doing something about a contact rather than only
// describing it.
//
// `tracked` is what turns it on: anything at the wall or frozen. That deliberately
// includes an ANIMAL, because a light is the proportionate response to motion you have not
// identified yet, and because the light going out is how you see it has been resolved.
export const TOWER = Object.freeze({
  x: (FENCE_X0 + FENCE_X1) / 2,
  y: 408,
  baseW: 18,
  baseH: 7,
  height: 34,
});
/** How far the beam reaches, and how wide it opens. */
// Reaches the far end of the wall: the tower sits centre-base at y=374 and the wall runs
// to x=96/x=564, so the corner is ~250 px away. A shorter throw left the wall ends
// permanently unlit — and, because identification now requires the light, permanently
// unclassifiable.
export const TOWER_BEAM_RANGE = 290;
export const TOWER_BEAM_HALF_FOV = (14 * Math.PI) / 180;
/** The rest position: straight up at the wall, before anything is tracked. */
export const TOWER_BEAM_ANGLE = -Math.PI / 2;
/** Radians per tick the beam swings. ~90 deg/sec at 20 ticks a second. */
// Radians per millisecond. Sized so the beam catches a track before the patrol that would
// identify it has swept clear: at 0.0016 a lamp took ~1.5 s to reach a target 60 deg away,
// by which time the patrol had moved out of range and the contact stayed unclassified.
export const TOWER_TURN_RATE = 0.006;
export const INTERCEPT_MAX_MS = 9000;    // abort if it cannot reach the target in this long

// ---- sensor faults -----------------------------------------------------------------------
//
// PACED SO THEY READ AS EVENTS. The first version gave each unit an independent fault roll
// every few seconds, so with six units a camera was almost always down and the page's
// resting verdict was "not sure". These constants make a fault a thing that happens
// roughly once every couple of minutes, one unit at a time, and not in the first few
// seconds of a run.
export const FAULT_GRACE_MS = 20000;
export const FAULT_MIN_MS = 5000;
export const FAULT_MAX_MS = 9000;
export const FAULT_GAP_MIN_MS = 70000;
export const FAULT_GAP_MAX_MS = 120000;

/** Where an intruder appears: the top edge, across the width of the wire. */
export const SPAWN_MARGIN = 24;
export const SPAWN_Y = 16;
/**
 * Where an intruder is stopped, measured from the wall's centre line, in px, OUTWARD.
 *
 * THE WALL IS A BARRIER AND THE INTRUDER NEVER GETS PAST IT. It approaches from the
 * exterior, is stopped flush against the wall's OUTER face — still above the wall's centre
 * line, still on the hostile side — stands there for `LOITER_MS`, then walks back the way
 * it came. It never crosses into the base, never reaches the rail.
 *
 * The stop point is derived from the wall's drawn thickness rather than tuned by eye, so
 * the body always rests against the face it is blocked by: half the wall, plus the
 * intruder's own radius, plus a hair. A camera looking up cannot see it there (it is at the
 * camera's own mounting line), which is why the patrols exist — they look up from the rail
 * and see this band.
 */
export const INTRUDER_STOP_OFFSET = WALL_HEIGHT / 2 + INTRUDER_R + 3;

/** @deprecated kept as the old name; the stop is above the wall, not a crossing. */
export const CROSSING_DEPTH = -INTRUDER_STOP_OFFSET;

/**
 * How long an intruder stands AT THE WALL before turning back — three minutes.
 *
 * This is the demo's pacing, not an accident: a loiter that ends in a few seconds gives the
 * page nothing to watch, and one that never ends leaves the same "danger" on screen with
 * nothing changing. Three minutes is long enough to see the verdict and the interceptor
 * resolve, and short enough that a visitor sees a full cycle.
 */
export const LOITER_MS = 180000;

export const DECIDE_INTERVAL_MS = 1200;

export const SENSOR_STATUS = Object.freeze({
  ONLINE: "online",
  DEGRADED: "degraded",
  OFFLINE: "offline",
});

/** The three verdicts, most severe first. These strings are the model's option labels. */
export const VERDICT = Object.freeze({
  DANGER: "danger",
  NOT_SURE: "not sure",
  SAFE: "safe",
});
export const VERDICT_ORDER = Object.freeze([VERDICT.DANGER, VERDICT.NOT_SURE, VERDICT.SAFE]);

/** The everyday postures. `danger` is escalation-only — see airbase_ontology.js. */
export const BASE_VERDICT_SET = Object.freeze([VERDICT.NOT_SURE, VERDICT.SAFE]);

/**
 * What may cross the approach, and which of those are threats.
 *
 * A PERSON OR A VEHICLE IS A THREAT; AN ANIMAL IS NOT. That distinction is the whole point
 * of classifying rather than detecting: a camera can only say "something moved", and a fox
 * moving is not an intrusion. Only a patrol robot's close-range identification can tell
 * them apart, which is why `THREAT_KINDS` is consulted only there — a corroborated contact
 * that nobody has identified is still unresolved, and stays `not sure`.
 *
 * The animal exists so the demo can show a *correct* `safe` on a picture that contained
 * motion: the sensors fired, the rule did not. Without it, every run with a contact ends in
 * danger and the page never demonstrates discrimination, only escalation.
 */
export const INTRUDER_KINDS = Object.freeze(["person", "vehicle", "animal"]);
export const THREAT_KINDS = Object.freeze(["person", "vehicle"]);
export const isThreat = kind => THREAT_KINDS.includes(kind);

// ---- the six units ----------------------------------------------------------------------

/**
 * The four cameras, evenly spaced along the wire, each aimed straight up.
 *
 * `dirX/dirY` is (0, -1): up the canvas is negative y. The spacing and the half-fov are
 * what create the low-altitude gaps between wedges — see the header. Changing either
 * changes how often an intruder is genuinely unseen, which is a measured property
 * (`test_airbase_sim.mjs` counts it across seeds).
 */
export const CAMERA_XS = Object.freeze([96, 232, 368, 504]);

/**
 * The six security units. Frozen: nothing may add, move or re-aim one at runtime.
 *
 * `group` is the independence unit for corroboration. Each camera is its own group; both
 * rail patrols share one, because they look at the same band from the same line — a
 * contact one patrol saw and the other saw is not two independent observations.
 */
export const SENSORS = Object.freeze([
  ...CAMERA_XS.map((x, i) => Object.freeze({
    // Named by position along the wire rather than by compass corner: the line is the
    // only axis this perimeter has.
    id: `camera_${i + 1}`,
    kind: "camera",
    label: `camera ${i + 1}`,
    x,
    y: FENCE_Y,
    dirX: 0,
    dirY: -1,
    group: `camera_${i + 1}`,
    sector: Object.freeze({ cx: x, cy: FENCE_Y, angle: -Math.PI / 2 }),
  })),
  Object.freeze({ id: "rail_1", kind: "patrol", label: "rail patrol 1", group: "rail",
    half: "west" }),
  Object.freeze({ id: "rail_2", kind: "patrol", label: "rail patrol 2", group: "rail",
    half: "east" }),
]);

export const SENSOR_IDS = Object.freeze(SENSORS.map(s => s.id));
export const sensorById = id => SENSORS.find(s => s.id === id) || null;

// ---- pure geometry ----------------------------------------------------------------------

/** Is this point on the airbase side of the wire? */
export function pointInBase(x, y, box = BASE) {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}

/** Is this point in the exterior the sensors watch? */
export function pointInExterior(x, y) {
  return y < FENCE_Y;
}

/**
 * Does a camera see this point?
 *
 * Range first, then the angle — both are facts, not rolls. The `along` term is the cosine
 * of the angle between the aim and the bearing, so this is a wedge test rather than a
 * pair of box tests, which is what makes the gaps between cameras real.
 */
export function cameraSees(camera, x, y, { range = CAMERA_RANGE, halfFov = CAMERA_HALF_FOV } = {}) {
  const dx = x - camera.x;
  const dy = y - camera.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;
  if (dist > range) return false;
  const along = (dx * camera.dirX + dy * camera.dirY) / dist;
  return along >= Math.cos(halfFov);
}

/** Does a patrol see this point? A radius around its current rail position. */
export function patrolSees(robot, x, y, range = RAIL_RANGE) {
  return Math.hypot(x - robot.x, y - RAIL_Y) <= range;
}

export function robotBounds(robot) {
  return robot.half === "west"
    ? { lo: RAIL_X0 + RAIL_PAD, hi: RAIL_MID - ROBOT_R - 2 }
    : { lo: RAIL_MID + ROBOT_R + 2, hi: RAIL_X1 - RAIL_PAD };
}

/**
 * Is this spawn line-of-sight blocked by the geometry alone?
 *
 * Exported so the tests can ask "where are the gaps?" without driving a sim, and so the
 * page could draw them if it ever wanted to. A point is covered when at least one online
 * camera's wedge contains it.
 */
export function coveredByCameras(x, y) {
  return SENSORS.some(s => s.kind === "camera" && cameraSees(s, x, y));
}

// ---- the sim ----------------------------------------------------------------------------

/**
 * A fresh world.
 *
 * `sim` is mutable — the PRNG and the clock have to advance — which is the same
 * `createSim`/`step` shape the other simulators use. The individual records are plain
 * objects; nothing here freezes them, because the browser renderer reads them every frame.
 */
export function createSim({ seed = 1, config = {} } = {}) {
  const rng = mulberry32(seed);
  const sensors = {};
  for (const cfg of SENSORS) {
    sensors[cfg.id] = {
      id: cfg.id,
      status: SENSOR_STATUS.ONLINE,
      lastContactAt: -Infinity,
      lastKind: null,
      contactId: null,
      // Staggered so the first fault does not arrive on top of the first intruder.
      // First eligible fault, after the grace period. Staggered so the seeded run does not
      // always break the same unit first.
      nextFaultAt: FAULT_GRACE_MS + Math.floor(rng() * FAULT_GAP_MIN_MS),
      faultUntil: 0,
    };
  }
  return {
    rng,
    seed,
    config,
    clock: 0,
    tick: 0,
    sensors,
    robots: [
      { id: "rail_1", half: "west", x: RAIL_X0 + RAIL_PAD + 10, dir: 1 },
      { id: "rail_2", half: "east", x: RAIL_X1 - RAIL_PAD - 10, dir: -1 },
    ],
    intruders: [],
    // The interceptor vehicle. `phase` is idle | out | holding | returning.
    interceptor: {
      x: INTERCEPT_DEPART_X,
      phase: "idle",
      targetId: null,
      holdUntil: 0,
      startedAt: 0,
    },
    // The searchlight. `on` is derived every tick from what is at the wall; `since` lets
    // the page animate a lamp warming up rather than snapping it.
    tower: { on: false, since: 0, aim: TOWER_BEAM_ANGLE, litTargetId: null },
    nextId: 1,
    nextSpawnAt: FIRST_SPAWN_MS,
    nextFaultAt: FAULT_GRACE_MS + rng() * FAULT_GAP_MIN_MS,
    counters: { spawned: 0, inside: 0, contacts: 0, unseenInside: 0, intercepted: 0 },
  };
}

function stepRobots(sim, dt) {
  const step = (ROBOT_SPEED * dt) / 1000;
  for (const robot of sim.robots) {
    const { lo, hi } = robotBounds(robot);
    robot.x += robot.dir * step;
    if (robot.x <= lo) { robot.x = lo; robot.dir = 1; }
    if (robot.x >= hi) { robot.x = hi; robot.dir = -1; }
  }
}

function stepIntruders(sim, dt) {
  const step = (INTRUDER_SPEED * dt) / 1000;
  const survivors = [];
  for (const intruder of sim.intruders) {
    // A frozen intruder does not walk. Its x is held by the interceptor; letting the
    // route logic run would drag it back onto its old path while the vehicle holds it.
    if (intruder.phase === "frozen") {
      survivors.push(intruder);
      continue;
    }
    if (intruder.phase === "at-wall") {
      if (sim.clock < intruder.waitUntil) {
        survivors.push(intruder);
        continue;
      }
      // It has stood at the wall long enough and gives up. Back out the way it came;
      // reaching the top edge removes it, which is how a track ends.
      intruder.phase = "leaving";
      intruder.route = [{ x: intruder.laneX, y: SPAWN_Y }];
      intruder.leg = 0;
    }
    const target = intruder.route[intruder.leg];
    if (!target) { survivors.push(intruder); continue; }
    const dx = target.x - intruder.x;
    const dy = target.y - intruder.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step) {
      intruder.x = target.x;
      intruder.y = target.y;
      intruder.leg += 1;
      if (intruder.phase === "approach" && intruder.leg >= intruder.route.length) {
        // It is AT THE WALL, not inside. The wall stops it here for LOITER_MS.
        intruder.phase = "at-wall";
        intruder.waitUntil = sim.clock + LOITER_MS;
        sim.counters.inside += 1;
        // Count how often something reaches the wall that no camera can see. This is the
        // demo's premise measured live, not a claim in a comment.
        if (!coveredByCameras(intruder.x, intruder.y)) sim.counters.unseenInside += 1;
      } else if (intruder.phase === "leaving" && intruder.leg >= intruder.route.length) {
        continue;   // off the top edge
      }
    } else {
      intruder.x += (dx / dist) * step;
      intruder.y += (dy / dist) * step;
      intruder.heading = Math.atan2(dy, dx);
    }
    survivors.push(intruder);
  }
  sim.intruders = survivors;
}

function stepFaults(sim) {
  // The page's toggle. Defaults to on: a perimeter demo that never goes blind cannot show
  // the one rule it exists for ("a blind sector is not a clean sector"). Turning it off
  // leaves the manual "take a unit down" buttons working.
  if (sim.config.faults === false) return;

  // Bring anything whose fault has expired back online. Nothing else happens on this tick:
  // a fault clearing is its own event, and letting it coincide with the next one starting
  // is how "one unit at a time" turns back into continuous downtime.
  let cleared = false;
  for (const sensor of Object.values(sim.sensors)) {
    if (sensor.status !== SENSOR_STATUS.ONLINE && sim.clock >= sensor.faultUntil) {
      sensor.status = SENSOR_STATUS.ONLINE;
      cleared = true;
    }
  }
  if (cleared) {
    sim.nextFaultAt = sim.clock + faultGapMs(sim);
    return;
  }

  // AT MOST ONE UNIT IS OUT AT A TIME, on ONE global timer.
  //
  // The previous version gave every unit its own fault roll. Six independent rolls make a
  // fault nearly continuous — measured at 20 events in six minutes, which is more than one
  // per twenty seconds — so "blind" became the page's resting state rather than an event
  // worth looking at. One timer, one unit, one recover-then-wait cycle.
  if (Object.values(sim.sensors).some(s => s.status !== SENSOR_STATUS.ONLINE)) return;
  if (sim.clock < sim.nextFaultAt) return;

  const online = Object.values(sim.sensors).filter(s => s.status === SENSOR_STATUS.ONLINE);
  if (!online.length) return;
  const victim = online[Math.floor(sim.rng() * online.length)];
  victim.status = sim.rng() < 0.6 ? SENSOR_STATUS.OFFLINE : SENSOR_STATUS.DEGRADED;
  victim.faultUntil = sim.clock + FAULT_MIN_MS + sim.rng() * (FAULT_MAX_MS - FAULT_MIN_MS);
  // The next fault is armed when this one clears (above), so the gap is a real gap.
}

function faultGapMs(sim) {
  return FAULT_GAP_MIN_MS + sim.rng() * (FAULT_GAP_MAX_MS - FAULT_GAP_MIN_MS);
}

/**
 * The searchlight follows the TRACK, not the verdict.
 *
 * It lights the track it is following and goes out the instant the last such track leaves
 * the map. Deriving it from the intruders rather than from an explicit `lightOn()` call
 * means it cannot be left burning after a page stops stepping, and it cannot be lit by a
 * rule the ontology no longer declares.
 *
 * THE BEAM AIMS AT THE TRACK, which is what makes the light a real mechanism rather than a
 * decoration. `tower.aim` is the direction the lamp is pointing, and `litTargetId` names
 * what it is pointing at. `lit()` is the predicate the patrols consult: a unit can only
 * identify a track that the beam is actually on, so the geometry of the aim decides what
 * is classifiable. A fixed straight-up beam could not express that — every track at the
 * wall would be "lit" by definition and the light would be a flag wearing a triangle.
 *
 * If several tracks are at the wall the beam follows the one it already holds, and only
 * retargets when that one is gone; a lamp that jumps between two shadows every frame shows
 * neither of them.
 */
function stepTower(sim, dt = 50) {
  const tracked = sim.intruders.filter(i => i.phase === "at-wall" || i.phase === "frozen");
  if (!tracked.length) {
    sim.tower.on = false;
    sim.tower.since = 0;
    sim.tower.litTargetId = null;
    sim.tower.aim = TOWER_BEAM_ANGLE;
    return;
  }
  if (!sim.tower.on) {
    sim.tower.on = true;
    sim.tower.since = sim.clock;
    sim.tower.litTargetId = null;
  }
  // Hold the current target while it is still there, else pick the nearest the lamp can
  // physically reach.
  let target = tracked.find(i => i.id === sim.tower.litTargetId);
  if (!target) {
    target = tracked.reduce((best, i) => {
      const d = Math.hypot(i.x - TOWER.x, i.y - (TOWER.y - TOWER.height));
      const bd = Math.hypot(best.x - TOWER.x, best.y - (TOWER.y - TOWER.height));
      return d < bd ? i : best;
    });
    sim.tower.litTargetId = target.id;
  }
  // Aim at it, easing rather than snapping so the beam reads as a lamp being swung.
  const lampX = TOWER.x;
  const lampY = TOWER.y - TOWER.height;
  const wanted = Math.atan2(target.y - lampY, target.x - lampX);
  // Radians per millisecond, so the swing is the same speed at any frame rate.
  sim.tower.aim = approachAngle(sim.tower.aim, wanted, TOWER_TURN_RATE * dt);
}

/** Shortest-path angle approach, so a beam crossing straight-down does not spin. */
function approachAngle(current, wanted, maxStep) {
  let delta = ((wanted - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  if (Math.abs(delta) <= maxStep) return wanted;
  return current + Math.sign(delta) * maxStep;
}

/**
 * Is this point inside the searchlight beam right now?
 *
 * The same wedge test the cameras use, anchored at the lamp and aimed by `tower.aim`, so
 * "lit" is a geometric fact rather than a boolean set by the page. Patrol identification
 * consults this: a track lit only in the page's imagination is not identifiable.
 */
export function litByTower(sim, x, y) {
  if (!sim.tower.on) return false;
  const lampX = TOWER.x;
  const lampY = TOWER.y - TOWER.height;
  const dx = x - lampX;
  const dy = y - lampY;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;
  if (dist > TOWER_BEAM_RANGE) return false;
  const along = (dx * Math.cos(sim.tower.aim) + dy * Math.sin(sim.tower.aim)) / dist;
  return along >= Math.cos(TOWER_BEAM_HALF_FOV);
}

/** Which intruder (if any) each unit can see right now, and whether it can name it. */
function stepDetections(sim) {
  const patrolX = Object.fromEntries(sim.robots.map(r => [r.id, r.x]));
  for (const cfg of SENSORS) {
    const sensor = sim.sensors[cfg.id];
    if (sensor.status === SENSOR_STATUS.OFFLINE) continue;
    let hit = null;
    for (const intruder of sim.intruders) {
      const originX = cfg.kind === "camera" ? cfg.x : patrolX[cfg.id];
      const originY = cfg.kind === "camera" ? FENCE_Y : RAIL_Y;
      const seen = cfg.kind === "camera"
        ? cameraSees(cfg, intruder.x, intruder.y)
        : patrolSees({ x: patrolX[cfg.id] }, intruder.x, intruder.y);
      if (!seen) continue;
      const dist = Math.hypot(intruder.x - originX, intruder.y - originY);
      if (!hit || dist < hit.dist) hit = { intruder, dist };
    }
    if (!hit) continue;
    if (hit.intruder.id !== sensor.contactId) {
      sensor.contactId = hit.intruder.id;
      sensor.lastKind = null;
      sim.counters.contacts += 1;
    }
    sensor.lastContactAt = sim.clock;
    // Only a patrol identifies, and only when the SEARCHLIGHT IS ON THE TARGET. A camera
    // reports that something is there; a patrol close enough can say what it is — but only
    // if it can see it, and the beam is what makes it visible.
    //
    // `litByTower` is a geometric test against the beam's actual aim, not a flag: the lamp
    // swings, so a track the beam has not reached yet is genuinely unclassifiable and stays
    // `contact (unclassified)` until the light arrives. That delay is the point — it is
    // what the tower buys, and it is why the animal/threat distinction is unavailable in
    // the dark.
    if (cfg.kind === "patrol" && hit.dist <= CLASSIFY_RANGE &&
        litByTower(sim, hit.intruder.x, hit.intruder.y)) {
      sensor.lastKind = hit.intruder.kind;
    }
  }
}

/** Advance the world by `dt` milliseconds. */
export function step(sim, dt) {
  sim.clock += dt;
  sim.tick += 1;
  stepRobots(sim, dt);
  stepIntruders(sim, dt);
  stepInterceptor(sim, dt);
  stepFaults(sim);
  // The light is decided before the units look: a patrol can only identify what the
  // searchlight has lit, so computing the light after detection would make identification
  // lag one frame behind the light that enabled it.
  stepTower(sim, dt);
  stepDetections(sim);
  if (sim.clock >= sim.nextSpawnAt) {
    const spawned = spawnIntruder(sim);
    // If the wall was occupied the spawn was refused; retry soon rather than wait a whole
    // spawn interval, so an intruder appears shortly after the wall clears instead of up
    // to 80 s later.
    sim.nextSpawnAt = spawned
      ? sim.clock + SPAWN_MIN_MS + sim.rng() * (SPAWN_MAX_MS - SPAWN_MIN_MS)
      : sim.clock + SPAWN_RETRY_MS;
  }
  return sim;
}

// ---- the interceptor ---------------------------------------------------------------------

/**
 * Send the interceptor after the intruder nearest the wire.
 *
 * Called by the page only when the ENFORCED verdict is `danger` — the response is part of
 * the declared rule, not a timer, so deleting the danger axioms in the live editor stops it
 * too. Idempotent while a run is in progress: a second call during `out` or `holding`
 * retargets nothing, because two vehicles converging on one intruder would be a second
 * story the page never tells.
 *
 * Only intruders on the BASE side of the wire are candidates. A contact still in the
 * exterior may yet be a coyote; one that has crossed is the one the rule confirmed.
 *
 * Returns the target intruder, or null if nothing was eligible.
 */
export function intercept(sim) {
  const vehicle = sim.interceptor;
  if (vehicle.phase !== "idle") return null;
  // "Crossed the wire" is a POSITION, not a phase: an intruder on the last leg of its
  // approach has already crossed even though its phase has not flipped yet, and refusing
  // it here would make the vehicle abort a run it had just accepted.
  // A candidate is anything pinned AT the wall. It is above the wall's centre line — the
  // barrier is what stops it, so nothing is ever on the base side — which is why this asks
  // about the phase rather than about `y`.
  const candidates = sim.intruders.filter(
    i => i.phase === "at-wall" || i.phase === "frozen");
  if (!candidates.length) return null;
  const target = candidates.reduce((best, i) =>
    Math.abs(i.x - vehicle.x) < Math.abs(best.x - vehicle.x) ? i : best);
  vehicle.phase = "out";
  vehicle.targetId = target.id;
  vehicle.startedAt = sim.clock;
  return target;
}

/** Put the vehicle back at the depot, discarding any run in progress. */
export function recallInterceptor(sim) {
  const vehicle = sim.interceptor;
  const target = sim.intruders.find(i => i.id === vehicle.targetId);
  if (target && target.phase === "frozen") target.phase = "at-wall";
  vehicle.phase = "idle";
  vehicle.targetId = null;
  vehicle.holdUntil = 0;
  vehicle.x = INTERCEPT_DEPART_X;
}

/**
 * Advance the vehicle.
 *
 * `out` drives to the target; `holding` freezes it for INTERCEPT_FREEZE_MS; then the
 * intruder is removed, a replacement is spawned, and the vehicle drives back to the depot.
 * A target that leaves the base side on its own (its dwell expired) aborts the run rather
 * than chasing it into the exterior, which is a different kind of story.
 */
function stepInterceptor(sim, dt) {
  const vehicle = sim.interceptor;
  const step = (INTERCEPT_SPEED * dt) / 1000;

  if (vehicle.phase === "idle") return;

  if (vehicle.phase === "returning") {
    vehicle.x -= step;
    if (vehicle.x <= INTERCEPT_DEPART_X) {
      vehicle.x = INTERCEPT_DEPART_X;
      vehicle.phase = "idle";
    }
    return;
  }

  const target = sim.intruders.find(i => i.id === vehicle.targetId);

  if (vehicle.phase === "out") {
    // Abandon if the target is gone, has started walking back out, or is being held by
    // nobody (a frozen one cannot be, since only this vehicle freezes).
    if (!target || target.phase === "leaving") {
      vehicle.phase = "returning";
      vehicle.targetId = null;
      return;
    }
    const dx = target.x - vehicle.x;
    const dist = Math.abs(dx);
    if (dist <= INTERCEPT_REACH || sim.clock - vehicle.startedAt >= INTERCEPT_MAX_MS) {
      // Clamp on: it holds the intruder still and the intruder stops moving.
      vehicle.x = target.x;
      target.phase = "frozen";
      target.x = vehicle.x;
      vehicle.phase = "holding";
      vehicle.holdUntil = sim.clock + INTERCEPT_FREEZE_MS;
      sim.counters.intercepted += 1;
      return;
    }
    vehicle.x += Math.sign(dx) * Math.min(step, dist);
    return;
  }

  if (vehicle.phase === "holding") {
    if (target && target.phase === "frozen") target.x = vehicle.x;
    if (sim.clock < vehicle.holdUntil) return;
    // The intruder is taken off the map and a fresh one takes its place, so a confirmed
    // danger never leaves the page with an empty picture and nothing to look at.
    if (target) sim.intruders = sim.intruders.filter(i => i.id !== target.id);
    vehicle.phase = "returning";
    vehicle.targetId = null;
    spawnIntruder(sim);
  }
}

// ---- manual levers, for the page's buttons and for tests --------------------------------

/**
 * Put an intruder on the map at a lane across the top edge.
 *
 * `laneX` is the x it drops from; null means a seeded draw across the whole width —
 * which is deliberately not drawn from the covered positions, so some intruders walk
 * straight down a gap between two cameras. That is the honest scenario, not a bug.
 */
export function spawnIntruder(sim, laneX = null, kind = null) {
  if (sim.intruders.length >= MAX_INTRUDERS) return null;
  // ONE INTRUDER AT THE WALL AT A TIME.
  //
  // With a three-minute loiter, a spawn gap alone cannot stop a queue: whichever spacing
  // is chosen, 180 s / gap intruders end up standing there together, and four identical
  // "danger" tracks at one wall is not a perimeter watch — it is a crowd. The wall is the
  // scene's focus, so the next intruder is admitted only once it is clear. Manual spawns
  // bypass this (a button press is the viewer asking for a second one), but the automatic
  // stream honours it.
  const atWall = sim.intruders.some(i => i.phase === "at-wall" || i.phase === "frozen");
  if (laneX === null || laneX === undefined) {
    if (atWall) return null;
  }
  const lo = FENCE_X0 + SPAWN_MARGIN;
  const hi = FENCE_X1 - SPAWN_MARGIN;
  // Drawn freely across the width, NOT from the uncovered positions: some intruders walk
  // straight down a gap between two wedges, and the demo has to be able to show that.
  const x = laneX === null || laneX === undefined
    ? lo + sim.rng() * (hi - lo)
    : Math.max(lo, Math.min(hi, laneX));
  const chosen = kind && INTRUDER_KINDS.includes(kind)
    ? kind
    : INTRUDER_KINDS[Math.floor(sim.rng() * INTRUDER_KINDS.length)];
  const intruder = {
    id: sim.nextId++,
    laneX: x,
    kind: chosen,
    x,
    y: SPAWN_Y,
    heading: Math.PI / 2,
    phase: "approach",
    leg: 0,
    waitUntil: 0,
    // Straight down until it hits the wall's OUTER face, and stops there — still in the
    // exterior, above the wall's centre line. The wall is the barrier; nothing crosses it.
    route: [{ x, y: FENCE_Y - INTRUDER_STOP_OFFSET }],
  };
  sim.intruders.push(intruder);
  sim.counters.spawned += 1;
  return intruder;
}

/** Take one unit down, or degrade it. `kind` defaults to a seeded offline/degraded draw. */
export function faultSensor(sim, sensorId, kind = null) {
  const sensor = sim.sensors[sensorId];
  if (!sensor) return false;
  sensor.status = kind === SENSOR_STATUS.DEGRADED || kind === SENSOR_STATUS.OFFLINE
    ? kind
    : (sim.rng() < 0.6 ? SENSOR_STATUS.OFFLINE : SENSOR_STATUS.DEGRADED);
  sensor.faultUntil = sim.clock + FAULT_MIN_MS;
  // Longer than the auto-fault gap: a unit the viewer deliberately took down should stay
  // down long enough to look at, not be restored by the next scheduled check.
  sensor.nextFaultAt = sensor.faultUntil + FAULT_GAP_MAX_MS * 2;
  return true;
}

/** Bring every unit back online. */
export function repairSensors(sim) {
  for (const sensor of Object.values(sim.sensors)) {
    sensor.status = SENSOR_STATUS.ONLINE;
    sensor.faultUntil = 0;
    sensor.nextFaultAt = sim.clock + FAULT_GRACE_MS + sim.rng() * FAULT_GAP_MIN_MS;
  }
}

/**
 * The intruder the interceptor will take, if any — for the page's row text.
 *
 * Exposed rather than read off `sim` directly so the page and the tests describe the same
 * thing: a vehicle that is merely driving is not yet holding anyone.
 */
export function interceptionState(sim) {
  const vehicle = sim.interceptor;
  return {
    phase: vehicle.phase,
    x: vehicle.x,
    targetId: vehicle.targetId,
    holding: vehicle.phase === "holding",
  };
}

export function clearIntruders(sim) {
  sim.intruders = [];
}

// ---- reports: what the six units say ----------------------------------------------------

/**
 * One report per unit. `contact` is true while the unit has seen something inside the
 * contact window — not merely this instant, because a camera that blinked for one frame
 * should not turn a confirmed track into a clean perimeter.
 */
export function sensorReports(sim) {
  return SENSORS.map(cfg => {
    const sensor = sim.sensors[cfg.id];
    const contact = sim.clock - sensor.lastContactAt <= CONTACT_WINDOW_MS;
    return {
      id: cfg.id,
      kind: cfg.kind,
      label: cfg.label,
      group: cfg.group,
      status: sensor.status,
      contact,
      classified: contact ? sensor.lastKind : null,
    };
  });
}

/** The passage the ontology reasons over. Raw reports only: no derived verdict. */
export function buildPassage(sim) {
  const reports = sensorReports(sim);
  let lastContactAt = -Infinity;
  for (const sensor of Object.values(sim.sensors)) {
    if (sensor.lastContactAt > lastContactAt) lastContactAt = sensor.lastContactAt;
  }
  return {
    tick: sim.tick,
    reports,
    lastContactAgoMs: Number.isFinite(lastContactAt)
      ? Math.max(0, sim.clock - lastContactAt)
      : null,
  };
}

/** Ground truth, for the page's own readout. NEVER part of the state sent to the model. */
export function truthFor(sim) {
  // "At the wall" rather than "inside": the wall stops an intruder, so anything on the
  // base side is pressed against the wall, never wandering the base.
  const atWall = sim.intruders.filter(
    i => i.phase === "at-wall" || i.phase === "frozen").length;
  const exterior = sim.intruders.filter(i => pointInExterior(i.x, i.y)).length;
  const inside = sim.intruders.filter(i => pointInBase(i.x, i.y)).length;
  return { onSite: sim.intruders.length, atWall, exterior, inside };
}

// ---- the state and the question ---------------------------------------------------------

const SENSOR_LEAF = Object.freeze({
  camera_1: "camera_1",
  camera_2: "camera_2",
  camera_3: "camera_3",
  camera_4: "camera_4",
  rail_1: "rail_patrol_1",
  rail_2: "rail_patrol_2",
});

function sensorWord(report) {
  const reading = !report.contact
    ? "clear"
    : report.classified
      // An animal is named as one so the model is not left to read "identified" as
      // "hostile" — the classification is the whole discrimination in this domain.
      ? `contact (${report.classified}${isThreat(report.classified) ? "" : ", not a threat"})`
      : "contact (unclassified)";
  if (report.status === SENSOR_STATUS.OFFLINE) return "offline, no reading";
  if (report.status === SENSOR_STATUS.DEGRADED) return `degraded, ${reading}`;
  return `online, ${reading}`;
}

function contactAgeWord(passage) {
  if (passage.reports.some(r => r.contact)) return "now";
  if (passage.lastContactAgoMs === null) return "none";
  return passage.lastContactAgoMs <= CONTACT_FADED_MS ? "moments ago" : "none";
}

function patrolClassificationWord(passage) {
  const patrols = passage.reports.filter(r => r.kind === "patrol" && r.contact);
  const named = patrols.find(r => r.classified);
  if (named) {
    // An animal is named as one, and explicitly marked not a threat, so the model is not
    // left to infer that "identified" means "hostile".
    return isThreat(named.classified)
      ? `${named.classified} by ${named.label}`
      : `${named.classified} by ${named.label}, not a threat`;
  }
  return patrols.length ? "unclassified contact" : "none";
}

/**
 * The flat JSON the model receives.
 *
 * Flat and scalar only: `server.py` `str()`s each top-level value, so a nested object
 * would arrive as a Python repr the head has never seen. Nine leaves, under the fifteen
 * the warehouse head documents — the whole text is prepended as field 0, and a chunker
 * that starts merging leaves would merge the decisive one with a neighbour.
 *
 * The six per-unit leaves are the point of the demo: every unit's own status is visible,
 * not a pre-digested score. Values are words rather than numbers because the backbone is
 * nearly insensitive to the value of a number.
 */
export function buildState(passage) {
  const doc = { site: "airbase perimeter, night watch" };
  for (const report of passage.reports) {
    doc[SENSOR_LEAF[report.id]] = sensorWord(report);
  }
  // Named for what it is rather than "blind sectors": the ontology distinguishes an
  // offline unit (a blind sector) from a degraded one (a reading you cannot fully trust),
  // and one leaf covering both would say "blind" about a unit that is still reporting.
  const notOnline = passage.reports.filter(r => r.status !== SENSOR_STATUS.ONLINE);
  doc.units_not_online = notOnline.length
    ? notOnline.map(r => `${r.label} (${r.status})`).join(", ")
    : "none";
  doc.contact_age = contactAgeWord(passage);
  doc.patrol_classification = patrolClassificationWord(passage);
  return doc;
}

export const QUESTION_ID = "intruders";

/**
 * What each verdict means, in the words the model reads. The keys ARE the option set —
 * `ciel.py` turns the criteria keys into the model's options.
 *
 * They are not filtered by the ontology, and that is a deliberate difference from
 * warehouse.html. See `buildQuestion` for why filtering would make the demo vacuous.
 */
export const VERDICT_CRITERIA = Object.freeze({
  [VERDICT.DANGER]:
    "an intruder is confirmed: two independent sensors report a contact, or a patrol " +
    "robot has classified the contact as a person or a vehicle",
  [VERDICT.NOT_SURE]:
    "the picture is unresolved: a contact is uncorroborated, or a sensor is degraded " +
    "or offline so its sector is unchecked",
  [VERDICT.SAFE]:
    "every one of the six sensors is online and none reports a contact",
});

/**
 * The question.
 *
 * ALL THREE VERDICTS ARE ALWAYS OFFERED, DELIBERATELY — this is the one place this demo
 * parts company with warehouse.html, and the reason is worth stating.
 *
 * `warehouse.html` filters its criteria through the ontology's permitted set, because a
 * robot asked a question it may not answer is a real bug there. The same filter here
 * would be a worse bug: on a confirmed intruder the permitted set is {danger}, so the
 * question would have ONE option, `ciel.py` would send one option, the service would
 * argmax over one, and the model would return confidence 1.000 on a question it could
 * not get wrong. The demo would then be showing a tautology and calling it a decision,
 * and the eval harness would report 100% for every arm and every state.
 *
 * So the menu is the full vocabulary and the ontology is a VETO applied to the answer:
 *
 *   the model reads the state and picks a verdict
 *   the rule decides whether that verdict is permitted
 *   an answer the rule forbade is refused, and the safest permitted verdict is used
 *     instead — and the page says so, in the row, rather than quietly correcting it
 *
 * That keeps both properties the other pages want: the model cannot ENFORCE a verdict
 * the rule withdrew, and it is still being asked a question with a real answer in it.
 *
 * The caller shows the permitted set beside the answer (see `airbase_panel.permittedFor`)
 * so a veto is visible rather than silent.
 */
export function buildQuestion() {
  return {
    type: "choice",
    instructions:
      "You are the airbase perimeter security system. Four stationary cameras are fixed " +
      "along the perimeter line and look up into the open ground above it; two patrol " +
      "robots sweep a straight rail just behind the line. Intruders approach from above. " +
      "Decide whether there are intruders.",
    criteria: { ...VERDICT_CRITERIA },
  };
}

/** The most cautious verdict in a set, for the veto's fallback. */
export function safestVerdict(options) {
  const rank = v => VERDICT_ORDER.indexOf(v);
  return [...options].sort((a, b) => rank(a) - rank(b))[0];
}

export function counters(sim) {
  return { ...sim.counters, clockMs: Math.round(sim.clock) };
}
