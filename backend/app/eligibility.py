"""
Eligibility service — Sprint 4 / v3

Pure-logic + async DB helpers for the tri-state eligibility model:
    auth_state       : guest | otp_verified | suspended
    buyer_eligible   : bool
    seller_tier      : not_eligible | lite | full | restricted

Use the FastAPI dependencies in app.core.dependencies for request-level gating;
use functions here for state transitions and TDS-threshold logic.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity_auth.models import SellerTierEvent, User

logger = structlog.get_logger()


# ── Enums (string-valued to match DB columns) ─────────────────────────────────

class AuthState(str, Enum):
    GUEST = "guest"
    OTP_VERIFIED = "otp_verified"
    SUSPENDED = "suspended"


class SellerTier(str, Enum):
    NOT_ELIGIBLE = "not_eligible"
    LITE = "lite"
    FULL = "full"
    RESTRICTED = "restricted"


# ── TDS 194-O constants ──────────────────────────────────────────────────────

TDS_THRESHOLD_PAISE = 500_000_00       # ₹5,00,000
TDS_THRESHOLD_NUDGE_PAISE = 400_000_00  # nudge at ₹4,00,000
TDS_RATE_FULL = 0.01                   # 1% with PAN (Section 194-O)
TDS_RATE_206AA = 0.05                  # 5% without PAN (Section 206AA fallback)


def financial_year_start(as_of: Optional[date] = None) -> date:
    """India FY runs April 1 -> March 31."""
    as_of = as_of or date.today()
    if as_of.month >= 4:
        return date(as_of.year, 4, 1)
    return date(as_of.year - 1, 4, 1)


# ── Pure-logic eligibility checks (no DB I/O) ─────────────────────────────────

def can_buy(user: User) -> bool:
    if user is None or user.auth_state == AuthState.SUSPENDED.value:
        return False
    return bool(user.buyer_eligible)


def can_sell(user: User) -> bool:
    if user is None or user.auth_state == AuthState.SUSPENDED.value:
        return False
    return user.seller_tier in (SellerTier.LITE.value, SellerTier.FULL.value)


def can_draft_listing(user: User) -> bool:
    if user is None or user.auth_state == AuthState.SUSPENDED.value:
        return False
    return user.auth_state == AuthState.OTP_VERIFIED.value


def can_request_fe_visit(user: User) -> bool:
    return can_draft_listing(user) and user.seller_tier != SellerTier.RESTRICTED.value


def tds_rate_for_user(user: User) -> float:
    return TDS_RATE_FULL if user.seller_tier == SellerTier.FULL.value else TDS_RATE_206AA


def should_prompt_tier_upgrade(user: User) -> bool:
    if user.seller_tier != SellerTier.LITE.value:
        return False
    return user.fy_cumulative_payout_paise >= TDS_THRESHOLD_NUDGE_PAISE


def must_hold_payout_for_upgrade(user: User, proposed_payout_paise: int) -> bool:
    """True if this payout would cross the TDS threshold and seller is still Lite."""
    if user.seller_tier != SellerTier.LITE.value:
        return False
    return (user.fy_cumulative_payout_paise + proposed_payout_paise) >= TDS_THRESHOLD_PAISE


# ── State transitions (async, commit handled by caller) ───────────────────────

_ALLOWED_TRANSITIONS = {
    SellerTier.NOT_ELIGIBLE.value: {SellerTier.LITE.value, SellerTier.RESTRICTED.value},
    SellerTier.LITE.value: {
        SellerTier.FULL.value,
        SellerTier.RESTRICTED.value,
        SellerTier.NOT_ELIGIBLE.value,
    },
    SellerTier.FULL.value: {
        SellerTier.LITE.value,
        SellerTier.RESTRICTED.value,
    },
    SellerTier.RESTRICTED.value: {
        SellerTier.LITE.value,
        SellerTier.FULL.value,
        SellerTier.NOT_ELIGIBLE.value,
    },
}


async def transition_seller_tier(
    db: AsyncSession,
    user: User,
    to_tier: SellerTier,
    reason: str,
    triggered_by: str = "system",
    idempotency_key: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> bool:
    """
    Apply a seller_tier transition and append to seller_tier_events.

    Returns True if a transition was applied, False if it was a no-op
    (same-state transition or idempotency-hit).

    Caller is responsible for `await db.commit()` / `await db.flush()`.
    """
    # Idempotency check
    if idempotency_key:
        existing = await db.execute(
            select(SellerTierEvent).where(
                SellerTierEvent.idempotency_key == idempotency_key
            )
        )
        if existing.scalar_one_or_none() is not None:
            return False

    from_tier = user.seller_tier

    # Same-state is a no-op, not an error
    if from_tier == to_tier.value:
        return False

    allowed = _ALLOWED_TRANSITIONS.get(from_tier, set())
    if to_tier.value not in allowed:
        raise ValueError(
            f"Illegal seller_tier transition {from_tier} -> {to_tier.value}"
        )

    user.seller_tier = to_tier.value
    db.add(user)

    event = SellerTierEvent(
        user_id=user.id,
        from_tier=from_tier,
        to_tier=to_tier.value,
        reason=reason,
        triggered_by=triggered_by,
        idempotency_key=idempotency_key,
        metadata_=metadata,
    )
    db.add(event)

    logger.info(
        "seller_tier.transition",
        user_id=str(user.id),
        from_tier=from_tier,
        to_tier=to_tier.value,
        reason=reason,
    )
    return True


async def mark_buyer_eligible(db: AsyncSession, user: User) -> bool:
    """Set buyer_eligible=True. Idempotent."""
    if user.buyer_eligible:
        return False
    user.buyer_eligible = True
    db.add(user)
    logger.info("buyer.eligible_granted", user_id=str(user.id))
    return True


async def promote_to_lite_after_aadhaar(db: AsyncSession, user: User) -> bool:
    """Aadhaar verification -> NOT_ELIGIBLE -> LITE. Idempotent."""
    if user.seller_tier in (SellerTier.LITE.value, SellerTier.FULL.value):
        return False
    return await transition_seller_tier(
        db,
        user,
        SellerTier.LITE,
        reason="aadhaar_completed",
        triggered_by=f"user:{user.id}",
    )


async def promote_to_full_after_pan_and_liveness(db: AsyncSession, user: User) -> bool:
    """LITE -> FULL. Idempotent."""
    if user.seller_tier == SellerTier.FULL.value:
        return False
    if user.seller_tier != SellerTier.LITE.value:
        raise ValueError(
            f"Cannot promote to FULL from {user.seller_tier}; must be LITE first"
        )
    return await transition_seller_tier(
        db,
        user,
        SellerTier.FULL,
        reason="pan_liveness_completed",
        triggered_by=f"user:{user.id}",
    )


# ── FY tracker ────────────────────────────────────────────────────────────────

async def refresh_fy_cumulative_if_needed(
    db: AsyncSession, user: User, as_of: Optional[date] = None
) -> None:
    """Reset the FY cumulative payout tracker at FY rollover (April 1)."""
    current_start = financial_year_start(as_of)
    if user.fy_cumulative_payout_fy_start != current_start:
        user.fy_cumulative_payout_fy_start = current_start
        user.fy_cumulative_payout_paise = 0
        db.add(user)
