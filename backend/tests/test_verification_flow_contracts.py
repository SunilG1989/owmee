from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.modules.offers import router as offers_router
from app.modules.transactions import shipped
from app.modules.verification import service as verification_service


@pytest.mark.asyncio
async def test_accept_offer_endpoint_returns_structured_buyer_verification_error(monkeypatch):
    async def blocked_accept_offer(_db, _offer_id, _seller_id):
        raise ValueError("BUYER_VERIFICATION_REQUIRED:BUYER_KYC_REQUIRED:buyer_kyc")

    monkeypatch.setattr(offers_router, "accept_offer", blocked_accept_offer)

    with pytest.raises(HTTPException) as exc:
        await offers_router.accept_offer_endpoint(
            uuid4(),
            SimpleNamespace(user_id=uuid4()),
            None,
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == {
        "error": "BUYER_VERIFICATION_REQUIRED",
        "message": "Buyer verification is required before payment.",
        "reason_code": "BUYER_KYC_REQUIRED",
        "required_step": "buyer_kyc",
    }


@pytest.mark.asyncio
async def test_seller_payout_verified_delegates_to_action_policy(monkeypatch):
    seller_id = uuid4()
    calls = []

    async def fake_evaluate_user_action(db, *, user_id, action, context):
        calls.append((db, user_id, action, context))
        return verification_service.allow("PAYOUT_VERIFIED")

    monkeypatch.setattr(verification_service, "evaluate_user_action", fake_evaluate_user_action)

    assert await shipped.seller_payout_verified("db-session", seller_id) is True
    assert calls == [
        ("db-session", seller_id, verification_service.ACTION_PAYOUT, {}),
    ]


@pytest.mark.asyncio
async def test_seller_payout_verified_returns_false_for_policy_step_up(monkeypatch):
    async def fake_evaluate_user_action(_db, *, user_id, action, context):
        assert action == verification_service.ACTION_PAYOUT
        return verification_service.step_up(
            "PAYOUT_VERIFICATION_REQUIRED",
            "Verify PAN and payout account before receiving money.",
            "payout_kyc",
        )

    monkeypatch.setattr(verification_service, "evaluate_user_action", fake_evaluate_user_action)

    assert await shipped.seller_payout_verified("db-session", uuid4()) is False
