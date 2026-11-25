// node --test test_vds_chat_ui.mjs
//
// The ordering is the whole demo: the fast vds head gets a human-sounding reaction
// on screen before the slow chat model answers. Both requests start together;
// if the chat model wins the race, its text waits for the backchannel.

export const FALLBACK_BACKCHANNEL = "그러니까요, 잠깐 확인할게요.";
const ANSWER_FAILURE = "답변을 가져오지 못했어요.";
const CLIENT_WARNING = "VDS를 사용할 수 없어 기본 추임새를 썼어요.";

export async function runTurn(message, deps) {
  deps.renderUser(message);

  const post = (url, body) => deps.fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(response => response.json());

  // The answer is intentionally requested with intent: null: waiting for the
  // classifier to start the slow call would give back part of the latency the
  // demo exists to hide.
  const answerPromise = post("/api/vds-chat/answer", { message, intent: null })
    .then(data => {
      deps.renderLatency("LLM", data.latency_ms);
      return data.answer || ANSWER_FAILURE;
    })
    .catch(() => ANSWER_FAILURE);

  const intentPromise = post("/api/vds-chat/intent", { message })
    .then(data => {
      deps.renderLatency("VDS", data.latency_ms);
      if (data.degraded && deps.renderWarning) deps.renderWarning(data.warning || CLIENT_WARNING);
      deps.renderBackchannel(data.backchannel || FALLBACK_BACKCHANNEL);
    })
    .catch(() => {
      if (deps.renderWarning) deps.renderWarning(CLIENT_WARNING);
      deps.renderBackchannel(FALLBACK_BACKCHANNEL);
    });

  // Promise.all is the ordering gate, not a speed gate: both calls are already
  // in flight. The answer is rendered only after the backchannel promise has
  // settled, whichever response arrived first.
  const [, answer] = await Promise.all([intentPromise, answerPromise]);
  deps.renderAnswer(answer);
}

// Browser wiring. The module is also imported by node:test, where `document`
// does not exist — keep everything DOM-related behind this guard.
if (typeof document !== "undefined") {
  const $ = id => document.getElementById(id);
  const log = $("log");
  const form = $("composer");
  const input = $("message");
  const status = $("status");
  const warning = $("warning");
  const latencies = {};

  const appendTurn = (who, text, answerText = null) => {
    const turn = document.createElement("div");
    turn.className = "turn";
    const label = document.createElement("div");
    label.className = "who";
    label.textContent = who;
    const body = document.createElement("div");
    body.className = "text";
    body.textContent = text;
    turn.append(label);
    if (text) turn.append(body);
    if (answerText !== null) {
      const answer = document.createElement("div");
      answer.className = "answer";
      answer.textContent = answerText;
      turn.append(answer);
    }
    log.append(turn);
    log.scrollTop = log.scrollHeight;
  };

  const renderLatency = (label, ms) => {
    latencies[label] = Math.round(ms);
    const parts = [];
    if ("VDS" in latencies) parts.push(`VDS ${latencies.VDS}ms`);
    if ("LLM" in latencies) parts.push(`LLM ${latencies.LLM}ms`);
    status.textContent = parts.join(" · ");
  };

  const renderWarning = text => {
    warning.textContent = text;
    warning.hidden = false;
  };

  document.querySelectorAll("[data-example]").forEach(button => {
    button.addEventListener("click", () => {
      input.value = button.dataset.example;
      input.focus();
    });
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || form.dataset.busy === "1") return;
    form.dataset.busy = "1";
    input.disabled = true;
    form.querySelector("button").disabled = true;
    warning.hidden = true;
    warning.textContent = "";

    try {
      await runTurn(message, {
        fetchImpl: window.fetch.bind(window),
        renderUser: text => appendTurn("나", text),
        renderBackchannel: text => appendTurn("VDS — 추임새", text),
        renderAnswer: text => appendTurn("laya — 길안내", "", text),
        renderLatency,
        renderWarning,
      });
    } finally {
      input.value = "";
      input.disabled = false;
      form.querySelector("button").disabled = false;
      delete form.dataset.busy;
      input.focus();
    }
  });
}
