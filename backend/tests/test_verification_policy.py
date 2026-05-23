from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.settings import settings
from app.modules.verification import service


def _user(**overrides):
    base = {
        "id": uuid4(),
        "phone_verified": True,
        "auth_state": "otp_verified",
        "is_restricted": False,
        "seller_tier": "not_eligible",
        "buyer_eligible": False,
        "kyc_status": "not_started",
        "trust_score": 50,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _fraud_check(status="passed", risk_band="low"):
    return SimpleNamespace(status=status, risk_band=risk_band, provider="bureau", completed_at=None)


def _kyc(**overrides):
    base = {
        "pan_verified": False,
        "payout_verified": False,
        "payout_account_ref": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _risk_decision(decision, **overrides):
    base = {
        "decision": decision,
        "message": "",
        "risk_band": "medium",
        "metadata_": {},
    }
    base.update(overrides)
    return SimpleNamespace(**base)


async def _none(*_args, **_kwargs):
    return None


def _enable_bureau_policy(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "fraud_provider", "bureau")
    monkeypatch.setattr(settings, "fraud_enforcement_enabled", True)


@pytest.mark.asyncio
async def test_publish_high_value_requires_seller_kyc_after_low_risk(monkeypatch):
    user = _user(seller_tier="not_eligible")

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "low")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PUBLISH_LISTING,
        context={"price": 12000, "category_slug": "kids-utility"},
    )

    assert decision.allowed is False
    assert decision.required_step == "seller_kyc"
    assert decision.reason_codes == ["SELLER_KYC_REQUIRED"]


@pytest.mark.asyncio
async def test_publish_structured_category_allows_lite_seller_after_low_risk(monkeypatch):
    user = _user(seller_tier="lite")

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "low")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PUBLISH_LISTING,
        context={"price": 8000, "category_slug": "smartphones"},
    )

    assert decision.allowed is True
    assert decision.reason_codes == ["SELLER_KYC_PRESENT"]


@pytest.mark.asyncio
async def test_publish_waits_for_fraud_check_when_bureau_enabled(monkeypatch):
    user = _user(seller_tier="lite")

    async def get_user(_db, _user_id):
        return user

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_verification_check", _none)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PUBLISH_LISTING,
        context={"price": 8000, "category_slug": "smartphones"},
    )

    assert decision.allowed is False
    assert decision.required_step == "risk_screening"
    assert decision.reason_codes == ["FRAUD_CHECK_REQUIRED"]


@pytest.mark.asyncio
async def test_medium_risk_requires_step_up_before_publish(monkeypatch):
    user = _user(seller_tier="lite")

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "medium")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PUBLISH_LISTING,
        context={"price": 8000, "category_slug": "smartphones"},
    )

    assert decision.allowed is False
    assert decision.required_step == "kyc"
    assert decision.risk_band == "medium"


@pytest.mark.asyncio
async def test_admin_step_up_decision_blocks_action_without_provider_call(monkeypatch):
    user = _user(seller_tier="lite")

    async def get_user(_db, _user_id):
        return user

    async def latest_risk_decision(_db, _user_id, _action):
        return SimpleNamespace(
            decision="step_up",
            message="Manual review requested.",
            risk_band="medium",
            metadata_={"required_step": "manual_review"},
        )

    async def latest_check_should_not_run(*_args, **_kwargs):
        raise AssertionError("fraud gate should not run after an active step-up decision")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", latest_risk_decision)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check_should_not_run)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PUBLISH_LISTING,
        context={"price": 8000, "category_slug": "smartphones"},
    )

    assert decision.allowed is False
    assert decision.decision == "step_up"
    assert decision.required_step == "manual_review"
    assert decision.reason_codes == ["FRAUD_STEP_UP_REQUIRED"]


@pytest.mark.asyncio
async def test_active_global_block_stops_buy_even_when_buyer_is_eligible(monkeypatch):
    user = _user(buyer_eligible=True)

    async def get_user(_db, _user_id):
        return user

    async def latest_risk_decision(_db, _user_id, _action):
        return _risk_decision(
            "block",
            message="Blocked by risk review.",
            risk_band="high",
        )

    async def latest_check_should_not_run(*_args, **_kwargs):
        raise AssertionError("fraud gate should not run after an active block decision")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", latest_risk_decision)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check_should_not_run)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_BUY,
        context={"amount": 500},
    )

    assert decision.allowed is False
    assert decision.decision == "block"
    assert decision.reason_codes == ["FRAUD_RISK_BLOCKED"]
    assert decision.risk_band == "high"


@pytest.mark.asyncio
async def test_active_manual_review_stops_payout_even_when_kyc_is_complete(monkeypatch):
    user = _user()

    async def get_user(_db, _user_id):
        return user

    async def latest_risk_decision(_db, _user_id, _action):
        return _risk_decision(
            "manual_review",
            message="Payout account needs review.",
            risk_band="medium",
        )

    async def get_kyc_should_not_run(*_args, **_kwargs):
        raise AssertionError("KYC gate should not run after an active manual review")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", latest_risk_decision)
    monkeypatch.setattr(service, "_get_kyc_verification", get_kyc_should_not_run)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PAYOUT,
        context={},
    )

    assert decision.allowed is False
    assert decision.decision == "manual_review"
    assert decision.required_step == "manual_review"
    assert decision.reason_codes == ["FRAUD_MANUAL_REVIEW"]


@pytest.mark.asyncio
async def test_allow_evidence_does_not_short_circuit_current_fraud_risk(monkeypatch):
    user = _user(buyer_eligible=True)

    async def get_user(_db, _user_id):
        return user

    async def stale_allow_decision(_db, _user_id, _action):
        return _risk_decision("allow", risk_band="low")

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "medium")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", stale_allow_decision)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_BUY,
        context={"amount": 500},
    )

    assert decision.allowed is False
    assert decision.decision == "step_up"
    assert decision.reason_codes == ["FRAUD_MEDIUM_RISK"]
    assert decision.required_step == "kyc"


@pytest.mark.asyncio
async def test_draft_listing_requires_phone_otp_before_any_risk_policy(monkeypatch):
    user = _user(auth_state="otp_pending", phone_verified=False)

    async def get_user(_db, _user_id):
        return user

    async def latest_risk_should_not_run(*_args, **_kwargs):
        raise AssertionError("draft listing should be gated by phone before risk policy")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", latest_risk_should_not_run)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_DRAFT_LISTING,
        context={},
    )

    assert decision.allowed is False
    assert decision.required_step == "phone_otp"
    assert decision.reason_codes == ["PHONE_OTP_REQUIRED"]


@pytest.mark.asyncio
async def test_phone_change_requires_new_otp_after_low_risk(monkeypatch):
    user = _user()

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "low")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PHONE_CHANGE,
        context={},
    )

    assert decision.allowed is False
    assert decision.required_step == "phone_otp"
    assert decision.reason_codes == ["PHONE_CHANGE_RECHECK_REQUIRED"]


@pytest.mark.asyncio
async def test_high_value_buy_requires_buyer_kyc_after_low_risk(monkeypatch):
    user = _user(buyer_eligible=False)

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "low")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_BUY,
        context={"amount": 12000},
    )

    assert decision.allowed is False
    assert decision.required_step == "buyer_kyc"
    assert decision.reason_codes == ["BUYER_KYC_REQUIRED"]


@pytest.mark.asyncio
async def test_low_value_buy_allows_without_full_buyer_kyc_after_low_risk(monkeypatch):
    user = _user(buyer_eligible=False)

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "low")

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_BUY,
        context={"amount": 2500},
    )

    assert decision.allowed is True
    assert decision.reason_codes == ["BUY_ALLOWED_WITH_RISK_PASS"]


@pytest.mark.asyncio
async def test_payout_requires_pan_and_payout_account(monkeypatch):
    user = _user()

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "low")

    async def get_kyc(_db, _user_id):
        return _kyc(pan_verified=True, payout_verified=False)

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_get_kyc_verification", get_kyc)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PAYOUT,
        context={},
    )

    assert decision.allowed is False
    assert decision.required_step == "payout_kyc"
    assert decision.reason_codes == ["PAYOUT_VERIFICATION_REQUIRED"]


@pytest.mark.asyncio
async def test_payout_allows_only_after_pan_and_payout_verification(monkeypatch):
    user = _user()

    async def get_user(_db, _user_id):
        return user

    async def latest_check(_db, _user_id, _check_type):
        return _fraud_check("passed", "low")

    async def get_kyc(_db, _user_id):
        return _kyc(pan_verified=True, payout_verified=True)

    _enable_bureau_policy(monkeypatch)
    monkeypatch.setattr(service, "_get_user", get_user)
    monkeypatch.setattr(service, "_get_kyc_verification", get_kyc)
    monkeypatch.setattr(service, "_latest_verification_check", latest_check)
    monkeypatch.setattr(service, "_latest_valid_risk_decision", _none)

    decision = await service.evaluate_user_action(
        None,
        user_id=user.id,
        action=service.ACTION_PAYOUT,
        context={},
    )

    assert decision.allowed is True
    assert decision.reason_codes == ["PAYOUT_VERIFIED"]
