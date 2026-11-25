# VDS Backchannel Delay Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 50–500 ms slider to `/vds_chat.html` that delays only the VDS intent request, so the demo can tune how quickly the 추임새 appears without slowing the LLM answer.

**Architecture:** `runTurn()` gains a `vdsDelayMs` argument and an injectable `sleep` dependency. The browser starts the LLM request immediately, awaits `sleep(vdsDelayMs)`, then starts the VDS request. Existing ordering still holds: the LLM answer is rendered only after the backchannel. No server route changes.

**Tech Stack:** plain HTML range input, browser ES module JS, Node `node:test` with injected `sleep`, pytest smoke test via FastAPI `TestClient`.

**Spec:** `docs/superpowers/specs/2026-11-25-vds-backchannel-delay-design.md`

## Global Constraints

- Slider: `min="50"`, `max="500"`, `step="50"`, `value="150"`.
- Element ids: `vds-delay` (range input), `vds-delay-value` (visible `…ms` label).
- `runTurn(message, deps, vdsDelayMs: number = 150) -> Promise<void>`.
- Optional dep `sleep: (ms: number) => Promise<void>`; default `ms => new Promise(resolve => setTimeout(resolve, ms))`.
- The LLM request starts before `sleep()` is awaited; the VDS request starts after.
- The server latency chip remains `VDS …ms` / `LLM …ms` and continues to report server time only.
- No changes to `server.py`, `ciel.py`, `vds_chat.py`, or the existing endpoint contracts.

## Review Focus

- Delay only the VDS call: LLM request must start before the sleep, VDS after — pinned by Task 1's event-order test.
- Untouched slider defaults to 150 ms — pinned by Task 1's default-delay test.
- LLM resolves during the delay and must not overtake the backchannel — pinned by Task 1's full event-order assertion.
- Slider bounds and visible value label — pinned by Task 1's page smoke test.
- Client delay must not be folded into the `VDS …ms` chip — pinned by Task 1's latency assertion that `renderLatency("VDS", 40)` receives the server value, not `40 + 50`.

---

### Task 1: Delay slider and client-side VDS hold

**Files:**
- Modify: `static/vds_chat.js`
- Modify: `static/vds_chat.html`
- Test: `test_vds_chat_ui.mjs`
- Test: `test_server.py`

**Interfaces:**
- Consumes: existing `/api/vds-chat/intent` → `{intent, backchannel, confidence, degraded, warning, latency_ms}` and `/api/vds-chat/answer` → `{answer, latency_ms}`.
- Produces: `runTurn(message, deps, vdsDelayMs = 150)` with optional `deps.sleep`; browser reads `#vds-delay` and writes `#vds-delay-value`.

- [ ] **Step 1: Write the failing Node tests**

Append to `test_vds_chat_ui.mjs`:

```js
test("the configured delay holds VDS but not the LLM request", async () => {
  const events = [];
  const sleeps = [];
  const latencies = [];
  const fetchImpl = (url) => {
    events.push(`fetch:${url}`);
    return Promise.resolve({ json: async () => url === "/api/vds-chat/intent"
      ? { backchannel: "네, 가는 길 확인하고 있어요.", latency_ms: 40 }
      : { answer: "2호선을 타세요.", latency_ms: 10 } });
  };

  await runTurn("시청까지 어떻게 가요?", {
    fetchImpl,
    sleep: async ms => { sleeps.push(ms); events.push(`sleep:${ms}`); },
    renderUser: () => events.push("user"),
    renderBackchannel: text => events.push(`backchannel:${text}`),
    renderAnswer: text => events.push(`answer:${text}`),
    renderLatency: (label, ms) => latencies.push([label, ms]),
  }, 50);

  assert.deepEqual(sleeps, [50]);
  assert.deepEqual(latencies.filter(([label]) => label === "VDS"), [["VDS", 40]]);
  assert.deepEqual(events, [
    "user",
    "fetch:/api/vds-chat/answer",
    "sleep:50",
    "fetch:/api/vds-chat/intent",
    "backchannel:네, 가는 길 확인하고 있어요.",
    "answer:2호선을 타세요.",
  ]);
});

test("an untouched slider uses the 150ms default", async () => {
  const sleeps = [];
  const fetchImpl = () => Promise.resolve({ json: async () => ({
    backchannel: "네, 가는 길 확인하고 있어요.", answer: "지도 볼게요.", latency_ms: 1,
  }) });

  await runTurn("아무 말", {
    fetchImpl,
    sleep: async ms => { sleeps.push(ms); },
    renderUser: () => {},
    renderBackchannel: () => {},
    renderAnswer: () => {},
    renderLatency: () => {},
  });

  assert.deepEqual(sleeps, [150]);
});
```

- [ ] **Step 2: Write the failing page smoke assertions**

Replace the smoke test body in `test_server.py`:

```python
def test_vds_chat_page_is_served_and_linked(client):
    test_client, _ = client
    page = test_client.get("/vds_chat.html")
    assert page.status_code == 200
    assert "vds_chat.js" in page.text
    assert "composer" in page.text
    assert 'id="warning"' in page.text
    assert 'id="vds-delay"' in page.text
    assert 'id="vds-delay-value"' in page.text
    assert 'min="50"' in page.text
    assert 'max="500"' in page.text
    assert 'step="50"' in page.text
    assert 'value="150"' in page.text
    assert "VDS 시작 지연" in page.text
    assert 'id="status"' in page.text
    index = test_client.get("/index.html")
    assert "/vds_chat.html" in index.text
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test_vds_chat_ui.mjs && uv run python -m pytest test_server.py::test_vds_chat_page_is_served_and_linked -v`
Expected: FAIL — `runTurn` has no `vdsDelayMs`/`sleep` support, and the page has no `vds-delay` element.

- [ ] **Step 4: Implement the delay in `static/vds_chat.js`**

Change the signature to `export async function runTurn(message, deps, vdsDelayMs = 150)`. Set `const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))`. Keep the LLM `post("/api/vds-chat/answer", ...)` call where it is — before any await. Replace the immediate intent call with `await sleep(vdsDelayMs); const intentPromise = post("/api/vds-chat/intent", ...) ...`. Keep the existing `.then/.catch` backchannel and warning behavior unchanged, and keep the final `await Promise.all([intentPromise, answerPromise])` ordering gate. Update the file header comment so it says the answer request starts immediately and the VDS request waits the configured delay.

- [ ] **Step 5: Implement the slider in `static/vds_chat.html` and browser wiring**

Add CSS for the range row using the existing muted-text / panel conventions. Insert above `<form id="composer">`:

```html
<div class="row">
  <label class="ctl" for="vds-delay">VDS 시작 지연 <span id="vds-delay-value">150ms</span></label>
  <input id="vds-delay" type="range" min="50" max="500" step="50" value="150">
</div>
```

In the browser branch of `vds_chat.js`, add `const delay = $("vds-delay")` and `const delayValue = $("vds-delay-value")`; attach an `input` listener that sets `delayValue.textContent = `${delay.value}ms``; pass `Number(delay.value)` as the third argument to `runTurn` in the submit handler. Leave `#status` untouched: it continues to show only server-reported `VDS …ms · LLM …ms`.

- [ ] **Step 6: Run the task tests**

Run: `node --test test_vds_chat_ui.mjs && uv run python -m pytest test_server.py::test_vds_chat_page_is_served_and_linked -v`
Expected: PASS — 6 Node tests (4 existing + 2 new) and the page smoke test.

- [ ] **Step 7: Run the full verification**

Run: `uv run python -m pytest -q && node --test test_vds_chat_ui.mjs`
Expected: PASS — the full Python suite and all Node tests.

- [ ] **Step 8: Commit**

```bash
git add static/vds_chat.js static/vds_chat.html test_vds_chat_ui.mjs test_server.py docs/superpowers/specs/2026-11-25-vds-backchannel-delay-design.md
git commit -m "feat: add adjustable vds backchannel delay"
```
