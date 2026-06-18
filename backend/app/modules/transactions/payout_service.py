"""Seller payout processing helpers.

Owmee collects buyer payment first, but seller payout processing starts only
after Owmee has physical custody of the item: FE pickup/inspection must pass.
Actual release still remains ops/provider-driven and must respect seller
payout/KYC verification.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import structlog

from app.modules.offers.models import Transaction
from app.modules.transactions.shipped import compute_tds, seller_payout_verified

logger = structlog.get_logger()


PAYOUT_PROCESSING_ALLOWED_STATUSES = {
    "at_hub",
    "delivery_in_progress",
    "delivered",
    "completed",
    "auto_completed",
    "buyer_accepted",
}


def _format_rupees(amount: Decimal | int | float | str | None) -> str:
    value = Decimal(str(amount or 0))
    return f"₹{value:,.0f}"


async def ensure_seller_payout_processing(
    db,
    txn: Transaction,
    *,
    source: str,
    now: datetime | None = None,
    notify: bool = False,
) -> dict:
    """Compute payout fields and mark payout processing as started.

    Idempotent: repeated calls recompute the payout breakdown but preserve the
    original ``payout_flagged_at`` timestamp so the first processing milestone is
    auditable.
    """
    now = now or datetime.now(timezone.utc)
    seller_gross = Decimal(str(txn.gross_amount or 0)) - Decimal(str(txn.delivery_fee or 0))
    tds_result = await compute_tds(db, txn.seller_id, seller_gross, txn.id)

    txn.tds_withheld = tds_result["tds_amount"]
    txn.platform_fee = tds_result["platform_fee"]
    txn.gst_on_fee = tds_result["gst_on_fee"]
    txn.net_payout = tds_result["net_payout"]

    started_now = txn.payout_flagged_at is None
    if started_now:
        txn.payout_flagged_at = now

    payout_verified = await seller_payout_verified(db, txn.seller_id)
    if not payout_verified:
        logger.warning(
            "payout.processing_for_unverified_seller",
            transaction_id=str(txn.id),
            seller_id=str(txn.seller_id),
            source=source,
            net_payout=str(txn.net_payout),
        )

    if notify and started_now:
        await _notify_seller_payout_started(
            db,
            seller_id=txn.seller_id,
            transaction_id=txn.id,
            amount=txn.net_payout,
            payout_verified=payout_verified,
        )

    logger.info(
        "payout.processing_started" if started_now else "payout.processing_already_started",
        transaction_id=str(txn.id),
        seller_id=str(txn.seller_id),
        source=source,
        payout_verified=payout_verified,
        net_payout=str(txn.net_payout),
    )
    return {
        "started_now": started_now,
        "seller_payout_verified": payout_verified,
        "net_payout": txn.net_payout,
        "tds_result": tds_result,
    }


async def _notify_seller_payout_started(
    db,
    *,
    seller_id: UUID,
    transaction_id: UUID,
    amount: Decimal,
    payout_verified: bool,
) -> None:
    from app.modules.offers.service import _notify

    if payout_verified:
        await _notify(
            db,
            seller_id,
            "payout_processing_started",
            "Payout processing started",
            f"Owmee picked up and inspected the item. {_format_rupees(amount)} payout is now processing.",
            "transaction",
            str(transaction_id),
        )
        return

    await _notify(
        db,
        seller_id,
        "payout_verification_required",
        "Verify payout account",
        f"Owmee picked up the item. Verify payout details so {_format_rupees(amount)} can be released.",
        "transaction",
        str(transaction_id),
    )
