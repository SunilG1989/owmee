"""
Admin reports and disputes router — Epic 6

POST /v1/reports/listing/{listing_id}    — report a listing (basic)
POST /v1/reports/user/{user_id}          — report a user (basic)
GET  /v1/admin/reports                   — ops queue (no auth for MVP dev)
POST /v1/admin/reports/{id}/resolve      — resolve a report

POST /v1/disputes                        — raise dispute on transaction (verified)
GET  /v1/disputes/{id}                   — get dispute detail (verified, own)
GET  /v1/admin/disputes                  — ops queue
POST /v1/admin/disputes/{id}/resolve     — ops resolves dispute
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.core.admin_dependencies import (
    AdminAny,
    CurrentAdmin,
    require_admin_roles,
)
from app.core.dependencies import BasicUser, DBSession, VerifiedUser
from app.modules.admin.models import Dispute, UserBlock, UserReport
from app.modules.disputes.resolution import apply_dispute_resolution
from app.modules.listings.models import Listing

# Resolving a dispute moves money (refund) or releases payout, so it requires a
# senior, money-capable role — not any logged-in admin. SUPER_ADMIN is always
# admitted by the factory.
require_dispute_resolver = require_admin_roles("L2_REVIEWER", "FINANCE_OPS")

logger = structlog.get_logger()
router = APIRouter()


# ── Schemas ─────────────────────────────────────────────────────────────────────

VALID_REPORT_TYPES = {"spam", "fraud", "inappropriate", "wrong_category", "counterfeit", "harassment", "other"}
VALID_DISPUTE_REASONS = {"item_not_received", "item_not_as_described", "payment_issue", "seller_no_show", "other"}
VALID_RESOLUTIONS = {"full_refund", "full_release", "partial_refund", "dismissed"}


class ReportListingRequest(BaseModel):
    report_type: str
    description: str | None = Field(None, max_length=500)


class ReportUserRequest(BaseModel):
    report_type: str
    description: str | None = Field(None, max_length=500)


class RaiseDisputeRequest(BaseModel):
    transaction_id: UUID
    reason: str
    description: str = Field(..., min_length=10, max_length=1000)
    # P0.4 (2026-05-03) — mobile sends 1-3 photo URIs. The handler resolves
    # them to R2 keys (or stores raw URIs if no presigned-URL flow yet).
    photo_uris: list[str] | None = Field(default=None, max_length=3)


class ResolveReportRequest(BaseModel):
    resolution_note: str = Field(..., min_length=5, max_length=500)


class ResolveDisputeRequest(BaseModel):
    resolution: str
    resolution_note: str = Field(..., min_length=5, max_length=500)
    # Required for partial_refund; ignored otherwise. Rupees (not paise).
    refund_amount_inr: Decimal | None = Field(default=None, gt=0)


# ── Report endpoints ─────────────────────────────────────────────────────────────

@router.post("/reports/listing/{listing_id}", status_code=status.HTTP_201_CREATED)
async def report_listing(
    listing_id: UUID,
    body: ReportListingRequest,
    current_user: BasicUser,
    db: DBSession,
):
    if body.report_type not in VALID_REPORT_TYPES:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_REPORT_TYPE",
            "valid": list(VALID_REPORT_TYPES),
        })
    # Verify listing exists
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})
    # Can't report your own listing
    if listing.seller_id == current_user.user_id:
        raise HTTPException(status_code=400, detail={"error": "CANNOT_REPORT_OWN_LISTING"})

    report = UserReport(
        reporter_id=current_user.user_id,
        reported_listing_id=listing_id,
        report_type=body.report_type,
        description=body.description,
    )
    db.add(report)
    await db.commit()
    logger.info("report.listing_created", listing_id=str(listing_id), type=body.report_type)
    return {"report_id": str(report.id), "message": "Report submitted. Our team will review it."}


@router.post("/reports/user/{reported_user_id}", status_code=status.HTTP_201_CREATED)
async def report_user(
    reported_user_id: UUID,
    body: ReportUserRequest,
    current_user: BasicUser,
    db: DBSession,
):
    if body.report_type not in VALID_REPORT_TYPES:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_REPORT_TYPE",
            "valid": list(VALID_REPORT_TYPES),
        })
    if reported_user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail={"error": "CANNOT_REPORT_YOURSELF"})

    report = UserReport(
        reporter_id=current_user.user_id,
        reported_user_id=reported_user_id,
        report_type=body.report_type,
        description=body.description,
    )
    db.add(report)
    await db.commit()
    logger.info("report.user_created", reported_user_id=str(reported_user_id), type=body.report_type)
    return {"report_id": str(report.id), "message": "Report submitted. Our team will review it."}


@router.post("/reports/user/{blocked_user_id}/block", status_code=status.HTTP_201_CREATED)
async def block_user(
    blocked_user_id: UUID,
    current_user: BasicUser,
    db: DBSession,
):
    """
    Fix #17: Block a user — their listings hidden from blocker's browse.
    Stores a row in user_blocks table. Browse queries filter blocked sellers.
    """
    if blocked_user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail={"error": "CANNOT_BLOCK_YOURSELF"})

    # Check if already blocked
    existing = await db.execute(
        select(UserBlock).where(
            UserBlock.blocker_id == current_user.user_id,
            UserBlock.blocked_id == blocked_user_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Already blocked."}

    block = UserBlock(blocker_id=current_user.user_id, blocked_id=blocked_user_id)
    db.add(block)
    await db.commit()
    logger.info("user.blocked", blocker=str(current_user.user_id), blocked=str(blocked_user_id))
    return {"message": "User blocked. Their listings will no longer appear for you."}


@router.get("/admin/reports")
async def get_reports_queue(admin: AdminAny, db: DBSession, status_filter: str = "open"):
    result = await db.execute(
        select(UserReport)
        .where(UserReport.status == status_filter)
        .order_by(UserReport.created_at.asc())
    )
    reports = result.scalars().all()
    return {"count": len(reports), "reports": [
        {
            "id": str(r.id),
            "reporter_id": str(r.reporter_id),
            "reported_user_id": str(r.reported_user_id) if r.reported_user_id else None,
            "reported_listing_id": str(r.reported_listing_id) if r.reported_listing_id else None,
            "report_type": r.report_type,
            "description": r.description,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
        }
        for r in reports
    ]}


@router.post("/admin/reports/{report_id}/resolve")
async def resolve_report(report_id: UUID, body: ResolveReportRequest, admin: AdminAny, db: DBSession):
    result = await db.execute(select(UserReport).where(UserReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})
    report.status = "resolved"
    report.resolved_at = datetime.now(timezone.utc)
    report.resolution_note = body.resolution_note
    await db.commit()
    return {"report_id": str(report_id), "status": "resolved"}


# ── Dispute endpoints ─────────────────────────────────────────────────────────────

@router.post("/disputes", status_code=status.HTTP_201_CREATED)
async def raise_dispute(body: RaiseDisputeRequest, current_user: VerifiedUser, db: DBSession):
    if body.reason not in VALID_DISPUTE_REASONS:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_REASON",
            "valid": list(VALID_DISPUTE_REASONS),
        })

    from app.modules.offers.models import Transaction
    result = await db.execute(
        select(Transaction).where(Transaction.id == body.transaction_id)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "TRANSACTION_NOT_FOUND"})
    if txn.buyer_id != current_user.user_id and txn.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "FORBIDDEN"})
    # Check for existing dispute FIRST (before status check)
    existing = await db.execute(
        select(Dispute).where(Dispute.transaction_id == body.transaction_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail={"error": "DISPUTE_ALREADY_EXISTS"})

    if txn.status not in (
        "payment_captured",
        "at_hub",
        "delivery_in_progress",
        "delivered",
        "awaiting_confirmation",
        "completed",
        "disputed",
    ):
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_STATUS",
            "message": "Disputes can only be raised on active or completed transactions.",
        })

    now = datetime.now(timezone.utc)
    # P0.4 — store raw URIs verbatim until the presigned-URL flow lands.
    # When that ships (mirroring listings/{id}/images/request), this becomes
    # an upload + r2_key extraction step before the Dispute insert.
    photo_keys = body.photo_uris if body.photo_uris else None
    dispute = Dispute(
        transaction_id=body.transaction_id,
        raised_by=current_user.user_id,
        reason=body.reason,
        description=body.description,
        photo_keys=photo_keys,
        status="opened",
        review_deadline=now + timedelta(hours=48),
    )
    db.add(dispute)

    # Freeze transaction
    txn.status = "disputed"
    txn.dispute_id = dispute.id

    await db.commit()
    logger.info("dispute.raised", transaction_id=str(body.transaction_id))
    return {
        "dispute_id": str(dispute.id),
        "status": "opened",
        "message": "Dispute raised. Our team will review within 48 hours.",
        "review_deadline": dispute.review_deadline.isoformat(),
    }


@router.get("/disputes/{dispute_id}")
async def get_dispute(dispute_id: UUID, current_user: VerifiedUser, db: DBSession):
    result = await db.execute(select(Dispute).where(Dispute.id == dispute_id))
    dispute = result.scalar_one_or_none()
    if not dispute:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})
    # Only parties to the transaction can see the dispute
    from app.modules.offers.models import Transaction
    txn_result = await db.execute(
        select(Transaction).where(Transaction.id == dispute.transaction_id)
    )
    txn = txn_result.scalar_one_or_none()
    if not txn or (txn.buyer_id != current_user.user_id and txn.seller_id != current_user.user_id):
        raise HTTPException(status_code=403, detail={"error": "FORBIDDEN"})
    return {
        "id": str(dispute.id),
        "transaction_id": str(dispute.transaction_id),
        "raised_by": str(dispute.raised_by),
        "reason": dispute.reason,
        "description": dispute.description,
        "status": dispute.status,
        "resolution": dispute.resolution,
        "review_deadline": dispute.review_deadline.isoformat() if dispute.review_deadline else None,
        "resolved_at": dispute.resolved_at.isoformat() if dispute.resolved_at else None,
        "created_at": dispute.created_at.isoformat(),
    }


@router.get("/admin/disputes")
async def get_disputes_queue(admin: AdminAny, db: DBSession, status_filter: str = "opened"):
    result = await db.execute(
        select(Dispute)
        .where(Dispute.status == status_filter)
        .order_by(Dispute.created_at.asc())
    )
    disputes = result.scalars().all()
    return {"count": len(disputes), "disputes": [
        {
            "id": str(d.id),
            "transaction_id": str(d.transaction_id),
            "raised_by": str(d.raised_by),
            "reason": d.reason,
            "status": d.status,
            "review_deadline": d.review_deadline.isoformat() if d.review_deadline else None,
            "created_at": d.created_at.isoformat(),
        }
        for d in disputes
    ]}


@router.post("/admin/disputes/{dispute_id}/resolve")
async def resolve_dispute(
    dispute_id: UUID,
    body: ResolveDisputeRequest,
    db: DBSession,
    admin: CurrentAdmin = Depends(require_dispute_resolver),
):
    if body.resolution not in VALID_RESOLUTIONS:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_RESOLUTION",
            "valid": list(VALID_RESOLUTIONS),
        })
    if body.resolution == "partial_refund" and (
        body.refund_amount_inr is None or body.refund_amount_inr <= 0
    ):
        raise HTTPException(status_code=400, detail={
            "error": "PARTIAL_REFUND_AMOUNT_REQUIRED",
            "message": "partial_refund requires a positive refund_amount_inr.",
        })

    result = await db.execute(select(Dispute).where(Dispute.id == dispute_id))
    dispute = result.scalar_one_or_none()
    if not dispute:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})
    if dispute.status == "resolved":
        raise HTTPException(status_code=409, detail={"error": "ALREADY_RESOLVED"})

    from app.modules.offers.models import Transaction
    from app.modules.transactions.refund_service import INITIATED_BY_ADMIN

    txn = (await db.execute(
        select(Transaction).where(Transaction.id == dispute.transaction_id)
    )).scalar_one_or_none()

    # A partial refund must not exceed what was charged.
    if (
        body.resolution == "partial_refund"
        and txn is not None
        and body.refund_amount_inr > Decimal(str(txn.gross_amount or 0))
    ):
        raise HTTPException(status_code=400, detail={
            "error": "REFUND_EXCEEDS_GROSS",
            "message": "Partial refund cannot exceed the amount charged.",
        })

    outcome = await apply_dispute_resolution(
        db,
        dispute=dispute,
        txn=txn,
        resolution=body.resolution,
        resolution_note=body.resolution_note,
        refund_amount=body.refund_amount_inr,
        initiated_by=INITIATED_BY_ADMIN,
    )

    await db.commit()
    logger.info(
        "dispute.resolved",
        dispute_id=str(dispute_id),
        resolution=body.resolution,
        refund_status=outcome["refund_status"],
        admin_id=str(admin.admin_id),
    )
    return {
        "dispute_id": str(dispute_id),
        "status": "resolved",
        "resolution": body.resolution,
        "refund_status": outcome["refund_status"],
    }
