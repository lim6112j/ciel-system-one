from types import SimpleNamespace

import pytest

import vds_chat


@pytest.mark.parametrize(("intent", "expected"), [
    ("배차요청", "네, 가는 길 확인하고 있어요."),
    ("예약", "네, 가는 길 확인하고 있어요."),
    ("변경", "네, 경로 바꿔볼게요."),
    ("취소", "알겠어요, 안내 그만할게요."),
    ("상태조회", "지금 위치 확인하고 있어요."),
    ("도움말", "도와드릴게요, 말씀하세요."),
    ("다시말하기", "다시 말씀드릴게요."),
    ("확인_예", "네, 그렇게 할게요."),
    ("확인_아니오", "아니요, 다시 볼게요."),
    ("기타", "그러니까요, 잠깐 확인할게요."),
])
def test_backchannel_copy(intent, expected):
    assert vds_chat.backchannel_for(intent) == expected


@pytest.mark.parametrize("intent", [None, "", " 낯선의도 "])
def test_unknown_intent_falls_back(intent):
    assert vds_chat.backchannel_for(intent) == vds_chat.FALLBACK_BACKCHANNEL


def test_answer_uses_injected_chat_model_and_intent_hint():
    class FakeModel:
        def invoke(self, messages):
            self.messages = messages
            return SimpleNamespace(content="시청역에서 내리시면 돼요.")

    fake = FakeModel()
    text = vds_chat.answer("시청까지 어떻게 가요?", "상태조회", chat_model=fake)

    assert text == "시청역에서 내리시면 돼요."
    assert vds_chat.SYSTEM_PROMPT in fake.messages[0].content
    assert "시청까지 어떻게 가요?" in fake.messages[1].content
    assert "상태조회" in fake.messages[1].content
