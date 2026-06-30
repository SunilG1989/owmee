"""
Field Executive Temporal activities — Sprint 4 / Pass 2.

Activities run outside the workflow sandbox; they can do DB/network I/O.
They are kept thin and idempotent: any meaningful state change writes through
the service layer so invariants are enforced once.
"""
from __future__ import annotations

from uuid import UUID

import structlog
from temporalio import activity

logger = structlog.get_logger()


@activity.defn(name="fe_visit.notify_fe_assigned")
async def act_notify_fe_assigned(visit_id: str, fe_user_id: str) -> None:
    """
    Push notification to the FE's device telling them a new visit is assigned.
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.field_executive.models import FEVisit, FieldExecutive
    from app.modules.notifications.service import push
    from sqlalchemy import select

    try:
        target_user_id = UUID(fe_user_id) if fe_user_id else None
    except ValueError:
        target_user_id = None
    fe_code = None
    async with AsyncSessionLocal() as db:
        visit = (await db.execute(
            select(FEVisit).where(FEVisit.id == UUID(visit_id))
        )).scalar_one_or_none()
        if visit and not target_user_id and visit.fe_id:
            fe = (await db.execute(
                select(FieldExecutive).where(FieldExecutive.id == visit.fe_id)
            )).scalar_one_or_none()
            if fe:
                target_user_id = fe.user_id
                fe_code = fe.fe_code

    if target_user_id:
        await push(
            target_user_id,
            "fe_visit_assigned",
            title="Visit assigned",
            body="A seller visit is ready in your FE tasks.",
            data={"visit_id": visit_id, "fe_code": fe_code or ""},
            entity_type="fe_visit",
            entity_id=visit_id,
            idempotency_key=f"fe_visit_assigned:{visit_id}:{target_user_id}",
        )
    logger.info(
        "fe_visit.notify.assigned",
        visit_id=visit_id,
        fe_user_id=str(target_user_id) if target_user_id else fe_user_id,
    )


@activity.defn(name="fe_visit.surface_stuck_visit")
async def act_surface_stuck_visit(visit_id: str, reason: str) -> None:
    """
    Surface a stuck visit to the admin ops queue.
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.field_executive.models import FEVisit, FieldExecutive
    from app.modules.stuck_workflow import report_stuck
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        visit = (await db.execute(
            select(FEVisit).where(FEVisit.id == UUID(visit_id))
        )).scalar_one_or_none()
        fe_code = None
        fe_user_id = None
        if visit and visit.fe_id:
            fe = (await db.execute(
                select(FieldExecutive).where(FieldExecutive.id == visit.fe_id)
            )).scalar_one_or_none()
            if fe:
                fe_code = fe.fe_code
                fe_user_id = str(fe.user_id)
        await report_stuck(
            db,
            workflow_type="fe_visit",
            workflow_id=f"fe-visit-{visit_id}",
            entity_type="fe_visit",
            entity_id=visit_id,
            reason=reason,
            severity="critical" if reason == "visit_in_progress_too_long" else "warning",
            description="FE visit needs admin intervention.",
            metadata_json={
                "visit_id": visit_id,
                "fe_code": fe_code,
                "fe_user_id": fe_user_id,
                "status": getattr(visit, "status", None),
            },
        )
        await db.commit()
    logger.warning(
        "fe_visit.stuck",
        visit_id=visit_id,
        reason=reason,
    )


@activity.defn(name="fe_visit.spawn_listing_review")
async def act_spawn_listing_review(visit_id: str, listing_id: str) -> None:
    """
    Enqueue the resulting fe_assisted listing into the ops review queue.
    The listing already has reviewed_by='fe'; this activity escalates to ops.
    MVP implementation: log-only. Phase 3 spawns ListingReviewWorkflow.
    """
    logger.info(
        "fe_visit.listing_review_queued",
        visit_id=visit_id,
        listing_id=listing_id,
    )
