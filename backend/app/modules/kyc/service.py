"""
KYC service — business logic layer.

Handles:
- Aadhaar OTP initiation and verification (via partner adapter)
- PAN verification + PAN-Aadhaar linkage check
- Name fuzzy match with configurable thresholds
- Minor detection from DOB
- Liveness session and verification
- Payout account verification
- KYC state machine transitions
- DPDP consent events
- Sprint 4: seller_tier + buyer_eligible transitions derived from KYC step completion
"""
from __future__ import annotations

import unicodedata
from datetime import date, datetime, timezone
from uuid import UUID

import structlog
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.kyc.models import ConsentEvent, KYCEvent, KYCVerification
from app.modules.identity_auth.models import User
from app.eligibility import (
    AuthState,
    SellerTier,
    mark_buyer_eligible,
    promote_to_lite_after_aadhaar,
    promote_to_full_after_pan_and_liveness,
    transition_seller_tier,
)

logger = structlog.get_logger()

# ── Thresholds ─────────────────────────────────────────────────────────────────
NAME_PASS_THRESHOLD = 0.85        # score >= this → pass
NAME_REVIEW_THRESHOLD = 0.70      # score >= this → manual review
# score < NAME_REVIEW_THRESHOLD → hard reject

MINIMUM_AGE_YEARS = 18


# ── Name normalisation and fuzzy match ────────────────────────────────────────

def _normalise_name(name: str) -> str:
    """Normalise name for comparison: lowercase, strip accents, collapse spaces."""
    name = name.strip().lower()
    # Strip accents (handles Indic-romanised names)
    name = "".join(
        c for c in unicodedata.normalize("NFD", name)
        if unicodedata.category(c) != "Mn"
    )
    # Collapse multiple spaces
    return " ".join(name.split())


def compute_name_match(name_a: str, name_b: str) -> tuple[float, str]:
    """
    Compare two names using token sort ratio (handles word order variation).
    Returns (score, result) where result is one of: pass | manual_review | reject
    """
    a = _normalise_name(name_a)
    b = _normalise_name(name_b)
    score = fuzz.token_sort_ratio(a, b) / 100.0

    if score >= NAME_PASS_THRESHOLD:
        result = "pass"
    elif score >= NAME_REVIEW_THRESHOLD:
        result = "manual_review"
    else:
        result = "reject"

    logger.info("kyc.name_match", score=round(score, 3), result=result)
    return score, result


def is_minor(dob_str: str) -> bool:
    """
    Check if DOB (YYYY-MM-DD string) indicates age < 18.
    Returns True if minor.
    """
    try:
        dob = date.fromisoformat(dob_str)
        today = date.today()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return age < MINIMUM_AGE_YEARS
    except (ValueError, TypeError):
        return False


# ── KYC state machine ─────────────────────────────────────────────────────────

KYC_STATE_TRANSITIONS = {
    "not_started": ["in_progress"],
    "in_progress": ["pending_review", "verified", "rejected"],
    "pending_review": ["verified", "rejected"],
    "verified": ["re_verification_required"],
    "rejected": ["in_progress"],   # allow retry
    "re_verification_required": ["in_progress"],
}


def can_transition(current: str, target: str) -> bool:
    return target in KYC_STATE_TRANSITIONS.get(current, [])


async def get_or_create_verification(
    db: AsyncSession,
    user_id: UUID,
) -> KYCVerification:
    result = await db.execute(
        select(KYCVerification).where(KYCVerification.user_id == user_id)
    )
    v = result.scalar_one_or_none()
    if not v:
        v = KYCVerification(user_id=user_id, kyc_status="not_started")
        db.add(v)
        await db.flush()
    return v


async def record_kyc_event(
    db: AsyncSession,
    verification_id: UUID,
    user_id: UUID,
    event_type: str,
    step: str | None = None,
    result: str | None = None,
    payload: dict | None = None,
) -> None:
    """Append an immutable KYC event. Never store raw Aadhaar data in payload."""
    event = KYCEvent(
        verification_id=verification_id,
        user_id=user_id,
        event_type=event_type,
        step=step,
        result=result,
        payload=payload or {},
    )
    db.add(event)


async def record_consent(
    db: AsyncSession,
    user_id: UUID,
    verification_id: UUID,
    consent_type: str,
    action: str = "granted",
    ip_address: str | None = None,
    consent_version: str = "v1.0",
) -> None:
    """Log DPDP consent event before any data collection step."""
    event = ConsentEvent(
        user_id=user_id,
        verification_id=verification_id,
        consent_type=consent_type,
        consent_version=consent_version,
        action=action,
        ip_address=ip_address,
    )
    db.add(event)


# ── Sprint 4 / v3: tri-state derivation ───────────────────────────────────────
#
# This helper reads the KYCVerification flags and advances the user's
# seller_tier + buyer_eligible accordingly. It's idempotent — safe to call at
# any point, and called automatically from update_user_kyc_status.
#
# It's also called explicitly from the KYC router after each successful step
# (aadhaar / pan / liveness / payout), so transitions happen at the right
# moment, not just when kyc_status changes.

async def derive_tri_state_from_kyc(
    db: AsyncSession,
    user_id: UUID,
) -> dict:
    """
    Derive and apply seller_tier + buyer_eligible transitions from current
    KYCVerification flags.

    Returns a dict summarising what changed — useful for tests / logging.
    Caller is responsible for db.commit() / db.flush().

    Rules:
      - v.aadhaar_verified -> seller_tier at least LITE
      - v.aadhaar + v.pan + v.liveness (and currently LITE) -> seller_tier FULL
      - all four flags + name_match_result != 'reject' -> buyer_eligible = True
    """
    u_result = await db.execute(select(User).where(User.id == user_id))
    user = u_result.scalar_one_or_none()
    if user is None:
        return {"error": "user_not_found"}

    v_result = await db.execute(
        select(KYCVerification).where(KYCVerification.user_id == user_id)
    )
    v = v_result.scalar_one_or_none()
    if v is None:
        return {"changed": False, "reason": "no_verification"}

    changes = {"changed": False}

    # Aadhaar -> at least LITE
    if v.aadhaar_verified and user.seller_tier == SellerTier.NOT_ELIGIBLE.value:
        if await promote_to_lite_after_aadhaar(db, user):
            changes["changed"] = True
            changes["promoted_to_lite"] = True

    # PAN + liveness (while LITE) -> FULL
    if (
        v.aadhaar_verified
        and v.pan_verified
        and v.liveness_verified
        and user.seller_tier == SellerTier.LITE.value
    ):
        try:
            if await promote_to_full_after_pan_and_liveness(db, user):
                changes["changed"] = True
                changes["promoted_to_full"] = True
        except ValueError:
            logger.warning(
                "seller_tier.promote_full.skipped",
                user_id=str(user.id),
                current_tier=user.seller_tier,
            )

    # All four flags + clean name match -> buyer_eligible
    if (
        v.aadhaar_verified
        and v.pan_verified
        and v.liveness_verified
        and v.payout_verified
        and v.name_match_result != "reject"
    ):
        if await mark_buyer_eligible(db, user):
            changes["changed"] = True
            changes["buyer_eligible"] = True

    return changes


async def update_user_kyc_status(
    db: AsyncSession,
    user_id: UUID,
    new_status: str,
) -> None:
    """
    Update users.kyc_status and users.tier atomically.

    Sprint 4 / v3: ALSO derives tri-state transitions. This function is the
    historical entry point for status changes; tri-state derivation is also
    exposed separately via derive_tri_state_from_kyc() so the KYC router can
    call it directly after each step.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one()

    user.kyc_status = new_status

    # Sprint 3 legacy tier (preserved for backward compat)
    if new_status == "verified":
        user.tier = "verified"
        user.kyc_version += 1
    elif new_status in ("rejected", "re_verification_required"):
        user.tier = "basic"

    # ── Sprint 4 / v3: tri-state derivations ──────────────────────────────────
    if new_status == "rejected":
        # Hard rejection — revoke seller tier
        if user.seller_tier in (SellerTier.LITE.value, SellerTier.FULL.value):
            await transition_seller_tier(
                db, user, SellerTier.NOT_ELIGIBLE,
                reason="kyc_rejected",
                triggered_by="system:kyc",
            )
        user.buyer_eligible = False

    elif new_status == "re_verification_required":
        if user.seller_tier in (SellerTier.LITE.value, SellerTier.FULL.value):
            await transition_seller_tier(
                db, user, SellerTier.NOT_ELIGIBLE,
                reason="re_verification_required",
                triggered_by="system:kyc",
            )
        user.buyer_eligible = False

    else:
        # Forward transitions — pick up whatever KYC flags say
        await derive_tri_state_from_kyc(db, user_id)


def next_pending_step(v: KYCVerification) -> str:
    """Return the next incomplete KYC step for a given verification."""
    if not v.aadhaar_verified:
        return "aadhaar_otp"
    if not v.pan_verified:
        return "pan"
    if v.name_match_result == "manual_review":
        return "manual_review"
    if not v.liveness_verified:
        return "liveness"
    if not v.payout_verified:
        return "payout_account"
    return "complete"
