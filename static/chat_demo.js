// Shared browser logic for the VDS and OMS chatbot examples.
//
// The answer request starts immediately; the classifier request waits the
// configured delay. If the chat model wins the race, its text waits for the
// backchannel.

export const FALLBACK_BACKCHANNEL = "그러니까요, 잠깐 확인할게요.";
const ANSWER_FAILURE = "답변을 가져오지 못했어요.";
const DEFAULT_CLIENT_WARNING = "VDS를 사용할 수 없어 기본 추임새를 썼어요.";

export async function runTurn(message, deps, delayMs = 150) {
  deps.renderUser(message);
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const intentUrl = deps.intentUrl || "/api/vds-chat/intent";
  const answerUrl = deps.answerUrl || "/api/vds-chat/answer";
  const clientWarning = deps.clientWarning || DEFAULT_CLIENT_WARNING;
  const classifierLabel = deps.classifierLabel || "VDS";

  const post = (url, body) => deps.fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(response => response.json());

  const answerPromise = post(answerUrl, { message, intent: null })
    .then(data => {
      deps.renderLatency("LLM", data.latency_ms);
      return data.answer || ANSWER_FAILURE;
    })
    .catch(() => ANSWER_FAILURE);

  await sleep(delayMs);
  const intentPromise = post(intentUrl, { message })
    .then(data => {
      deps.renderLatency(classifierLabel, data.latency_ms);
      if (data.degraded && deps.renderWarning) deps.renderWarning(data.warning || clientWarning);
      deps.renderBackchannel(data.backchannel || FALLBACK_BACKCHANNEL);
    })
    .catch(() => {
      if (deps.renderWarning) deps.renderWarning(clientWarning);
      deps.renderBackchannel(FALLBACK_BACKCHANNEL);
    });

  const [, answer] = await Promise.all([intentPromise, answerPromise]);
  deps.renderAnswer(answer);
}

export function wireChat(config) {
  const $ = id => document.getElementById(id);
  const log = $("log");
  const form = $("composer");
  const input = $("message");
  const status = $("status");
  const warning = $("warning");
  const delay = $(config.delayId);
  const delayValue = $(config.delayValueId);
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
    for (const key of [config.classifierLabel, "LLM"]) {
      if (key in latencies) parts.push(`${key} ${latencies[key]}ms`);
    }
    status.textContent = parts.join(" · ");
  };

  const renderWarning = text => {
    warning.textContent = text;
    warning.hidden = false;
  };

  delay.addEventListener("input", () => {
    delayValue.textContent = `${delay.value}ms`;
  });

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
        intentUrl: config.intentUrl,
        answerUrl: config.answerUrl,
        clientWarning: config.clientWarning,
        classifierLabel: config.classifierLabel,
        renderUser: text => appendTurn("나", text),
        renderBackchannel: text => appendTurn(config.backchannelWho, text),
        renderAnswer: text => appendTurn(config.answerWho, "", text),
        renderLatency,
        renderWarning,
      }, Number(delay.value));
    } finally {
      input.value = "";
      input.disabled = false;
      form.querySelector("button").disabled = false;
      delete form.dataset.busy;
      input.focus();
    }
  });
}
