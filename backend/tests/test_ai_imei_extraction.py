from app.modules.ai_assistant.identifier_extraction import (
    extract_imei_candidate,
    extract_serial_candidate,
    normalize_serial_number,
)


def test_extract_imei_candidate_normalizes_grouped_digits_from_imei_field():
    assert extract_imei_candidate("IMEI: 490154 203237 518", "") == "490154203237518"


def test_extract_imei_candidate_prefers_labelled_imei_one():
    text = "Serial C02TEST123\nIMEI 1: 356938-035643-809\nIMEI 2: 490154 203237 518"

    assert extract_imei_candidate(None, text) == "356938035643809"


def test_extract_imei_candidate_accepts_single_unlabelled_number():
    assert extract_imei_candidate(None, "356938 035643 809") == "356938035643809"


def test_extract_imei_candidate_rejects_ambiguous_unlabelled_numbers():
    text = "356938 035643 809\n490154 203237 518"

    assert extract_imei_candidate(None, text) is None


def test_extract_imei_candidate_handles_android_slot_label():
    text = "IMEI (SIM slot 1): 356 938 035 643 809\nIMEI (SIM slot 2): 490154203237518"

    assert extract_imei_candidate(None, text) == "356938035643809"


def test_extract_serial_candidate_prefers_apple_serial_label():
    text = "Model Name: MacBook Air\nSerial Number: C02ZQ0ABCDEF\nModel Number: A2337"

    assert extract_serial_candidate(None, text) == "C02ZQ0ABCDEF"


def test_extract_serial_candidate_reads_dell_service_tag():
    text = "Dell Inc.\nService Tag: 8CGZ9Y3\nExpress Service Code: 18123456789"

    assert extract_serial_candidate(None, text) == "8CGZ9Y3"


def test_extract_serial_candidate_reads_common_sn_labels():
    assert extract_serial_candidate(None, "Serial No. R90X7ABC12") == "R90X7ABC12"
    assert extract_serial_candidate(None, "S/N: PF3K9QW2") == "PF3K9QW2"


def test_extract_serial_candidate_rejects_model_only():
    text = "Model Number: A2337\nPart Number: MGN63HN/A"

    assert extract_serial_candidate(None, text) is None


def test_normalize_serial_number_uppercases_and_strips_spaces():
    assert normalize_serial_number(" c02 xq1 abc123 ") == "C02XQ1ABC123"
