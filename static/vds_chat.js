// VDS chatbot page wiring. Shared behavior lives in chat_demo.js.

import { wireChat } from "./chat_demo.js";

export { runTurn, FALLBACK_BACKCHANNEL } from "./chat_demo.js";

export const CONFIG = {
  intentUrl: "/api/vds-chat/intent",
  answerUrl: "/api/vds-chat/answer",
  clientWarning: "VDS를 사용할 수 없어 기본 추임새를 썼어요.",
  classifierLabel: "VDS",
  delayId: "vds-delay",
  delayValueId: "vds-delay-value",
  backchannelWho: "VDS — 추임새",
  answerWho: "laya — 길안내",
};

if (typeof document !== "undefined") wireChat(CONFIG);
