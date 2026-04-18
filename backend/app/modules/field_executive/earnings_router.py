"""FE earnings service + admin router — Sprint 4 / Pass 4c.

Earnings are recorded at visit completion. Admin dashboard shows monthly
aggregates per FE + per-visit detail.

Integration pattern: the FE submit-outcome / submit-listing flow (in
field_executive/router.py) imports record_earning() and calls it inside
the same DB transaction that closes the visit. This way an earning exists
iff the visit reached a payout-eligible outcome.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_dependencies import AdminAny, AdminFinance
from app.core.dependencies import DBSession

logger = structlog.get_logger(__name__)


# ── Per-outcome payout amounts (paise) — config, not DB for now ──────────────
# Listed visit pays full fee; rejected / pickup-not-ready pay a lower trip fee.
OUTCOME_AMOUNTS_PAISE: dict[str, int] = {
    "listed":                       30000,   # ₹300
    "rejected_item":                10000,   # ₹100 (trip fee)
    "seller_missing_verification":  10000,   # ₹100 (trip fee)
    "pickup_not_ready":             10000,   # ₹100 (trip fee)
}


async def record_earning(
    db: AsyncSession,
    *,
    fe_id: uuid.UUID,
    visit_id: uuid.UUID,
    outcome: str,
) -> Optional[object]:
    """Record an earning row for a completed visit. Idempotent by visit_id.

    Caller is responsible for commit(). Returns the FEEarning row, or None
    if outcome isn't in the payout rubric.
    """
    if outcome not in OUTCOME_AMOUNTS_PAISE:
        logger.info("fe_earnings.skipped", reason="outcome_not_payable", outcome=outcome)
        return None

    from app.modules.field_executive.models import FEEarning

    # Idempotent: if already recorded for this visit, return existing
    res = await db.execute(
        select(FEEarning).where(FEEarning.visit_id == visit_id)
    )
    existing = res.scalar_one_or_none()
    if existing is not None:
        return existing

    amount = OUTCOME_AMOUNTS_PAISE[outcome]
    row = FEEarning(
        fe_id=fe_id,
        visit_id=visit_id,
        amount_paise=amount,
        outcome=outcome,
    )
    db.add(row)
    await db.flush()
    logger.info(
        "fe_earnings.recorded",
        fe_id=str(fe_id), visit_id=str(visit_id),
        outcome=outcome, amount_paise=amount,
    )
    return row


# ── Schemas ──────────────────────────────────────────────────────────────────

class FEEarningItem(BaseModel):
    id: str
    visit_id: str
    amount_paise: int
    outcome: str
    earned_at: str
    payout_status: str


class FEMonthlyAggregate(BaseModel):
    fe_id: str
    fe_code: str
    fe_name: Optional[str] = None
    month: str  # "2026-04"
    visits_count: int
    total_paise: int
    total_rupees: int
    by_outcome: dict  # {outcome: count}


class FEEarningsResponse(BaseModel):
    month: str
    aggregates: list[FEMonthlyAggregate]
    grand_total_paise: int


# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(tags=["admin-fe-earnings"])


@router.get("/monthly", response_model=FEEarningsResponse)
async def fe_earnings_monthly(
    _: AdminFinance,
    db: DBSession,
    month: Optional[str] = Query(None, description="YYYY-MM; defaults to current month"),
):
    from app.modules.field_executive.models import FEEarning, FieldExecutive

    if month is None:
        today = datetime.now(timezone.utc)
        month = f"{today.year:04d}-{today.month:02d}"

    try:
        yr, mo = month.split("-")
        yr, mo = int(yr), int(mo)
        start = datetime(yr, mo, 1, tzinfo=timezone.utc)
        if mo == 12:
            end = datetime(yr + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end = datetime(yr, mo + 1, 1, tzinfo=timezone.utc)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_MONTH",
            "message": "month must be YYYY-MM (e.g., 2026-04)."
        })

    # Per-FE aggregates
    agg_q = (
        select(
            FEEarning.fe_id,
            FieldExecutive.fe_code,
            func.count(FEEarning.id).label("visits_count"),
            func.sum(FEEarning.amount_paise).label("total_paise"),
        )
        .join(FieldExecutive, FieldExecutive.id == FEEarning.fe_id)
        .where(FEEarning.earned_at >= start, FEEarning.earned_at < end)
        .group_by(FEEarning.fe_id, FieldExecutive.fe_code)
        .order_by(func.sum(FEEarning.amount_paise).desc())
    )
    agg_rows = (await db.execute(agg_q)).all()

    # Per-FE per-outcome counts
    outcome_q = (
        select(
            FEEarning.fe_id,
            FEEarning.outcome,
            func.count(FEEarning.id).label("c"),
        )
        .where(FEEarning.earned_at >= start, FEEarning.earned_at < end)
        .group_by(FEEarning.fe_id, FEEarning.outcome)
    )
    outcome_rows = (await db.execute(outcome_q)).all()
    by_outcome_map: dict[uuid.UUID, dict[str, int]] = {}
    for fe_id, outcome, c in outcome_rows:
        by_outcome_map.setdefault(fe_id, {})[outcome] = c

    aggregates = []
    grand_total = 0
    for fe_id, fe_code, vc, total_paise in agg_rows:
        total_paise = int(total_paise or 0)
        grand_total += total_paise
        aggregates.append(FEMonthlyAggregate(
            fe_id=str(fe_id),
            fe_code=fe_code,
            month=month,
            visits_count=int(vc or 0),
            total_paise=total_paise,
            total_rupees=total_paise // 100,
            by_outcome=by_outcome_map.get(fe_id, {}),
        ))

    return FEEarningsResponse(
        month=month,
        aggregates=aggregates,
        grand_total_paise=grand_total,
    )


@router.get("/fe/{fe_id}", response_model=list[FEEarningItem])
async def fe_earnings_detail(
    fe_id: str,
    _: AdminFinance,
    db: DBSession,
    limit: int = Query(100, ge=1, le=500),
):
    from app.modules.field_executive.models import FEEarning

    try:
        uid = uuid.UUID(fe_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_ID", "message": "fe_id must be a UUID"})

    res = await db.execute(
        select(FEEarning)
        .where(FEEarning.fe_id == uid)
        .order_by(FEEarning.earned_at.desc())
        .limit(limit)
    )
    rows = list(res.scalars().all())
    return [FEEarningItem(
        id=str(r.id),
        visit_id=str(r.visit_id),
        amount_paise=r.amount_paise,
        outcome=r.outcome,
        earned_at=r.earned_at.isoformat(),
        payout_status=r.payout_status,
    ) for r in rows]
