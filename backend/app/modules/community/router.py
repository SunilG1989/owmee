"""
Community HTTP router — Sprint 7 / Phase 1.

User-facing endpoints (consumer mobile app):

  GET  /v1/community/me                       - my community status
  POST /v1/community/referral/validate        - validate a referral code
  POST /v1/community/join-by-referral         - join via referral code
  POST /v1/community/verify/upload/request    - presigned URL for proof image
  POST /v1/community/verify/submit            - submit manual verification request
  GET  /v1/community/safe-meetup-points       - list safe meetup points for my community
  GET  /v1/community/list                     - list active communities (for manual flow dropdown)
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.dependencies import BasicUser, DBSession
from app.core.storage import (
    generate_presigned_upload_url,
    object_key_for_listing_image,
)
from app.modules.community import service as community_service
from app.modules.community.models import (
    Community,
    CommunityVerification,
    SafeMeetupPoint,
)
from app.modules.community.service import CommunityError
from app.modules.identity_auth.models import User

router = APIRouter()
logger = structlog.get_logger()


# ── Schemas ─────────────────────────────────────────────────────────────────


class ValidateReferralRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=10)


class JoinByReferralRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=10)


class SubmitVerificationRequest(BaseModel):
    community_id: Optional[UUID] = None
    requested_community_name: Optional[str] = Field(None, max_length=200)
    proof_r2_key: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=2000)


class VerificationProofUploadRequest(BaseModel):
    content_type: str = Field("image/jpeg", pattern="^image/(jpeg|png|webp)$")


# ── Helpers ─────────────────────────────────────────────────────────────────


def _community_to_dict(c: Community) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "slug": c.slug,
        "type": c.type,
        "city": c.city,
        "state": c.state,
        "pincode": c.pincode,
        "is_active": bool(c.is_active),
        "member_count": c.member_count,
    }


def _verification_to_dict(v: CommunityVerification) -> dict:
    return {
        "id": str(v.id),
        "user_id": str(v.user_id),
        "community_id": str(v.community_id) if v.community_id else None,
        "requested_community_name": v.requested_community_name,
        "proof_r2_key": v.proof_r2_key,
        "status": v.status,
        "rejection_reason": v.rejection_reason,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "reviewed_at": v.reviewed_at.isoformat() if v.reviewed_at else None,
    }


async def _load_user(db, user_id) -> User:
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})
    return user


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.get("/me")
async def get_my_community_status(current_user: BasicUser, db: DBSession):
    """Return community status for the requesting user.

    Includes:
      - community: Community dict if joined, else None
      - referral_code: lazily generated if user has community
      - pending_verification: latest pending verification if any
    """
    user = await _load_user(db, current_user.user_id)

    community = None
    if user.community_id:
        c = await community_service.get_community_by_id(db, user.community_id)
        community = _community_to_dict(c) if c else None

    referral_code = None
    if user.community_id:
        # Only assign referral codes to users who are themselves verified
        try:
            referral_code = await community_service.ensure_referral_code(db, user)
            await db.commit()
        except CommunityError:
            referral_code = None

    pending = await community_service.get_pending_verification_for_user(
        db, user.id
    )

    return {
        "community": community,
        "community_verified_at": (
            user.community_verified_at.isoformat()
            if user.community_verified_at
            else None
        ),
        "community_verified_by": user.community_verified_by,
        "referral_code": referral_code,
        "referred_by_user_id": (
            str(user.referred_by_user_id) if user.referred_by_user_id else None
        ),
        "pending_verification": (
            _verification_to_dict(pending) if pending else None
        ),
    }


@router.post("/referral/validate")
async def validate_referral(
    body: ValidateReferralRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Validate a referral code without joining. Returns community details on success."""
    validated = await community_service.validate_referral_code(db, body.code)
    if validated is None:
        return {"valid": False, "community": None, "referrer_name": None}

    referrer, community = validated
    return {
        "valid": True,
        "community": _community_to_dict(community),
        "referrer_name": referrer.name or "A neighbor",
    }


@router.post("/join-by-referral")
async def join_by_referral(
    body: JoinByReferralRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Join a community via referral code."""
    user = await _load_user(db, current_user.user_id)
    try:
        community, referrer = await community_service.join_by_referral(
            db, user=user, code=body.code
        )
        await db.commit()
    except CommunityError as e:
        raise HTTPException(
            status_code=400,
            detail={"error": str(e)},
        )

    # Lazily generate the new member's own referral code
    try:
        await community_service.ensure_referral_code(db, user)
        await db.commit()
    except CommunityError:
        pass

    return {
        "community": _community_to_dict(community),
        "referrer_name": referrer.name or "A neighbor",
        "verified_by": "referral",
    }


@router.post("/verify/upload/request")
async def request_proof_upload(
    body: VerificationProofUploadRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Generate a presigned URL for uploading a proof image (utility bill, ID, etc).

    Reuses the listings image bucket structure: keys are scoped under
    'community-proof/<user_id>/<uuid>.<ext>'.
    """
    import uuid as uuid_mod

    ext_map = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }
    ext = ext_map.get(body.content_type, "jpg")
    r2_key = f"community-proof/{current_user.user_id}/{uuid_mod.uuid4()}.{ext}"

    presigned_url = generate_presigned_upload_url(
        r2_key, body.content_type, expires_in=600
    )
    return {
        "r2_key": r2_key,
        "presigned_url": presigned_url,
        "expires_in": 600,
    }


@router.post("/verify/submit")
async def submit_manual_verification(
    body: SubmitVerificationRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Submit a manual community verification request.

    Either community_id (selected from list) or requested_community_name
    (free text for new community) must be provided.
    """
    user = await _load_user(db, current_user.user_id)
    try:
        verification = await community_service.create_manual_verification(
            db,
            user=user,
            community_id=body.community_id,
            requested_community_name=body.requested_community_name,
            proof_r2_key=body.proof_r2_key,
            notes=body.notes,
        )
        await db.commit()
    except CommunityError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})

    return _verification_to_dict(verification)


@router.get("/safe-meetup-points")
async def my_safe_meetup_points(current_user: BasicUser, db: DBSession):
    """List safe meetup points for the user's community."""
    user = await _load_user(db, current_user.user_id)
    if not user.community_id:
        return {"points": [], "community_id": None}

    points = await community_service.list_safe_meetup_points(db, user.community_id)
    return {
        "community_id": str(user.community_id),
        "points": [
            {
                "id": str(p.id),
                "name": p.name,
                "notes": p.notes,
                "sort_order": p.sort_order,
            }
            for p in points
        ],
    }


@router.get("/list")
async def list_communities(
    current_user: BasicUser,
    db: DBSession,
    city: Optional[str] = None,
):
    """List active communities, optionally filtered by city.

    Used by the manual verification UI to populate a dropdown.
    """
    q = select(Community).where(Community.is_active.is_(True))
    if city:
        q = q.where(Community.city.ilike(f"%{city}%"))
    q = q.order_by(Community.city, Community.name).limit(200)
    res = await db.execute(q)
    communities = list(res.scalars().all())
    return {
        "communities": [_community_to_dict(c) for c in communities],
        "count": len(communities),
    }
