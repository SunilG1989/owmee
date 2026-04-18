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
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.core.dependencies import BasicUser, DBSession, VerifiedUser
from app.modules.listings.models import Listing

logger = structlog.get_logger()
router = APIRouter()


# ── Models (inline to avoid circular imports) ──────────────────────────────────
# These reference tables created in migration 0003_epic5_6

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from app.db.session import Base
import uuid as uuid_lib


class UserReport(Base):
    __tablename__ = "user_reports"
    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid_lib.uuid4)
    reporter_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reported_user_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reported_listing_id = Column(PG_UUID(as_uuid=True), ForeignKey("listings.id"), nullable=True)
    report_type = Column(String(30), nullable=False)
    description = Column(String(500))
    status = Column(String(20), nullable=False, default="open")
    resolved_by = Column(PG_UUID(as_uuid=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=__import__('sqlalchemy').text("now()"))


class Dispute(Base):
    __tablename__ = "disputes"
    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid_lib.uuid4)
    transaction_id = Column(PG_UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=False, unique=True)
    raised_by = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reason = Column(String(50), nullable=False)
    description = Column(String(1000), nullable=False)
    status = Column(String(30), nullable=False, default="opened")
    resolution = Column(String(30), nullable=True)
    resolution_note = Column(String(500), nullable=True)
    assigned_to = Column(PG_UUID(as_uuid=True), nullable=True)
    evidence_archived_at = Column(DateTime(timezone=True), nullable=True)
    review_deadline = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=__import__('sqlalchemy').text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=__import__('sqlalchemy').text("now()"))


class UserBlock(Base):
    """Fix #17: User blocks — blocker won't see blocked user's listings."""
    __tablename__ = "user_blocks"
    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid_lib.uuid4)
    blocker_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    blocked_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=__import__('sqlalchemy').text("now()"))


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


class ResolveReportRequest(BaseModel):
    resolution_note: str = Field(..., min_length=5, max_length=500)


class ResolveDisputeRequest(BaseModel):
    resolution: str
    resolution_note: str = Field(..., min_length=5, max_length=500)


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
async def get_reports_queue(db: DBSession, status_filter: str = "open"):
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
async def resolve_report(report_id: UUID, body: ResolveReportRequest, db: DBSession):
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

    if txn.status not in ("payment_captured", "awaiting_confirmation", "completed", "disputed"):
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_STATUS",
            "message": "Disputes can only be raised on active or completed transactions.",
        })

    now = datetime.now(timezone.utc)
    dispute = Dispute(
        transaction_id=body.transaction_id,
        raised_by=current_user.user_id,
        reason=body.reason,
        description=body.description,
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
async def get_disputes_queue(db: DBSession, status_filter: str = "opened"):
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
async def resolve_dispute(dispute_id: UUID, body: ResolveDisputeRequest, db: DBSession):
    if body.resolution not in VALID_RESOLUTIONS:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_RESOLUTION",
            "valid": list(VALID_RESOLUTIONS),
        })
    result = await db.execute(select(Dispute).where(Dispute.id == dispute_id))
    dispute = result.scalar_one_or_none()
    if not dispute:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})

    now = datetime.now(timezone.utc)
    dispute.status = "resolved"
    dispute.resolution = body.resolution
    dispute.resolution_note = body.resolution_note
    dispute.resolved_at = now

    # Update transaction status
    from app.modules.offers.models import Transaction
    txn_result = await db.execute(
        select(Transaction).where(Transaction.id == dispute.transaction_id)
    )
    txn = txn_result.scalar_one_or_none()
    if txn:
        if body.resolution in ("full_refund", "partial_refund"):
            txn.status = "refunded"
        elif body.resolution == "full_release":
            txn.status = "completed"
            txn.payout_flagged_at = now

    await db.commit()
    logger.info("dispute.resolved", dispute_id=str(dispute_id), resolution=body.resolution)
    return {"dispute_id": str(dispute_id), "status": "resolved", "resolution": body.resolution}
