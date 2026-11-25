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
