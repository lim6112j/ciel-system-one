"""Intent-shaped backchannels and the slow LLM answer for the OMS chat demo.

The oms head classifies KakaoTalk messages from a liquor wholesale into
주문 / 조회 / 질문. This module turns those three labels into short Korean
reactions and writes the full answer with the repo's chat-model convention.
"""

from __future__ import annotations

import os
from typing import Any

from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, SystemMessage

import guard_agent

OMS_OPTIONS: tuple[str, ...] = ("주문", "조회", "질문")

OMS_QUESTION: dict[str, Any] = {
    "type": "choice",
    "instructions": "이 고객 메시지는 어떤 의도인가?",
    "criteria": {intent: intent for intent in OMS_OPTIONS},
}

FALLBACK_BACKCHANNEL = "그러니까요, 잠깐 확인할게요."

# Three options make chance ~0.33, so the VDS floor of 0.3 would let a random
# head look confident. 0.5 is the demo's "no usable signal" line.
MIN_CONFIDENCE = 0.5
LOW_CONFIDENCE_WARNING = "OMS 헤드 신뢰도가 낮아 기본 추임새를 썼어요."
UNAVAILABLE_WARNING = "OMS를 사용할 수 없어 기본 추임새를 썼어요."

BACKCHANNELS: dict[str, str] = {
    "주문": "네, 주문 접수 도와드릴게요.",
    "조회": "주문 내역 확인하고 있어요.",
    "질문": "가격이랑 재고 확인해 드릴게요.",
}

SYSTEM_PROMPT = (
    "당신은 주류 도매 카카오톡 채널의 친절한 한국어 상담원입니다. 고객의 마지막 "
    "메시지에 1~3문장으로 짧게 답하고, 필요하면 아래 데모 예시 가격을 근거로 "
    "설명하세요. 참이슬 12병 24,000원, 처음처럼 12병 23,000원, 카스 500ml 24병 "
    "36,000원, 테라 500ml 24병 37,000원. 이 가격은 예시 가격이며 실제 재고나 "
    "실시간 판매 조건이 아님을 분명히 하세요. 실제 재고를 지어내지 말고, 분류기나 "
    "방금 보낸 추임새를 언급하지 마세요."
)


def backchannel_for(intent: str | None) -> str:
    """One natural reaction for an oms intent label; unknown labels fall back."""
    return BACKCHANNELS.get((intent or "").strip(), FALLBACK_BACKCHANNEL)


def answer(
    message: str,
    intent: str | None,
    chat_model: Any | None = None,
) -> str:
    """Write the full answer with the repo's chat model convention.

    ``intent`` is an optional hint for callers that already have one; the demo
    starts this call in parallel with classification and passes ``None``.
    """
    model = chat_model or init_chat_model(
        os.environ.get(guard_agent.MODEL_ENV, guard_agent.DEFAULT_MODEL),
        temperature=0,
    )
    result = model.invoke([
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"의도 후보: {intent or '기타'}\n고객: {message}"),
    ])
    return str(result.content).strip()
