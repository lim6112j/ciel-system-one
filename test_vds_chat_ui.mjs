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
