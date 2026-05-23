from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, or_, select

from app.core.admin_dependencies import require_risk_analyst
from app.core.dependencies import BasicUser, DBSession
from app.modules.verification.models import RiskDecision, VerificationCheck
from app.modules.verification.service import VALID_ACTIONS, build_trust_summary, record_risk_decision

router = APIRouter()
admin_router = APIRouter()


@router.get("/me/trust-summary")
async def trust_summary(current_user: BasicUser, db: DBSession):
    """Return product-safe trust state for mobile/admin surfaces.

    This endpoint exposes Owmee badges and normalized verification state, not
    raw provider payloads.
    """
    return await build_trust_summary(db, current_user.user_id)


def _risk_decision_item(row: RiskDecision) -> dict:
    return {
        "id": str(row.id),
        "user_id": str(row.user_id),
        "applies_to": row.applies_to,
        "decision": row.decision,
        "risk_band": row.risk_band,
        "reason_codes": row.reason_codes or [],
        "message": row.message,
        "metadata": row.metadata_ or {},
        "valid_until": row.valid_until.isoformat() if row.valid_until else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@admin_router.get("/risk-queue", dependencies=[Depends(require_risk_analyst)])
async def risk_review_queue(
    db: DBSession,
    decision: str | None = Query(None, pattern="^(step_up|manual_review|block)$"),
):
    """Risk analyst queue for Bureau/internal manual review outcomes."""
    now = datetime.now(timezone.utc)
    q = select(RiskDecision).where(
        RiskDecision.decision.in_([decision] if decision else ["step_up", "manual_review", "block"]),
        or_(RiskDecision.valid_until.is_(None), RiskDecision.valid_until > now),
    ).order_by(desc(RiskDecision.created_at)).limit(200)
    result = await db.execute(q)
    rows = result.scalars().all()
    return {"count": len(rows), "items": [_risk_decision_item(row) for row in rows]}


class AdminRiskDecisionRequest(BaseModel):
    action: str = Field("global")
    decision: str = Field(..., pattern="^(allow|step_up|manual_review|block)$")
    reason_code: str = Field(..., min_length=2, max_length=80)
    message: str = Field("", max_length=300)
    valid_days: int = Field(30, ge=1, le=180)
    notes: str = Field("", max_length=500)


@admin_router.post("/users/{user_id}/risk-decision", dependencies=[Depends(require_risk_analyst)])
async def set_admin_risk_decision(
    user_id: UUID,
    body: AdminRiskDecisionRequest,
    db: DBSession,
):
    """Manual risk override for false positives, blocks, and step-up cases."""
    if body.action not in VALID_ACTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "INVALID_ACTION", "valid_actions": sorted(VALID_ACTIONS)},
        )

    check = await record_verification_check_for_admin(
        db,
        user_id=user_id,
        action=body.action,
        decision=body.decision,
        reason_code=body.reason_code,
        notes=body.notes,
        valid_days=body.valid_days,
    )
    row = await record_risk_decision(
        db,
        user_id=user_id,
        applies_to=body.action,
        decision=body.decision,
        source_check_id=check.id,
        risk_band="medium",
        reason_codes=[body.reason_code],
        message=body.message or body.reason_code,
        metadata={"notes": body.notes, "source": "admin"},
        valid_until=datetime.now(timezone.utc) + timedelta(days=body.valid_days),
    )
    await db.commit()
    return _risk_decision_item(row)


async def record_verification_check_for_admin(
    db,
    *,
    user_id: UUID,
    action: str,
    decision: str,
    reason_code: str,
    notes: str,
    valid_days: int,
) -> VerificationCheck:
    from app.modules.verification.service import record_verification_check

    return await record_verification_check(
        db,
        user_id=user_id,
        check_type="manual_risk_review",
        provider="owmee",
        status="passed" if decision == "allow" else "manual_review",
        applies_to=action,
        risk_band="medium",
        reason_codes=[reason_code],
        metadata={"notes": notes, "decision": decision},
        expires_at=datetime.now(timezone.utc) + timedelta(days=valid_days),
    )
