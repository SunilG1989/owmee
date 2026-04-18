"""Dispute Temporal activities."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone

import structlog
from temporalio import activity

logger = structlog.get_logger()


@dataclass
class ActivityDisputeInput:
    dispute_id: str
    transaction_id: str


@dataclass
class ActivityDisputeResolutionInput:
    dispute_id: str
    transaction_id: str
    resolution: str
    resolution_note: str = ""


@activity.defn(name="act_archive_chat_evidence")
async def act_archive_chat_evidence(inp: ActivityDisputeInput) -> dict:
    """Archive chat history to S3 evidence bucket under legal hold."""
    # In production: fetch chat history from chat vendor, upload to R2 evidence bucket
    logger.info("act_archive_chat_evidence.done", dispute_id=inp.dispute_id)
    return {"success": True, "archived": True}


@activity.defn(name="act_freeze_transaction_for_dispute")
async def act_freeze_transaction_for_dispute(inp: ActivityDisputeInput) -> dict:
    """Ensure transaction payout is frozen during dispute."""
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = result.scalar_one_or_none()
        if txn:
            # Clear payout eligibility if not yet released
            if txn.payout_flagged_at and not txn.payout_released_at:
                txn.payout_flagged_at = None
        await db.commit()
    logger.info("act_freeze_transaction_for_dispute.done", transaction_id=inp.transaction_id)
    return {"success": True}


@activity.defn(name="act_apply_dispute_resolution")
async def act_apply_dispute_resolution(inp: ActivityDisputeResolutionInput) -> dict:
    """Apply full_refund / full_release / partial_refund to transaction."""
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from app.modules.admin.reports_disputes import Dispute
    from app.modules.listings.models import Listing
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)

        # Update dispute record
        disp_result = await db.execute(
            select(Dispute).where(Dispute.id == uuid.UUID(inp.dispute_id))
        )
        dispute = disp_result.scalar_one_or_none()
        if dispute:
            dispute.status = "resolved"
            dispute.resolution = inp.resolution
            dispute.resolution_note = inp.resolution_note
            dispute.resolved_at = now

        # Apply to transaction
        txn_result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = txn_result.scalar_one_or_none()
        if txn:
            if inp.resolution in ("full_refund", "partial_refund"):
                txn.status = "refunded"
                txn.cancelled_at = now
                # Re-open listing
                listing_result = await db.execute(
                    select(Listing).where(Listing.id == txn.listing_id)
                )
                listing = listing_result.scalar_one_or_none()
                if listing:
                    listing.status = "active"
            elif inp.resolution == "full_release":
                txn.status = "completed"
                txn.completed_at = now
                txn.payout_flagged_at = now

        await db.commit()
        logger.info("act_apply_dispute_resolution.done",
                    dispute_id=inp.dispute_id, resolution=inp.resolution)
        return {"success": True}


@activity.defn(name="act_notify_dispute_event")
async def act_notify_dispute_event(inp: ActivityDisputeInput) -> dict:
    """Send notifications for dispute escalation."""
    logger.info("act_notify_dispute_event.done", dispute_id=inp.dispute_id)
    return {"success": True}
