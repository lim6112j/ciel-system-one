# OMS Chatbot Example Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `/oms_chat.html` chatbot for the OMS (주류도매) sub-path, with the same fast intent → 추임새 → LLM answer flow, 50–500 ms delay slider, and confidence warning as the VDS demo.

**Architecture:** The existing `ciel.predict_text()` sends raw KakaoTalk text to `path: "oms"`; a new `oms_chat.py` owns the 3-way intent copy, 0.5 confidence floor, and LLM prompt with a small demo catalog. Two new FastAPI routes mirror the VDS ones. Shared browser logic moves to `static/chat_demo.js`, with thin VDS/OMS wrappers supplying endpoint URLs and element ids. Model-repo configs stay untouched; run one decision_lab service at a time.

**Tech Stack:** Python 3.11, FastAPI, pytest, LangChain `init_chat_model`, plain ES module JS, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-25-oms-chatbot-design.md`

## Global Constraints

- OMS options verbatim: `주문`, `조회`, `질문`.
- `ciel.predict_text(..., path="oms", stt_source="kakaotalk-demo@1")`.
- Backchannels: `주문` → `네, 주문 접수 도와드릴게요.`; `조회` → `주문 내역 확인하고 있어요.`; `질문` → `가격이랑 재고 확인해 드릴게요.`; fallback → `그러니까요, 잠깐 확인할게요.`
- OMS `MIN_CONFIDENCE = 0.5` (VDS stays 0.3); low-confidence warning `OMS 헤드 신뢰도가 낮아 기본 추임새를 썼어요.`; unavailable warning `OMS를 사용할 수 없어 기본 추임새를 썼어요.`
- Demo catalog in the prompt: 참이슬 12병 24,000원; 처음처럼 12병 23,000원; 카스 500ml 24병 36,000원; 테라 500ml 24병 37,000원. Tell the model these are 예시 가격, not live inventory.
- Slider: 50–500 ms, step 50, default 150. OMS ids: `oms-delay`, `oms-delay-value`; VDS ids unchanged.
- No model-repo changes; no combined config; no device lock on the new routes.
- Chat model uses `GUARD_MODEL` / `openrouter:deepseek/deepseek-v4.1-flash`, `temperature=0`.

## Review Focus

- OMS confidence floor 0.5 vs VDS 0.3: a 3-way random head must not pass — pinned by Task 2's 0.4-confidence test.
- Raw KakaoTalk text, not JSON-wrapped state — pinned by Task 2's fake-argument assertions.
- OMS page must hit OMS routes, not VDS routes — pinned by Task 4's wrapper-config test.
- Existing VDS behavior must not regress during JS extraction — pinned by Task 3's unchanged 6-test suite.
- Switching decision_lab configs: README must say one service at a time — pinned by Task 4's README step (documentation, no test).

---

### Task 1: `oms_chat.py` — copy, warnings, and LLM answer

**Files:**
- Create: `oms_chat.py`
- Test: `test_oms_chat.py`

**Interfaces:**
- Consumes: `guard_agent.MODEL_ENV`, `guard_agent.DEFAULT_MODEL`, `langchain.chat_models.init_chat_model`, `langchain.messages.SystemMessage`, `langchain.messages.HumanMessage`.
- Produces: `OMS_OPTIONS`, `OMS_QUESTION`, `BACKCHANNELS`, `FALLBACK_BACKCHANNEL`, `MIN_CONFIDENCE = 0.5`, `LOW_CONFIDENCE_WARNING`, `UNAVAILABLE_WARNING`, `SYSTEM_PROMPT`, `backchannel_for(intent: str | None) -> str`, `answer(message: str, intent: str | None, chat_model: Any | None = None) -> str`.

- [ ] **Step 1: Write the failing tests**

Create `test_oms_chat.py`:

```python
from types import SimpleNamespace

import pytest

import oms_chat


@pytest.mark.parametrize(("intent", "expected"), [
    ("주문", "네, 주문 접수 도와드릴게요."),
    ("조회", "주문 내역 확인하고 있어요."),
    ("질문", "가격이랑 재고 확인해 드릴게요."),
])
def test_backchannel_copy(intent, expected):
    assert oms_chat.backchannel_for(intent) == expected


@pytest.mark.parametrize("intent", [None, "", " 낯선의도 "])
def test_unknown_intent_falls_back(intent):
    assert oms_chat.backchannel_for(intent) == oms_chat.FALLBACK_BACKCHANNEL


def test_answer_uses_injected_chat_model_and_demo_catalog():
    class FakeModel:
        def invoke(self, messages):
            self.messages = messages
            return SimpleNamespace(content="참이슬 2박스 주문 도와드릴게요.")

    fake = FakeModel()
    text = oms_chat.answer("참이슬 2박스 보내주세요", "주문", chat_model=fake)

    assert text == "참이슬 2박스 주문 도와드릴게요."
    assert oms_chat.SYSTEM_PROMPT in fake.messages[0].content
    assert "참이슬" in fake.messages[0].content
    assert "24,000원" in fake.messages[0].content
    assert "참이슬 2박스 보내주세요" in fake.messages[1].content
    assert "주문" in fake.messages[1].content
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run python -m pytest test_oms_chat.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'oms_chat'`.

- [ ] **Step 3: Implement `oms_chat.py`**

Set `OMS_OPTIONS = ("주문", "조회", "질문")`, `OMS_QUESTION = {"type": "choice", "instructions": "이 고객 메시지는 어떤 의도인가?", "criteria": {intent: intent for intent in OMS_OPTIONS}}`, and the exact copy/warnings/constants from Global Constraints. `backchannel_for` uses `(intent or "").strip()` with fallback. Write `SYSTEM_PROMPT` as a Korean liquor-wholesale assistant: 1–3 sentences, use the demo catalog, call prices 예시 가격, do not invent live inventory, never mention the classifier or backchannel. Implement `answer()` exactly like `vds_chat.answer()` — injected `chat_model` when given, otherwise `init_chat_model(os.environ.get(guard_agent.MODEL_ENV, guard_agent.DEFAULT_MODEL), temperature=0)` — and invoke with `SystemMessage` + `HumanMessage(content=f"의도 후보: {intent or '기타'}\n고객: {message}")`, returning stripped content.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run python -m pytest test_oms_chat.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add oms_chat.py test_oms_chat.py
git commit -m "feat: add oms intent copy and LLM answer helper"
```

### Task 2: OMS FastAPI routes

**Files:**
- Modify: `server.py`
- Test: `test_server.py`

**Interfaces:**
- Consumes: `ciel.predict_text(...)`, `vds_chat.MIN_CONFIDENCE` for comparison only, `oms_chat.OMS_QUESTION`, `oms_chat.backchannel_for`, `oms_chat.answer`, `oms_chat.MIN_CONFIDENCE`, warnings, `OmsChatRequest` (new, same fields as `VDSChatRequest`).
- Produces: `POST /api/oms-chat/intent` → `{"intent", "backchannel", "confidence", "degraded", "warning", "latency_ms"}`; `POST /api/oms-chat/answer` → `{"answer", "latency_ms"}`.

- [ ] **Step 1: Write the failing tests**

Append to `test_server.py`:

```python
def test_oms_chat_intent_returns_backchannel(client, monkeypatch):
    test_client, _ = client

    def fake_predict_text(text, questions, **kwargs):
        assert text == "참이슬 2박스 보내주세요"
        assert kwargs == {"path": "oms", "stt_source": "kakaotalk-demo@1"}
        assert questions["intent"] == server_module.oms_chat.OMS_QUESTION
        return {"answers": {"intent": {"type": "choice", "choice": "주문",
                                       "confidence": 0.92}}}

    monkeypatch.setattr(server_module.ciel, "predict_text", fake_predict_text)
    response = test_client.post("/api/oms-chat/intent",
                                json={"message": "참이슬 2박스 보내주세요"})
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == "주문"
    assert body["backchannel"] == "네, 주문 접수 도와드릴게요."
    assert body["degraded"] is False
    assert body["warning"] is None


def test_oms_chat_intent_degrades_at_0_4_confidence(client, monkeypatch):
    test_client, _ = client
    monkeypatch.setattr(server_module.ciel, "predict_text",
                        lambda *a, **k: {"answers": {"intent": {
                            "type": "choice", "choice": "질문", "confidence": 0.4}}})
    response = test_client.post("/api/oms-chat/intent", json={"message": "얼마예요?"})
    body = response.json()
    assert body["intent"] == "기타"
    assert body["backchannel"] == "그러니까요, 잠깐 확인할게요."
    assert body["degraded"] is True
    assert body["warning"] == "OMS 헤드 신뢰도가 낮아 기본 추임새를 썼어요."


def test_oms_chat_intent_degrades_on_upstream_error(client, monkeypatch):
    test_client, _ = client

    def boom(*args, **kwargs):
        raise server_module.ciel.CielError("down")

    monkeypatch.setattr(server_module.ciel, "predict_text", boom)
    response = test_client.post("/api/oms-chat/intent", json={"message": "아무 말"})
    assert response.status_code == 200
    assert response.json()["warning"] == "OMS를 사용할 수 없어 기본 추임새를 썼어요."


def test_oms_chat_answer_returns_text_and_502(client, monkeypatch):
    test_client, _ = client
    monkeypatch.setattr(server_module.oms_chat, "answer",
                        lambda message, intent: "참이슬 2박스 주문 도와드릴게요.")
    ok = test_client.post("/api/oms-chat/answer",
                          json={"message": "참이슬 2박스 보내주세요", "intent": "주문"})
    assert ok.status_code == 200
    assert ok.json()["answer"] == "참이슬 2박스 주문 도와드릴게요."

    def boom(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(server_module.oms_chat, "answer", boom)
    bad = test_client.post("/api/oms-chat/answer", json={"message": "아무 말"})
    assert bad.status_code == 502
    assert "provider down" in bad.json()["detail"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run python -m pytest test_server.py -k oms_chat -v`
Expected: FAIL — new routes return 405 from the static mount or the module is not imported yet.

- [ ] **Step 3: Implement the routes in `server.py`**

Add `import oms_chat`. Define `OmsChatRequest` beside `VDSChatRequest` with the same two fields. Add `/api/oms-chat/intent` and `/api/oms-chat/answer` before the static mount, mirroring the VDS route bodies with these differences: call `ciel.predict_text(request.message, {"intent": oms_chat.OMS_QUESTION}, path="oms", stt_source="kakaotalk-demo@1")`; compare `confidence < oms_chat.MIN_CONFIDENCE`; use `oms_chat.backchannel_for` and the OMS warnings. Take no device lock. Factor shared route bodies into private helpers only if the duplication is obvious after writing both route pairs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run python -m pytest test_server.py -v`
Expected: PASS — including all existing VDS and guard tests.

- [ ] **Step 5: Commit**

```bash
git add server.py test_server.py
git commit -m "feat: add oms chat intent and answer endpoints"
```

### Task 3: Extract shared browser logic

**Files:**
- Create: `static/chat_demo.js`
- Modify: `static/vds_chat.js`
- Test: `test_vds_chat_ui.mjs`

**Interfaces:**
- Consumes: current `runTurn` contract from `static/vds_chat.js`.
- Produces: `static/chat_demo.js` exporting `FALLBACK_BACKCHANNEL`, `runTurn(message, deps, delayMs = 150)` with optional `deps.intentUrl`, `deps.answerUrl`, `deps.clientWarning`, `deps.classifierLabel`, and `wireChat(config)` for browser wiring; `static/vds_chat.js` exporting `CONFIG` and calling `wireChat(CONFIG)`.

- [ ] **Step 1: Add a wrapper config test**

Add to the import block at the top of `test_vds_chat_ui.mjs`:

```js
import { CONFIG as VDS_CONFIG } from "./static/vds_chat.js";
```

Append this test:

```js
test("vds wrapper points at the vds endpoints", () => {
  assert.equal(VDS_CONFIG.intentUrl, "/api/vds-chat/intent");
  assert.equal(VDS_CONFIG.answerUrl, "/api/vds-chat/answer");
  assert.equal(VDS_CONFIG.delayId, "vds-delay");
  assert.equal(VDS_CONFIG.classifierLabel, "VDS");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test_vds_chat_ui.mjs`
Expected: FAIL — `static/vds_chat.js` does not export `CONFIG`.

- [ ] **Step 3: Extract `static/chat_demo.js`**

Move the current `runTurn` and browser-wiring body into `static/chat_demo.js`. In `runTurn`, replace hardcoded endpoint strings with `deps.intentUrl || "/api/vds-chat/intent"` and `deps.answerUrl || "/api/vds-chat/answer"`, hardcoded client warning with `deps.clientWarning || "VDS를 사용할 수 없어 기본 추임새를 썼어요."`, and `renderLatency("VDS", …)` with `renderLatency(deps.classifierLabel || "VDS", …)`. Keep the default `FALLBACK_BACKCHANNEL`, sleep/ordering, degraded warning, and `Promise.all` gate unchanged. Export `wireChat(config)` taking `{intentUrl, answerUrl, clientWarning, classifierLabel, delayId, delayValueId, backchannelWho, answerWho}` and containing the existing DOM setup; `renderLatency` builds `${label} …ms` from the label passed in.

- [ ] **Step 4: Turn `static/vds_chat.js` into a thin wrapper**

Export `CONFIG` with the VDS URLs, client warning, `classifierLabel: "VDS"`, `delayId: "vds-delay"`, `delayValueId: "vds-delay-value"`, `backchannelWho: "VDS — 추임새"`, `answerWho: "laya — 길안내"`. Re-export `runTurn` from `chat_demo.js` so existing tests keep importing from the wrapper. In the browser branch, call `wireChat(CONFIG)`.

- [ ] **Step 5: Run the UI tests**

Run: `node --test test_vds_chat_ui.mjs`
Expected: PASS — all 7 tests, including the new config test, with unchanged ordering/delay behavior.

- [ ] **Step 6: Commit**

```bash
git add static/chat_demo.js static/vds_chat.js test_vds_chat_ui.mjs
git commit -m "refactor: share chat demo browser logic"
```

### Task 4: OMS page, link, and docs

**Files:**
- Create: `static/oms_chat.html`, `static/oms_chat.js`, `test_oms_chat_ui.mjs`
- Modify: `static/index.html`, `README.md`, `test_server.py`

**Interfaces:**
- Consumes: `/api/oms-chat/*` from Task 2; `wireChat` from Task 3.
- Produces: `/oms_chat.html` with `oms-delay` / `oms-delay-value`, index link, README switching instructions.

- [ ] **Step 1: Write the failing tests**

Create `test_oms_chat_ui.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { CONFIG as OMS_CONFIG } from "./static/oms_chat.js";

test("oms wrapper points at the oms endpoints", () => {
  assert.equal(OMS_CONFIG.intentUrl, "/api/oms-chat/intent");
  assert.equal(OMS_CONFIG.answerUrl, "/api/oms-chat/answer");
  assert.equal(OMS_CONFIG.delayId, "oms-delay");
  assert.equal(OMS_CONFIG.clientWarning, "OMS를 사용할 수 없어 기본 추임새를 썼어요.");
  assert.equal(OMS_CONFIG.classifierLabel, "OMS");
});
```

Append to `test_server.py`:

```python
def test_oms_chat_page_is_served_and_linked(client):
    test_client, _ = client
    page = test_client.get("/oms_chat.html")
    assert page.status_code == 200
    assert "oms_chat.js" in page.text
    assert 'id="oms-delay"' in page.text
    assert 'id="oms-delay-value"' in page.text
    assert "OMS 시작 지연" in page.text
    index = test_client.get("/index.html")
    assert "/oms_chat.html" in index.text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test_oms_chat_ui.mjs && uv run python -m pytest test_server.py::test_oms_chat_page_is_served_and_linked -v`
Expected: FAIL — `oms_chat.js` and `/oms_chat.html` do not exist.

- [ ] **Step 3: Implement `static/oms_chat.js`**

Export `CONFIG` with OMS URLs, `clientWarning: "OMS를 사용할 수 없어 기본 추임새를 썼어요."`, `classifierLabel: "OMS"`, `delayId: "oms-delay"`, `delayValueId: "oms-delay-value"`, `backchannelWho: "OMS — 추임새"`, `answerWho: "laya — 주류도매"`. Re-export `runTurn` from `chat_demo.js`. In the browser branch, call `wireChat(CONFIG)`.

- [ ] **Step 4: Implement `static/oms_chat.html` and the index link**

Copy `vds_chat.html`'s shell and CSS, changing ids to `oms-delay` / `oms-delay-value`, label to `OMS 시작 지연`, header text to 주류도매 카카오톡 채널, script to `/oms_chat.js`, and a note that the catalog prices are demo-only. Add `· <a href="/oms_chat.html" style="color:var(--accent)">🛒 OMS 챗봇 — 주류도매 주문 응답</a>` to `static/index.html` beside the VDS link.

- [ ] **Step 5: Document service switching in `README.md`**

Add a short `## The OMS chatbot — a backchannel for 주류도매` section beside the VDS section. State: open `/oms_chat.html`; stop the VDS decision_lab first and start `python -m decision_lab --config configs/oms.yaml ui` from `../ciel-system-one-model` because both configs use port 8000; the page uses the same two-stage flow and delay slider; OMS confidence floor is 0.5; prices in the prompt are examples, not live inventory.

- [ ] **Step 6: Run the task tests**

Run: `node --test test_oms_chat_ui.mjs && uv run python -m pytest test_server.py::test_oms_chat_page_is_served_and_linked -v`
Expected: PASS.

- [ ] **Step 7: Run the full verification**

Run: `uv run python -m pytest -q && node --test test_vds_chat_ui.mjs test_oms_chat_ui.mjs`
Expected: PASS — full Python suite, all VDS UI tests, and the OMS wrapper test.

- [ ] **Step 8: Commit**

```bash
git add static/oms_chat.html static/oms_chat.js test_oms_chat_ui.mjs static/index.html README.md test_server.py
git commit -m "feat: add oms chatbot demo page"
```
