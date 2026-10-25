// Airbase decision-quality harness: does the head read the six sensors, or guess?
//
// The demo's whole subject is that "danger", "not sure" and "safe" mean something
// specific, declared as axioms. The question always offers all three verdicts (see
// `buildQuestion` — narrowing the menu would make every answer a one-option tautology),
// and the rule is a veto on the answer. So the numbers worth having are:
//
//   * agreement  — does the model's answer match the verdict the rule alone permits?
//   * veto rate  — how often would the page have refused the model's answer, and
//                  replaced it with the safest permitted one?
//   * collapse   — is the head answering one verdict regardless of the state?
//
// Slices are reported separately, because they fail for different reasons:
//
//   clean      — six units online, nothing seen. Permits {not sure, safe}; no gold.
//                What matters here is that "safe" is reachable at all.
//   degraded   — a unit reporting badly, nothing seen. Narrowed to {not sure}.
//   blind      — a unit offline, nothing seen. Narrowed to {not sure}.
//                The failure this catches is the head calling a blind perimeter safe.
//   contact    — something seen but uncorroborated. Narrowed to {not sure}.
//   confirmed  — corroborated or identified. Narrowed to {danger}.
//                The failure this catches is a head that answers "safe" to a sighting.
//
// It imports static/airbase_sim.js and static/airbase_ontology.js, the same modules the
// browser runs, so the scenarios and the gold cannot drift from the demo.
//
//   uv run python -m uvicorn server:app --port 8001     # terminal 1
//   node eval_airbase.mjs --url http://127.0.0.1:8001/api/predict --model ciel_decision_model_v1
//   node eval_airbase.mjs --model english --path ""      # a laya arm
//
// NOTE THE PORT. decision_lab holds 8000, so this repo's server runs on 8001 and
// DECISION_LAB_URL points at 8000.
//
// The confidence percentiles per slice are what a gate — if one is ever added — should be
// set from, measured rather than guessed. There is no gate today: the ontology owns the
// permitted set, and the model choosing within it is the design.

import * as S from "./static/airbase_sim.js";
import { permittedVerdicts, classifyPicture } from "./static/airbase_ontology.js";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const URL = argOf("--url", "http://127.0.0.1:8001/api/predict");
const MODEL = argOf("--model", "ciel_decision_model_v1");
const PATH = argOf("--path", "");
const N = Number(argOf("--n", 90));
const SEED = Number(argOf("--seed", 1));
const STEP_MS = 50;
const DECIDE_EVERY_TICKS = 24;   // one decision per 1.2 s, matching the page

/** The slice a picture belongs to, so failures are attributed to a cause. */
function sliceOf(description) {
  const facts = classifyPicture(description);
  if (facts.identified || facts.corroborated) return "confirmed";
  if (facts.contact) return "contact";
  if (facts.blind) return "blind";
  if (facts.degraded) return "degraded";
  return "clean";
}

/**
 * Collect decision points by driving the shipped sim.
 *
 * Every state the demo can produce is reachable this way — including the degraded and
 * blind ones, which a hand-built fixture set forgets. The slice mix is also the honest
 * one: most of a run is a clean perimeter with the occasional interruption.
 */
function collectScenarios(n, seed) {
  const sim = S.createSim({ seed });
  const seen = [];
  for (let i = 0; i < 200000 && seen.length < n; i++) {
    S.step(sim, STEP_MS);
    if (i % DECIDE_EVERY_TICKS !== 0) continue;
    const passage = S.buildPassage(sim);
    const verdict = permittedVerdicts(passage);
    seen.push({
      qid: S.QUESTION_ID,
      passage,
      slice: sliceOf(passage),
      // All three verdicts, always — the same question the page asks. See
      // `buildQuestion` on why the menu is not narrowed to the permitted set.
      question: S.buildQuestion(),
      state: S.buildState(passage),
      permitted: verdict.options,
      // THERE IS NO GOLD WHEN THE RULE LEAVES A CHOICE. On a clean perimeter the rule
      // permits {not sure, safe} and either is a legal reading of the same evidence;
      // picking the first as "the answer" would invent a preference the rule never
      // declared and score a correct model as wrong. Gold exists only where the rule
      // itself narrowed the set to one verdict.
      gold: verdict.options.length === 1 ? verdict.options[0] : null,
      // True when the rule alone decided — the slice where a disagreement is
      // unambiguously a model failure rather than a legitimate choice.
      forced: verdict.options.length === 1 ? verdict.options[0] : null,
    });
  }
  return seen;
}

async function ask(scenario) {
  const payload = {
    state: scenario.state,
    questions: { [scenario.qid]: scenario.question },
    model: MODEL,
  };
  if (PATH) payload.path = PATH;
  const response = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status}: ${detail.slice(0, 300)}`);
  }
  const body = await response.json();
  return body.result.answers[scenario.qid];
}

function percentiles(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { p10: at(0.10), p50: at(0.50), p90: at(0.90) };
}

function pct(n, d) { return d ? `${(100 * n / d).toFixed(1)}%` : "n/a"; }

async function main() {
  const scenarios = collectScenarios(N, SEED);
  if (!scenarios.length) {
    console.error("no decision points reached — did the sim evolve?");
    process.exit(1);
  }
  const arm = PATH ? `${MODEL} (path=${PATH})` : MODEL;
  console.error(`asking ${scenarios.length} scenarios (${arm}) → ${URL}`);

  const rows = [];
  for (const scenario of scenarios) {
    try {
      const answer = await ask(scenario);
      rows.push({ scenario, answer });
    } catch (error) {
      console.error(`  failed: ${error.message}`);
      process.exit(1);
    }
  }

  const forcedRows = rows.filter(r => r.scenario.forced);
  const forcedRight = forcedRows.filter(r => r.answer.choice === r.scenario.forced).length;
  const legalRows = rows.filter(r => r.scenario.permitted.includes(r.answer.choice)).length;
  console.log(`\n=== airbase verdict — ${arm} ===`);
  console.log(`answers the rule permits: ${legalRows}/${rows.length} ` +
    `(${pct(legalRows, rows.length)})`);
  console.log("(the rest would be VETOED by the page and replaced with the safest " +
    "permitted verdict — this is the model's own opinion, before the veto)");
  console.log(`rule-determined decisions answered correctly: ${forcedRight}/${forcedRows.length} ` +
    `(${pct(forcedRight, forcedRows.length)})`);
  console.log("(ruled-out rows are excluded: where the rule permits two verdicts there is " +
    "no gold to score against)\n");

  const bySlice = {};
  for (const row of rows) {
    const bucket = (bySlice[row.scenario.slice] ||= {
      n: 0, forcedN: 0, forcedCorrect: 0, undetermined: 0,
      conf: [], confForced: [], pred: {}, gold: {}, confusion: {}, outside: 0,
    });
    bucket.n++;
    bucket.conf.push(row.answer.confidence || 0);
    if (row.scenario.forced) {
      bucket.forcedN++;
      bucket.confForced.push(row.answer.confidence || 0);
      const right = row.answer.choice === row.scenario.forced;
      if (right) bucket.forcedCorrect++;
      const c = (bucket.confusion[row.scenario.forced] ||= {});
      c[row.answer.choice] = (c[row.answer.choice] || 0) + 1;
      bucket.gold[row.scenario.forced] = (bucket.gold[row.scenario.forced] || 0) + 1;
    } else {
      // No gold. Record what the model chose so the slice is still legible, but keep it
      // out of the accuracy numbers — a legitimate choice is not an error.
      bucket.undetermined++;
      const key = `any of ${row.scenario.permitted.join("/")}`;
      bucket.gold[key] = (bucket.gold[key] || 0) + 1;
      const c = (bucket.confusion[key] ||= {});
      c[row.answer.choice] = (c[row.answer.choice] || 0) + 1;
    }
    bucket.pred[row.answer.choice] = (bucket.pred[row.answer.choice] || 0) + 1;
    if (!row.scenario.permitted.includes(row.answer.choice)) bucket.outside++;
  }

  for (const [slice, b] of Object.entries(bySlice).sort((a, b2) => b2[1].n - a[1].n)) {
    console.log(`--- ${slice}: ${b.n} decisions`);
    if (b.forcedN) {
      console.log(`  rule forced one answer: ${b.forcedCorrect}/${b.forcedN} ` +
        `(${pct(b.forcedCorrect, b.forcedN)})  ← the load-bearing number`);
    }
    if (b.undetermined) {
      console.log(`  rule left a choice    : ${b.undetermined} (not scored — no gold)`);
    }
    console.log(`  gold distribution     : ${JSON.stringify(b.gold)}`);
    console.log(`  predicted distribution: ${JSON.stringify(b.pred)}`);
    if (b.outside) {
      console.log(`  would be VETOED       : ${b.outside} of ${b.n} ` +
        `(replaced by the safest permitted verdict)`);
    }
    const preds = [...new Set(Object.values(b.confusion).flatMap(r => Object.keys(r)))].sort();
    console.log("  confusion (rows = what the rule says):");
    for (const g of Object.keys(b.confusion).sort()) {
      const cells = preds.map(p => `${p}=${b.confusion[g][p] || 0}`).join("  ");
      console.log(`    ${g.padEnd(24)} ${cells}`);
    }
    const p = percentiles(b.confForced.length ? b.confForced : b.conf);
    console.log(`  confidence p10/p50/p90: ${p.p10.toFixed(3)} / ${p.p50.toFixed(3)} / ` +
      `${p.p90.toFixed(3)}${b.confForced.length ? " (rule-determined rows)" : ""}`);
    console.log();
  }

  console.log("A predicted distribution with one populated key is a collapse: the head is");
  console.log("answering one verdict regardless of the state. Compare arms with --model");
  console.log("and --path; there is no airbase-trained head, so this measures how far an");
  console.log("out-of-domain checkpoint gets on this state shape.");
}

main();
