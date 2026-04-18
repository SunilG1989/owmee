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
    For MVP this just logs; real FCM integration is Phase 3+.
    """
    logger.info(
        "fe_visit.notify.assigned",
        visit_id=visit_id,
        fe_user_id=fe_user_id,
    )


@activity.defn(name="fe_visit.surface_stuck_visit")
async def act_surface_stuck_visit(visit_id: str, reason: str) -> None:
    """
    Surface a stuck visit to the admin ops queue. Real implementation writes
    to a `stuck_workflow_alerts` table; MVP just logs.
    """
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
