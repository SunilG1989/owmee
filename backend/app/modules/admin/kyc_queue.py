"""
Admin KYC review queue — Epic 2

Endpoints (all require admin JWT, not user JWT):
  GET  /v1/admin/kyc/queue              — pending_review items
  GET  /v1/admin/kyc/{user_id}          — full KYC detail for a user
  POST /v1/admin/kyc/{user_id}/approve  — L2: approve with optional notes
  POST /v1/admin/kyc/{user_id}/reject   — L2: reject with reason code
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
import structlog

from app.core.dependencies import DBSession
from app.modules.kyc.models import KYCVerification, KYCEvent
from app.modules.kyc.service import update_user_kyc_status, record_kyc_event

router = APIRouter()
logger = structlog.get_logger()

# TODO: replace with proper admin JWT middleware (Phase 1 exit gate)
# For now: stub dependency that accepts any request in dev
async def require_l2_reviewer():
    pass


class KYCDecisionRequest(BaseModel):
    notes: str = ""
    rejection_reason: str | None = None


@router.get("/queue")
async def get_kyc_queue(db: DBSession):
    """Return all KYC verifications in pending_review state."""
    result = await db.execute(
        select(KYCVerification).where(
            KYCVerification.kyc_status == "pending_review"
        ).order_by(KYCVerification.created_at.asc())
    )
    verifications = result.scalars().all()
    return {
        "count": len(verifications),
        "items": [
            {
                "user_id": str(v.user_id),
                "verification_id": str(v.id),
                "name_match_score": v.name_match_score,
                "name_match_result": v.name_match_result,
                "aadhaar_state_ut": v.aadhaar_state_ut,
                "pan_number_masked": v.pan_number_masked,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in verifications
        ],
    }


@router.get("/{user_id}")
async def get_kyc_detail(user_id: str, db: DBSession):
    """Return KYC verification detail for a specific user (masked fields only)."""
    from uuid import UUID
    result = await db.execute(
        select(KYCVerification).where(KYCVerification.user_id == UUID(user_id))
    )
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="KYC verification not found")

    events_result = await db.execute(
        select(KYCEvent).where(KYCEvent.verification_id == v.id).order_by(KYCEvent.created_at.asc())
    )
    events = events_result.scalars().all()

    return {
        "user_id": user_id,
        "kyc_status": v.kyc_status,
        "aadhaar_verified": v.aadhaar_verified,
        "aadhaar_name_masked": v.aadhaar_name_masked,
        "aadhaar_dob": v.aadhaar_dob,
        "aadhaar_gender": v.aadhaar_gender,
        "aadhaar_state_ut": v.aadhaar_state_ut,
        "pan_number_masked": v.pan_number_masked,
        "pan_verified": v.pan_verified,
        "pan_aadhaar_linked": v.pan_aadhaar_linked,
        "pan_name": v.pan_name,
        "name_match_score": v.name_match_score,
        "name_match_result": v.name_match_result,
        "liveness_verified": v.liveness_verified,
        "payout_verified": v.payout_verified,
        "rejection_reason": v.rejection_reason,
        "reviewer_notes": v.reviewer_notes,
        "event_log": [
            {
                "event_type": e.event_type,
                "step": e.step,
                "result": e.result,
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ],
    }


@router.post("/{user_id}/approve", dependencies=[Depends(require_l2_reviewer)])
async def approve_kyc(user_id: str, body: KYCDecisionRequest, db: DBSession):
    """L2 reviewer: approve a KYC in pending_review state."""
    from uuid import UUID
    uid = UUID(user_id)

    result = await db.execute(
        select(KYCVerification).where(KYCVerification.user_id == uid)
    )
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="KYC not found")
    if v.kyc_status != "pending_review":
        raise HTTPException(
            status_code=400,
            detail={"error": "INVALID_STATE", "message": f"KYC is {v.kyc_status}, not pending_review"},
        )

    v.kyc_status = "verified"
    v.reviewer_notes = body.notes
    from datetime import datetime, timezone
    v.reviewed_at = datetime.now(timezone.utc)
    v.completed_at = datetime.now(timezone.utc)

    await record_kyc_event(
        db, v.id, uid,
        event_type="admin_kyc_approved",
        result="verified",
        payload={"notes": body.notes},
    )
    await update_user_kyc_status(db, uid, "verified")
    logger.info("admin.kyc.approved", user_id=user_id)
    return {"status": "verified"}


@router.post("/{user_id}/reject", dependencies=[Depends(require_l2_reviewer)])
async def reject_kyc(user_id: str, body: KYCDecisionRequest, db: DBSession):
    """L2 reviewer: reject a KYC with reason code."""
    from uuid import UUID
    uid = UUID(user_id)

    result = await db.execute(
        select(KYCVerification).where(KYCVerification.user_id == uid)
    )
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="KYC not found")

    reason = body.rejection_reason or "MANUAL_REVIEW_REJECTED"
    v.kyc_status = "rejected"
    v.rejection_reason = reason
    v.reviewer_notes = body.notes
    from datetime import datetime, timezone
    v.reviewed_at = datetime.now(timezone.utc)

    await record_kyc_event(
        db, v.id, uid,
        event_type="admin_kyc_rejected",
        result="rejected",
        payload={"reason": reason, "notes": body.notes},
    )
    await update_user_kyc_status(db, uid, "rejected")
    logger.info("admin.kyc.rejected", user_id=user_id, reason=reason)
    return {"status": "rejected", "reason": reason}
