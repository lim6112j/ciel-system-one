// The airbase security ontology: when a picture of six sensor reports counts as
// `danger`, `not sure` or `safe`, declared as axioms rather than written as an `if`.
//
// WHY DECLARE IT. The sibling domains state the reason and it is the same one here: a
// hand-written predicate is "not wrong, but it cannot be checked". The rule this file
// replaces — `handVerdict` at the bottom — is a plain if-chain, and the two halves that
// matter (which verdicts are permitted, and what the page shows beside each decision)
// are exactly the kind of thing that drifts when they live in two places. So the rule is
// declared, and `divergence()` runs the declaration and the hand-written twin over every
// picture the simulator can produce, requiring zero disagreements.
//
// THE DOMAIN'S ONE PRINCIPLE: a blind sector is not a clean sector. `guard_pii.py` makes
// the same argument about a detector it cannot reach — a caller that cannot tell "checked,
// nothing found" from "could not check" reads a blind spot as a health certificate. On a
// perimeter that is the default failure, not an edge case, so an offline or degraded unit
// withdraws `safe` before any contact is considered.
//
// THE SECOND: one report is not an identification. A camera sees something and cannot say
// what it is; the rail patrols share one line of sight, so their agreement is not two
// independent observations. Corroboration is therefore counted by `group` — the four
// cameras count separately, the two patrols count once — and only a patrol's close-range
// classification counts as an identification on its own.
//
// SCOPE: an OWL-RL subset, closed-world. The four forms are maxCardinality /
// minCardinality / range / disjoint, and the vocabulary lives in airbase_sim.js because
// the simulator needs the verdict names to build the question. Imports run one way —
// ontology imports the sim, never the reverse.

import { checkTBox as coreCheckTBox } from "./ontology_core.js";
import { BASE_VERDICT_SET, VERDICT, VERDICT_ORDER, isThreat } from "./airbase_sim.js";

// ---- vocabulary -------------------------------------------------------------------------

/** The full vocabulary, used to read which side of a disjointness is a verdict. */
export const VERDICT_SET = VERDICT_ORDER;

/** What a clean, fully covered perimeter is permitted before any rule fires. */
export const BASE_SET = BASE_VERDICT_SET;

export const VOCABULARY = {
  classes: [
    "Picture", "SensorReport", "Camera", "PatrolRobot",
    "BlindSector", "DegradedSensor", "OnlineSensor",
    "CorroboratedContact", "SingleSourceContact", "PatrolIdentification",
    "NoContact", "Danger", "NotSure", "Safe", "Alarm", "Silence",
  ],
  properties: ["verdict", "signal"],
};

/** The forms this domain's reason() evaluates. Per-domain on purpose — see
 *  ontology_core.js on why a shared list would let an inert axiom through. */
export const IMPLEMENTED_FORMS = ["maxCardinality", "minCardinality", "range", "disjoint"];

// ---- the TBox ---------------------------------------------------------------------------
//
// Declarations, not control flow. Read by checkTBox and reason(), and editable live —
// removing one disables its check and reason() reports it as unasserted rather than
// crashing. That is the demonstration the editor exists for.

export const TBOX = [
  {
    id: "blind-sector-excludes-safe",
    form: "disjoint",
    value: ["BlindSector", VERDICT.SAFE],
    comment:
      "Tier 0. 카메라나 레일 로봇 하나라도 degraded/offline이면 그 구역은 '확인된 " +
      "깨끗함'이 아니라 '확인되지 않음'이다. guard_pii.py가 도달할 수 없는 탐지기에 " +
      "대해 같은 말을 한다 — 'checked, nothing found'와 'could not check'를 구분하지 " +
      "못하는 호출자는 사각지대를 청정 판정으로 읽는다. 그래서 fault는 safe를 철회하고, " +
      "not sure가 남는다. 이 공리가 없으면 카메라 한 대가 꺼진 밤에 페이지는 'safe'를 " +
      "계속 말한다.",
  },
  {
    id: "single-contact-not-identified",
    form: "disjoint",
    value: ["SingleSourceContact", VERDICT.SAFE],
    comment:
      "Tier 0. 한 곳에서만 잡힌 접촉은 침입자 '확인'이 아니라 미확인 접촉이다. safe를 " +
      "철회하지만 danger를 부여하지는 않는다 — 카메라는 무언가가 있다는 것만 말하고, " +
      "그것이 무엇인지는 말하지 못한다. 기각(harmless motion)과 침입을 구분할 근거가 " +
      "없으므로 낙관도 비관도 하지 않는 것이 이 도메인이 할 수 있는 정직한 판정이다.",
  },
  {
    id: "degraded-sensor-not-clean",
    form: "disjoint",
    value: ["DegradedSensor", VERDICT.SAFE],
    comment:
      "Tier 0. degraded는 offline보다 약하지만 같은 방향의 사실이다. 판독값은 도착하지만 " +
      "신뢰 구간이 넓어졌고, wide-fov 카메라의 far-edge처럼 판정이 확률적인 구역이 " +
      "생긴다. offline은 별도 철회(blind-sector-excludes-safe)로 처리하고, 이 공리는 " +
      "판독값이 '있다'와 '정확하다'가 다르다는 것을 선언한다. 둘 다 있어야 하는 이유는 " +
      "오프라인일 때도 이 공리가 성립하기 때문이다 — 상태가 하나뿐인 필드가 아니라는 " +
      "것을 잊으면 둘 중 하나만 검사하게 된다.",
  },
  {
    id: "corroborated-contact-confirms",
    form: "range",
    subject: "CorroboratedContact",
    property: "verdict",
    value: [VERDICT.DANGER],
    comment:
      "Tier 0이며, danger를 부여하는 두 공리 중 하나다. 서로 독립인 증거 둘 이상 " +
      "(카메라 4대는 각자 하나, 레일 로봇 2대는 같은 선을 보므로 합쳐서 하나)이 같은 " +
      "접촉을 보고하면 그 접촉은 확인된 침입자다. 독립성이 핵심이다: 레일 로봇 두 대가 " +
      "같은 것을 봤다는 것은 관측이 두 번이라는 뜻이지, 사건이 두 개라는 뜻이 아니다. " +
      "그래서 group으로 세고, 대수를 세지 않는다. " +
      "주의: 동물로 식별된 접촉은 CorroboratedContact로 분류되지 않는다(ABox 참고) — " +
      "여러 출처가 일치한다는 것은 '무언가 있다'를 확립할 뿐 무엇인지는 말하지 않으므로, " +
      "식별이 끝난 동물을 접촉으로 세면 여우가 경보를 울린다.",
  },
  {
    id: "confirmed-contact-excludes-safe",
    form: "disjoint",
    value: ["CorroboratedContact", VERDICT.SAFE],
    comment:
      "Tier 0. 확인된 접촉이 있는 화면은 safe가 아니다. 아래의 부여 공리가 danger를 " +
      "집합에 더하지만, 그것만으로는 safe가 남아 있을 수 있다 — '침입자가 있다'와 " +
      "'안전하다'가 동시에 허용되는 판정 집합은 규칙이 아니라 오류다. 부여와 철회를 " +
      "분리해 선언하는 이유는 둘의 실패 방식이 다르기 때문이다: 부여가 빠지면 경보가 " +
      "울리지 않고, 철회가 빠지면 경보와 함께 'safe'가 화면에 남는다.",
  },
  {
    id: "confirmed-contact-excludes-uncertain",
    form: "disjoint",
    value: ["CorroboratedContact", VERDICT.NOT_SURE],
    comment:
      "Tier 0. 확인된 침입자는 '아직 모르겠다'가 아니다. 이 공리가 없으면 danger와 " +
      "not sure가 함께 허용되고, 모델은 확인된 침입자 앞에서 더 조용한 답을 고를 수 " +
      "있다 — 규칙이 허용한 선택이므로 막을 방법이 없다. 확인은 미확인의 반대말이고, " +
      "그 반대말을 선언하는 곳이 여기다.",
  },
  {
    id: "identification-excludes-safe",
    form: "disjoint",
    value: ["PatrolIdentification", VERDICT.SAFE],
    comment:
      "Tier 0. 레일 로봇이 근거리에서 사람/차량으로 식별한 화면은 safe가 아니다. " +
      "confirmed-contact-excludes-safe와 겹치는 것처럼 보이지만 근거가 다르다 — " +
      "하나는 출처가 둘이라는 사실, 다른 하나는 한 출처가 식별할 수 있는 거리에 " +
      "있었다는 사실이다. 식별만으로 danger가 부여되는 경로에는 이 철회가 반드시 " +
      "짝을 이뤄야 한다. 식별 경로만 corroboration 철회에 의존하면, 식별 단독일 때 " +
      "safe가 남는다.",
  },
  {
    id: "identification-excludes-uncertain",
    form: "disjoint",
    value: ["PatrolIdentification", VERDICT.NOT_SURE],
    comment:
      "Tier 0. 식별은 추정의 반대말이다. patrol-identification-confirms가 danger를 " +
      "부여하는데 not sure가 남아 있으면, 페이지는 '침입자를 확인했다'와 '잘 모르겠다'를 " +
      "동시에 내놓고 모델은 후자를 고를 수 있다. 확인했다면 모르는 것이 아니다.",
  },
  {
    id: "patrol-identification-confirms",
    form: "range",
    subject: "PatrolIdentification",
    property: "verdict",
    value: [VERDICT.DANGER],
    comment:
      "Tier 0. 레일 로봇이 근거리에서 접촉을 person 또는 vehicle로 분류했다면 그것은 " +
      "보고가 아니라 식별이며, 두 번째 출처를 기다리지 않는다. 이 부여가 " +
      "corroborated-contact-confirms와 겹치지 않는 이유는 근거가 다르기 때문이다 — " +
      "하나는 독립 출처의 수, 다른 하나는 한 출처가 무엇인지 말할 수 있는 거리다. " +
      "카메라에는 이 능력이 없으므로 카메라 단독 접촉은 여전히 미확인으로 남는다.",
  },
  {
    id: "danger-not-silent",
    form: "range",
    subject: "Danger",
    property: "signal",
    value: ["Alarm"],
    comment:
      "Tier 0이며, 이 온톨로지와 페이지가 그리는 것을 잇는 공리다. 오직 danger만 경보를 " +
      "울리고, not sure와 safe는 침묵한다. 규칙은 danger라고 결론했는데 페이지가 조용히 " +
      "넘어가는 것은 보고 가능하게 만들려는 바로 그 drift이므로, 렌더러가 알아서 " +
      "맞추도록 두지 않고 선언한다. traffic의 allow-means-forward와 같은 형태다.",
  },
  {
    id: "verdict-is-one",
    form: "minCardinality",
    subject: "Picture",
    property: "verdict",
    value: 1,
    comment:
      "Tier 0. 규칙은 어떤 판정도 전부 제거해서는 안 된다. 합법적 판정이 하나도 없는 " +
      "화면은 '안전'이 아니라 '판정 불가'이며, 이 공리가 그것을 아무도 읽지 않는 " +
      "폴백에 맡기는 대신 명시한다. reason()은 이 공리가 없으면 base 집합으로 " +
      "복구한다 — 집합이 비었다는 사실 자체가 보고 대상이다.",
  },
];

const PRISTINE = TBOX.map(a => ({ ...a, value: Array.isArray(a.value) ? [...a.value] : a.value }));

export const axiom = id => TBOX.find(a => a.id === id);

export { describeAxiom } from "./ontology_core.js";

export const checkTBox = (tbox = TBOX) => coreCheckTBox(tbox, IMPLEMENTED_FORMS);

/**
 * Which member of a disjointness is the condition and which is the verdict it excludes.
 *
 * Read from the axiom's own value rather than from a table here, so editing an axiom in
 * the live panel changes what is enforced. traffic_ontology.js records what the parallel
 * table cost: editing the axiom then changed nothing while the table silently went on
 * applying the old rule.
 */
export function disjointSides(rule) {
  const [a, b] = rule.value;
  const aIsVerdict = VERDICT_SET.includes(a);
  const bIsVerdict = VERDICT_SET.includes(b);
  if (bIsVerdict && !aIsVerdict) return { condition: a, excluded: b };
  if (aIsVerdict && !bIsVerdict) return { condition: b, excluded: a };
  return { condition: null, excluded: null };
}

// ---- the ABox ---------------------------------------------------------------------------

/**
 * Classify the picture from the sensor reports.
 *
 * Pure, and exported so the tests can drive it directly:
 *
 *   classifyPicture({
 *     reports: [{id, kind, group, status, contact, classified}, ...],
 *     lastContactAgoMs: 0,
 *   })
 *
 * The returned `conditions` is the set of classes the picture satisfies. Corroboration is
 * counted by DISTINCT GROUP among units reporting a contact — see the TBox comment on
 * `corroborated-contact-confirms` for why two patrols are one observation.
 */
export function classifyPicture({ reports = [], lastContactAgoMs = null } = {}) {
  const offline = reports.filter(r => r.status === "offline");
  const degraded = reports.filter(r => r.status === "degraded");
  const contacting = reports.filter(r => r.contact);

  const groups = new Set(contacting.map(r => r.group));
  const corroborated = groups.size >= 2;
  // ONLY A THREAT CLASSIFICATION IS AN IDENTIFICATION. A patrol that names what it sees as
  // an animal has resolved the picture in the other direction: the motion is real and it is
  // not an intrusion. Folding that into `identified` would raise the alarm on a fox.
  const identified = contacting.some(r => r.kind === "patrol" && isThreat(r.classified));
  const identifiedAnimal = contacting.some(r => r.kind === "patrol" && r.classified === "animal");

  return {
    blind: offline.length > 0,
    degraded: degraded.length > 0,
    contact: contacting.length > 0,
    corroborated,
    identified,
    identifiedAnimal,
    // Kept so the page can say WHICH units are blind rather than only that some are.
    blindUnits: offline.map(r => r.id),
    degradedUnits: degraded.map(r => r.id),
    contactingUnits: contacting.map(r => r.id),
    // Groups, not units: two patrols are one observation.
    contactGroups: [...groups],
    lastContactAgoMs,
  };
}

/**
 * Build the ABox for one picture.
 *
 * The ABox's asserted set is the HAND-WRITTEN predicate's answer. The axioms are then
 * evaluated against it, so a disagreement is reported on every decision rather than only
 * in the test harness — the arrangement traffic_ontology.js uses, and for the same reason.
 */
export function buildABox(description) {
  const facts = classifyPicture(description);

  const individuals = new Map();
  individuals.set("picture", {
    id: "picture",
    type: "Picture",
    asserted: new Set(handVerdict(description)),
    verdict: new Set(),
    signal: new Set(["Silence"]),
  });
  if (facts.blind) {
    individuals.set("blind", {
      id: facts.blindUnits.join("+"),
      type: "BlindSector",
      units: facts.blindUnits,
    });
  }
  if (facts.degraded) {
    individuals.set("degraded", {
      id: facts.degradedUnits.join("+"),
      type: "DegradedSensor",
      units: facts.degradedUnits,
    });
  }
  // AN IDENTIFIED ANIMAL IS NOT AN UNRESOLVED CONTACT. This ordering is the whole
  // discrimination this domain can make: a contact that a patrol has named as an animal
  // is a resolved, harmless observation, so it files as `NoContact` rather than as a
  // `SingleSourceContact`. Filing it as a contact and then adding a clearance rule would
  // mean the axiom set withdraws `safe` and puts it back in the same pass — a rule that
  // undoes another rule is exactly the arrangement this layer exists to avoid.
  //
  // It outranks CORROBORATION too, and that is the interesting case: two cameras agreeing
  // establishes that something is there, and the patrol establishes what it is. "Fox seen
  // by two cameras and identified by a patrol" is a resolved picture, not a danger.
  if (facts.identifiedAnimal && !facts.identified) {
    individuals.set("contact", { id: "animal-only", type: "NoContact", animal: true });
  } else if (facts.corroborated) {
    individuals.set("contact", {
      id: "corroborated-contact",
      type: "CorroboratedContact",
      groups: facts.contactGroups,
    });
  } else if (facts.contact) {
    individuals.set("contact", {
      id: facts.contactGroups[0] ?? "contact",
      type: "SingleSourceContact",
      groups: facts.contactGroups,
    });
  } else {
    individuals.set("contact", { id: "no-contact", type: "NoContact" });
  }
  if (facts.identified) {
    individuals.set("identified", {
      id: "patrol-identification",
      type: "PatrolIdentification",
      units: facts.contactingUnits,
    });
  }
  // A patrol named the contact as an animal: the motion is real and it is not an
  // intrusion. This is the one class that can RESTORE `safe` after a contact withdrew it,
  // and it is why the demo can show a correct `safe` on a picture that had a sensor hit.
  if (facts.identifiedAnimal) {
    individuals.set("animal", {
      id: "animal-identification",
      type: "AnimalIdentification",
      units: facts.contactingUnits,
    });
  }

  return { individuals, derived: facts };
}

// ---- the reasoner -----------------------------------------------------------------------

/**
 * Evaluate the TBox against an ABox.
 *
 * Returns {violations, unasserted, applied, derived} where `derived.permitted` is the
 * verdict set and `derived.signal` is what the page should do with it.
 *
 * A violation is the state CONTRADICTING a declared axiom, not the axiom firing — the
 * distinction warehouse_ontology.js draws: it reports "a camera is offline but `safe` is
 * still permitted", never "an offline camera withdrew safe".
 */
export function reason(facts) {
  const violations = [];
  const unasserted = [];
  const picture = facts.individuals.get("picture");

  const ruleFor = id => {
    const rule = axiom(id);
    if (!rule) {
      if (!unasserted.includes(id)) unasserted.push(id);
      return null;
    }
    return rule;
  };

  const holders = new Map();
  for (const individual of facts.individuals.values()) {
    if (individual.type) holders.set(individual.type, individual);
  }

  // ---- application: driven by the TBox, not by a table here ------------------------
  //
  // Every disjointness names a condition class and the verdict it excludes. The condition
  // holds if some ABox individual carries that type. The base set is {not sure, safe}:
  // `danger` is escalation-only, which is the same move traffic_ontology.js makes with
  // Drop and Quarantine and warehouse_ontology.js with `backward` — an alarm is not a
  // posture you reach for by default, and leaving it in the base set would make both
  // danger-granting axioms inert.
  const applied = [];
  const permitted = new Set(BASE_SET);
  for (const rule of [...TBOX]) {
    if (rule.form !== "disjoint") continue;
    const { condition, excluded } = disjointSides(rule);
    if (!excluded) continue;
    if (!holders.has(condition)) continue;
    if (!permitted.has(excluded)) continue;
    permitted.delete(excluded);
    applied.push({ axiom: rule.id, removed: excluded, because: condition });
  }

  for (const declared of PRISTINE) {
    if (!axiom(declared.id) && !unasserted.includes(declared.id)) unasserted.push(declared.id);
  }

  // ---- the grants: the only two axioms that can add `danger` ----------------------
  //
  // Measured against what the withdrawals left, not against the facts that triggered
  // them. The two differ when an axiom is edited in the live panel, and the question the
  // page asks is "did this evidence change what the picture may be called?".
  const beforeGrants = new Set(permitted);
  const grants = ["corroborated-contact-confirms", "patrol-identification-confirms"];
  for (const id of grants) {
    const grant = ruleFor(id);
    if (!grant) continue;
    const condition = id === "corroborated-contact-confirms"
      ? "CorroboratedContact" : "PatrolIdentification";
    if (!holders.has(condition)) continue;
    for (const verdict of grant.value) permitted.add(verdict);
  }
  const escalated = [...permitted].some(v => !beforeGrants.has(v));

  // ---- the floor: a rule may never empty the set ----------------------------------
  const floor = ruleFor("verdict-is-one");
  if (floor && permitted.size < floor.value) {
    for (const verdict of BASE_SET) permitted.add(verdict);
  }

  // ---- check the declaration against the hand-written predicate --------------------
  //
  // THE POINT OF THE LAYER. The ABox asserted what handVerdict concluded; the axioms
  // above computed what the DECLARED rule concludes. A non-empty `violations` is the
  // signal that an axiom and the predicate it replaced have drifted.
  const asserted = [...picture.asserted].sort().join("|");
  const computed = [...permitted].sort().join("|");
  if (picture.asserted.size && asserted !== computed) {
    violations.push({
      axiom: "disjoint",
      subject: picture.id,
      detail: `선언된 공리는 [${[...permitted].join(", ")}]를 허용하지만 손으로 쓴 술어는 ` +
              `[${[...picture.asserted].join(", ")}]를 주장한다`,
      kind: "declaration-drift",
    });
  }

  picture.verdict = permitted;

  // ---- check the axioms against the resulting set ---------------------------------
  //
  // Checked as the disjointness it is declared as — the permitted set must not intersect
  // what the axiom separates off — rather than by re-deriving the condition. That catches
  // BOTH failure directions with one rule: an applied axiom whose side effect went
  // missing, and a deleted axiom whose withdrawal is still happening.
  for (const rule of TBOX) {
    if (rule.form !== "disjoint") continue;
    if (!axiom(rule.id)) continue;
    const { condition, excluded } = disjointSides(rule);
    if (!excluded) continue;
    if (!holders.has(condition)) continue;
    if (permitted.has(excluded)) {
      violations.push({
        axiom: rule.id,
        subject: picture.id,
        detail: `${condition} 이(가) 성립하지만 ${excluded} 이(가) 여전히 허용됨 — ` +
                `"${rule.value.join(" ⊥ ")}" 이(가) 모순됨`,
        kind: "disjoint-violated",
      });
    }
  }

  // ---- the signal: only danger alarms ---------------------------------------------
  const signalRule = ruleFor("danger-not-silent");
  const signal = permitted.has(VERDICT.DANGER) ? "Alarm" : "Silence";
  if (signalRule && permitted.has(VERDICT.DANGER) && !signalRule.value.includes(signal)) {
    violations.push({
      axiom: signalRule.id,
      subject: picture.id,
      detail: `판정이 danger인데 신호가 ${signal}로 선언되지 않았다; 이 공리가 허용하는 ` +
              `것은 ${signalRule.value.join(", ")}`,
      kind: "signal",
    });
  }

  return {
    violations,
    unasserted,
    applied,
    derived: {
      permitted: VERDICT_SET.filter(v => permitted.has(v)),
      verdict: permitted,
      signal,
      escalated,
      ...facts.derived,
    },
  };
}

// ---- the API the page and the panel read -------------------------------------------------

/**
 * The permitted verdict set, as the decision loop sees it.
 *
 * `undecided` is SET EQUALITY against the base set, not a length comparison — the bug
 * traffic_ontology.js documents. Here the two happen to differ in length, but the check
 * is written the same way so it cannot become a coincidental match later.
 */
export function permittedVerdicts(description) {
  const facts = buildABox(description);
  const verdict = reason(facts);
  const options = verdict.derived.permitted.length
    ? verdict.derived.permitted
    : [...VERDICT_SET];
  return {
    options,
    // Nothing narrowed the menu: every unit is online and nothing was seen. The page
    // still asks, because "are there intruders?" is the question this demo exists for.
    undecided: options.length === BASE_SET.length && options.every(v => BASE_SET.includes(v)),
    signal: verdict.derived.signal,
    facts: verdict.derived,
    applied: verdict.applied,
    escalated: verdict.derived.escalated,
    violations: verdict.violations,
    unasserted: verdict.unasserted,
  };
}

// ---- the hand-written twin, and the check that they agree --------------------------------

/**
 * The verdict set, written by hand.
 *
 * This is what the ontology replaces, kept so the two can be compared. It is deliberately
 * a plain if-chain — the point is that it CANNOT be wrong in a way you can detect, which
 * is why the declared version is the one that ships.
 */
export function handVerdict(description) {
  const facts = classifyPicture(description);
  const out = new Set(BASE_SET);
  if (facts.blind || facts.degraded) out.delete(VERDICT.SAFE);
  // A contact that a patrol has named as an animal is a resolved, harmless observation:
  // it does not withdraw `safe`. Everything else that was seen does.
  const resolvedAnimal = facts.identifiedAnimal && !facts.identified;
  if (facts.contact && !resolvedAnimal) out.delete(VERDICT.SAFE);
  // An animal a patrol named is not a threat even if two cameras saw it first: the
  // corroboration says the motion is real, the identification says what it is.
  if (!resolvedAnimal && (facts.corroborated || facts.identified)) {
    out.add(VERDICT.DANGER);
    // A confirmed intruder is not "not sure"; the alarm is the answer.
    out.delete(VERDICT.NOT_SURE);
  }
  if (out.size === 0) for (const v of BASE_SET) out.add(v);
  return VERDICT_ORDER.filter(v => out.has(v));
}

/**
 * Does the declared rule agree with the hand-written predicate it replaces?
 *
 * Run both over every picture the simulator can produce and compare. Zero disagreements is
 * the claim; a non-zero count means the declaration does NOT faithfully reimplement the
 * code, and the number to report is the disagreement count, not "it looks right".
 */
export function divergence(cases) {
  const broken = [];
  let compared = 0;
  for (const description of cases) {
    compared++;
    const declared = permittedVerdicts(description).options.slice().sort();
    const hand = handVerdict(description).slice().sort();
    if (declared.join("|") !== hand.join("|")) {
      broken.push({
        lastContactAgoMs: description.lastContactAgoMs ?? null,
        facts: classifyPicture(description),
        declared,
        hand,
      });
    }
  }
  return { compared, disagreements: broken.length, broken };
}

/** One row describing what the ontology currently believes, for the panel. */
export function aboxFor(description) {
  if (!description) return [];
  const verdict = permittedVerdicts(description);
  const facts = verdict.facts;
  const conditions = [];
  if (facts.blind) conditions.push("BlindSector");
  if (facts.degraded) conditions.push("DegradedSensor");
  if (facts.corroborated) conditions.push("CorroboratedContact");
  else if (facts.contact) conditions.push("SingleSourceContact");
  else conditions.push("NoContact");
  if (facts.identified) conditions.push("PatrolIdentification");

  const what = facts.identified
    ? `patrol identified ${facts.contactingUnits.join("/")}`
    : facts.contact
      ? `contact seen by ${facts.contactGroups.length} source(s)` +
        (facts.blind || facts.degraded ? `, ${facts.blindUnits.length + facts.degradedUnits.length} unit(s) not clean` : "")
      : "no contact";
  return [{
    id: "perimeter",
    detail: `${conditions.join(" + ")} · ${what} · permitted ${verdict.options.join("/")}` +
      ` → ${verdict.signal === "Alarm" ? "경보" : "침묵"}`,
    violations: verdict.violations,
    unasserted: verdict.unasserted,
  }];
}
