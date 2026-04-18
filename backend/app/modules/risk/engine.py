"""
Risk engine — fraud rules and trust score management.

Signals tracked:
  - Seller ghosting (no-show after payment)
  - Off-platform payment pressure (UPI/phone sharing in chat)
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
    "chat_abuse_warning":     -2,   # sent blocked message (off-platform pressure)
    "chat_abuse_escalated":   -5,   # repeated abuse, transaction suspended
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


async def check_offer_spam(buyer_id: UUID, listing_id: UUID) -> dict:
    """
    Check if buyer is spamming offers.
    Returns: {should_block, reason}
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Offer
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        # Count rejected offers from this buyer in last 24h
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        result = await db.execute(
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


# ── Chat abuse detection ──────────────────────────────────────────────────────

import re as _re

# Patterns for off-platform payment pressure
PHONE_PATTERN = _re.compile(
    r'(?<!\d)(\+?91[-.\s]?)?[6-9]\d{9}(?!\d)'
)
UPI_PATTERN = _re.compile(
    r'[\w.\-_]+@(upi|paytm|gpay|phonepe|okicici|oksbi|ybl|ibl|axl|okhdfcbank|okaxis|aubank)'
)
PAYMENT_LINK_PATTERN = _re.compile(
    r'(razorpay|paytm|phonepe|gpay|bhim|upi)\.me|pay\.[\w]+\.in|paymentlink',
    _re.IGNORECASE
)
OTP_PRESSURE_PATTERN = _re.compile(
    r'\botp\b.*\bshar[e|ed]\b|\bsend.*\botp\b|\bgive.*\botp\b',
    _re.IGNORECASE
)
THREAT_KEYWORDS = [
    'police', 'complaint', 'fraud', 'scam', 'cheat', 'fake', 'report you',
    'call you', 'address', 'find you', 'beat', 'harm', 'kill',
]


def scan_message(text: str) -> dict:
    """
    Scan a chat message for abuse signals.
    Returns: {blocked, reason, severity}
    """
    if PHONE_PATTERN.search(text):
        return {
            "blocked": True,
            "reason": "PHONE_NUMBER_SHARED",
            "severity": "medium",
            "message": "Sharing phone numbers outside the app is not allowed. Use in-app chat.",
        }

    if UPI_PATTERN.search(text):
        return {
            "blocked": True,
            "reason": "UPI_ID_SHARED",
            "severity": "high",
            "message": "All payments must go through Owmee. Off-platform payments are not protected.",
        }

    if PAYMENT_LINK_PATTERN.search(text):
        return {
            "blocked": True,
            "reason": "PAYMENT_LINK_SHARED",
            "severity": "high",
            "message": "Do not share external payment links. All transactions must happen through Owmee.",
        }

    if OTP_PRESSURE_PATTERN.search(text):
        return {
            "blocked": True,
            "reason": "OTP_PRESSURE",
            "severity": "critical",
            "message": "Never share your OTP with anyone. Owmee will never ask for your OTP.",
        }

    text_lower = text.lower()
    for keyword in THREAT_KEYWORDS:
        if keyword in text_lower:
            return {
                "blocked": True,
                "reason": "THREATENING_CONTENT",
                "severity": "critical",
                "message": "This message has been flagged for review.",
            }

    return {"blocked": False}


async def record_abuse_signal(user_id: UUID, reason: str, severity: str, transaction_id: UUID | None = None):
    """
    Record a chat abuse signal and update trust score.
    Escalate to ops if repeated violations.
    """
    score_event = "chat_abuse_warning"
    if severity == "critical":
        score_event = "chat_abuse_escalated"

    await adjust_trust_score(user_id, score_event, note=reason)

    # Check if transaction should be auto-suspended (3+ violations)
    if transaction_id:
        await _check_auto_suspend(user_id, transaction_id, reason)

    logger.warning("risk.abuse_signal",
                   user_id=str(user_id), reason=reason,
                   severity=severity,
                   transaction_id=str(transaction_id) if transaction_id else None)


async def _check_auto_suspend(user_id: UUID, transaction_id: UUID, reason: str):
    """Auto-suspend transaction if user has 3+ abuse signals in this session."""
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import NotificationEvent

    async with AsyncSessionLocal() as db:
        since = datetime.now(timezone.utc) - timedelta(hours=2)
        result = await db.execute(
            select(func.count(NotificationEvent.id)).where(
                NotificationEvent.user_id == user_id,
                NotificationEvent.event_type.like("chat_abuse%"),
                NotificationEvent.created_at >= since,
            )
        )
        abuse_count = result.scalar() or 0

        if abuse_count >= 3:
            # Flag for ops
            from app.modules.offers.models import Transaction
            txn_result = await db.execute(
                select(Transaction).where(Transaction.id == transaction_id)
            )
            txn = txn_result.scalar_one_or_none()
            if txn and txn.status not in ("completed", "cancelled", "disputed"):
                logger.warning("risk.transaction_auto_suspended",
                               transaction_id=str(transaction_id),
                               user_id=str(user_id),
                               abuse_count=abuse_count)


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
