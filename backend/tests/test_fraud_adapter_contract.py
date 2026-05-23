import pytest

from app.modules.verification.fraud_adapter import (
    _extract_score,
    _normalize_decision,
    _normalize_risk_band,
)


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"risk_band": "LOW"}, "low"),
        ({"riskBand": "medium"}, "medium"),
        ({"risk_level": "high"}, "high"),
        ({"score": 0.81}, "high"),
        ({"risk_score": 52}, "medium"),
        ({"score": 0.19}, "low"),
        ({}, "unknown"),
        ({"score": "not-a-score"}, "unknown"),
    ],
)
def test_bureau_risk_band_normalization_is_stable(payload, expected):
    assert _normalize_risk_band(payload) == expected


@pytest.mark.parametrize(
    ("payload", "risk_band", "expected"),
    [
        ({"decision": "approve"}, "high", "allow"),
        ({"recommendation": "review"}, "low", "step_up"),
        ({"decision": "manual-review"}, "low", "manual_review"),
        ({"recommendation": "reject"}, "low", "block"),
        ({}, "high", "block"),
        ({}, "medium", "step_up"),
        ({}, "unknown", "step_up"),
        ({}, "low", "allow"),
    ],
)
def test_bureau_decision_normalization_is_conservative(payload, risk_band, expected):
    assert _normalize_decision(payload, risk_band) == expected


def test_bureau_score_extraction_accepts_common_shapes():
    assert _extract_score({"score": "12.5"}) == 12.5
    assert _extract_score({"risk_score": 0.35}) == 0.35
    assert _extract_score({"score": "bad"}) is None
