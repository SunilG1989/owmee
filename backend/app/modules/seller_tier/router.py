"""
Seller Tier API — Sprint 4 / v3

Endpoints:
    GET  /v1/sellers/me/tier            — current tier summary
    GET  /v1/sellers/me/tier/threshold  — TDS threshold tracking
    POST /v1/sellers/me/tier/upgrade    — Lite -> Full upgrade (PAN+liveness required)
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
import structlog

from app.core.dependencies import BasicUser, DBSession
from app.modules.identity_auth.models import User
from app.modules.kyc.models import KYCVerification
from app.eligibility import (
    SellerTier,
    TDS_RATE_206AA,
    TDS_RATE_FULL,
    TDS_THRESHOLD_NUDGE_PAISE,
    TDS_THRESHOLD_PAISE,
    can_buy,
    can_sell,
    financial_year_start,
    promote_to_full_after_pan_and_liveness,
    refresh_fy_cumulative_if_needed,
    should_prompt_tier_upgrade,
)

router = APIRouter()
logger = structlog.get_logger()


class TierResponse(BaseModel):
    tier: str
    buyer_eligible: bool
    can_sell: bool
    can_buy: bool
    aadhaar_verified: bool
    pan_verified: bool
    liveness_verified: bool
    payout_verified: bool
    should_prompt_upgrade: bool
    tds_rate: float


class ThresholdResponse(BaseModel):
    fy_start: str
    fy_cumulative_paise: int
    threshold_paise: int
    nudge_threshold_paise: int
    distance_to_threshold_paise: int
    distance_to_nudge_paise: int
    will_hold_next_payout_over_paise: int
    applied_tds_rate: float


class UpgradeResponse(BaseModel):
    success: bool
    new_tier: str
    message: str


async def _load_user_and_kyc(db, user_id):
    u_result = await db.execute(select(User).where(User.id == user_id))
    user = u_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    v_result = await db.execute(
        select(KYCVerification).where(KYCVerification.user_id == user_id)
    )
    v = v_result.scalar_one_or_none()
    return user, v


@router.get("/tier", response_model=TierResponse)
async def get_my_tier(current_user: BasicUser, db: DBSession):
    user, v = await _load_user_and_kyc(db, current_user.user_id)

    aadhaar = bool(v and v.aadhaar_verified)
    pan = bool(v and v.pan_verified)
    liveness = bool(v and v.liveness_verified)
    payout = bool(v and v.payout_verified)

    return TierResponse(
        tier=user.seller_tier,
        buyer_eligible=bool(user.buyer_eligible),
        can_sell=can_sell(user),
        can_buy=can_buy(user),
        aadhaar_verified=aadhaar,
        pan_verified=pan,
        liveness_verified=liveness,
        payout_verified=payout,
        should_prompt_upgrade=should_prompt_tier_upgrade(user),
        tds_rate=(
            TDS_RATE_FULL if user.seller_tier == SellerTier.FULL.value else TDS_RATE_206AA
        ),
    )


@router.get("/tier/threshold", response_model=ThresholdResponse)
async def get_threshold_info(current_user: BasicUser, db: DBSession):
    u_result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = u_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    await refresh_fy_cumulative_if_needed(db, user)

    fy_start = user.fy_cumulative_payout_fy_start or financial_year_start()
    cumulative = user.fy_cumulative_payout_paise
    distance_to_threshold = max(0, TDS_THRESHOLD_PAISE - cumulative)
    distance_to_nudge = max(0, TDS_THRESHOLD_NUDGE_PAISE - cumulative)

    applied_rate = (
        TDS_RATE_FULL if user.seller_tier == SellerTier.FULL.value else TDS_RATE_206AA
    )

    return ThresholdResponse(
        fy_start=fy_start.isoformat(),
        fy_cumulative_paise=cumulative,
        threshold_paise=TDS_THRESHOLD_PAISE,
        nudge_threshold_paise=TDS_THRESHOLD_NUDGE_PAISE,
        distance_to_threshold_paise=distance_to_threshold,
        distance_to_nudge_paise=distance_to_nudge,
        will_hold_next_payout_over_paise=(
            distance_to_threshold if user.seller_tier == SellerTier.LITE.value else 0
        ),
        applied_tds_rate=applied_rate,
    )


@router.post("/tier/upgrade", response_model=UpgradeResponse)
async def upgrade_to_full(current_user: BasicUser, db: DBSession):
    """
    Upgrade seller from Lite to Full. Requires PAN + liveness to already be
    verified (done via existing /v1/kyc/pan/verify + /v1/kyc/liveness/verify).
    """
    user, v = await _load_user_and_kyc(db, current_user.user_id)

    if user.seller_tier == SellerTier.FULL.value:
        return UpgradeResponse(
            success=True,
            new_tier=SellerTier.FULL.value,
            message="You're already a Full-tier seller.",
        )

    if user.seller_tier != SellerTier.LITE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "NOT_LITE_TIER",
                "message": "Only Lite-tier sellers can upgrade to Full.",
                "current_tier": user.seller_tier,
            },
        )

    if not v or not v.pan_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "PAN_VERIFICATION_REQUIRED",
                "message": "Complete PAN verification to upgrade.",
                "next_step": "pan",
            },
        )

    if not v.liveness_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "LIVENESS_REQUIRED",
                "message": "Complete the selfie check to upgrade.",
                "next_step": "liveness",
            },
        )

    await promote_to_full_after_pan_and_liveness(db, user)
    await db.commit()

    logger.info("seller_tier.upgraded_to_full", user_id=str(user.id))
    return UpgradeResponse(
        success=True,
        new_tier=user.seller_tier,
        message="You're now a Full-tier seller. Standard 1% TDS applies on future payouts.",
    )
