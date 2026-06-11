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
    # Rupees, used only for partial_refund. Carried as a string to keep the
    # Temporal payload JSON-stable (Decimal is not natively serializable).
    refund_amount_inr: str | None = None


@activity.defn(name="act_archive_chat_evidence")
async def act_archive_chat_evidence(inp: ActivityDisputeInput) -> dict:
    """Sprint 6b: chat was removed. The activity name is preserved so the
    Temporal workflow signature stays stable, but the evidence we archive
    is now the offer history (every price point, counter, accept/reject
    timestamp) plus FE pickup/delivery photos — not chat messages.

    Implementation of the offer-thread snapshot is deferred to the
    dispute-flow rebuild (KNOWN_ISSUES Concern B / Sprint 6b followup).
    For now this is a no-op success so existing workflows complete."""
    logger.info("act_archive_chat_evidence.noop_post_sprint6b",
                dispute_id=inp.dispute_id)
    return {"success": True, "archived": False, "reason": "chat_removed_sprint6b"}


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
    """Apply full_refund / full_release / partial_refund to transaction.

    Delegates to the shared ``apply_dispute_resolution`` service so the durable
    workflow path moves money identically to the synchronous admin endpoint —
    previously this only flipped ``txn.status='refunded'`` and the buyer never
    got their money back.
    """
    from decimal import Decimal
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from app.modules.admin.reports_disputes import Dispute
    from app.modules.disputes.resolution import apply_dispute_resolution
    from sqlalchemy import select
    import uuid

    refund_amount = Decimal(inp.refund_amount_inr) if inp.refund_amount_inr else None

    async with AsyncSessionLocal() as db:
        dispute = (await db.execute(
            select(Dispute).where(Dispute.id == uuid.UUID(inp.dispute_id))
        )).scalar_one_or_none()
        txn = (await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )).scalar_one_or_none()

        outcome = await apply_dispute_resolution(
            db,
            dispute=dispute,
            txn=txn,
            resolution=inp.resolution,
            resolution_note=inp.resolution_note,
            refund_amount=refund_amount,
            initiated_by="workflow:dispute",
        )

        await db.commit()
        logger.info("act_apply_dispute_resolution.done",
                    dispute_id=inp.dispute_id, resolution=inp.resolution,
                    refund_status=outcome["refund_status"])
        return {"success": True, "refund_status": outcome["refund_status"]}


@activity.defn(name="act_notify_dispute_event")
async def act_notify_dispute_event(inp: ActivityDisputeInput) -> dict:
    """Send notifications for dispute escalation."""
    logger.info("act_notify_dispute_event.done", dispute_id=inp.dispute_id)
    return {"success": True}
