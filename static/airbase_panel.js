// The airbase ontology panel — a domain adapter over the shared editor in
// ontology_core.js, the same structure as traffic_panel.js and warehouse_panel.js.
//
// ENFORCEMENT IS NOT A SWITCH HERE, for the reason the other two give: the rule removes
// verdicts from the permitted set, and removing a verdict IS the behaviour change — a
// picture with an offline camera cannot be called `safe`, and that is the whole rule. An
// "Ontology: on/off" button beside it would suggest the rule is optional on a page whose
// subject is the rule. The live TBox editor is the switch: deleting an axiom disables its
// check and the panel reports it as unasserted, and the next decision meets a different
// rule set.
//
// THIS DOMAIN CANNOT CLAIM THAT ENFORCEMENT LEAVES DECISIONS UNCHANGED — it cannot even
// claim that for the shipped TBox every picture is narrowed, because a fully-online
// perimeter with nothing on it legitimately permits the whole base set. What it can claim,
// and what `node --test test_airbase_ontology.mjs` checks over every picture the simulator
// produces, is that the declared rule and the hand-written predicate agree.

import { TBOX, VOCABULARY, IMPLEMENTED_FORMS, aboxFor, permittedVerdicts }
  from "./airbase_ontology.js";
import { mountTBoxEditor } from "./ontology_core.js";

// Snapshot at construction time, before the panel is ever mounted, so a stray edit during
// a session is not what `reset` restores you to.
const PRISTINE = TBOX.map(a => ({
  ...a,
  value: Array.isArray(a.value) ? [...a.value] : a.value,
}));

export function mountAirbasePanel({ root, getSim, onChange }) {
  return mountTBoxEditor({
    root,
    adapter: {
      tbox: TBOX,
      pristine: PRISTINE,
      implementedForms: IMPLEMENTED_FORMS,
      vocabulary: VOCABULARY,
      getSim,
      aboxFor,
      // Only the VIOLATIONS are reported here, deliberately. The ABox row above already
      // names the fired classes, the permitted set and the signal, so a note restating
      // them would be a second copy of the same sentence on a different clock — the two
      // could then disagree on screen. One line, one home.
      notes: passage => {
        if (!passage) {
          return [{ ok: true, text: "아직 판정한 화면이 없습니다 — 감시를 시작하세요" }];
        }
        return permittedVerdicts(passage).violations
          .map(v => ({ ok: false, text: `${v.axiom}: ${v.detail}` }));
      },
      note: "선언된 규칙이 이 화면의 판정을 정한다. 카메라 한 대라도 꺼졌거나 성능이 " +
            "떨어졌으면 그 구역은 '확인된 깨끗함'이 아니라 '확인되지 않음'이므로 safe가 " +
            "철회된다. 서로 독립인 출처 둘이 같은 접촉을 보거나, 레일 로봇이 근거리에서 " +
            "그것을 사람/차량으로 식별했을 때만 danger가 부여된다 — 한 출처의 미확인 " +
            "접촉은 not sure로 남는다. 여기서 공리를 제거하면 그 검사가 꺼지고 패널이 " +
            "그 사실을 알린다. 이 도메인은 시행이 결정을 바꾸지 않는다고 주장할 수 없다 — " +
            "판정을 철회하는 것이 바로 그 변경이기 때문이다. 대신 주장할 수 있는 것, " +
            "그리고 `node --test test_airbase_ontology.mjs`가 시뮬레이터가 만드는 모든 " +
            "화면 형태에 대해 검사하는 것은, 선언된 규칙과 그것이 대체한 손으로 쓴 " +
            "술어가 일치한다는 것이다.",
      onChange,
    },
  });
}

/**
 * The permitted verdict set, as the decision loop sees it.
 *
 * `gold` is computed through the SAME verdict rather than a second, independent guess — the
 * two drifting apart is the failure mode this layer exists to prevent, and the airbase
 * version of it would be the page showing an alarm for a verdict the rule never allowed.
 */
export function permittedFor(passage) {
  const verdict = permittedVerdicts(passage);
  return {
    options: verdict.options.length ? verdict.options : ["not sure", "safe"],
    // What the hand-written predicate says. On a picture the rule does NOT narrow there
    // is no single answer, so this is null rather than the first of two legal verdicts —
    // showing "gold: not sure" for a clean perimeter would claim a preference the rule
    // never declared.
    gold: verdict.options.length === 1 ? verdict.options[0] : null,
    signal: verdict.signal,
    facts: verdict.facts,
    applied: verdict.applied,
    violations: verdict.violations,
    unasserted: verdict.unasserted,
  };
}
