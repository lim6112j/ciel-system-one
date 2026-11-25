# OMS Chatbot Example — Design

**Date:** 2026-11-25

## Intent and why

Add a second chatbot example for the `oms` sub-path in `../ciel-system-one-model`: a 주류도매 KakaoTalk-style channel where a fast intent (`주문 / 조회 / 질문`) produces a natural Korean 추임새 before the slower OpenRouter answer arrives. It mirrors the VDS demo's latency-hiding UX, but as a completely separate page because the two services are different domains.

## Goals

- `/oms_chat.html`, linked from `static/index.html`, separate from `/vds_chat.html`.
- Same two-stage flow and same 50–500 ms 시작 지연 slider, default 150 ms.
- OMS intent → intent-specific backchannel; low confidence or upstream failure → fallback + visible warning.
- LLM answers look like a liquor-wholesale assistant using a small demo catalog.
- Each demo keeps its own decision_lab config; only one is served at a time.

## Non-goals

- No real order placement, inventory lookup, or KakaoTalk integration.
- No new training: reuse `models/head_dynamic_oms.pt`.
- No combined config and no model-repo changes: `configs/vds.yaml` and `configs/oms.yaml` stay as-is.
- No change to VDS intents, copy, or page behavior beyond the shared JS extraction.
- No persistence of the delay slider across reloads.

## Anti-goals

- Reusing the VDS confidence floor (0.3): with only three OMS options, chance is ~0.33, so a random head would pass. OMS uses **0.5**.
- Claiming the sample prices are live data; the page and README call them demo-only.
- Silently falling back without a warning, as in the VDS demo.
- Serving both heads from one config: training/eval commands read a single `dynamic_head.checkpoint_filename`, so a combined config would make `train-vds` and `train-oms` target the same file. Keeping the domains separate avoids that entire class of mistake.

## Constraints

- OMS options, verbatim from `configs/oms.yaml`: `주문`, `조회`, `질문`.
- OMS request: `path: "oms"`, raw `custom_text`, `stt_source: "kakaotalk-demo@1"`, `X-Decision-Lab-Log: 1`.
- Backchannel copy:
  - `주문` → `네, 주문 접수 도와드릴게요.`
  - `조회` → `주문 내역 확인하고 있어요.`
  - `질문` → `가격이랑 재고 확인해 드릴게요.`
  - low confidence / upstream failure / unknown → `그러니까요, 잠깐 확인할게요.`
- Warnings:
  - low confidence → `OMS 헤드 신뢰도가 낮아 기본 추임새를 썼어요.`
  - unavailable → `OMS를 사용할 수 없어 기본 추임새를 썼어요.`
- Chat model convention unchanged: `GUARD_MODEL` / `openrouter:deepseek/deepseek-v4.1-flash`, `temperature=0`.
- Message validation reuses `server.MAX_MESSAGE_CHARS`; no device lock on either new route.
- The latency chip label follows the active classifier: `VDS …ms` on the VDS page, `OMS …ms` on the OMS page.
- Both configs default to port 8000 (and llama-server to 8080), so run one at a time. The README explains the switch.

## Approaches

- **1 — keep per-domain configs, serve one at a time (chosen).** No model-repo change. Start `configs/vds.yaml` for `/vds_chat.html` or `configs/oms.yaml` for `/oms_chat.html`. The current repo adds a separate OMS page and two OMS routes.
- **2 — one config serves both heads, two UI pages.** Rejected: `web.paths` could name both checkpoints, but `dynamic_head.checkpoint_filename` is singular and all train/eval commands use it; a combined config would silently couple retraining.
- **3 — OMS on a separate port with a per-path URL env.** No config change, but `ciel`/server gain path-specific URL branching. Rejected as more moving parts than switching services.

## Decided how

### Model repo

No file changes. Use the existing configs:

- VDS demo: `python -m decision_lab --config configs/vds.yaml ui`
- OMS demo: `python -m decision_lab --config configs/oms.yaml ui`
- Retrain/eval each with its own config (`train-vds`/`eval-vds` vs `train-oms`/`scripts/eval_oms.py`).
- Stop one service before starting the other; both want port 8000 and llama-server port 8080. Changing ports is out of scope.

### Current repo

- **Create `oms_chat.py`** — `OMS_OPTIONS`, `OMS_QUESTION`, `BACKCHANNELS`, `FALLBACK_BACKCHANNEL`, `MIN_CONFIDENCE = 0.5`, warnings, `SYSTEM_PROMPT` with a small demo catalog, `backchannel_for(intent)`, `answer(message, intent, chat_model=None)`.
- **Modify `server.py`** — add `POST /api/oms-chat/intent` and `/api/oms-chat/answer` mirroring the VDS routes but using `ciel.predict_text(..., path="oms", stt_source="kakaotalk-demo@1")` and `oms_chat` helpers. Factor the duplicate route body into two small private helpers shared by VDS and OMS if the diff stays readable; otherwise leave both route pairs explicit.
- **Extract `static/chat_demo.js`** from `static/vds_chat.js`: exports `runTurn(message, deps, vdsDelayMs = 150)` with the existing ordering and warning behavior, plus `wireChat({intentUrl, answerUrl, selectors})` for the browser branch. `static/vds_chat.js` and `static/oms_chat.js` become thin wrappers with their own URLs and element ids.
- **Create `static/oms_chat.html`** — same panel/bubble/slider layout as `vds_chat.html`, but mode text says 주류도매 카카오톡 채널 and the note says the prices are demo-only.
- **Modify `static/index.html`** — add `🛒 OMS 챗봇 — 주류도매 주문 응답` beside the VDS link.
- **Modify `README.md`** — short OMS section: how to switch decision_lab between `configs/vds.yaml` and `configs/oms.yaml`, what the two-stage flow shows, the 0.5 confidence floor, and the demo-catalog caveat.

### Demo catalog in the prompt

A fixed, clearly-labeled example table used only to make answers domain-shaped: 참이슬 12병 24,000원, 처음처럼 12병 23,000원, 카스 500ml 24병 36,000원, 테라 500ml 24병 37,000원. The prompt tells the model to say it is 예시 가격 and not invent live inventory.

### Tests

- `test_oms_chat.py` — every intent maps to exact copy; unknown/None falls back; low confidence floor is 0.5; `answer()` uses injected chat model and includes a catalog item.
- `test_server.py` — OMS intent route returns mapped copy/degraded flag and degrades on upstream error; answer route returns text and 502s; page smoke pins `oms_chat.js`, slider ids, and new index link.
- Keep `test_vds_chat_ui.mjs`, changing only its import to the extracted `static/chat_demo.js`; all existing ordering, fallback, degraded, and delay tests stay green. Add `test_oms_chat_ui.mjs` importing `static/oms_chat.js` to pin its endpoint URLs and element ids without a DOM harness.
- Existing VDS behavior must remain green unchanged after the JS extraction.

## Files

- Create: `oms_chat.py`, `static/oms_chat.html`, `static/oms_chat.js`, `static/chat_demo.js`
- Modify: `server.py`, `static/vds_chat.js`, `static/index.html`, `README.md`
- Tests: `test_oms_chat.py`, `test_server.py`, `test_oms_chat_ui.mjs`, existing `test_vds_chat_ui.mjs`

## Left to the builder

- Exact HTML copy for the OMS page, following `vds_chat.html`.
- Whether the shared JS helper is named `chat_demo.js` or `chat_ui.js`; no behavior depends on it.
- Commit grouping for the repo-only changes.
