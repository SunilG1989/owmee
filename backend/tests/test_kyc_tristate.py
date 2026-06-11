"""Wave 7: KYC tri-state derivation.

CLAUDE.md mandates derive_tri_state_from_kyc() after every KYC step, and it
drives seller_tier + buyer_eligible — the core eligibility convention. It had
no behavioral test. Runs against the dev Postgres with rollback isolation.
"""
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.settings import settings
from app.modules.identity_auth.models import User
from app.modules.kyc.models import KYCVerification
from app.modules.kyc.service import derive_tri_state_from_kyc


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(settings.database_url, echo=False, poolclass=NullPool)
    try:
        Session = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            await session.begin()
            try:
                yield session
            finally:
                await session.rollback()
    finally:
        await engine.dispose()


async def _seed_user(db, **overrides):
    user = User(
        phone_number=f"+91900000{uuid4().hex[:4]}",
        phone_verified=True,
        kyc_status="in_progress",
        seller_tier="not_eligible",
        buyer_eligible=False,
        auth_state="otp_verified",
        **overrides,
    )
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_aadhaar_only_promotes_to_lite_not_full(db):
    user = await _seed_user(db)
    db.add(KYCVerification(user_id=user.id, aadhaar_verified=True, kyc_status="in_progress"))
    await db.flush()

    await derive_tri_state_from_kyc(db, user.id)
    assert user.seller_tier == "lite"
    assert user.buyer_eligible is False  # buyer eligibility needs full KYC


@pytest.mark.asyncio
async def test_full_kyc_grants_full_tier_and_buyer_eligible(db):
    user = await _seed_user(db)
    db.add(KYCVerification(
        user_id=user.id,
        aadhaar_verified=True,
        pan_verified=True,
        liveness_verified=True,
        payout_verified=True,
        name_match_result="pass",
        kyc_status="verified",
    ))
    await db.flush()

    await derive_tri_state_from_kyc(db, user.id)
    assert user.seller_tier == "full"
    assert user.buyer_eligible is True


@pytest.mark.asyncio
async def test_no_verification_row_is_a_noop(db):
    user = await _seed_user(db)
    result = await derive_tri_state_from_kyc(db, user.id)
    assert result.get("changed") is False
    assert user.seller_tier == "not_eligible"


@pytest.mark.asyncio
async def test_buyer_not_eligible_when_name_match_rejected(db):
    user = await _seed_user(db)
    db.add(KYCVerification(
        user_id=user.id,
        aadhaar_verified=True,
        pan_verified=True,
        liveness_verified=True,
        payout_verified=True,
        name_match_result="reject",
        kyc_status="pending_review",
    ))
    await db.flush()

    await derive_tri_state_from_kyc(db, user.id)
    # Seller tier can still progress, but buyer eligibility must NOT be granted
    # when the name match was rejected.
    assert user.buyer_eligible is False
