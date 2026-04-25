"""
Community admin router — Sprint 7 / Phase 1.

Admin-facing endpoints (admin web app):

  GET  /v1/admin/community/verifications/queue       - pending list
  GET  /v1/admin/community/verifications/{id}        - detail
  POST /v1/admin/community/verifications/{id}/approve
  POST /v1/admin/community/verifications/{id}/reject
  GET  /v1/admin/community/list                      - all communities (incl inactive)
  POST /v1/admin/community/                          - create new community
  POST /v1/admin/community/{id}/safe-meetup-points   - add safe meetup point

Note: These endpoints are guarded by AuthUser only for V1 (consistent with
other admin routers in the codebase). Pass 3 will wrap with AdminRBAC.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from app.core.dependencies import AuthUser, DBSession
from app.modules.community import service as community_service
from app.modules.community.models import (
    Community,
    CommunityVerification,
    SafeMeetupPoint,
)
from app.modules.community.service import CommunityError

router = APIRouter()
logger = structlog.get_logger()


# ── Schemas ─────────────────────────────────────────────────────────────────


class ApproveVerificationRequest(BaseModel):
    community_id: Optional[UUID] = None  # required if verification has only requested_name


class RejectVerificationRequest(BaseModel):
    rejection_reason: str = Field(..., min_length=3, max_length=500)


class CreateCommunityRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=100, pattern="^[a-z0-9-]+$")
    type: str = Field("apartment", pattern="^(apartment|school|neighborhood|office)$")
    city: str = Field(..., min_length=2, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    pincode: Optional[str] = Field(None, max_length=10)


class CreateSafeMeetupPointRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    notes: Optional[str] = Field(None, max_length=500)
    sort_order: int = Field(0, ge=0, le=999)


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
        "notes": v.notes,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "reviewed_at": v.reviewed_at.isoformat() if v.reviewed_at else None,
        "reviewed_by_admin_id": (
            str(v.reviewed_by_admin_id) if v.reviewed_by_admin_id else None
        ),
    }


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.get("/verifications/queue")
async def verification_queue(
    current_user: AuthUser,
    db: DBSession,
    status_filter: str = Query("pending", pattern="^(pending|approved|rejected|all)$"),
    limit: int = Query(50, ge=1, le=200),
):
    q = select(CommunityVerification)
    if status_filter != "all":
        q = q.where(CommunityVerification.status == status_filter)
    q = q.order_by(desc(CommunityVerification.created_at)).limit(limit)
    res = await db.execute(q)
    items = list(res.scalars().all())
    return {
        "verifications": [_verification_to_dict(v) for v in items],
        "count": len(items),
        "status_filter": status_filter,
    }


@router.get("/verifications/{verification_id}")
async def get_verification(
    verification_id: UUID,
    current_user: AuthUser,
    db: DBSession,
):
    res = await db.execute(
        select(CommunityVerification).where(
            CommunityVerification.id == verification_id
        )
    )
    v = res.scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=404, detail={"error": "VERIFICATION_NOT_FOUND"}
        )
    return _verification_to_dict(v)


@router.post("/verifications/{verification_id}/approve")
async def approve_verification(
    verification_id: UUID,
    body: ApproveVerificationRequest,
    current_user: AuthUser,
    db: DBSession,
):
    res = await db.execute(
        select(CommunityVerification).where(
            CommunityVerification.id == verification_id
        )
    )
    v = res.scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=404, detail={"error": "VERIFICATION_NOT_FOUND"}
        )

    try:
        verification = await community_service.admin_approve_verification(
            db,
            verification=v,
            admin_id=current_user.user_id,
            community_id=body.community_id,
        )
        await db.commit()
    except CommunityError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})

    return _verification_to_dict(verification)


@router.post("/verifications/{verification_id}/reject")
async def reject_verification(
    verification_id: UUID,
    body: RejectVerificationRequest,
    current_user: AuthUser,
    db: DBSession,
):
    res = await db.execute(
        select(CommunityVerification).where(
            CommunityVerification.id == verification_id
        )
    )
    v = res.scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=404, detail={"error": "VERIFICATION_NOT_FOUND"}
        )

    try:
        verification = await community_service.admin_reject_verification(
            db,
            verification=v,
            admin_id=current_user.user_id,
            rejection_reason=body.rejection_reason,
        )
        await db.commit()
    except CommunityError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})

    return _verification_to_dict(verification)


@router.get("/list")
async def admin_list_communities(
    current_user: AuthUser,
    db: DBSession,
    include_inactive: bool = Query(False),
):
    q = select(Community)
    if not include_inactive:
        q = q.where(Community.is_active.is_(True))
    q = q.order_by(Community.city, Community.name).limit(500)
    res = await db.execute(q)
    cs = list(res.scalars().all())
    return {
        "communities": [_community_to_dict(c) for c in cs],
        "count": len(cs),
    }


@router.post("", status_code=201)
async def admin_create_community(
    body: CreateCommunityRequest,
    current_user: AuthUser,
    db: DBSession,
):
    # Uniqueness check
    res = await db.execute(
        select(Community).where(
            (Community.name == body.name) | (Community.slug == body.slug)
        )
    )
    existing = res.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "COMMUNITY_EXISTS",
                "message": "A community with this name or slug already exists.",
            },
        )

    c = Community(
        name=body.name,
        slug=body.slug,
        type=body.type,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        is_active=True,
        member_count=0,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    logger.info(
        "community.admin_created",
        community_id=str(c.id),
        admin_id=str(current_user.user_id),
    )
    return _community_to_dict(c)


@router.post("/{community_id}/safe-meetup-points", status_code=201)
async def admin_add_safe_meetup_point(
    community_id: UUID,
    body: CreateSafeMeetupPointRequest,
    current_user: AuthUser,
    db: DBSession,
):
    res = await db.execute(select(Community).where(Community.id == community_id))
    c = res.scalar_one_or_none()
    if c is None:
        raise HTTPException(
            status_code=404, detail={"error": "COMMUNITY_NOT_FOUND"}
        )

    p = SafeMeetupPoint(
        community_id=c.id,
        name=body.name,
        notes=body.notes,
        sort_order=body.sort_order,
        is_active=True,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    logger.info(
        "community.safe_meetup_point_added",
        community_id=str(c.id),
        point_id=str(p.id),
        admin_id=str(current_user.user_id),
    )
    return {
        "id": str(p.id),
        "community_id": str(p.community_id),
        "name": p.name,
        "notes": p.notes,
        "sort_order": p.sort_order,
    }
