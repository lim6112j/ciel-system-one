# VDS Backchannel Delay Control — Design

**Date:** 2026-11-25

## Intent and why

The trained VDS head can return a backchannel in ~100–900 ms, which still feels immediate. Add a small UI control so the demo can deliberately hold the user's utterance before it reaches VDS, making the "fast reaction fills the LLM wait" effect tunable. The delay applies only to the VDS request; the LLM request still starts at submit time.

## Goals

- A range slider on `/vds_chat.html`: **50–500 ms**, step **50 ms**, default **150 ms**.
- The slider's current value is visible next to it.
- Submitting a turn starts the LLM request immediately, waits the configured delay, then sends the VDS intent request.
- The existing ordering guarantee holds: the LLM answer is rendered only after the backchannel.
- The page distinguishes `시작 지연` (client-side) from the server's `VDS …ms` latency chip.

## Non-goals

- No server-side sleep and no change to `/api/vds-chat/intent` or `/api/vds-chat/answer`.
- No delay of the LLM request; changing that would slow the whole turn and defeat the comparison.
- No persistence of the slider value across reloads.
- No change to the VDS head, its labels, or its backchannel copy.

## Anti-goals

- Silently including the client delay inside the `VDS …ms` chip. That chip reports server time; the configured delay is shown separately.
- Letting the LLM answer overtake the backchannel when the LLM happens to resolve during the delay.

## Constraints

- `runTurn(message, deps)` keeps its existing consumed interface: `fetchImpl`, `renderUser`, `renderBackchannel`, `renderAnswer`, `renderLatency`; `renderWarning` stays optional.
- Add one optional dep: `sleep: (ms: number) => Promise<void>`, defaulting to `ms => new Promise(resolve => setTimeout(resolve, ms))`.
- Add one optional argument: `vdsDelayMs: number = 150`.
- Slider element id: `vds-delay`; value label id: `vds-delay-value`.
- Node tests use the injected `sleep` rather than real timers.

## Approaches

- **A — browser delays only the VDS call (chosen).** One slider, one `await deps.sleep(vdsDelayMs)` before the intent `post()`. LLM starts immediately. No server code.
- **B — server sleeps inside `/api/vds-chat/intent`.** Same perceived effect, but occupies a FastAPI worker and makes the delay global. Rejected.
- **C — delay the whole turn.** VDS and LLM both wait; the answer gets slower too, so the UX comparison is lost. Rejected.

## Decided how

### Client flow

1. Render user bubble.
2. Start `/api/vds-chat/answer` immediately with `intent: null`.
3. `await sleep(vdsDelayMs)`.
4. Start `/api/vds-chat/intent`.
5. Render backchannel/warning when intent resolves, then render the held LLM answer.

### UI

Add a labeled range input above the composer:

```text
VDS 시작 지연   [────●────────] 150ms   (50–500ms)
```

On `input`, update `#vds-delay-value` to `${value}ms`. On submit, read `Number($("vds-delay").value)` and pass it as `vdsDelayMs`. The status line keeps showing `VDS …ms · LLM …ms`; the slider label is separate.

### Tests

- `test_vds_chat_ui.mjs`: with `vdsDelayMs=50` and an injected `sleep`, assert the answer request starts before `sleep(50)`, the intent request starts after it, and the answer still renders after the backchannel.
- `test_vds_chat_ui.mjs`: default `sleep` remains a real `setTimeout` path (covered indirectly by the browser branch; no fake timers needed).
- `test_server.py`: `/vds_chat.html` contains `id="vds-delay"`, `min="50"`, `max="500"`, `step="50"`, and value `150`.

## Files

- Modify: `static/vds_chat.html`
- Modify: `static/vds_chat.js`
- Test: `test_vds_chat_ui.mjs`
- Test: `test_server.py` (extend the page smoke test)

## Left to the builder

- Exact slider styling, following the existing `.panel` / muted-text conventions.
- Whether the label reads `VDS 시작 지연` or `추임새 지연`; no behavior depends on it.
