# VDS Chatbot — Instant Backchannel Demo — Design

**Date:** 2026-11-25

## Intent and why

Add a chatbot example to `ciel-system-one` that makes the LLM's slow first token invisible. When a user sends a Korean route-guidance-style message, the existing `vds` sub-path in `../ciel-system-one-model` classifies the utterance's intent immediately and the page shows a short, intent-appropriate **추임새** (backchannel) right away. The LLM answer arrives later and is appended as the next bubble.

This is a **latency-hiding UX demo**, not a route-guidance accuracy demo. The VDS head is deliberately left as-is.

## Goals

- A new demo page linked from `static/index.html`, reachable at `/vds_chat.html`.
- On submit: user bubble → instant backchannel bubble → LLM answer bubble, in that order.
- Backchannel wording varies by VDS intent, so the fast reply reads as a natural reaction rather than a fixed "thinking..." spinner.
- The page visibly reports VDS and LLM latency so the point of the demo is legible.

## Non-goals

- No changes to `../ciel-system-one-model`: no new config, generator, question bank, or checkpoint.
- No claim that the VDS head understands 길안내. Its labels are 배차 의도; this demo maps them to route-guidance-flavored Korean copy.
- No free-form slot extraction (origin/destination/time). The VDS head only predicts intent here.
- No guard/PII scanning around the LLM call; this is not `/api/guard/chat`.

## Anti-goals

- Calling `/api/predict` for the intent: `ciel.predict()` JSON-encodes the state (`{"text": "…"}`), but the VDS head was trained on **raw STT utterances**. That would be a silent train/serve skew. The demo must send `custom_text` verbatim.
- Letting the slow LLM answer overtake the backchannel bubble. If the LLM resolves first, the client holds the answer until the backchannel is rendered.
- Replacing the backchannel with the answer. The example says "이어서 답을 한다", so the answer is appended **after** the backchannel.

## Constraints

- Existing `vds` sub-path options, verbatim from `configs/vds.yaml`:
  `배차요청, 예약, 취소, 변경, 상태조회, 도움말, 다시말하기, 확인_예, 확인_아니오, 기타`.
- The service accepts `stt_source`; this demo sends `typed-demo@1` because the text is typed, not STT. `X-Decision-Lab-Log: 1` stays on so traffic capture keeps working.
- Server already requires `OPENROUTER_API_KEY` at startup (`guard_agent.build_agent` in `lifespan`), so the LLM path has the same availability assumption as the guard page.
- Reuse `guard_agent.MODEL_ENV` / `guard_agent.DEFAULT_MODEL` for the chat model so the demo does not invent a second model-env convention.
- The LLM call is network-only: no `_RouterState.device_lock`, no 503 on a cold local router.

## Approaches

- **A — two parallel browser calls (chosen).** Client starts `/api/vds-chat/intent` and `/api/vds-chat/answer` at submit time. Backchannel renders on intent resolution; answer renders after both. Small server surface, matches existing endpoint patterns, easiest to test.
- **B — one SSE stream** (`event: backchannel` then `event: answer`). Cleaner client and server-side ordering, but needs a queue/thread around the sync LLM call and more complex tests. Rejected as overbuilt for this demo.
- **C — reuse `/api/predict` + `/api/guard/chat`.** Fewer new routes, but `/api/predict` JSON-wraps the text (wrong for VDS) and `/api/guard/chat` adds guard scanning/blocking to a plain route-guidance demo. Rejected.

## Decided how

### Backchannel map

One short Korean sentence per intent, defined in `vds_chat.py`:

| VDS intent | Backchannel |
|---|---|
| `배차요청`, `예약` | `네, 가는 길 확인하고 있어요.` |
| `변경` | `네, 경로 바꿔볼게요.` |
| `취소` | `알겠어요, 안내 그만할게요.` |
| `상태조회` | `지금 위치 확인하고 있어요.` |
| `도움말` | `도와드릴게요, 말씀하세요.` |
| `다시말하기` | `다시 말씀드릴게요.` |
| `확인_예` | `네, 그렇게 할게요.` |
| `확인_아니오` | `아니요, 다시 볼게요.` |
| `기타`, unknown, missing, or VDS failure | `그러니까요, 잠깐 확인할게요.` |

### Files

- **Modify `ciel.py`** — factor the urllib POST out of `predict()` into a private helper and add
  `predict_text(text: str, questions: Mapping[str, Dict[str, Any]], path: str = "vds", stt_source: str = "typed-demo@1", timeout: float = DEFAULT_TIMEOUT) -> Dict[str, Any]`.
  It reuses `_to_lab_questions` / `_from_lab_answers`, sends `custom_text` verbatim, and returns the same envelope as `predict()`.
- **Create `vds_chat.py`** — owns `INTENT_OPTIONS`, `INTENT_QUESTION`, `BACKCHANNELS`, `backchannel_for(intent: str | None) -> str`, `SYSTEM_PROMPT`, and `answer(message: str, intent: str | None) -> str`. `answer()` calls `init_chat_model(model or os.environ.get(guard_agent.MODEL_ENV, guard_agent.DEFAULT_MODEL), temperature=0)` and extracts the message content; injectable `chat_model` parameter for tests.
- **Modify `server.py`** — add `VDSChatRequest` and two routes above the static mount:
  - `POST /api/vds-chat/intent` → `{"intent": str, "backchannel": str, "confidence": float, "latency_ms": float}`. Calls `ciel.predict_text` with the one intent question and `path="vds"`, then `vds_chat.backchannel_for(intent)` so the copy has one source of truth. Any failure degrades to `기타` + its fallback backchannel with confidence `0.0` rather than failing the page.
  - `POST /api/vds-chat/answer` → `{"answer": str, "latency_ms": float}`. Calls `vds_chat.answer(message, intent)`; provider failure → 502.
  - Both validate `message` with the existing `MAX_MESSAGE_CHARS`.
- **Create `static/vds_chat.html` / `static/vds_chat.js`** — chat UI, two example prompts, latency chips (`VDS 42ms` / `LLM 2.3s`), and the ordering logic described below.
- **Modify `static/index.html`** — one link next to the other demos: `💬 VDS 챗봇 — 먼저 추임새, 나중에 답변`.
- **Modify `README.md`** — a short section beside the other demo write-ups: what the two-stage flow shows, how to open it, and the honest caveat that the `vds` head classifies 배차 의도, not 길안내.

### Client ordering

1. Disable composer, append the user bubble.
2. Start both fetches immediately.
3. On intent resolution, append the `backchannel` string returned by the endpoint and the `VDS …ms` chip (also on failure, with the fallback text).
4. Await the LLM fetch; await the intent promise if it is still pending; append the LLM answer bubble and the `LLM …ms` chip.
5. Re-enable composer. A failed answer shows a short `답변을 가져오지 못했어요.` bubble; the backchannel remains.

### LLM prompt

`SYSTEM_PROMPT` says: concise Korean route-guidance assistant; answer the user's last message in 1–3 sentences; do not mention the classifier or the backchannel; if the request is not about routes, answer briefly and steer back to directions. `answer()` accepts an optional `intent` hint for callers that have one, but this demo sends `intent: null` because the LLM call starts in parallel with the intent call — the page must not wait for the classifier before starting the slow request.

### Tests

- `test_ciel.py` — `predict_text()` sends raw `custom_text`, `path`, and `stt_source`; response envelope is keyed by qid.
- `test_vds_chat.py` — every intent maps to the exact copy above; unknown/None falls back; `answer()` uses the injected chat model and includes the intent hint.
- `test_server.py` — intent endpoint returns the mapped intent + backchannel + confidence and degrades on upstream error; answer endpoint returns the LLM text and 502s on failure; both reject an empty message.
- `test_vds_chat_ui.mjs` — `runTurn()` renders the backchannel before the answer even when the LLM promise resolves first, and still renders a fallback backchannel when the intent call rejects.

## Left to the builder

- Exact HTML/CSS styling of the chat page, following `static/guard.html`'s bubble layout rather than inventing a new design system.
- Whether the latency chips are separate small badges or one line of muted text; no behavior depends on this.
- Commit message and whether to include the design doc in the same commit as the code.
