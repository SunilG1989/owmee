"""
Admin listings moderation queue — Epic 3 + Sprint 4 Pass 3 (3g).

Endpoints:
  GET  /v1/admin/listings/queue             — pending_moderation items, optional ?source filter
  POST /v1/admin/listings/{id}/approve      — approve listing → active, stamps ops review
  POST /v1/admin/listings/{id}/reject       — reject listing with flag, stamps ops review
  GET  /v1/admin/listings/fe-assisted       — all fe_assisted listings (any status)

Pass 3 changes:
  - Real AdminL2 dep (drops the kyc-queue-era stub)
  - ?source filter supports self_prep | fe_assisted | all (default: all)
  - approve/reject now stamp reviewed_by='fe_and_ops' (when approving an fe_assisted
    listing), ops_reviewed_at=now(), ops_reviewer_id=current_admin.admin_id
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
import structlog

from app.core.admin_dependencies import AdminAny, AdminL2
from app.core.dependencies import DBSession
from app.modules.listings.models import Listing
from app.modules.listings.service import approve_listing, reject_listing

router = APIRouter()
logger = structlog.get_logger()


class RejectRequest(BaseModel):
    flag: str
    reason: str = ""


def _item_dict(l: Listing) -> dict:
    return {
        "listing_id": str(l.id),
        "seller_id": str(l.seller_id),
        "title": l.title,
        "price": str(l.price),
        "condition": l.condition,
        "city": l.city,
        "status": l.status,
        "moderation_status": l.moderation_status,
        "moderation_flag": l.moderation_flag,
        "image_urls": l.image_urls or [],
        "published_at": l.published_at.isoformat() if l.published_at else None,
        "listing_source": l.listing_source,
        "reviewed_by": l.reviewed_by,
        "fe_visit_id": str(l.fe_visit_id) if l.fe_visit_id else None,
        "is_kids_item": l.is_kids_item,
        "kids_safety_checklist": l.kids_safety_checklist,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }


@router.get("/queue")
async def get_moderation_queue(
    current_admin: AdminAny,
    db: DBSession,
    source: Optional[str] = Query(None, pattern="^(self_prep|fe_assisted|all)$"),
):
    """Return listings in pending_moderation, oldest first. Filter by source."""
    q = select(Listing).where(Listing.status == "pending_moderation")
    if source and source != "all":
        q = q.where(Listing.listing_source == source)
    q = q.order_by(Listing.published_at.asc().nullsfirst(), Listing.created_at.asc())
    result = await db.execute(q)
    listings = result.scalars().all()
    return {
        "count": len(listings),
        "source_filter": source or "all",
        "items": [_item_dict(l) for l in listings],
    }


@router.get("/fe-assisted")
async def list_fe_assisted(
    current_admin: AdminAny,
    db: DBSession,
    status_filter: Optional[str] = Query(None),
):
    """List all fe_assisted listings regardless of moderation status."""
    q = select(Listing).where(Listing.listing_source == "fe_assisted")
    if status_filter:
        q = q.where(Listing.status == status_filter)
    q = q.order_by(Listing.created_at.desc()).limit(200)
    result = await db.execute(q)
    listings = result.scalars().all()
    return {
        "count": len(listings),
        "status_filter": status_filter,
        "items": [_item_dict(l) for l in listings],
    }


@router.post("/{listing_id}/approve")
async def approve(
    listing_id: UUID,
    current_admin: AdminL2,
    db: DBSession,
):
    """Approve a listing — moves it to active and stamps ops review."""
    try:
        listing = await approve_listing(db, listing_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})

    # Stamp ops review (Pass 3). If the listing was reviewed_by='fe', becomes 'fe_and_ops'.
    prior_reviewed_by = listing.reviewed_by or "none"
    if prior_reviewed_by == "fe":
        listing.reviewed_by = "fe_and_ops"
    else:
        listing.reviewed_by = "ops"
    listing.ops_reviewed_at = datetime.now(timezone.utc)
    listing.ops_reviewer_id = current_admin.admin_id

    await db.commit()
    logger.info(
        "admin.listing.approved",
        listing_id=str(listing_id),
        admin_id=str(current_admin.admin_id),
        prior_reviewed_by=prior_reviewed_by,
        reviewed_by=listing.reviewed_by,
        listing_source=listing.listing_source,
    )
    return {
        "listing_id": str(listing_id),
        "status": "active",
        "reviewed_by": listing.reviewed_by,
        "ops_reviewer_id": str(listing.ops_reviewer_id),
        "ops_reviewed_at": listing.ops_reviewed_at.isoformat(),
    }


@router.post("/{listing_id}/reject")
async def reject(
    listing_id: UUID,
    body: RejectRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    """Reject a listing with a flag reason. Stamps ops review."""
    try:
        listing = await reject_listing(db, listing_id, body.flag)
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})

    prior_reviewed_by = listing.reviewed_by or "none"
    if prior_reviewed_by == "fe":
        listing.reviewed_by = "fe_and_ops"
    else:
        listing.reviewed_by = "ops"
    listing.ops_reviewed_at = datetime.now(timezone.utc)
    listing.ops_reviewer_id = current_admin.admin_id

    await db.commit()
    logger.info(
        "admin.listing.rejected",
        listing_id=str(listing_id),
        admin_id=str(current_admin.admin_id),
        flag=body.flag,
        reason=body.reason,
    )
    return {
        "listing_id": str(listing_id),
        "status": "removed",
        "flag": body.flag,
        "reviewed_by": listing.reviewed_by,
        "ops_reviewer_id": str(listing.ops_reviewer_id),
        "ops_reviewed_at": listing.ops_reviewed_at.isoformat(),
    }
