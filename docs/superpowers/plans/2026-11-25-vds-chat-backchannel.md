# VDS Chatbot Backchannel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/vds_chat.html` demo where the existing `vds` sub-path returns an intent fast enough to show a natural Korean 추임새 first, then a slower OpenRouter LLM answer is appended as the next bubble.

**Architecture:** The browser starts the VDS intent call and the LLM answer call in parallel at submit time. A thin `ciel.predict_text()` sends the user's text verbatim to Decision Lab (the existing `/api/predict` JSON-wraps it, which is wrong for the VDS head), and a new `vds_chat.py` owns the intent-to-backchannel copy and the LLM prompt. Two small FastAPI routes expose those; the page renders the backchannel as soon as the intent returns and holds the LLM answer until then, even if the LLM wins the race.

**Tech Stack:** Python 3.11, FastAPI, pytest, `ciel.py` urllib adapter, LangChain `init_chat_model` via `guard_agent` env convention, plain HTML/JS, Node `node:test` for the client ordering.

**Spec:** `docs/superpowers/specs/2026-11-25-vds-chat-backchannel-design.md`

## Global Constraints

- No changes to `../ciel-system-one-model`; use the existing `vds` head only.
- VDS options, verbatim: `배차요청, 예약, 취소, 변경, 상태조회, 도움말, 다시말하기, 확인_예, 확인_아니오, 기타`.
- VDS request sends `path: "vds"`, raw `custom_text`, and `stt_source: "typed-demo@1"`.
- Keep `X-Decision-Lab-Log: 1` on the Decision Lab call.
- Chat model: `GUARD_MODEL` env, default `openrouter:deepseek/deepseek-v4.1-flash` (`guard_agent.MODEL_ENV` / `guard_agent.DEFAULT_MODEL`), `temperature=0`.
- Message validation: `Field(min_length=1, max_length=MAX_MESSAGE_CHARS)` with the existing `server.MAX_MESSAGE_CHARS` (`64 * 1024`).
- The LLM route takes **no** `_RouterState.device_lock` and sends no guard/PII scan.
- Backchannel strings and the fallback are exact:
  - `배차요청`/`예약` → `네, 가는 길 확인하고 있어요.`
  - `변경` → `네, 경로 바꿔볼게요.`
  - `취소` → `알겠어요, 안내 그만할게요.`
  - `상태조회` → `지금 위치 확인하고 있어요.`
  - `도움말` → `도와드릴게요, 말씀하세요.`
  - `다시말하기` → `다시 말씀드릴게요.`
  - `확인_예` → `네, 그렇게 할게요.`
  - `확인_아니오` → `아니요, 다시 볼게요.`
  - `기타`/unknown/`None`/VDS failure → `그러니까요, 잠깐 확인할게요.`
- The LLM answer is **appended after** the backchannel, never a replacement.

## Review Focus

- Raw utterance text vs JSON-wrapped state: the VDS head sees `{"text": "…"}` and silently misclassifies; pinned by Task 1's request-body assertion.
- VDS failure or an out-of-bank intent label: page still shows a natural fallback backchannel; pinned by Task 2's fallback tests and Task 3's upstream-error test.
- LLM resolves before VDS: the answer must not overtake the backchannel; pinned by Task 4's deferred-promise ordering test.
- Empty or oversized message: both endpoints 422 before any upstream call; pinned by Task 3's validation test.
- LLM/provider failure: answer bubble shows a short failure line while the backchannel stays; pinned by Task 3's 502 test and Task 4's answer-rejection test.

---

### Task 1: `ciel.predict_text()` — raw text to the VDS head

**Files:**
- Modify: `ciel.py`
- Test: `test_ciel.py`

**Interfaces:**
- Consumes: `ciel._to_lab_questions`, `ciel._from_lab_answers`, `ciel.base_url`, `ciel.DECIDE_PATH`, `ciel.CielError`, `ciel.DEFAULT_TIMEOUT`.
- Produces: `ciel.predict_text(text: str, questions: Mapping[str, Dict[str, Any]], path: str = "vds", stt_source: str = "typed-demo@1", timeout: float = DEFAULT_TIMEOUT) -> Dict[str, Any]`, returning the same `{"model", "provider", "answers", "usage"}` envelope as `predict()`.

- [ ] **Step 1: Write the failing test**

Append to `test_ciel.py`:

```python
def test_predict_text_sends_raw_custom_text_and_provenance(lab_server):
    result = ciel.predict_text(
        "시청까지 어떻게 가요?",
        {"intent": {"type": "choice", "instructions": "이 발화의 의도는?",
                    "criteria": {"기타": "기타"}}},
    )
    assert _LabHandler.received == {
        "path": "vds",
        "custom_text": "시청까지 어떻게 가요?",
        "stt_source": "typed-demo@1",
        "questions": [{"type": "choice", "question": "이 발화의 의도는?",
                       "options": ["기타"]}],
    }
    assert result["answers"]["intent"]["type"] == "choice"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python -m pytest test_ciel.py::test_predict_text_sends_raw_custom_text_and_provenance -v`
Expected: FAIL with `AttributeError: module 'ciel' has no attribute 'predict_text'`.

- [ ] **Step 3: Implement `predict_text` in `ciel.py`**

Factor the urllib POST block currently inside `predict()` into a private `_decide(payload: dict, timeout: float) -> dict` helper; make `predict()` call it with its existing JSON-encoded `custom_text`, and make `predict_text()` call it with the text unchanged plus `path` and `stt_source`. Do **not** call `_state_to_custom_text` from `predict_text`. Map answers through the same `_from_lab_answers(qids, questions, body["answers"])` path and return the same envelope keys as `predict()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run python -m pytest test_ciel.py::test_predict_text_sends_raw_custom_text_and_provenance -v`
Expected: PASS.

- [ ] **Step 5: Run the whole adapter suite**

Run: `uv run python -m pytest test_ciel.py -v`
Expected: PASS — the `_decide` refactor must not change `predict()`'s existing request body or envelopes.

- [ ] **Step 6: Commit**

```bash
git add ciel.py test_ciel.py
git commit -m "feat: add raw-text Decision Lab call for the vds sub-path"
```

### Task 2: `vds_chat.py` — intent copy and LLM answer

**Files:**
- Create: `vds_chat.py`
- Test: `test_vds_chat.py`

**Interfaces:**
- Consumes: `guard_agent.MODEL_ENV`, `guard_agent.DEFAULT_MODEL`, `langchain.chat_models.init_chat_model`, `langchain.messages.SystemMessage`, `langchain.messages.HumanMessage`.
- Produces: `INTENT_OPTIONS: tuple[str, ...]`, `INTENT_QUESTION: dict`, `BACKCHANNELS: dict[str, str]`, `FALLBACK_BACKCHANNEL: str`, `SYSTEM_PROMPT: str`, `backchannel_for(intent: str | None) -> str`, `answer(message: str, intent: str | None, chat_model: Any | None = None) -> str`.

- [ ] **Step 1: Write the failing tests**

Create `test_vds_chat.py`:

```python
from types import SimpleNamespace

import pytest

import vds_chat


@pytest.mark.parametrize(("intent", "expected"), [
    ("배차요청", "네, 가는 길 확인하고 있어요."),
    ("예약", "네, 가는 길 확인하고 있어요."),
    ("변경", "네, 경로 바꿔볼게요."),
    ("취소", "알겠어요, 안내 그만할게요."),
    ("상태조회", "지금 위치 확인하고 있어요."),
    ("도움말", "도와드릴게요, 말씀하세요."),
    ("다시말하기", "다시 말씀드릴게요."),
    ("확인_예", "네, 그렇게 할게요."),
    ("확인_아니오", "아니요, 다시 볼게요."),
    ("기타", "그러니까요, 잠깐 확인할게요."),
])
def test_backchannel_copy(intent, expected):
    assert vds_chat.backchannel_for(intent) == expected


@pytest.mark.parametrize("intent", [None, "", " 낯선의도 "])
def test_unknown_intent_falls_back(intent):
    assert vds_chat.backchannel_for(intent) == vds_chat.FALLBACK_BACKCHANNEL


def test_answer_uses_injected_chat_model_and_intent_hint():
    class FakeModel:
        def invoke(self, messages):
            self.messages = messages
            return SimpleNamespace(content="시청역에서 내리시면 돼요.")

    fake = FakeModel()
    text = vds_chat.answer("시청까지 어떻게 가요?", "상태조회", chat_model=fake)

    assert text == "시청역에서 내리시면 돼요."
    assert vds_chat.SYSTEM_PROMPT in fake.messages[0].content
    assert "시청까지 어떻게 가요?" in fake.messages[1].content
    assert "상태조회" in fake.messages[1].content
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run python -m pytest test_vds_chat.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'vds_chat'`.

- [ ] **Step 3: Implement `vds_chat.py`**

Set `INTENT_OPTIONS` to the ten labels from Global Constraints in that order. Set `INTENT_QUESTION = {"type": "choice", "instructions": "이 발화의 의도는?", "criteria": {intent: intent for intent in INTENT_OPTIONS}}`. Define `BACKCHANNELS` with the exact Global Constraints copy and `FALLBACK_BACKCHANNEL` to the `기타` string. `backchannel_for(intent)` returns `BACKCHANNELS.get((intent or "").strip(), FALLBACK_BACKCHANNEL)`. Write `SYSTEM_PROMPT` as a concise Korean route-guidance assistant instruction (1–3 sentences; never mention the classifier or backchannel; steer non-route chatter back to directions). In `answer()`, use the injected `chat_model` directly when given; otherwise call `init_chat_model(os.environ.get(guard_agent.MODEL_ENV, guard_agent.DEFAULT_MODEL), temperature=0)`; invoke with `SystemMessage(content=SYSTEM_PROMPT)` and `HumanMessage(content=f"의도 후보: {intent or '기타'}\n사용자: {message}")`, then return `str(result.content).strip()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run python -m pytest test_vds_chat.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vds_chat.py test_vds_chat.py
git commit -m "feat: add vds intent backchannel copy and LLM answer helper"
```

### Task 3: FastAPI routes for intent and answer

**Files:**
- Modify: `server.py` (insert before `app.mount("/", ...)`)
- Test: `test_server.py`

**Interfaces:**
- Consumes: `ciel.predict_text(...)` from Task 1; `vds_chat.INTENT_QUESTION`, `vds_chat.backchannel_for`, `vds_chat.answer` from Task 2; `server.MAX_MESSAGE_CHARS`.
- Produces: `POST /api/vds-chat/intent` → `{"intent": str, "backchannel": str, "confidence": float, "latency_ms": float}`; `POST /api/vds-chat/answer` → `{"answer": str, "latency_ms": float}`; `VDSChatRequest` with fields `message: str` and `intent: str | None = None`.

- [ ] **Step 1: Write the failing tests**

Append to `test_server.py`:

```python
def test_vds_chat_intent_returns_backchannel(client, monkeypatch):
    test_client, _ = client

    def fake_predict_text(text, questions, **kwargs):
        assert text == "시청까지 어떻게 가요?"
        assert kwargs == {"path": "vds"}
        assert questions["intent"] == server_module.vds_chat.INTENT_QUESTION
        return {"answers": {"intent": {"type": "choice", "choice": "변경",
                                       "confidence": 0.91}}}

    monkeypatch.setattr(server_module.ciel, "predict_text", fake_predict_text)
    response = test_client.post("/api/vds-chat/intent",
                                json={"message": "시청까지 어떻게 가요?"})
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == "변경"
    assert body["backchannel"] == "네, 경로 바꿔볼게요."
    assert body["confidence"] == 0.91
    assert body["latency_ms"] >= 0


def test_vds_chat_intent_degrades_on_upstream_error(client, monkeypatch):
    test_client, _ = client

    def boom(*args, **kwargs):
        raise server_module.ciel.CielError("down")

    monkeypatch.setattr(server_module.ciel, "predict_text", boom)
    response = test_client.post("/api/vds-chat/intent", json={"message": "아무 말"})
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == "기타"
    assert body["backchannel"] == "그러니까요, 잠깐 확인할게요."
    assert body["confidence"] == 0.0


def test_vds_chat_answer_returns_llm_text(client, monkeypatch):
    test_client, _ = client
    monkeypatch.setattr(server_module.vds_chat, "answer",
                        lambda message, intent: "2호선을 타고 시청역에서 내리세요.")
    response = test_client.post("/api/vds-chat/answer",
                                json={"message": "시청까지 어떻게 가요?",
                                      "intent": "배차요청"})
    assert response.status_code == 200
    assert response.json()["answer"] == "2호선을 타고 시청역에서 내리세요."
    assert response.json()["latency_ms"] >= 0


def test_vds_chat_answer_502_on_failure(client, monkeypatch):
    test_client, _ = client

    def boom(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(server_module.vds_chat, "answer", boom)
    response = test_client.post("/api/vds-chat/answer",
                                json={"message": "시청까지 어떻게 가요?"})
    assert response.status_code == 502
    assert "provider down" in response.json()["detail"]


@pytest.mark.parametrize("path", ["/api/vds-chat/intent", "/api/vds-chat/answer"])
def test_vds_chat_rejects_empty_message(client, path):
    test_client, _ = client
    response = test_client.post(path, json={"message": ""})
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run python -m pytest test_server.py -k vds_chat -v`
Expected: FAIL with 404 for both new paths.

- [ ] **Step 3: Implement the routes in `server.py`**

Add `import vds_chat` beside the existing imports. Define `VDSChatRequest` beside `GuardRequest` with `message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)` and `intent: str | None = None`. In `/api/vds-chat/intent`, time the call with `time.perf_counter()`, call `ciel.predict_text(request.message, {"intent": vds_chat.INTENT_QUESTION}, path="vds")`, read `result["answers"]["intent"]`, take `str(answer.get("choice") or "기타")` and `float(answer.get("confidence") or 0.0)`, and catch any `Exception` to set `intent="기타"` and `confidence=0.0`. Always return the four fields, deriving `backchannel` from `vds_chat.backchannel_for(intent)`. In `/api/vds-chat/answer`, call `vds_chat.answer(request.message, request.intent)`; raise `HTTPException(status_code=502, detail=f"chat model failed: {exc}")` on exception, and also on an empty answer. Take no device lock. Register both routes before the static mount.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run python -m pytest test_server.py -k vds_chat -v`
Expected: PASS.

- [ ] **Step 5: Run the whole server suite**

Run: `uv run python -m pytest test_server.py -v`
Expected: PASS — the new routes must not disturb `/api/predict` or the guard routes.

- [ ] **Step 6: Commit**

```bash
git add server.py test_server.py
git commit -m "feat: add vds chat intent and answer endpoints"
```

### Task 4: Chat page, ordering, and index link

**Files:**
- Create: `static/vds_chat.html`
- Create: `static/vds_chat.js`
- Create: `test_vds_chat_ui.mjs`
- Modify: `static/index.html`
- Modify: `README.md`
- Test: `test_server.py` (append two smoke assertions)

**Interfaces:**
- Consumes: `/api/vds-chat/intent` → `{intent, backchannel, confidence, latency_ms}` and `/api/vds-chat/answer` → `{answer, latency_ms}` from Task 3.
- Produces: `runTurn(message: str, deps: {fetchImpl: (url: str, options: object) => Promise<{json(): Promise<object>}>, renderUser: (text: str) => void, renderBackchannel: (text: str) => void, renderAnswer: (text: str) => void, renderLatency: (label: str, ms: float) => void}) -> Promise<void>` in `static/vds_chat.js`, exported with plain `export` declarations like `static/penguin_commands.js`; the browser form calls the same function with `window.fetch` and DOM renderers.

- [ ] **Step 1: Write the failing tests**

Create `test_vds_chat_ui.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { runTurn } from "./static/vds_chat.js";

const tick = () => new Promise(resolve => setImmediate(resolve));

test("backchannel renders before the answer even when the LLM resolves first", async () => {
  const events = [];
  let resolveIntent, resolveAnswer;
  const fetchImpl = (url) => {
    if (url === "/api/vds-chat/intent") {
      return new Promise(resolve => {
        resolveIntent = () => resolve({ json: async () => ({
          intent: "변경", backchannel: "네, 경로 바꿔볼게요.", latency_ms: 42,
        })});
      });
    }
    return new Promise(resolve => {
      resolveAnswer = () => resolve({ json: async () => ({
        answer: "2호선을 타고 시청역에서 내리세요.", latency_ms: 2300,
      })});
    });
  };

  const turn = runTurn("경로 바꿔줘", {
    fetchImpl,
    renderUser: () => events.push("user"),
    renderBackchannel: text => events.push(`backchannel:${text}`),
    renderAnswer: text => events.push(`answer:${text}`),
    renderLatency: () => {},
  });

  resolveAnswer();
  await tick();
  assert.deepEqual(events, ["user"], "the LLM answer must not overtake the backchannel");

  resolveIntent();
  await turn;
  assert.deepEqual(events, [
    "user",
    "backchannel:네, 경로 바꿔볼게요.",
    "answer:2호선을 타고 시청역에서 내리세요.",
  ]);
});

test("intent failure still renders a fallback before the answer", async () => {
  const events = [];
  const fetchImpl = (url) => url === "/api/vds-chat/intent"
    ? Promise.reject(new Error("offline"))
    : Promise.resolve({ json: async () => ({ answer: "지도 다시 볼게요.", latency_ms: 10 }) });

  await runTurn("아무 말", {
    fetchImpl,
    renderUser: () => events.push("user"),
    renderBackchannel: text => events.push(`backchannel:${text}`),
    renderAnswer: text => events.push(`answer:${text}`),
    renderLatency: () => {},
  });

  assert.deepEqual(events, [
    "user",
    "backchannel:그러니까요, 잠깐 확인할게요.",
    "answer:지도 다시 볼게요.",
  ]);
});

test("answer failure keeps the backchannel and shows a short failure line", async () => {
  const events = [];
  const fetchImpl = (url) => url === "/api/vds-chat/intent"
    ? Promise.resolve({ json: async () => ({
        intent: "배차요청", backchannel: "네, 가는 길 확인하고 있어요.", latency_ms: 30,
      })})
    : Promise.reject(new Error("provider down"));

  await runTurn("시청까지 어떻게 가요?", {
    fetchImpl,
    renderUser: () => events.push("user"),
    renderBackchannel: text => events.push(`backchannel:${text}`),
    renderAnswer: text => events.push(`answer:${text}`),
    renderLatency: () => {},
  });

  assert.deepEqual(events, [
    "user",
    "backchannel:네, 가는 길 확인하고 있어요.",
    "answer:답변을 가져오지 못했어요.",
  ]);
});
```

Append to `test_server.py`:

```python
def test_vds_chat_page_is_served_and_linked(client):
    test_client, _ = client
    page = test_client.get("/vds_chat.html")
    assert page.status_code == 200
    assert "vds_chat.js" in page.text
    assert "composer" in page.text
    index = test_client.get("/index.html")
    assert "/vds_chat.html" in index.text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test_vds_chat_ui.mjs && uv run python -m pytest test_server.py::test_vds_chat_page_is_served_and_linked -v`
Expected: FAIL — `static/vds_chat.js` does not exist and `/vds_chat.html` returns 404.

- [ ] **Step 3: Implement `static/vds_chat.js`**

Export `FALLBACK_BACKCHANNEL = "그러니까요, 잠깐 확인할게요."` and `runTurn`. `runTurn` calls `deps.renderUser(message)` first, then starts both `fetchImpl("/api/vds-chat/intent", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({message})})` and the analogous `/api/vds-chat/answer` request with `{message, intent: null}`. The intent promise resolves to its `backchannel` (or `FALLBACK_BACKCHANNEL` on rejection) and calls `renderBackchannel`; the answer promise calls `renderAnswer` with its `answer`, or with `답변을 가져오지 못했어요.` on rejection. Await the intent promise before rendering the answer even if the answer settled first. Call `renderLatency("VDS", ms)` and `renderLatency("LLM", ms)` from the successful responses. Use plain `export` declarations exactly like `static/penguin_commands.js` — no `module.exports` alias. In the browser branch (`typeof document !== "undefined"`), attach a `submit` listener to `#composer`, read `#message`, disable the form while a turn runs, and append DOM nodes using `guard.html`'s transcript classes: `.turn`, `.who`, `.text`, and `.answer` for the appended LLM reply.

- [ ] **Step 4: Implement `static/vds_chat.html` and the index link**

Use the page shell and transcript CSS conventions from `static/guard.html` (same card width, muted text, `.turn` / `.who` / `.text` / `.answer` style names). Include `<form id="composer">`, `<input id="message">`, `<button type="submit">보내기</button>`, `<div id="log">`, a `<span id="status">` for `VDS …ms · LLM …ms`, `<script src="/vds_chat.js"></script>`, and two example buttons with `data-example` values `시청까지 어떻게 가요?` and `내일 아침 일곱 시에 중앙 시장 가는 길 알려줘`. Add one link to `static/index.html` beside the other demo links: `· <a href="/vds_chat.html" style="color:var(--accent)">💬 VDS 챗봇 — 먼저 추임새, 나중에 답변</a>`.

- [ ] **Step 5: Document the demo in `README.md`**

Add a short `## The VDS chatbot — a backchannel before the LLM` section immediately before `## Startup performance`. State the two-stage flow, the command to open it (`uv run python -m uvicorn server:app` → `/vds_chat.html`), and the caveat verbatim in substance: the `vds` head classifies 배차 의도, not 길안내; the demo maps those labels to Korean backchannel copy to show the latency-hiding pattern.

- [ ] **Step 6: Run the UI tests**

Run: `node --test test_vds_chat_ui.mjs && uv run python -m pytest test_server.py::test_vds_chat_page_is_served_and_linked -v`
Expected: PASS.

- [ ] **Step 7: Run the full verification**

Run: `uv run python -m pytest && node --test test_vds_chat_ui.mjs`
Expected: PASS — all Python tests and all Node tests.

- [ ] **Step 8: Commit**

```bash
git add static/vds_chat.html static/vds_chat.js static/index.html README.md test_vds_chat_ui.mjs test_server.py
git commit -m "feat: add vds chatbot demo page with instant backchannel"
```
