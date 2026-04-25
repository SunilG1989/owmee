"""
Community service — Sprint 7 / Phase 1.

Pure-logic + async DB helpers:

  - _generate_referral_code   : 6-char alphanumeric, collision-retry
  - ensure_referral_code      : lazy assignment of code to a user
  - join_by_referral          : validate + join via a referral code
  - create_manual_verification: create a pending review row
  - get_user_community_status : status/eligibility summary for mobile
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.community.models import (
    Community,
    CommunityVerification,
    SafeMeetupPoint,
)
from app.modules.identity_auth.models import User

logger = structlog.get_logger()

# Code alphabet: unambiguous (no 0/O, 1/I/L)
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LEN = 6
_MAX_COLLISION_RETRIES = 8


class CommunityError(ValueError):
    pass


# ── Referral codes ────────────────────────────────────────────────────────


def _generate_referral_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))


async def ensure_referral_code(db: AsyncSession, user: User) -> str:
    """Lazily assign a referral code to a user. Idempotent."""
    if user.referral_code:
        return user.referral_code

    for _ in range(_MAX_COLLISION_RETRIES):
        candidate = _generate_referral_code()
        res = await db.execute(
            select(User.id).where(User.referral_code == candidate)
        )
        if res.scalar_one_or_none() is None:
            user.referral_code = candidate
            await db.flush()
            logger.info(
                "community.referral_code_assigned",
                user_id=str(user.id),
                code=candidate,
            )
            return candidate

    raise CommunityError(
        "Could not generate unique referral code after retries"
    )


# ── Join flow ──────────────────────────────────────────────────────────────


async def validate_referral_code(
    db: AsyncSession, code: str
) -> Optional[tuple[User, Community]]:
    """Return (referrer, community) or None if invalid."""
    code_norm = code.strip().upper()
    if not code_norm or len(code_norm) != _CODE_LEN:
        return None

    res = await db.execute(
        select(User).where(User.referral_code == code_norm)
    )
    referrer = res.scalar_one_or_none()
    if referrer is None:
        return None
    if not referrer.community_id:
        # Referrer has no community — code is dangling, cannot be used
        return None

    res2 = await db.execute(
        select(Community).where(Community.id == referrer.community_id)
    )
    community = res2.scalar_one_or_none()
    if community is None or not community.is_active:
        return None

    return (referrer, community)


async def join_by_referral(
    db: AsyncSession,
    *,
    user: User,
    code: str,
) -> tuple[Community, User]:
    """Join user to a community via referral code.

    Returns (community, referrer). Raises CommunityError on invalid code
    or if user is already in a community.
    """
    if user.community_id is not None:
        raise CommunityError("ALREADY_IN_COMMUNITY")

    validated = await validate_referral_code(db, code)
    if validated is None:
        raise CommunityError("INVALID_REFERRAL_CODE")

    referrer, community = validated

    if referrer.id == user.id:
        raise CommunityError("CANNOT_REFER_SELF")

    # Join
    user.community_id = community.id
    user.community_verified_at = datetime.now(timezone.utc)
    user.community_verified_by = "referral"
    user.referred_by_user_id = referrer.id

    # Bump member count
    await db.execute(
        update(Community)
        .where(Community.id == community.id)
        .values(member_count=Community.member_count + 1)
    )

    await db.flush()

    logger.info(
        "community.joined_by_referral",
        user_id=str(user.id),
        community_id=str(community.id),
        community_name=community.name,
        referrer_id=str(referrer.id),
    )
    return (community, referrer)


# ── Manual verification ────────────────────────────────────────────────────


async def create_manual_verification(
    db: AsyncSession,
    *,
    user: User,
    community_id: Optional[UUID],
    requested_community_name: Optional[str],
    proof_r2_key: Optional[str],
    notes: Optional[str],
) -> CommunityVerification:
    if user.community_id is not None:
        raise CommunityError("ALREADY_IN_COMMUNITY")

    if community_id is None and not requested_community_name:
        raise CommunityError(
            "Must provide either community_id or requested_community_name"
        )

    # Check for any existing pending verification for this user
    res = await db.execute(
        select(CommunityVerification).where(
            CommunityVerification.user_id == user.id,
            CommunityVerification.status == "pending",
        )
    )
    existing = res.scalar_one_or_none()
    if existing is not None:
        raise CommunityError("ALREADY_PENDING_VERIFICATION")

    verification = CommunityVerification(
        user_id=user.id,
        community_id=community_id,
        requested_community_name=(
            requested_community_name.strip() if requested_community_name else None
        ),
        proof_r2_key=proof_r2_key,
        notes=notes,
        status="pending",
    )
    db.add(verification)
    await db.flush()
    logger.info(
        "community.verification_submitted",
        verification_id=str(verification.id),
        user_id=str(user.id),
    )
    return verification


async def admin_approve_verification(
    db: AsyncSession,
    *,
    verification: CommunityVerification,
    admin_id: UUID,
    community_id: Optional[UUID] = None,
) -> CommunityVerification:
    if verification.status != "pending":
        raise CommunityError(f"Cannot approve verification in {verification.status} state")

    target_community_id = community_id or verification.community_id
    if target_community_id is None:
        raise CommunityError(
            "Must specify community_id when approving a community-name-only verification"
        )

    res = await db.execute(
        select(Community).where(Community.id == target_community_id)
    )
    community = res.scalar_one_or_none()
    if community is None or not community.is_active:
        raise CommunityError("Community not found or inactive")

    # Load the user
    res2 = await db.execute(select(User).where(User.id == verification.user_id))
    user = res2.scalar_one_or_none()
    if user is None:
        raise CommunityError("User not found")

    if user.community_id is not None:
        # Already joined by referral while waiting — just close the verification
        verification.status = "approved"
        verification.reviewed_by_admin_id = admin_id
        verification.reviewed_at = datetime.now(timezone.utc)
        verification.notes = (verification.notes or "") + "\n[User joined via referral before admin review]"
        await db.flush()
        return verification

    # Apply the join
    user.community_id = community.id
    user.community_verified_at = datetime.now(timezone.utc)
    user.community_verified_by = "manual"

    await db.execute(
        update(Community)
        .where(Community.id == community.id)
        .values(member_count=Community.member_count + 1)
    )

    verification.status = "approved"
    verification.community_id = community.id
    verification.reviewed_by_admin_id = admin_id
    verification.reviewed_at = datetime.now(timezone.utc)
    await db.flush()

    logger.info(
        "community.verification_approved",
        verification_id=str(verification.id),
        user_id=str(user.id),
        community_id=str(community.id),
        admin_id=str(admin_id),
    )
    return verification


async def admin_reject_verification(
    db: AsyncSession,
    *,
    verification: CommunityVerification,
    admin_id: UUID,
    rejection_reason: str,
) -> CommunityVerification:
    if verification.status != "pending":
        raise CommunityError(f"Cannot reject verification in {verification.status} state")

    verification.status = "rejected"
    verification.reviewed_by_admin_id = admin_id
    verification.reviewed_at = datetime.now(timezone.utc)
    verification.rejection_reason = rejection_reason
    await db.flush()

    logger.info(
        "community.verification_rejected",
        verification_id=str(verification.id),
        admin_id=str(admin_id),
    )
    return verification


# ── Lookups ────────────────────────────────────────────────────────────────


async def get_community_by_id(
    db: AsyncSession, community_id: UUID
) -> Optional[Community]:
    res = await db.execute(select(Community).where(Community.id == community_id))
    return res.scalar_one_or_none()


async def list_safe_meetup_points(
    db: AsyncSession, community_id: UUID
) -> list[SafeMeetupPoint]:
    res = await db.execute(
        select(SafeMeetupPoint)
        .where(
            SafeMeetupPoint.community_id == community_id,
            SafeMeetupPoint.is_active.is_(True),
        )
        .order_by(SafeMeetupPoint.sort_order, SafeMeetupPoint.name)
    )
    return list(res.scalars().all())


async def get_pending_verification_for_user(
    db: AsyncSession, user_id: UUID
) -> Optional[CommunityVerification]:
    res = await db.execute(
        select(CommunityVerification).where(
            CommunityVerification.user_id == user_id,
            CommunityVerification.status == "pending",
        )
    )
    return res.scalar_one_or_none()
