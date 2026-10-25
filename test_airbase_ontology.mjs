// node --test test_airbase_ontology.mjs
//
// Tests for the airbase security ontology.
//
// THE LOAD-BEARING TEST HERE IS THE DIVERGENCE ONE. Declaring a rule that also exists as
// code is only worth anything if the declaration and the code are checked against each
// other — an unchecked second home for the rule is strictly worse than the one home it
// had. So `divergence()` runs the declared reasoner and the hand-written predicate over
// every picture the simulator can produce and requires zero disagreements, and a second
// test deliberately breaks an axiom to prove that check can fail.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BASE_SET,
  IMPLEMENTED_FORMS,
  TBOX,
  VERDICT_SET,
  aboxFor,
  axiom,
  buildABox,
  checkTBox,
  classifyPicture,
  divergence,
  handVerdict,
  permittedVerdicts,
  reason,
} from "./static/airbase_ontology.js";
import {
  SENSORS,
  SENSOR_STATUS,
  VERDICT,
  VERDICT_ORDER,
  buildPassage,
  createSim,
  faultSensor,
  spawnIntruder,
  step,
} from "./static/airbase_sim.js";
import { permittedFor } from "./static/airbase_panel.js";

const CAMERA_GROUPS = ["camera_nw", "camera_ne", "camera_sw", "camera_se"];

/** One unit's report, with every field defaulted so a test names only what it is about. */
const report = (over = {}) => ({
  id: "camera_nw", kind: "camera", group: "camera_nw",
  status: SENSOR_STATUS.ONLINE, contact: false, classified: null,
  ...over,
});

const picture = (reports, over = {}) => ({ reports, lastContactAgoMs: null, ...over });

const clean = () => CAMERA_GROUPS.map(g => report({ id: g, group: g }));

/** Every picture shape the simulator can produce, as a cross product. */
function everyPictureShape() {
  const statuses = [SENSOR_STATUS.ONLINE, SENSOR_STATUS.DEGRADED, SENSOR_STATUS.OFFLINE];
  const sighting = [
    [],                                             // nothing
    [CAMERA_GROUPS[0]],                             // one camera
    [CAMERA_GROUPS[0], CAMERA_GROUPS[1]],           // two cameras (independent)
    [CAMERA_GROUPS[0], CAMERA_GROUPS[2], CAMERA_GROUPS[3]],
    ["rail"],                                       // one patrol
    ["rail", "rail"],                               // two patrols: ONE observation
    [CAMERA_GROUPS[0], "rail"],                     // camera + patrol: independent
    [CAMERA_GROUPS[0], CAMERA_GROUPS[1], "rail"],
  ];
  // `animal` is a classification, not a threat — the harness has to cover it or the
  // divergence check would not notice the animal path drifting from the twin.
  const kinds = [null, "person", "vehicle", "animal"];
  const shapes = [];
  for (const status of statuses) {
    for (const groups of sighting) {
      for (const kind of kinds) {
        // lift each group to concrete reports
        const reports = CAMERA_GROUPS.map(g => report({ id: g, group: g, status }));
        const patrols = [];
        for (const g of groups) {
          if (g === "rail") {
            patrols.push(report({ id: "rail_1", kind: "patrol", group: "rail",
              contact: true, classified: kind }));
          }
        }
        const cameras = reports.map(r => groups.includes(r.id)
          ? { ...r, contact: true }
          : r);
        shapes.push(picture([...cameras, ...patrols]));
        // and the same picture with one patrol only, which is a different shape
        if (groups.includes("rail")) {
          shapes.push(picture([...cameras, patrols[0]]));
        }
      }
    }
  }
  return shapes;
}

// ---- the TBox ---------------------------------------------------------------------------

test("the TBox is coherent", () => {
  const status = checkTBox();
  assert.equal(status.satisfiable, true,
    `unsatisfiable: ${JSON.stringify(status.unsatisfiable)}`);
});

test("every declared form is one this domain implements", () => {
  // An axiom in a form nothing implements reads as enforced and is inert — the failure
  // ontology_core.checkTBox exists to reject.
  for (const a of TBOX) {
    assert.ok(IMPLEMENTED_FORMS.includes(a.form), `${a.id} uses unimplemented ${a.form}`);
  }
});

test("every axiom explains what it replaces", () => {
  for (const a of TBOX) {
    assert.ok(a.comment && a.comment.length > 40, `${a.id} has no useful comment`);
  }
});

test("the TBox names every verdict it can add or remove", () => {
  const mentioned = new Set();
  for (const a of TBOX) {
    const values = Array.isArray(a.value) ? a.value : [a.value];
    for (const v of values) if (VERDICT_SET.includes(v)) mentioned.add(v);
  }
  assert.deepEqual([...mentioned].sort(), [...VERDICT_SET].sort());
});

test("danger is escalation-only, which is what makes the grants do work", () => {
  // If danger were in the base set, `corroborated-contact-confirms` and
  // `patrol-identification-confirms` would grant something already available and would
  // never alter a decision — the inert-axiom failure traffic_ontology.js records.
  assert.ok(!BASE_SET.includes(VERDICT.DANGER));
  assert.deepEqual(BASE_SET, [VERDICT.NOT_SURE, VERDICT.SAFE]);
});

// ---- classification ---------------------------------------------------------------------

test("two cameras seeing one contact is corroboration; two patrols are not", () => {
  const twoCameras = classifyPicture(picture([
    ...CAMERA_GROUPS.map(g => report({ id: g, group: g, contact: g === "camera_nw" || g === "camera_ne" })),
  ]));
  assert.equal(twoCameras.corroborated, true);
  assert.deepEqual(twoCameras.contactGroups.sort(), ["camera_ne", "camera_nw"]);

  const twoPatrols = classifyPicture(picture([
    ...clean(),
    report({ id: "rail_1", kind: "patrol", group: "rail", contact: true }),
    report({ id: "rail_2", kind: "patrol", group: "rail", contact: true }),
  ]));
  assert.equal(twoPatrols.contact, true);
  assert.equal(twoPatrols.corroborated, false,
    "two patrols on one rail are one line of sight, not two observations");
  assert.deepEqual(twoPatrols.contactGroups, ["rail"]);
});

test("a patrol's close classification is an identification; its bare contact is not", () => {
  const identified = classifyPicture(picture([
    ...clean(),
    report({ id: "rail_1", kind: "patrol", group: "rail", contact: true, classified: "vehicle" }),
  ]));
  assert.equal(identified.identified, true);

  const unclassified = classifyPicture(picture([
    ...clean(),
    report({ id: "rail_1", kind: "patrol", group: "rail", contact: true }),
  ]));
  assert.equal(unclassified.identified, false);
});

test("an animal identified by a patrol is not a threat", () => {
  // The demo has to be able to show a correct `safe` on a picture that had sensor hits,
  // or the only thing it ever demonstrates is escalation.
  const flagged = [...clean().map(r => r.id === "camera_1" ? { ...r, contact: true } : r),
    report({ id: "rail_1", kind: "patrol", group: "rail", contact: true, classified: "animal" })];
  const facts = classifyPicture(picture(flagged));
  assert.equal(facts.identified, false, "an animal was treated as an identification");
  assert.equal(facts.identifiedAnimal, true);
  assert.deepEqual(permittedVerdicts(picture(flagged)).options,
    [VERDICT.NOT_SURE, VERDICT.SAFE]);
  assert.equal(permittedVerdicts(picture(flagged)).signal, "Silence");
});

test("an animal identified by a patrol outranks camera corroboration", () => {
  // Two cameras agreeing establishes that something is there; the patrol establishes what
  // it is. A fox seen by two cameras and named by a patrol is resolved, not dangerous.
  const flagged = [...clean().map(r =>
      (r.id === "camera_1" || r.id === "camera_3") ? { ...r, contact: true } : r),
    report({ id: "rail_1", kind: "patrol", group: "rail", contact: true, classified: "animal" })];
  assert.ok(!permittedVerdicts(picture(flagged)).options.includes(VERDICT.DANGER),
    "a corroborated fox raised the alarm");
});

test("a person identified by a patrol is a threat", () => {
  const flagged = [...clean().map(r => r.id === "camera_1" ? { ...r, contact: true } : r),
    report({ id: "rail_1", kind: "patrol", group: "rail", contact: true, classified: "person" })];
  assert.deepEqual(permittedVerdicts(picture(flagged)).options, [VERDICT.DANGER]);
});

test("a camera's report never counts as an identification", () => {
  // Cameras have no classification capability at all, so a `classified` field on one is
  // noise rather than evidence. Only the patrol branch may consult it.
  const facts = classifyPicture(picture([
    ...CAMERA_GROUPS.map(g => report({ id: g, group: g, contact: g === "camera_nw",
      classified: "person" })),
  ]));
  assert.equal(facts.identified, false);
});

test("an offline or degraded unit is a blind or degraded sector, never clean", () => {
  const offline = classifyPicture(picture([
    ...clean().map(r => r.id === "camera_se" ? { ...r, status: SENSOR_STATUS.OFFLINE } : r),
  ]));
  assert.equal(offline.blind, true);
  assert.deepEqual(offline.blindUnits, ["camera_se"]);

  const degraded = classifyPicture(picture([
    ...clean().map(r => r.id === "camera_sw" ? { ...r, status: SENSOR_STATUS.DEGRADED } : r),
  ]));
  assert.equal(degraded.degraded, true);
  assert.deepEqual(degraded.degradedUnits, ["camera_sw"]);
});

// ---- verdicts ---------------------------------------------------------------------------

test("a clean, fully covered perimeter permits not sure and safe", () => {
  const verdict = permittedVerdicts(picture(clean()));
  assert.deepEqual(verdict.options, [VERDICT.NOT_SURE, VERDICT.SAFE]);
  assert.equal(verdict.signal, "Silence");
});

test("one camera contact withdraws safe but does not raise danger", () => {
  const verdict = permittedVerdicts(picture([
    ...CAMERA_GROUPS.map(g => report({ id: g, group: g, contact: g === "camera_sw" })),
  ]));
  assert.deepEqual(verdict.options, [VERDICT.NOT_SURE]);
  assert.equal(verdict.signal, "Silence");
});

test("two independent contacts raise danger, and danger alone remains", () => {
  const verdict = permittedVerdicts(picture([
    ...CAMERA_GROUPS.map(g => report({ id: g, group: g,
      contact: g === "camera_nw" || g === "camera_se" })),
  ]));
  assert.deepEqual(verdict.options, [VERDICT.DANGER]);
  assert.equal(verdict.signal, "Alarm");
  assert.equal(verdict.escalated, true);
});

test("a patrol identification raises danger on its own", () => {
  const verdict = permittedVerdicts(picture([
    ...clean(),
    report({ id: "rail_2", kind: "patrol", group: "rail", contact: true, classified: "person" }),
  ]));
  assert.deepEqual(verdict.options, [VERDICT.DANGER]);
  assert.equal(verdict.signal, "Alarm");
});

test("a blind sector withdraws safe even with nothing on the perimeter", () => {
  const verdict = permittedVerdicts(picture([
    ...clean().map(r => r.id === "camera_ne" ? { ...r, status: SENSOR_STATUS.OFFLINE } : r),
  ]));
  assert.deepEqual(verdict.options, [VERDICT.NOT_SURE]);
  assert.equal(verdict.signal, "Silence");
});

test("a degraded sector withdraws safe too", () => {
  const verdict = permittedVerdicts(picture([
    ...clean().map(r => r.id === "camera_ne" ? { ...r, status: SENSOR_STATUS.DEGRADED } : r),
  ]));
  assert.deepEqual(verdict.options, [VERDICT.NOT_SURE]);
});

test("a confirmed intruder and a blind sector together still permit danger only", () => {
  // The alarm does not soften because another camera is down; the blind sector is a
  // separate fact and danger is already the loudest verdict available.
  const verdict = permittedVerdicts(picture([
    ...CAMERA_GROUPS.map(g => report({ id: g, group: g,
      status: g === "camera_se" ? SENSOR_STATUS.OFFLINE : SENSOR_STATUS.ONLINE,
      contact: g === "camera_nw" || g === "camera_ne" })),
  ]));
  assert.deepEqual(verdict.options, [VERDICT.DANGER]);
});

// ---- the divergence harness --------------------------------------------------------------

test("the declaration agrees with the hand-written predicate on every picture", () => {
  const cases = everyPictureShape();
  const result = divergence(cases);
  assert.ok(result.compared >= 100, `only compared ${result.compared} pictures`);
  assert.equal(result.disagreements, 0,
    `declared rule and hand-written predicate disagree: ${JSON.stringify(result.broken.slice(0, 3))}`);
});

test("the divergence check can actually fail", () => {
  // A check that cannot fail proves nothing. Break an axiom's value, run the same
  // comparison, and require it to notice.
  const blindAxiom = axiom("blind-sector-excludes-safe");
  const saved = [...blindAxiom.value];
  blindAxiom.value = ["NoSuchCondition", "Safe"];   // condition can never hold
  try {
    const result = divergence(everyPictureShape());
    assert.ok(result.disagreements > 0,
      "making a withdrawal unreachable did not change any verdict — the harness is inert");
  } finally {
    blindAxiom.value = saved;
  }
  assert.equal(divergence(everyPictureShape()).disagreements, 0, "restoring did not restore");
});

test("deleting an axiom is reported rather than silently changing behaviour", () => {
  const index = TBOX.findIndex(a => a.id === "blind-sector-excludes-safe");
  const [removed] = TBOX.splice(index, 1);
  try {
    const verdict = permittedVerdicts(picture([
      ...clean().map(r => r.id === "camera_ne" ? { ...r, status: SENSOR_STATUS.OFFLINE } : r),
    ]));
    assert.ok(verdict.unasserted.includes("blind-sector-excludes-safe"),
      "a deleted axiom was not reported as unasserted");
    // and with the rule gone, the blind sector no longer withdraws safe
    assert.ok(verdict.options.includes(VERDICT.SAFE));
    // reason() also reports the drift against the hand-written predicate
    assert.ok(verdict.violations.some(v => v.kind === "declaration-drift"),
      "the deleted axiom did not surface as declaration drift");
  } finally {
    TBOX.splice(index, 0, removed);
  }
});

// ---- the reasoner's own invariants ------------------------------------------------------

test("a violation means the state contradicts an axiom", () => {
  const facts = buildABox(picture(clean()));
  const verdict = reason(facts);
  assert.deepEqual(verdict.violations, [],
    `a clean picture violated an axiom: ${JSON.stringify(verdict.violations)}`);
  assert.equal(verdict.derived.signal, "Silence");
});

test("every verdict in the permitted set is in the vocabulary", () => {
  for (const description of everyPictureShape()) {
    const { options } = permittedVerdicts(description);
    assert.ok(options.length > 0, "a picture was left with no legal verdict");
    for (const v of options) assert.ok(VERDICT_SET.includes(v));
  }
});

test("the alarm is raised iff danger is permitted", () => {
  for (const description of everyPictureShape()) {
    const verdict = permittedVerdicts(description);
    assert.equal(verdict.signal === "Alarm", verdict.options.includes(VERDICT.DANGER),
      `signal ${verdict.signal} does not match ${verdict.options.join("/")}`);
  }
});

test("the ABox row names the fired conditions and the signal", () => {
  const rows = aboxFor(picture([
    ...CAMERA_GROUPS.map(g => report({ id: g, group: g,
      status: g === "camera_sw" ? SENSOR_STATUS.DEGRADED : SENSOR_STATUS.ONLINE,
      contact: g === "camera_nw" || g === "camera_ne" })),
  ]));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].detail.includes("BlindSector") || rows[0].detail.includes("DegradedSensor"));
  assert.ok(rows[0].detail.includes("CorroboratedContact"));
  assert.ok(rows[0].detail.includes("danger"));
  assert.ok(rows[0].detail.includes("경보"));
});

test("aboxFor has nothing to say before the first picture", () => {
  assert.deepEqual(aboxFor(null), []);
});

// ---- from the simulator, not from hand-built fixtures ------------------------------------

test("the panel wrapper and the ontology agree over a real run", () => {
  // Hand-built fixtures can miss a shape the simulator actually produces, so this drives
  // the shipped sim across several seeds and compares the wrapper to permittedVerdicts.
  for (const seed of [1, 2, 3, 7, 11]) {
    const sim = createSim({ seed });
    for (let i = 0; i < 600; i++) {
      step(sim, 50);
      const passage = buildPassage(sim);
      const viaPanel = permittedFor(passage);
      const direct = permittedVerdicts(passage);
      assert.deepEqual(viaPanel.options, direct.options,
        `seed ${seed} tick ${sim.tick}: panel and ontology disagree`);
      // `gold` exists only where the rule decided. A clean perimeter permits two
      // verdicts and has no gold — asserting one would invent a preference the rule
      // never declared.
      assert.equal(viaPanel.gold, direct.options.length === 1 ? direct.options[0] : null,
        `seed ${seed} tick ${sim.tick}: gold does not match the permitted set`);
    }
  }
});

test("a real run reaches all three verdicts, or the demo cannot show its headline", () => {
  const seen = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const sim = createSim({ seed });
    for (let i = 0; i < 900; i++) {
      step(sim, 50);
      const { options } = permittedVerdicts(buildPassage(sim));
      if (options.length === 1) seen.add(options[0]);
      else seen.add(options.join("+"));
    }
  }
  assert.ok(seen.has(VERDICT.SAFE) || seen.has(`${VERDICT.NOT_SURE}+${VERDICT.SAFE}`),
    `never saw a clean perimeter: ${[...seen].join(", ")}`);
  assert.ok(seen.has(VERDICT.DANGER), `never confirmed an intruder: ${[...seen].join(", ")}`);
  assert.ok([...seen].some(s => s.startsWith(VERDICT.NOT_SURE)),
    `never showed 'not sure': ${[...seen].join(", ")}`);
});

test("a fault injected on a clean perimeter changes the verdict it reports", () => {
  const sim = createSim({ seed: 41 });
  sim.nextSpawnAt = Infinity;
  sim.intruders = [];
  step(sim, 16);
  const before = permittedVerdicts(buildPassage(sim)).options;
  assert.ok(before.includes(VERDICT.SAFE), "a clean perimeter did not permit safe");
  faultSensor(sim, "camera_1", SENSOR_STATUS.OFFLINE);
  step(sim, 16);
  const after = permittedVerdicts(buildPassage(sim)).options;
  assert.deepEqual(after, [VERDICT.NOT_SURE]);
});

test("a manual spawn on a clean perimeter eventually raises the alarm", () => {
  // The spawn is placed on a camera's own aisle so the ladder is deterministic: one
  // camera reports it (=> not sure), and then a patrol that sweeps past identifies it
  // (=> danger). That is the demo's whole escalation, driven end to end.
  const sim = createSim({ seed: 42 });
  sim.nextSpawnAt = Infinity;
  sim.intruders = [];
  const lane = SENSORS.find(s => s.id === "camera_2").x;
  spawnIntruder(sim, lane);
  const seen = new Set();
  for (let i = 0; i < 900; i++) {
    step(sim, 50);
    for (const v of permittedVerdicts(buildPassage(sim)).options) seen.add(v);
  }
  assert.ok(seen.has(VERDICT.DANGER),
    `an intruder walked in and no alarm was ever permitted: ${[...seen]}`);
});

test("VERDICT_ORDER puts danger first", () => {
  // The page renders the bars in this order, and a caller reading the first key is meant
  // to read the alarm.
  assert.deepEqual(VERDICT_ORDER, [VERDICT.DANGER, VERDICT.NOT_SURE, VERDICT.SAFE]);
});
