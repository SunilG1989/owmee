from app.modules.ai_assistant.gemini_client import _extract_imei_candidate


def test_extract_imei_candidate_normalizes_grouped_digits_from_imei_field():
    assert _extract_imei_candidate("IMEI: 490154 203237 518", "") == "490154203237518"


def test_extract_imei_candidate_prefers_labelled_imei_one():
    text = "Serial C02TEST123\nIMEI 1: 356938-035643-809\nIMEI 2: 490154 203237 518"

    assert _extract_imei_candidate(None, text) == "356938035643809"


def test_extract_imei_candidate_accepts_single_unlabelled_number():
    assert _extract_imei_candidate(None, "356938 035643 809") == "356938035643809"


def test_extract_imei_candidate_rejects_ambiguous_unlabelled_numbers():
    text = "356938 035643 809\n490154 203237 518"

    assert _extract_imei_candidate(None, text) is None
