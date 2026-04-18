"""
Field Executive service — Sprint 4 / Pass 3.

Pure-logic + async DB helpers for FE workflow transitions. All state changes
go through these functions so that admin endpoints, FE endpoints, seller
endpoints and Temporal activities all follow the same invariants.

Status state machine:
    requested  -> scheduled (admin assigns)
    requested  -> cancelled (seller cancels)
    scheduled  -> in_progress (FE starts)
    scheduled  -> cancelled   (admin/seller cancels before start)
    scheduled  -> postponed   (FE or admin postpones)
    in_progress -> completed | no_show | postponed

Pass 3: assign_fe now captures `category_id` so FE capture can submit a
listing without client-side category resolution.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.field_executive.models import FEVisit, FieldExecutive
from app.modules.identity_auth.models import User

logger = structlog.get_logger()


# ── Allowed transitions ───────────────────────────────────────────────────────

_ALLOWED_STATUS_TRANSITIONS = {
    "requested": {"scheduled", "cancelled"},
    "scheduled": {"in_progress", "cancelled", "postponed"},
    "in_progress": {"completed", "no_show", "postponed"},
    # Terminal states — no transitions out.
    "completed": set(),
    "cancelled": set(),
    "postponed": {"scheduled"},   # admin can re-schedule a postponed visit
    "no_show": set(),
}

_VALID_OUTCOMES = {
    "listed",
    "rejected_item",
    "seller_missing_verification",
    "pickup_not_ready",
    "postponed",
}


class IllegalVisitTransition(ValueError):
    pass


# ── FE CRUD ───────────────────────────────────────────────────────────────────

async def get_fe_by_user_id(
    db: AsyncSession, user_id: UUID
) -> Optional[FieldExecutive]:
    res = await db.execute(
        select(FieldExecutive).where(FieldExecutive.user_id == user_id)
    )
    return res.scalar_one_or_none()


async def is_active_fe(db: AsyncSession, user_id: UUID) -> bool:
    fe = await get_fe_by_user_id(db, user_id)
    return bool(fe and fe.active)


async def _next_fe_code(db: AsyncSession, city: str) -> str:
    """Produce next fe_code like FE-BLR-007 (3-letter city prefix, zero-pad to 3)."""
    prefix = (city[:3] or "XXX").upper()
    res = await db.execute(
        select(func.count(FieldExecutive.id)).where(FieldExecutive.city == city)
    )
    count = res.scalar_one() or 0
    return f"FE-{prefix}-{(count + 1):03d}"


async def create_fe_for_user(
    db: AsyncSession,
    user: User,
    city: str,
    created_by_admin_id: Optional[UUID] = None,
) -> FieldExecutive:
    existing = await get_fe_by_user_id(db, user.id)
    if existing:
        return existing

    code = await _next_fe_code(db, city)
    fe = FieldExecutive(
        user_id=user.id,
        fe_code=code,
        city=city,
        active=True,
        current_shift="off",
        created_by_admin_id=created_by_admin_id,
    )
    db.add(fe)
    await db.flush()
    logger.info("fe.created", user_id=str(user.id), fe_code=code, city=city)
    return fe


# ── Visit CRUD ────────────────────────────────────────────────────────────────

async def create_visit_request(
    db: AsyncSession,
    *,
    seller: User,
    requested_start: datetime,
    requested_end: datetime,
    address_snapshot: dict,
    category_hint: str,
    item_notes: Optional[str] = None,
) -> FEVisit:
    if requested_end <= requested_start:
        raise ValueError("requested_slot_end must be after requested_slot_start")

    visit = FEVisit(
        seller_id=seller.id,
        requested_slot_start=requested_start,
        requested_slot_end=requested_end,
        address_snapshot=address_snapshot,
        category_hint=category_hint,
        item_notes=item_notes,
        status="requested",
    )
    db.add(visit)
    await db.flush()
    logger.info(
        "fe_visit.requested",
        visit_id=str(visit.id),
        seller_id=str(seller.id),
        category=category_hint,
    )
    return visit


async def _apply_status_transition(
    visit: FEVisit, new_status: str
) -> None:
    allowed = _ALLOWED_STATUS_TRANSITIONS.get(visit.status, set())
    if new_status not in allowed:
        raise IllegalVisitTransition(
            f"Cannot transition visit from {visit.status} to {new_status}"
        )
    visit.status = new_status


async def assign_fe(
    db: AsyncSession,
    *,
    visit: FEVisit,
    fe: FieldExecutive,
    scheduled_start: datetime,
    scheduled_end: datetime,
    category_id: Optional[UUID] = None,
) -> FEVisit:
    if visit.status not in ("requested", "postponed"):
        raise IllegalVisitTransition(
            f"Can only assign from requested/postponed, not {visit.status}"
        )
    if scheduled_end <= scheduled_start:
        raise ValueError("scheduled_slot_end must be after scheduled_slot_start")
    if not fe.active:
        raise ValueError("Cannot assign to inactive FE")

    visit.fe_id = fe.id
    visit.scheduled_slot_start = scheduled_start
    visit.scheduled_slot_end = scheduled_end
    if category_id is not None:
        visit.category_id = category_id
    await _apply_status_transition(visit, "scheduled")
    logger.info(
        "fe_visit.assigned",
        visit_id=str(visit.id),
        fe_id=str(fe.id),
        fe_code=fe.fe_code,
        category_id=str(category_id) if category_id else None,
    )
    return visit


async def reassign_fe(
    db: AsyncSession,
    *,
    visit: FEVisit,
    new_fe: FieldExecutive,
    scheduled_start: Optional[datetime] = None,
    scheduled_end: Optional[datetime] = None,
    category_id: Optional[UUID] = None,
) -> FEVisit:
    if visit.status != "scheduled":
        raise IllegalVisitTransition(
            f"Can only reassign a scheduled visit, not {visit.status}"
        )
    if not new_fe.active:
        raise ValueError("Cannot reassign to inactive FE")

    visit.fe_id = new_fe.id
    if scheduled_start and scheduled_end:
        if scheduled_end <= scheduled_start:
            raise ValueError("scheduled_slot_end must be after scheduled_slot_start")
        visit.scheduled_slot_start = scheduled_start
        visit.scheduled_slot_end = scheduled_end
    if category_id is not None:
        visit.category_id = category_id
    logger.info(
        "fe_visit.reassigned",
        visit_id=str(visit.id),
        new_fe_id=str(new_fe.id),
    )
    return visit


async def start_visit(db: AsyncSession, *, visit: FEVisit) -> FEVisit:
    await _apply_status_transition(visit, "in_progress")
    visit.started_at = datetime.now(timezone.utc)
    logger.info("fe_visit.started", visit_id=str(visit.id))
    return visit


async def complete_visit(
    db: AsyncSession,
    *,
    visit: FEVisit,
    outcome: str,
    outcome_reason: Optional[str] = None,
    listing_id: Optional[UUID] = None,
) -> FEVisit:
    if outcome not in _VALID_OUTCOMES:
        raise ValueError(f"Invalid outcome: {outcome}")

    # Outcome -> status mapping
    if outcome == "listed":
        target = "completed"
    elif outcome == "rejected_item":
        target = "completed"
    elif outcome == "seller_missing_verification":
        target = "completed"
    elif outcome == "pickup_not_ready":
        target = "no_show"
    elif outcome == "postponed":
        target = "postponed"
    else:  # defensive — should never reach here
        target = "completed"

    await _apply_status_transition(visit, target)
    visit.outcome = outcome
    visit.outcome_reason = outcome_reason
    if listing_id is not None:
        visit.listing_id = listing_id
    visit.completed_at = datetime.now(timezone.utc)
    logger.info(
        "fe_visit.completed",
        visit_id=str(visit.id),
        outcome=outcome,
        status=target,
    )
    return visit


async def cancel_visit(
    db: AsyncSession, *, visit: FEVisit, reason: str, triggered_by: str
) -> FEVisit:
    await _apply_status_transition(visit, "cancelled")
    visit.outcome_reason = reason
    visit.completed_at = datetime.now(timezone.utc)
    logger.info(
        "fe_visit.cancelled",
        visit_id=str(visit.id),
        triggered_by=triggered_by,
        reason=reason,
    )
    return visit


# ── SLA helpers ───────────────────────────────────────────────────────────────

def is_visit_stuck(visit: FEVisit, now: Optional[datetime] = None) -> bool:
    """Heuristic for admin ops: visit is stuck if FE hasn't progressed it."""
    now = now or datetime.now(timezone.utc)
    if visit.status == "scheduled" and visit.scheduled_slot_end:
        # FE didn't start within 30 min after scheduled slot end
        gap_min = (now - visit.scheduled_slot_end).total_seconds() / 60
        if gap_min > 30:
            return True
    if visit.status == "in_progress" and visit.started_at:
        # Visit taking more than 2 hours
        dur_min = (now - visit.started_at).total_seconds() / 60
        if dur_min > 120:
            return True
    return False
