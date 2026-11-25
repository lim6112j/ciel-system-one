// OMS chatbot page wiring. Shared behavior lives in chat_demo.js.

import { wireChat } from "./chat_demo.js";

export { runTurn, FALLBACK_BACKCHANNEL } from "./chat_demo.js";

export const CONFIG = {
  intentUrl: "/api/oms-chat/intent",
  answerUrl: "/api/oms-chat/answer",
  clientWarning: "OMS를 사용할 수 없어 기본 추임새를 썼어요.",
  classifierLabel: "OMS",
  delayId: "oms-delay",
  delayValueId: "oms-delay-value",
  backchannelWho: "OMS — 추임새",
  answerWho: "laya — 주류도매",
};

if (typeof document !== "undefined") wireChat(CONFIG);
