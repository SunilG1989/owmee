from app.modules.kyc.activities import _normalise_provider_name_match
from app.modules.kyc.adapter import PANVerifyResponse


def test_provider_name_match_normalization_is_conservative():
    assert _normalise_provider_name_match("matched") == "pass"
    assert _normalise_provider_name_match("mismatch") == "reject"
    assert _normalise_provider_name_match("needs_review") == "manual_review"
    assert _normalise_provider_name_match("") == "manual_review"
    assert _normalise_provider_name_match(None) == "manual_review"


def test_pan_response_does_not_default_missing_name_match_to_pass():
    response = PANVerifyResponse(success=True, pan_aadhaar_linked=True)

    assert response.name_match_result is None
