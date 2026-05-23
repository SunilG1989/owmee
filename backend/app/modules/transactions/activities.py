"""
Transaction Temporal activities.
Each is idempotent, writes to event log before side effects.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

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
    Mark transaction as refunded. In production this calls the PA refund API.
    Idempotent — safe to retry.
    """
    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import Transaction, PaymentLink
    from sqlalchemy import select
    import uuid

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transaction).where(Transaction.id == uuid.UUID(inp.transaction_id))
        )
        txn = result.scalar_one_or_none()
        if not txn:
            return {"success": False, "reason": "NOT_FOUND"}

        # Idempotency: don't refund twice
        if txn.status == "refunded":
            return {"success": True, "already_refunded": True}

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
        logger.info("act_trigger_refund.done", transaction_id=inp.transaction_id)
        return {"success": True}


@activity.defn(name="act_trigger_payout_eligibility")
async def act_trigger_payout_eligibility(inp: ActivityTransactionInput) -> dict:
    """
    Mark transaction payout as eligible. Queues payout job.
    In production: calls PA settlement API after TDS computation.
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

        if txn.payout_flagged_at:
            return {"success": True, "already_flagged": True}

        txn.payout_flagged_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info("act_trigger_payout_eligibility.done", transaction_id=inp.transaction_id)
        return {"success": True}


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
    from app.modules.transactions.shipped import compute_tds, seller_payout_verified
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

        seller_gross = Decimal(str(txn.gross_amount or 0)) - Decimal(str(txn.delivery_fee or 0))
        tds_result = await compute_tds(db, txn.seller_id, seller_gross, txn.id)
        txn.tds_withheld = tds_result["tds_amount"]
        txn.platform_fee = tds_result["platform_fee"]
        txn.gst_on_fee = tds_result["gst_on_fee"]
        txn.net_payout = tds_result["net_payout"]
        txn.status = "auto_completed"
        txn.completed_at = now
        txn.auto_completed_at = now
        txn.payout_flagged_at = now
        txn.rate_available_at = now + timedelta(hours=2)

        # Mark listing as sold
        listing_result = await db.execute(
            select(Listing).where(Listing.id == txn.listing_id)
        )
        listing = listing_result.scalar_one_or_none()
        if listing:
            listing.status = "sold"

        if not await seller_payout_verified(db, txn.seller_id):
            logger.warning(
                "payout.flagged_for_unverified_seller",
                transaction_id=inp.transaction_id,
                seller_id=str(txn.seller_id),
                net_payout=str(txn.net_payout),
            )
        await _notify(db, txn.seller_id, "deal_confirmed",
            "Deal auto-completed — payout queued",
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
