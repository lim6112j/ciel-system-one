"""Intent-shaped backchannels and the slow LLM answer for the VDS chat demo.

The vds head classifies 배차 의도, not 길안내. This module maps those labels to
short Korean reactions so a fast classification can fill the silence before
the chat model answers. No slot extraction and no guard scanning live here.
"""

from __future__ import annotations

import os
from typing import Any

from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, SystemMessage

import guard_agent

INTENT_OPTIONS: tuple[str, ...] = (
    "배차요청", "예약", "취소", "변경", "상태조회",
    "도움말", "다시말하기", "확인_예", "확인_아니오", "기타",
)

INTENT_QUESTION: dict[str, Any] = {
    "type": "choice",
    "instructions": "이 발화의 의도는?",
    "criteria": {intent: intent for intent in INTENT_OPTIONS},
}

FALLBACK_BACKCHANNEL = "그러니까요, 잠깐 확인할게요."

BACKCHANNELS: dict[str, str] = {
    "배차요청": "네, 가는 길 확인하고 있어요.",
    "예약": "네, 가는 길 확인하고 있어요.",
    "변경": "네, 경로 바꿔볼게요.",
    "취소": "알겠어요, 안내 그만할게요.",
    "상태조회": "지금 위치 확인하고 있어요.",
    "도움말": "도와드릴게요, 말씀하세요.",
    "다시말하기": "다시 말씀드릴게요.",
    "확인_예": "네, 그렇게 할게요.",
    "확인_아니오": "아니요, 다시 볼게요.",
    "기타": FALLBACK_BACKCHANNEL,
}

SYSTEM_PROMPT = (
    "당신은 친절한 한국어 길안내 도우미입니다. 사용자의 마지막 말에 1~3문장으로 "
    "짧게 답하고, 경로·교통수단·방향을 구체적으로 알려주세요. 분류기나 방금 한 "
    "추임새를 언급하지 마세요. 길안내와 무관한 말이면 짧게 답한 뒤 길안내로 "
    "돌아오세요."
)


def backchannel_for(intent: str | None) -> str:
    """One natural reaction for a vds intent label; unknown labels fall back."""
    return BACKCHANNELS.get((intent or "").strip(), FALLBACK_BACKCHANNEL)


def answer(
    message: str,
    intent: str | None,
    chat_model: Any | None = None,
) -> str:
    """Write the full answer with the repo's chat model convention.

    ``intent`` is an optional hint for callers that already have one. The chat
    demo starts this call in parallel with intent classification, so it passes
    ``None`` rather than waiting for the fast head.
    """
    model = chat_model or init_chat_model(
        os.environ.get(guard_agent.MODEL_ENV, guard_agent.DEFAULT_MODEL),
        temperature=0,
    )
    result = model.invoke([
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"의도 후보: {intent or '기타'}\n사용자: {message}"),
    ])
    return str(result.content).strip()
