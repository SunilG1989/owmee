"""
Transaction Temporal activities.
Each is idempotent, writes to event log before side effects.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import structlog
from temporalio import activity

logger = structlog.get_logger()


@dataclass
class ActivityTransactionInput:
    transaction_id: str


@activity.defn(name="act_check_transaction_status")
async def act_check_transaction_status(inp: ActivityTransactionInput) -> dict:
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = result.scalar_one_or_none()
        if not txn:
            return {"found": False}
        return {"found": True, "status": txn.status}


@activity.defn(name="act_trigger_refund")
async def act_trigger_refund(inp: ActivityTransactionInput) -> dict:
    """
    Refund a cancelled/timed-out transaction by calling the payment adapter,
    then mark it refunded and re-open the listing. Idempotent — safe to retry.

    Previously this only flipped ``status='refunded'`` and never called the PA
    refund API, so workflow-driven cancellations told the buyer "refunded"
    while no money moved. Now it goes through ``initiate_refund`` (which has its
    own DB + adapter idempotency keys).
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from app.modules.transactions.refund_service import (
        initiate_refund,
        REFUND_STATUS_COMPLETED,
    )
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = result.scalar_one_or_none()
        if not txn:
            return {"success": False, "reason": "NOT_FOUND"}

        # Idempotency: if money already came back, don't touch the adapter again.
        if txn.status == "refunded" and txn.refund_status == REFUND_STATUS_COMPLETED:
            return {"success": True, "already_refunded": True}

        refund_status = None
        try:
            await initiate_refund(
                db, txn,
                reason="Transaction cancelled/timed out by workflow",
                initiated_by="system_workflow",
            )
            refund_status = txn.refund_status
        except ValueError as exc:
            # NOT_PAID: nothing was captured to refund (cancel before payment).
            # ALREADY_REFUNDED: idempotent no-op.
            logger.warning("act_trigger_refund.skip", transaction_id=inp.transaction_id, error=str(exc))
            refund_status = "skipped"

        txn.status = "refunded"
        txn.cancelled_at = datetime.now(timezone.utc)

        # Re-open listing if it was reserved
        if txn.listing_id:
            from app.modules.listings.models import Listing
            listing_result = await db.execute(
                select(Listing).where(Listing.id == txn.listing_id)
            )
            listing = listing_result.scalar_one_or_none()
            if listing and listing.status in ("reserved", "disputed"):
                listing.status = "active"

        await db.commit()
        logger.info("act_trigger_refund.done", transaction_id=inp.transaction_id, refund_status=refund_status)
        return {"success": True, "refund_status": refund_status}


@activity.defn(name="act_trigger_payout_eligibility")
async def act_trigger_payout_eligibility(inp: ActivityTransactionInput) -> dict:
    """
    Mark transaction payout processing as started after successful pickup.

    Buyer payment capture alone is not enough. Once the item is in Owmee custody
    (at_hub or later), payout processing can start; actual release still stays
    behind payout/KYC verification and ops/provider settlement.
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = result.scalar_one_or_none()
        if not txn:
            return {"success": False}

        from app.modules.transactions.payout_service import (
            PAYOUT_PROCESSING_ALLOWED_STATUSES,
            ensure_seller_payout_processing,
        )
        if txn.status not in PAYOUT_PROCESSING_ALLOWED_STATUSES:
            logger.warning(
                "act_trigger_payout_eligibility.blocked_status",
                transaction_id=inp.transaction_id,
                status=txn.status,
            )
            return {"success": False, "reason": "PICKUP_NOT_CONFIRMED", "status": txn.status}

        payout_result = await ensure_seller_payout_processing(
            db,
            txn,
            source="activity_trigger",
            notify=False,
        )
        await db.commit()
        logger.info("act_trigger_payout_eligibility.done", transaction_id=inp.transaction_id)
        return {
            "success": True,
            "already_flagged": not payout_result["started_now"],
            "seller_payout_verified": payout_result["seller_payout_verified"],
        }


@activity.defn(name="act_flag_seller_ghosting")
async def act_flag_seller_ghosting(inp: ActivityTransactionInput) -> dict:
    """Decrement seller trust score for ghosting. Notify buyer."""
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from app.modules.identity_auth.models import User
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = result.scalar_one_or_none()
        if not txn:
            return {"success": False}

        txn.status = "cancelled"
        txn.seller_ghosting_flagged_at = datetime.now(timezone.utc)
        txn.cancelled_at = datetime.now(timezone.utc)
        txn.cancelled_reason = "SELLER_GHOSTING"

        # Decrement seller trust score
        seller_result = await db.execute(
            select(User).where(User.id == txn.seller_id)
        )
        seller = seller_result.scalar_one_or_none()
        if seller and seller.trust_score is not None:
            seller.trust_score = max(0, seller.trust_score - 5)

        await db.commit()
        logger.info("act_flag_seller_ghosting.done", transaction_id=inp.transaction_id,
                    seller_id=str(txn.seller_id))
        return {"success": True}


@activity.defn(name="act_auto_complete_transaction")
async def act_auto_complete_transaction(inp: ActivityTransactionInput) -> dict:
    """Auto-complete after 48h buyer silence on delivered orders only."""
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction
    from app.modules.listings.models import Listing
    from app.modules.offers.service import _notify
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = result.scalar_one_or_none()
        if not txn:
            return {"success": False}

        if txn.status in ("completed", "auto_completed"):
            return {"success": True, "already_completed": True}
        if txn.status != "delivered":
            return {"success": False, "reason": "INVALID_STATUS", "status": txn.status}

        now = datetime.now(timezone.utc)
        if txn.confirmation_deadline and txn.confirmation_deadline > now:
            return {"success": False, "reason": "DEADLINE_NOT_REACHED"}

        from app.modules.transactions.payout_service import ensure_seller_payout_processing
        await ensure_seller_payout_processing(
            db,
            txn,
            source="auto_complete",
            now=now,
            notify=False,
        )
        txn.status = "auto_completed"
        txn.completed_at = now
        txn.auto_completed_at = now
        txn.rate_available_at = now + timedelta(hours=2)

        # Mark listing as sold
        listing_result = await db.execute(
            select(Listing).where(Listing.id == txn.listing_id)
        )
        listing = listing_result.scalar_one_or_none()
        if listing:
            listing.status = "sold"

        await _notify(db, txn.seller_id, "deal_confirmed",
            "Deal auto-completed — payout processing",
            f"₹{txn.net_payout:,.0f} payout being processed. Rate your buyer in 2 hours.",
            "transaction", str(txn.id))
        await _notify(db, txn.buyer_id, "deal_confirmed_buyer",
            "Deal complete",
            "The 48-hour confirmation window ended, so Owmee completed the order.",
            "transaction", str(txn.id))

        await db.commit()
        logger.info("act_auto_complete_transaction.done", transaction_id=inp.transaction_id)
        return {"success": True}


@activity.defn(name="act_notify_transaction_event")
async def act_notify_transaction_event(inp: ActivityTransactionInput) -> dict:
    """Send notifications for transaction events."""
    return {"success": True}
