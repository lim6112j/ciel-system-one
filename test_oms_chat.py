from types import SimpleNamespace

import pytest

import oms_chat


@pytest.mark.parametrize(("intent", "expected"), [
    ("주문", "네, 주문 접수 도와드릴게요."),
    ("조회", "주문 내역 확인하고 있어요."),
    ("질문", "가격이랑 재고 확인해 드릴게요."),
])
def test_backchannel_copy(intent, expected):
    assert oms_chat.backchannel_for(intent) == expected


@pytest.mark.parametrize("intent", [None, "", " 낯선의도 "])
def test_unknown_intent_falls_back(intent):
    assert oms_chat.backchannel_for(intent) == oms_chat.FALLBACK_BACKCHANNEL


def test_answer_uses_injected_chat_model_and_demo_catalog():
    class FakeModel:
        def invoke(self, messages):
            self.messages = messages
            return SimpleNamespace(content="참이슬 2박스 주문 도와드릴게요.")

    fake = FakeModel()
    text = oms_chat.answer("참이슬 2박스 보내주세요", "주문", chat_model=fake)

    assert text == "참이슬 2박스 주문 도와드릴게요."
    assert oms_chat.SYSTEM_PROMPT in fake.messages[0].content
    assert "참이슬" in fake.messages[0].content
    assert "24,000원" in fake.messages[0].content
    assert "참이슬 2박스 보내주세요" in fake.messages[1].content
    assert "주문" in fake.messages[1].content
