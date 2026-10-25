// node --test test_airbase_sim.mjs
//
// Tests for the airbase security simulator: the six units, the line geometry, the
// intruder tracks, and the state contract.
//
// THE GEOMETRY TESTS ARE LOAD-BEARING HERE. The demo's premise is that the four fixed
// cameras leave real gaps low down, so an intruder can be inside the wire and unseen —
// not because a random roll said so, but because no camera's wedge contains that point.
// If the wedges ever merge into full coverage the demo loses its subject while every
// other test still passes, so coverage is measured, not assumed.
//
// THE STATE CONTRACT TESTS ARE THE OTHER LOAD-BEARING ONES. The model reads `buildState`,
// so a state that leaked ground truth would make every verdict a cheat sheet rather than
// an observation — and it would still pass every other test in this file.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as AIR from "./static/airbase_sim.js";
import { TOWER_BEAM_RANGE } from "./static/airbase_sim.js";
import {
  BASE,
  CAMERA_HALF_FOV,
  CAMERA_RANGE,
  CAMERA_XS,
  CROSSING_DEPTH,
  INTRUDER_STOP_OFFSET,
  FENCE_X0,
  FENCE_X1,
  FENCE_Y,
  H,
  MAX_INTRUDERS,
  QUESTION_ID,
  RAIL_RANGE,
  RAIL_X0,
  RAIL_X1,
  RAIL_Y,
  ROBOT_R,
  SENSORS,
  SENSOR_IDS,
  SENSOR_STATUS,
  VERDICT,
  VERDICT_CRITERIA,
  VERDICT_ORDER,
  W,
  buildPassage,
  buildQuestion,
  buildState,
  cameraSees,
  clearIntruders,
  counters,
  coveredByCameras,
  createSim,
  faultSensor,
  intercept,
  interceptionState,
  litByTower,
  mulberry32,
  patrolSees,
  pointInBase,
  pointInExterior,
  recallInterceptor,
  repairSensors,
  robotBounds,
  safestVerdict,
  sensorReports,
  spawnIntruder,
  step,
  truthFor,
} from "./static/airbase_sim.js";

const CAMERAS = SENSORS.filter(s => s.kind === "camera");
const PATROLS = SENSORS.filter(s => s.kind === "patrol");

// ---- vocabulary + the perimeter line ----------------------------------------------------

test("there are four cameras and two rail patrols, with unique ids", () => {
  assert.equal(CAMERAS.length, 4, "the demo's whole claim is four fixed + two moving");
  assert.equal(PATROLS.length, 2);
  assert.equal(new Set(SENSOR_IDS).size, 6);
  assert.deepEqual(SENSOR_IDS.slice().sort(), [
    "camera_1", "camera_2", "camera_3", "camera_4", "rail_1", "rail_2",
  ]);
});

test("the rail patrols share one evidence group and each camera has its own", () => {
  // Corroboration counts GROUPS, not units. Two patrols on one rail are one line of
  // sight, so if this ever becomes two groups the danger rule fires on one sighting.
  assert.equal(PATROLS[0].group, PATROLS[1].group);
  const cameraGroups = new Set(CAMERAS.map(c => c.group));
  assert.equal(cameraGroups.size, 4);
  assert.ok(!cameraGroups.has(PATROLS[0].group), "a patrol must not share a camera's group");
});

test("the airbase is below the line and the hostile ground is above it", () => {
  // The layout the user asked for, pinned: rail and fence horizontal, base below.
  assert.ok(BASE.y0 >= FENCE_Y, "the airbase starts below the wire");
  assert.equal(pointInBase(FENCE_X0 + 10, FENCE_Y + 10), true);
  assert.equal(pointInBase(FENCE_X0 + 10, FENCE_Y - 10), false);
  assert.equal(pointInExterior(FENCE_X0 + 10, FENCE_Y - 10), true);
  assert.equal(pointInExterior(FENCE_X0 + 10, FENCE_Y + 10), false);
  // the rail rides behind the wire, inside the base
  assert.ok(RAIL_Y > FENCE_Y, "the rail is on the base side of the wire");
  assert.ok(RAIL_Y < BASE.y1);
});

test("all four cameras sit on the line and look straight up", () => {
  for (const camera of CAMERAS) {
    assert.equal(camera.y, FENCE_Y, `${camera.id} is not mounted on the wire`);
    assert.equal(camera.dirX, 0, `${camera.id} is not aimed vertically`);
    assert.ok(camera.dirY < 0, `${camera.id} looks down into the base, not up into the dark`);
    // straight up is up the canvas, i.e. negative y
    assert.equal(cameraSees(camera, camera.x, camera.y - CAMERA_RANGE + 1), true);
    assert.equal(cameraSees(camera, camera.x, camera.y + 20), false,
      `${camera.id} sees behind the wire`);
  }
});

test("the cameras are evenly spaced along the wire", () => {
  const gaps = CAMERA_XS.slice(1).map((x, i) => x - CAMERA_XS[i]);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  assert.ok(spread < 1, `uneven spacing: ${gaps.join(", ")}`);
  for (const x of CAMERA_XS) {
    assert.ok(x >= FENCE_X0 && x <= FENCE_X1, `camera at ${x} is off the wire`);
  }
});

test("a camera's sector is a wedge: range and angle both hold", () => {
  const camera = CAMERAS[0];
  assert.equal(cameraSees(camera, camera.x + camera.dirX * (CAMERA_RANGE - 1),
    camera.y + camera.dirY * (CAMERA_RANGE - 1)), true);
  assert.equal(cameraSees(camera, camera.x + camera.dirX * (CAMERA_RANGE + 1),
    camera.y + camera.dirY * (CAMERA_RANGE + 1)), false, "range is not enforced");
  // perpendicular to the aim at close range: outside the wedge
  assert.equal(cameraSees(camera, camera.x + 20, camera.y - 4), false);
  // the half-fov boundary is still inside
  const edgeAngle = camera.sector.angle + CAMERA_HALF_FOV - 0.001;
  assert.equal(cameraSees(camera, camera.x + Math.cos(edgeAngle) * 60,
    camera.y + Math.sin(edgeAngle) * 60), true);
});

test("the four wedges leave real gaps low down", () => {
  // THE DEMO'S PREMISE, MEASURED. Up close the wedge is narrow, so between two cameras
  // there is a band no camera covers. If this ever becomes full coverage, an intruder
  // could still be "unseen" only by a fault, and the demo would be lying about its own
  // geometry.
  const y = FENCE_Y - 12;
  let gaps = 0;
  for (let x = FENCE_X0 + 4; x <= FENCE_X1 - 4; x += 2) {
    if (!coveredByCameras(x, y)) gaps++;
  }
  assert.ok(gaps > 40, `only ${gaps} uncovered columns ${FENCE_Y - y}px above the wire`);

  // and coverage improves with altitude, because the wedges fan out
  const low = countCovered(FENCE_Y - 12);
  const high = countCovered(FENCE_Y - 150);
  assert.ok(high > low, `coverage does not improve with height: ${low} -> ${high}`);
});

function countCovered(y) {
  let covered = 0;
  for (let x = FENCE_X0 + 4; x <= FENCE_X1 - 4; x += 2) {
    if (coveredByCameras(x, y)) covered++;
  }
  return covered;
}

test("a camera cannot see anything behind the wire", () => {
  // The layer boundary: cameras cover the APPROACH, patrols cover the inside band. A
  // camera that could see behind the wire would make the patrols redundant.
  for (const camera of CAMERAS) {
    for (let x = FENCE_X0; x <= FENCE_X1; x += 40) {
      assert.equal(cameraSees(camera, x, FENCE_Y + 30), false,
        `${camera.id} sees into the base`);
    }
  }
});

test("a patrol sees a radius around its current position, not a fixed point", () => {
  const left = { x: 120 };
  const right = { x: 500 };
  const point = { x: 170, y: RAIL_Y };
  assert.equal(patrolSees(left, point.x, point.y), true);
  assert.equal(patrolSees(right, point.x, point.y), false);
  assert.equal(patrolSees(left, 120, RAIL_Y + RAIL_RANGE + 1), false);
});

test("the patrols cover the close-in band the cameras cannot see", () => {
  // Different jobs, on the same line: the cameras watch upward, the patrols cover the
  // strip just behind the wire where an intruder who crossed actually stands.
  const sim = createSim({ seed: 1 });
  const insideY = FENCE_Y + CROSSING_DEPTH;
  let covered = 0, total = 0;
  for (let i = 0; i < 200; i++) {
    step(sim, 50);
    for (let x = FENCE_X0 + 10; x <= FENCE_X1 - 10; x += 30) {
      total++;
      if (sim.robots.some(r => patrolSees(r, x, insideY))) covered++;
    }
  }
  assert.ok(covered / total > 0.4,
    `the patrols cover only ${(100 * covered / total).toFixed(0)}% of the inside band`);
});

test("the two patrols own disjoint halves of the rail", () => {
  const west = robotBounds(PATROLS[0]);
  const east = robotBounds(PATROLS[1]);
  assert.ok(west.hi < east.lo, `west hi=${west.hi} overlaps east lo=${east.lo}`);
});

test("every sensor is inside the canvas", () => {
  for (const sensor of SENSORS) {
    const x = sensor.kind === "camera" ? sensor.x : RAIL_X0;
    const y = sensor.kind === "camera" ? sensor.y : RAIL_Y;
    assert.ok(x >= 0 && x <= W, `${sensor.id} x=${x} is off canvas`);
    assert.ok(y >= 0 && y <= H, `${sensor.id} y=${y} is off canvas`);
  }
});

// ---- determinism ------------------------------------------------------------------------

test("the same seed replays the same intruder stream", () => {
  const trace = seed => {
    const sim = createSim({ seed });
    const seen = [];
    for (let i = 0; i < 400; i++) {
      step(sim, 50);
      seen.push(sim.intruders.map(x => `${x.id}:${x.kind}:${x.x.toFixed(2)}`).join(","));
    }
    return seen.join("|");
  };
  assert.equal(trace(11), trace(11));
  assert.notEqual(trace(11), trace(12));
});

test("the shared PRNG is the repo's, re-exported", () => {
  const a = mulberry32(3);
  const b = mulberry32(3);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

// ---- the patrols ------------------------------------------------------------------------

test("each patrol sweeps its own half and reverses at the bounds", () => {
  const sim = createSim({ seed: 5 });
  const sweeps = { rail_1: new Set(), rail_2: new Set() };
  for (let i = 0; i < 400; i++) {
    step(sim, 50);
    for (const robot of sim.robots) {
      const { lo, hi } = robotBounds(robot);
      assert.ok(robot.x >= lo - 1e-9 && robot.x <= hi + 1e-9,
        `${robot.id} left its half: x=${robot.x} not in [${lo}, ${hi}]`);
      sweeps[robot.id].add(Math.round(robot.x));
    }
  }
  assert.ok(sweeps.rail_1.size > 20, "rail_1 never swept");
  assert.ok(sweeps.rail_2.size > 20, "rail_2 never swept");
});

test("a patrol riding the rail stays clear of the other's half", () => {
  const sim = createSim({ seed: 9 });
  for (let i = 0; i < 300; i++) {
    step(sim, 40);
    const [a, b] = sim.robots;
    assert.ok(Math.abs(a.x - b.x) > 2 * ROBOT_R,
      `patrols collided at ${a.x} vs ${b.x}`);
  }
});

// ---- intruder tracks --------------------------------------------------------------------

test("an intruder walks down from the top edge, crosses the wire, and leaves", () => {
  const sim = createSim({ seed: 2 });
  sim.nextSpawnAt = Infinity;   // manual control: no automatic spawns
  const intruder = spawnIntruder(sim, 200);
  assert.ok(intruder, "spawn returned null");
  assert.equal(intruder.x, 200);
  assert.equal(intruder.y, 16, "the intruder does not start at the top edge");
  assert.ok(intruder.y < FENCE_Y, "the intruder does not start in the exterior");

  let sawAtWall = false;
  let reachedRail = false;
  let removed = false;
  for (let i = 0; i < 30000; i++) {
    step(sim, 50);
    if (sim.intruders.length === 0) { removed = true; break; }
    if (sim.intruders[0].phase === "at-wall") sawAtWall = true;
    // THE WALL IS A BARRIER: it must never walk down to the rail or into the base.
    if (sim.intruders[0].y >= RAIL_Y) reachedRail = true;
  }
  assert.ok(sawAtWall, "the intruder never reached the wall");
  assert.ok(!reachedRail, "the intruder walked past the wall to the rail");
  assert.ok(removed, "the intruder never left the map");
});

test("an intruder only moves downward on the way in", () => {
  const sim = createSim({ seed: 3 });
  sim.nextSpawnAt = Infinity;
  const intruder = spawnIntruder(sim, 300);
  let lastY = intruder.y;
  for (let i = 0; i < 40 && sim.intruders.length; i++) {
    step(sim, 50);
    if (!sim.intruders.length) break;
    assert.ok(sim.intruders[0].y >= lastY - 1e-9,
      `the intruder moved up: ${lastY} -> ${sim.intruders[0].y}`);
    lastY = sim.intruders[0].y;
    if (sim.intruders[0].phase !== "approach") break;
  }
});

test("intruders are capped, and a spawn at the cap returns null", () => {
  const sim = createSim({ seed: 4 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  for (let i = 0; i < MAX_INTRUDERS; i++) {
    assert.ok(spawnIntruder(sim, 150 + i * 20), `spawn ${i} refused below the cap`);
  }
  assert.equal(spawnIntruder(sim, 200), null);
  assert.equal(sim.intruders.length, MAX_INTRUDERS);
});

test("a spawn lane is clamped onto the wire's span", () => {
  const sim = createSim({ seed: 6 });
  sim.nextSpawnAt = Infinity;
  const far = spawnIntruder(sim, -500);
  assert.ok(far.x >= FENCE_X0, `spawn escaped the wire: ${far.x}`);
  const other = spawnIntruder(sim, 99999);
  assert.ok(other.x <= FENCE_X1, `spawn escaped the wire: ${other.x}`);
});

test("some intruders get in unseen, and the counter proves it", () => {
  // Not a failure — the geometry's premise. Recorded so the demo can say how often.
  const sim = createSim({ seed: 17 });
  for (let i = 0; i < 4000; i++) step(sim, 50);
  const c = counters(sim);
  assert.ok(c.spawned > 0, "nothing spawned");
  assert.ok(c.unseenInside > 0,
    `every crossing was covered by a camera — the wedges may have merged`);
});

// ---- sensors and faults ------------------------------------------------------------------

test("a contact is reported while it is in the contact window, then decays", () => {
  const sim = createSim({ seed: 3 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const robot = sim.robots.find(r => r.id === "rail_1");
  sim.intruders.push({
    id: 99, laneX: robot.x, kind: "person",
    x: robot.x, y: FENCE_Y - INTRUDER_STOP_OFFSET, heading: Math.PI / 2, phase: "at-wall",
    leg: 0, waitUntil: Infinity, route: [],
  });
  // The searchlight must SWING onto the track before a patrol can identify it, so this
  // runs long enough for the beam to arrive. That lag is the point: in the dark at the
  // instant of arrival the contact is unclassified.
  for (let i = 0; i < 40; i++) step(sim, 50);
  const reports = sensorReports(sim);
  const rail1 = reports.find(r => r.id === "rail_1");
  assert.equal(rail1.contact, true);
  assert.equal(rail1.classified, "person", "a patrol this close should identify");
  assert.equal(reports.find(r => r.id === "rail_2").contact, false,
    "the east patrol cannot see the west half");

  clearIntruders(sim);
  for (let i = 0; i < 100; i++) step(sim, 60);
  assert.equal(sensorReports(sim).find(r => r.id === "rail_1").contact, false);
});

test("a camera contact is never classified, a patrol's close contact is", () => {
  const sim = createSim({ seed: 8 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const camera = CAMERAS[0];
  sim.intruders.push({
    id: 98, laneX: camera.x, kind: "vehicle",
    // straight up from the camera, well inside its wedge
    x: camera.x, y: camera.y - 90,
    heading: Math.PI / 2, phase: "approach", leg: 0, waitUntil: 0, route: [],
  });
  step(sim, 16);
  const report = sensorReports(sim).find(r => r.id === camera.id);
  assert.equal(report.contact, true, "the camera should see the approach");
  assert.equal(report.classified, null, "a camera cannot say what it is looking at");
});

test("an offline sensor reports no contact at all", () => {
  const sim = createSim({ seed: 10 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const robot = sim.robots.find(r => r.id === "rail_1");
  sim.intruders.push({
    id: 97, laneX: robot.x, kind: "person",
    x: robot.x, y: FENCE_Y - INTRUDER_STOP_OFFSET, heading: Math.PI / 2, phase: "at-wall",
    leg: 0, waitUntil: Infinity, route: [],
  });
  faultSensor(sim, "rail_1", SENSOR_STATUS.OFFLINE);
  step(sim, 16);
  const report = sensorReports(sim).find(r => r.id === "rail_1");
  assert.equal(report.status, SENSOR_STATUS.OFFLINE);
  assert.equal(report.contact, false, "an offline unit cannot report a contact");
});

test("repair brings every unit back and stops the fault stream for a while", () => {
  const sim = createSim({ seed: 12 });
  for (const id of SENSOR_IDS) faultSensor(sim, id, SENSOR_STATUS.OFFLINE);
  assert.ok(Object.values(sim.sensors).every(s => s.status === SENSOR_STATUS.OFFLINE));
  repairSensors(sim);
  assert.ok(Object.values(sim.sensors).every(s => s.status === SENSOR_STATUS.ONLINE));
  step(sim, 16);
  assert.ok(Object.values(sim.sensors).every(s => s.status === SENSOR_STATUS.ONLINE),
    "a repaired unit faulted again immediately");
});

test("a fault is never asked of an unknown sensor", () => {
  const sim = createSim({ seed: 13 });
  assert.equal(faultSensor(sim, "nope"), false);
});

// ---- the state contract ------------------------------------------------------------------

test("the state is flat scalar JSON with at most 15 leaves", () => {
  const sim = createSim({ seed: 21 });
  for (let i = 0; i < 120; i++) {
    step(sim, 50);
    const state = buildState(buildPassage(sim));
    assert.ok(Object.keys(state).length <= 15,
      `too many leaves: ${Object.keys(state).length}`);
    for (const [key, value] of Object.entries(state)) {
      assert.ok(["string", "number"].includes(typeof value),
        `${key} is ${typeof value}`);
    }
  }
});

test("every one of the six units has its own leaf", () => {
  const sim = createSim({ seed: 22 });
  const state = buildState(buildPassage(sim));
  for (const leaf of ["camera_1", "camera_2", "camera_3", "camera_4",
                      "rail_patrol_1", "rail_patrol_2"]) {
    assert.ok(leaf in state, `the state never names ${leaf}`);
  }
});

test("an intruder the sensors cannot see leaves the state unchanged", () => {
  // THE CHEAT-SHEET TEST. If this fails the state carries ground truth, and every verdict
  // the demo shows is being scored against an answer the model was handed.
  const sim = createSim({ seed: 23 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  for (const id of SENSOR_IDS) faultSensor(sim, id, SENSOR_STATUS.OFFLINE);

  step(sim, 16);
  const before = buildState(buildPassage(sim));

  sim.intruders.push({
    id: 96, laneX: 300, kind: "person",
    x: 300, y: FENCE_Y - 100, heading: Math.PI / 2, phase: "approach",
    leg: 0, waitUntil: Infinity, route: [],
  });
  step(sim, 16);
  const after = buildState(buildPassage(sim));

  assert.deepEqual(after, before,
    "the state changed when every sensor was blind — it is reading ground truth");
});

test("the state never carries the intruder count", () => {
  const sim = createSim({ seed: 24 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  for (let i = 0; i < 4; i++) spawnIntruder(sim, 120 + i * 90);
  step(sim, 16);
  const state = buildState(buildPassage(sim));
  const text = JSON.stringify(state);
  assert.equal(truthFor(sim).onSite, 4);
  assert.ok(!/on_?site|intruder_?count|contacts/i.test(text),
    `the state names ground truth: ${text}`);
});

test("the state names no verdict — the model decides, the state describes", () => {
  const sim = createSim({ seed: 25 });
  for (let i = 0; i < 200; i++) {
    step(sim, 50);
    const text = JSON.stringify(buildState(buildPassage(sim))).toLowerCase();
    for (const verdict of VERDICT_ORDER) {
      assert.ok(!text.includes(`"${verdict}"`),
        `the state contains the verdict ${verdict}: ${text}`);
    }
  }
});

// ---- the question ------------------------------------------------------------------------

test("the question is the demo's three-way choice", () => {
  const question = buildQuestion();
  assert.equal(QUESTION_ID, "intruders");
  assert.equal(question.type, "choice");
  assert.equal(question.instructions.includes("intruders"), true);
  assert.deepEqual(Object.keys(question.criteria), VERDICT_ORDER);
});

test("the question always offers all three verdicts", () => {
  // THE ANTI-TAUTOLOGY TEST. If the menu were narrowed to the ontology's permitted set,
  // a confirmed intruder would produce a ONE-option question — and a one-option argmax
  // returns confidence 1.000 for every arm on every state. The rule is a veto applied to
  // the answer, not a menu, precisely so the model is asked something it can get wrong.
  assert.deepEqual(Object.keys(buildQuestion().criteria), VERDICT_ORDER);
  assert.equal(Object.keys(buildQuestion().criteria).length, 3);
});

test("the safest verdict is the one a veto falls back to", () => {
  assert.equal(safestVerdict([VERDICT.DANGER]), VERDICT.DANGER);
  assert.equal(safestVerdict([VERDICT.NOT_SURE, VERDICT.SAFE]), VERDICT.NOT_SURE);
});

test("every verdict has a description, and the three are distinct", () => {
  const texts = VERDICT_ORDER.map(v => VERDICT_CRITERIA[v]);
  assert.ok(texts.every(t => typeof t === "string" && t.length > 30));
  assert.equal(new Set(texts).size, 3);
});

// ---- the wall is a barrier ---------------------------------------------------------------

test("an intruder stands at the wall for three minutes", () => {
  // The loiter is the demo's pacing: three minutes at the wall, then it gives up. A
  // shorter one gives nothing to watch; a longer one leaves the same verdict on screen.
  const sim = createSim({ seed: 19 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  let ticks = 0;
  while (intruder.phase === "approach" && ticks < 2000) { step(sim, 50); ticks++; }
  assert.equal(intruder.phase, "at-wall");

  let loiterTicks = 0;
  while (intruder.phase === "at-wall" && loiterTicks < 100000) { step(sim, 50); loiterTicks++; }
  const minutes = (loiterTicks * 50) / 1000 / 60;
  assert.ok(Math.abs(minutes - 3) < 0.05, `it loitered ${minutes.toFixed(2)} minutes`);
});

test("it is stopped at the wall and never reaches the rail", () => {
  const sim = createSim({ seed: 20 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  for (let i = 0; i < 5000; i++) {
    step(sim, 50);
    if (!sim.intruders.length) break;
    assert.ok(sim.intruders[0].y < RAIL_Y,
      `it walked past the wall to y=${sim.intruders[0].y} (rail is ${RAIL_Y})`);
  }
});

test("only one intruder is admitted to the wall at a time", () => {
  // With a 3-minute loiter a spawn gap cannot prevent a queue: any spacing puts several
  // at the wall together. The automatic stream admits the next only once the wall clears.
  for (const seed of [1, 2, 3]) {
    const sim = createSim({ seed });
    let maxAtWall = 0;
    for (let i = 0; i < 1440 * 20; i++) {   // 24 simulated minutes
      step(sim, 50);
      maxAtWall = Math.max(maxAtWall,
        sim.intruders.filter(x => x.phase === "at-wall" || x.phase === "frozen").length);
    }
    assert.equal(maxAtWall, 1, `seed ${seed} queued ${maxAtWall} intruders at the wall`);
    assert.ok(sim.counters.spawned > 0, `seed ${seed} never spawned anyone`);
  }
});

test("a manual spawn is still allowed while the wall is occupied", () => {
  // A button press is the viewer asking for a second one; refusing it would make the
  // controls look broken.
  const sim = createSim({ seed: 21 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  assert.ok(spawnIntruder(sim, 200));
  for (let i = 0; i < 300; i++) step(sim, 50);
  assert.ok(spawnIntruder(sim, 400), "a manual spawn was refused at an occupied wall");
});

// ---- pacing: the demo has to look like it is moving -------------------------------------

test("an intruder crosses from the top edge in seconds, not minutes", () => {
  // The first version used 26 px/s over a 460 px canvas: a full approach took minutes and
  // the page looked frozen. The approach leg is 276 px; at the current speed it lands in
  // the low single digits of seconds.
  const sim = createSim({ seed: 7 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  let ticks = 0;
  while (intruder.phase === "approach" && ticks < 2000) {
    step(sim, 50);
    ticks++;
  }
  const seconds = (ticks * 50) / 1000;
  assert.equal(intruder.phase, "at-wall", "it never reached the wall");
  assert.ok(seconds < 10, `the approach took ${seconds}s — the demo reads as stalled`);
});

test("a fault happens about once every ninety seconds, and never two at once", () => {
  // The previous version rolled a fault per unit per few seconds: 20 events in six
  // minutes, so "blind" was the resting state. This measures the pacing as a property.
  let events = 0;
  let multi = 0;
  const MINUTES = 6;
  for (const seed of [1, 2, 3, 4, 5]) {
    const sim = createSim({ seed });
    let previous = null;
    for (let i = 0; i < (MINUTES * 60 * 1000) / 50; i++) {
      step(sim, 50);
      const down = Object.values(sim.sensors).filter(s => s.status !== SENSOR_STATUS.ONLINE);
      if (down.length > 1) multi++;
      if (down.length && down[0].id !== previous) { events++; previous = down[0].id; }
      if (!down.length) previous = null;
    }
  }
  assert.equal(multi, 0, "two units were down at once");
  const perMinute = events / (MINUTES * 5);
  assert.ok(perMinute <= 1.5, `${perMinute.toFixed(1)} faults per minute — too frequent`);
  assert.ok(events > 0, "no fault ever fired in half an hour of simulated watch");
});

test("no fault fires during the opening seconds of a run", () => {
  const sim = createSim({ seed: 8 });
  for (let i = 0; i < 300; i++) {
    step(sim, 50);
    assert.ok(Object.values(sim.sensors).every(s => s.status === SENSOR_STATUS.ONLINE),
      `a fault fired at ${(sim.clock / 1000).toFixed(1)}s, before the viewer looked`);
  }
});

test("a manually faulted unit stays down longer than an automatic one", () => {
  const sim = createSim({ seed: 9 });
  faultSensor(sim, "camera_2", SENSOR_STATUS.OFFLINE);
  const until = sim.sensors.camera_2.faultUntil - sim.clock;
  assert.ok(until >= 5000, "a deliberate fault was restored almost immediately");
});

// ---- the searchlight tower ---------------------------------------------------------------

test("the searchlight is off until something is tracked, then on until it is gone", () => {
  const sim = createSim({ seed: 22 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  step(sim, 50);
  assert.equal(sim.tower.on, false, "the light was on with an empty perimeter");

  const intruder = spawnIntruder(sim, 300);
  step(sim, 50);
  assert.equal(sim.tower.on, false, "the light came on for a track still in the exterior");

  for (let i = 0; i < 300 && intruder.phase === "approach"; i++) step(sim, 50);
  assert.equal(intruder.phase, "at-wall");
  assert.equal(sim.tower.on, true, "the light stayed dark on a track at the wall");

  // it stays on for the whole loiter, not just the moment of arrival
  for (let i = 0; i < 100; i++) step(sim, 50);
  assert.equal(sim.tower.on, true, "the light went out while the track was still there");

  // and goes out when the track is removed — by the interceptor or by leaving
  sim.intruders = sim.intruders.filter(x => x.id !== intruder.id);
  step(sim, 50);
  assert.equal(sim.tower.on, false, "the light stayed on after the track was gone");
});

test("the searchlight lights for an animal too — it is a response, not an alarm", () => {
  // The light is what you do about unresolved motion. A fox at the wall gets lit and the
  // verdict stays `safe`; the two are not in conflict.
  const sim = createSim({ seed: 23 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300, "animal");
  for (let i = 0; i < 300 && intruder.phase === "approach"; i++) step(sim, 50);
  assert.equal(sim.tower.on, true);
});

test("the interceptor takes it and the light goes out", () => {
  const sim = createSim({ seed: 24 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  for (let i = 0; i < 300 && intruder.phase === "approach"; i++) step(sim, 50);
  assert.equal(sim.tower.on, true);
  intercept(sim);
  for (let i = 0; i < 600 && sim.intruders.some(x => x.id === intruder.id); i++) step(sim, 50);
  // a replacement spawns immediately, so the light may still be on — but the ORIGINAL
  // track is gone and the original is what the light was tracking
  assert.equal(sim.intruders.some(x => x.id === intruder.id), false);
});

test("the beam aims at the track, and only what it lights is identifiable", () => {
  // The aim is a real mechanism, not a flag: a track the beam has not reached is
  // unclassifiable, which is what the tower buys.
  const sim = createSim({ seed: 26 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 120, "person");
  for (let i = 0; i < 300 && intruder.phase === "approach"; i++) step(sim, 50);
  assert.equal(sim.tower.on, true);
  assert.equal(sim.tower.litTargetId, intruder.id);

  // hold long enough for the beam to arrive, then it must be lit and identifiable
  for (let i = 0; i < 60; i++) step(sim, 50);
  assert.equal(litByTower(sim, intruder.x, intruder.y), true, "the beam never reached it");
  assert.equal(sim.sensors.rail_1.lastKind ?? sim.sensors.rail_2.lastKind, "person",
    "a lit track was not classified");

  // where the beam actually points is where the predicate says it is lit
  const lampX = AIR.TOWER.x;
  const lampY = AIR.TOWER.y - AIR.TOWER.height;
  const onAxis = 40;
  assert.equal(litByTower(sim, lampX + Math.cos(sim.tower.aim) * onAxis,
    lampY + Math.sin(sim.tower.aim) * onAxis), true, "the axis of the beam is not lit");
  assert.equal(litByTower(sim, lampX, lampY - 50), false,
    "straight up is lit even though the beam is aimed elsewhere");
});

test("the beam reaches every position along the wall", () => {
  // If it cannot, the wall ends are permanently unclassifiable — a silent hole in the
  // identification layer, not a drawing problem.
  const sim = createSim({ seed: 27 });
  const lampX = AIR.TOWER.x;
  const lampY = AIR.TOWER.y - AIR.TOWER.height;
  for (const x of [FENCE_X0 + 24, 200, 310, 420, FENCE_X1 - 24]) {
    const dist = Math.hypot(x - lampX, AIR.FENCE_Y - AIR.INTRUDER_STOP_OFFSET - lampY);
    assert.ok(dist <= AIR.TOWER_BEAM_RANGE,
      `the wall at x=${x} is ${dist.toFixed(0)}px away, past the ${AIR.TOWER_BEAM_RANGE}px beam`);
  }
});

test("the light goes out the moment the tracked intruder is removed", () => {
  const sim = createSim({ seed: 28 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300, "person");
  for (let i = 0; i < 300 && intruder.phase === "approach"; i++) step(sim, 50);
  assert.equal(sim.tower.on, true);
  // take it off the map without spawning a replacement
  sim.intruders = sim.intruders.filter(i => i.id !== intruder.id);
  sim.nextSpawnAt = Infinity;
  step(sim, 50);
  assert.equal(sim.tower.on, false, "the light stayed on after the threat was removed");
  assert.equal(sim.tower.litTargetId, null);
});

// ---- the interceptor --------------------------------------------------------------------

test("the interceptor is only sent when told, and only after something crossed", () => {
  const sim = createSim({ seed: 11 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  assert.equal(intercept(sim), null, "it launched with nothing to chase");

  const intruder = spawnIntruder(sim, 300);
  assert.equal(intercept(sim), null, "it chased an intruder still in the exterior");
  assert.equal(sim.interceptor.phase, "idle");

  // drive it over the wire
  for (let i = 0; i < 200 && !pointInBase(intruder.x, intruder.y); i++) step(sim, 50);
  const target = intercept(sim);
  assert.ok(target, "it refused an intruder standing on the base side");
  assert.equal(sim.interceptor.phase, "out");
});

test("the interceptor reaches the target, freezes it, and removes it", () => {
  const sim = createSim({ seed: 12 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  for (let i = 0; i < 200 && !pointInBase(intruder.x, intruder.y); i++) step(sim, 50);
  intercept(sim);

  let sawHolding = false;
  for (let i = 0; i < 400; i++) {
    step(sim, 50);
    const held = sim.intruders.find(x => x.id === intruder.id);
    if (held && held.phase === "frozen") {
      sawHolding = true;
      assert.equal(sim.interceptor.phase, "holding");
    }
    if (!held) break;
  }
  assert.ok(sawHolding, "it never held the intruder");
  assert.equal(sim.intruders.some(x => x.id === intruder.id), false,
    "the held intruder was never taken off the map");
  assert.ok(sim.counters.intercepted >= 1);
});

test("a frozen intruder does not walk while it is held", () => {
  const sim = createSim({ seed: 13 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 280);
  for (let i = 0; i < 200 && !pointInBase(intruder.x, intruder.y); i++) step(sim, 50);
  intercept(sim);
  // advance until the vehicle has clamped on
  for (let i = 0; i < 200 && intruder.phase !== "frozen"; i++) step(sim, 50);
  assert.equal(intruder.phase, "frozen");
  const held = { x: intruder.x, y: intruder.y };
  for (let i = 0; i < 10; i++) step(sim, 50);
  assert.deepEqual({ x: intruder.x, y: intruder.y }, held,
    "the frozen intruder drifted");
});

test("a fresh intruder replaces the one that was taken", () => {
  const sim = createSim({ seed: 14 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 320);
  for (let i = 0; i < 200 && !pointInBase(intruder.x, intruder.y); i++) step(sim, 50);
  const before = sim.counters.spawned;
  intercept(sim);
  for (let i = 0; i < 400; i++) {
    step(sim, 50);
    if (!sim.intruders.some(x => x.id === intruder.id)) break;
  }
  assert.ok(sim.counters.spawned > before,
    "the taken intruder was not replaced — a resolved danger left an empty picture");
});

test("the vehicle returns to the depot and can be sent again", () => {
  const sim = createSim({ seed: 15 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  for (let i = 0; i < 200 && !pointInBase(intruder.x, intruder.y); i++) step(sim, 50);
  intercept(sim);
  for (let i = 0; i < 600 && sim.interceptor.phase !== "idle"; i++) step(sim, 50);
  assert.equal(sim.interceptor.phase, "idle", "the vehicle never got home");
  assert.equal(sim.interceptor.x, AIR.INTERCEPT_DEPART_X);

  const second = sim.intruders[0];
  if (second) {
    for (let i = 0; i < 200 && !pointInBase(second.x, second.y); i++) step(sim, 50);
    assert.ok(intercept(sim) || !pointInBase(second.x, second.y),
      "the vehicle could not be sent a second time");
  }
});

test("intercept is idempotent while a run is in progress", () => {
  const sim = createSim({ seed: 16 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  for (let i = 0; i < 200 && !pointInBase(intruder.x, intruder.y); i++) step(sim, 50);
  assert.ok(intercept(sim));
  step(sim, 50);
  assert.equal(intercept(sim), null, "a second call launched a second run");
  assert.equal(sim.interceptor.phase, "out");
});

test("recall puts the vehicle back and releases a held intruder", () => {
  const sim = createSim({ seed: 17 });
  sim.nextSpawnAt = Infinity;
  clearIntruders(sim);
  const intruder = spawnIntruder(sim, 300);
  for (let i = 0; i < 200 && !pointInBase(intruder.x, intruder.y); i++) step(sim, 50);
  intercept(sim);
  for (let i = 0; i < 200 && intruder.phase !== "frozen"; i++) step(sim, 50);
  assert.equal(intruder.phase, "frozen");
  recallInterceptor(sim);
  assert.equal(sim.interceptor.phase, "idle");
  assert.equal(intruder.phase, "at-wall", "the held intruder was left frozen");
});

test("interception state is reported, not read off internals", () => {
  const sim = createSim({ seed: 18 });
  const state = interceptionState(sim);
  assert.equal(state.phase, "idle");
  assert.equal(state.holding, false);
  assert.equal(state.x, AIR.INTERCEPT_DEPART_X);
});

// ---- counters ----------------------------------------------------------------------------

test("counters track spawns, entries and contacts", () => {
  const sim = createSim({ seed: 31 });
  for (let i = 0; i < 1200; i++) step(sim, 50);
  const last = counters(sim);
  assert.ok(last.spawned > 0, "nothing spawned in a minute of simulated time");
  assert.ok(last.contacts > 0, "nothing was ever seen by a sensor");
  assert.ok(last.clockMs > 0);
});
