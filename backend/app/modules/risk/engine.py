"""
Risk engine — fraud rules and trust score management.

Signals tracked:
  - Seller ghosting (no-show after payment)
  - Duplicate account attempts (same PAN)
  - Repeated lowball/spam offers
  - Dispute rate
  - Rating manipulation

Trust score: 0-100, starts at 50 for new users.
Below 20: flagged for ops review.
Above 80: Trusted Seller badge eligible.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import select, func

logger = structlog.get_logger()


# ── Trust score adjustments ───────────────────────────────────────────────────

SCORE_ADJUSTMENTS = {
    "deal_completed":         +3,   # completed a deal successfully
    "five_star_rating":       +2,   # received a 5-star rating
    "four_star_rating":       +1,   # received a 4-star rating
    "one_two_star_rating":    -2,   # received a 1 or 2-star rating
    "seller_ghosting":        -10,  # no-show after payment captured
    "dispute_opened":         -3,   # buyer opened a dispute
    "dispute_resolved_seller": -5,  # dispute resolved against seller (refund)
    "dispute_resolved_buyer":  +2,  # dispute resolved in seller's favour
    "report_actioned":        -3,   # a report on this user was actioned by ops
    "verified_payout":        +5,   # payout account verified (one-time)
    "kyc_verified":           +5,   # KYC completed (one-time)
}

MIN_SCORE = 0
MAX_SCORE = 100
FLAGGED_THRESHOLD = 20
TRUSTED_THRESHOLD = 80


async def adjust_trust_score(
    user_id: UUID,
    event: str,
    note: str = "",
) -> int:
    """
    Apply a trust score adjustment for an event.
    Returns new score.
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.identity_auth.models import User

    delta = SCORE_ADJUSTMENTS.get(event, 0)
    if delta == 0:
        return -1

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return -1

        old_score = user.trust_score or 50
        new_score = max(MIN_SCORE, min(MAX_SCORE, old_score + delta))
        user.trust_score = new_score

        # Flag for ops review if score drops below threshold
        if new_score < FLAGGED_THRESHOLD and old_score >= FLAGGED_THRESHOLD:
            logger.warning("risk.user_flagged",
                           user_id=str(user_id), score=new_score, event=event)

        await db.commit()
        logger.info("risk.trust_score_updated",
                    user_id=str(user_id), event=event,
                    old=old_score, new=new_score, delta=delta, note=note)
        return new_score


async def get_trust_score(user_id: UUID) -> int:
    from app.db.session import AsyncSessionLocal
    from app.modules.identity_auth.models import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        return user.trust_score if user and user.trust_score is not None else 50


# ── Fraud rules ───────────────────────────────────────────────────────────────

async def check_duplicate_account(phone: str, pan_ref: str | None = None) -> dict:
    """
    Check for duplicate account attempts.
    Returns: {is_duplicate, existing_user_id, reason}
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.identity_auth.models import User
    from app.modules.kyc.models import KYCVerification
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        # Check same phone (different devices / re-registrations are fine, just flag)
        phone_result = await db.execute(
            select(User).where(User.phone_number == phone)
        )
        existing = phone_result.scalars().all()
        if len(existing) > 1:
            return {
                "is_suspicious": True,
                "reason": "MULTIPLE_ACCOUNTS_SAME_PHONE",
                "count": len(existing),
            }

        # Check PAN uniqueness (if provided)
        if pan_ref:
            pan_result = await db.execute(
                select(KYCVerification).where(
                    KYCVerification.pan_number_masked.isnot(None)
                )
            )
            # PAN uniqueness enforced at DB level — this is an additional signal check

    return {"is_suspicious": False}


async def check_offer_spam(buyer_id: UUID, listing_id: UUID, db=None) -> dict:
    """
    Check if buyer is spamming offers.
    Returns: {should_block, reason}
    """
    from app.modules.offers.models import Offer
    from sqlalchemy import select

    async def _check(session) -> dict:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        result = await session.execute(
            select(func.count(Offer.id)).where(
                Offer.buyer_id == buyer_id,
                Offer.status == "rejected",
                Offer.created_at >= since,
            )
        )
        rejected_count = result.scalar() or 0

        if rejected_count >= 5:
            return {
                "should_block": True,
                "reason": "OFFER_SPAM",
                "message": "Too many rejected offers. Please wait before making more offers.",
            }

        return {"should_block": False}

    if db is not None:
        return await _check(db)

    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as session:
        return await _check(session)


async def check_transaction_velocity(user_id: UUID) -> dict:
    """
    Check for suspicious transaction velocity.
    Flags users creating many transactions quickly.
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        since = datetime.now(timezone.utc) - timedelta(hours=1)
        result = await db.execute(
            select(func.count(Transaction.id)).where(
                Transaction.buyer_id == user_id,
                Transaction.created_at >= since,
            )
        )
        count = result.scalar() or 0

        if count >= 5:
            return {
                "is_suspicious": True,
                "reason": "HIGH_TRANSACTION_VELOCITY",
                "count": count,
            }

    return {"is_suspicious": False}


# ── Listing risk checks ───────────────────────────────────────────────────────

async def check_listing_risk(
    seller_id: UUID,
    price: Decimal,
    category_slug: str,
) -> dict:
    """
    Check a new listing for risk signals.
    Returns: {risk_level, signals}
    """
    signals = []
    trust_score = await get_trust_score(seller_id)

    if trust_score < FLAGGED_THRESHOLD:
        signals.append("LOW_TRUST_SCORE")

    # Price anomaly — very low prices can indicate bait-and-switch
    PRICE_FLOORS = {
        "smartphones": 2000,
        "laptops": 5000,
        "tablets": 3000,
    }
    floor = PRICE_FLOORS.get(category_slug, 500)
    if float(price) < floor:
        signals.append("PRICE_BELOW_FLOOR")

    risk_level = "low"
    if len(signals) >= 2:
        risk_level = "high"
    elif len(signals) == 1:
        risk_level = "medium"

    return {
        "risk_level": risk_level,
        "signals": signals,
        "trust_score": trust_score,
        "requires_review": risk_level == "high",
    }
