"""Settlement service — turns completed orders into seller ledger credits
and enforces the 48h delivered auto-complete window.

Design: docs/OWMEE_SELLER_PAYOUTS.md. The auto-complete path replaces the
never-started Temporal ``TransactionWorkflow`` timer with a sweeper, the
same pattern the payment window already uses.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.offers.models import Transaction
from app.modules.settlement.ledger import post_sale_credit

logger = structlog.get_logger()

RATING_DELAY_HOURS = 2


def _format_rupees(amount) -> str:
    return f"₹{Decimal(str(amount or 0)):,.0f}"


async def settle_completed_transaction(
    db: AsyncSession, txn: Transaction, *, source: str
) -> bool:
    """Post the sale credit for a completed/auto_completed transaction and
    tell the seller their balance moved. Idempotent per transaction; returns
    True only on first settlement. Caller commits."""
    net_payout = Decimal(str(txn.net_payout or 0))
    entry = await post_sale_credit(
        db,
        seller_id=txn.seller_id,
        transaction_id=txn.id,
        net_payout=net_payout,
        memo=f"Order settled ({source})",
    )
    if entry is None:
        return False

    from app.modules.offers.service import _notify

    await _notify(
        db,
        txn.seller_id,
        "payout_eligible",
        "Payout balance updated",
        f"{_format_rupees(net_payout)} is now in your payout balance and will "
        "be released in the next payout run.",
        "transaction",
        str(txn.id),
    )
    logger.info(
        "settlement.sale_settled",
        transaction_id=str(txn.id),
        seller_id=str(txn.seller_id),
        net_payout=str(net_payout),
        source=source,
    )
    return True


async def auto_complete_due_delivered_transactions(
    db: AsyncSession, *, limit: int = 100
) -> int:
    """Delivered orders whose 48h confirmation window has passed become
    auto_completed: listing sold, both parties notified, seller settled.

    Mirrors buyer_confirm_deal / the old act_auto_complete_transaction
    semantics. Only ``status == delivered`` rows qualify — returns and
    disputes move the status away, which keeps them out of this sweep.
    """
    from app.modules.listings.models import Listing
    from app.modules.offers.service import _notify
    from app.modules.transactions.payout_service import ensure_seller_payout_processing

    now = datetime.now(timezone.utc)
    candidates = (await db.execute(
        select(Transaction)
        .where(
            Transaction.status == "delivered",
            Transaction.confirmation_deadline.is_not(None),
            Transaction.confirmation_deadline <= now,
        )
        .order_by(Transaction.confirmation_deadline.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )).scalars().all()

    completed = 0
    for txn in candidates:
        await ensure_seller_payout_processing(
            db, txn, source="auto_complete_sweeper", now=now, notify=False,
        )
        txn.status = "auto_completed"
        txn.completed_at = now
        txn.auto_completed_at = now
        txn.rate_available_at = now + timedelta(hours=RATING_DELAY_HOURS)

        listing = (await db.execute(
            select(Listing).where(Listing.id == txn.listing_id).with_for_update()
        )).scalar_one_or_none()
        if listing:
            listing.status = "sold"

        await _notify(db, txn.seller_id, "deal_confirmed",
            "Deal auto-completed — payout processing",
            f"{_format_rupees(txn.net_payout)} payout being processed. Rate your buyer in 2 hours.",
            "transaction", str(txn.id))
        await _notify(db, txn.buyer_id, "deal_confirmed_buyer",
            "Deal complete",
            "The 48-hour confirmation window ended, so Owmee completed the order.",
            "transaction", str(txn.id))

        await settle_completed_transaction(db, txn, source="auto_complete_sweeper")
        completed += 1
        logger.info("settlement.auto_completed", transaction_id=str(txn.id))

    return completed
