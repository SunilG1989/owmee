"""Refund flow — owns the (initiate → process → complete) state machine
for buyer refunds. Triggered from three places:

  1. Auto: FE pickup-rejected. The item didn't match the listing; buyer
     paid in good faith and gets refunded immediately.
  2. Admin: ops decides to refund (from the admin web /admin/refunds
     queue, or directly from a transaction detail page).
  3. Buyer-initiated: pre-pickup cancel (POST /transactions/{id}/cancel →
     cancel_paid_pre_pickup_transaction). Once a pickup FE is assigned
     there is no buyer cancel path until post-delivery returns.

Idempotency
-----------
The authoritative layer is DB-level: `initiate_refund` re-reads the
transaction row under SELECT ... FOR UPDATE and re-checks refund_status,
so two concurrent initiators serialize and the loser sees the winner's
processing/completed state instead of firing a second provider refund.
An idempotency key (scoped to txn + amount) is still passed to the
adapter as a best-effort second layer, but the row lock is what actually
prevents double refunds — do not rely on the provider header.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.offers.models import PaymentLink, Transaction
from app.modules.payments.adapter import get_payment_adapter

logger = structlog.get_logger()


REFUND_STATUS_NONE = "none"
REFUND_STATUS_REQUESTED = "requested"
REFUND_STATUS_PROCESSING = "processing"
REFUND_STATUS_COMPLETED = "completed"
REFUND_STATUS_FAILED = "failed"

INITIATED_BY_SYSTEM_PICKUP = "system_pickup_rejected"
INITIATED_BY_SYSTEM_SELLER = "system_seller_unavailable"
INITIATED_BY_ADMIN = "admin"
INITIATED_BY_BUYER = "buyer"


async def initiate_refund(
    db: AsyncSession,
    txn: Transaction,
    *,
    reason: str,
    initiated_by: str,
    amount: Decimal | None = None,
) -> Transaction:
    """Mark the transaction as refund_requested and call the payment
    adapter. Mutates txn in place; caller must commit.

    Raises ValueError("ALREADY_REFUNDED") if a refund is already
    completed; raises ValueError("NOT_PAID") if there's no captured
    payment to refund against.
    """
    # Serialize concurrent initiators (admin retry, FE return completion,
    # dispute resolution can race): lock the row and re-read refund_status
    # from the database before deciding to fire the provider call. The lock
    # is held until the caller commits, so the second initiator blocks here
    # and then observes the winner's state.
    txn = (await db.execute(
        select(Transaction)
        .where(Transaction.id == txn.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one()

    if txn.refund_status == REFUND_STATUS_COMPLETED:
        raise ValueError("ALREADY_REFUNDED")
    if txn.refund_status == REFUND_STATUS_PROCESSING:
        # Idempotent — caller asked twice; return the in-flight refund.
        return txn

    pl = (await db.execute(
        select(PaymentLink)
        .where(
            PaymentLink.transaction_id == txn.id,
            PaymentLink.razorpay_payment_id.is_not(None),
        )
        .order_by(PaymentLink.paid_at.desc().nullslast(), PaymentLink.created_at.desc())
    )).scalars().first()

    if not pl or not pl.razorpay_payment_id:
        raise ValueError("NOT_PAID")

    full_amount = amount if amount is not None else Decimal(str(txn.gross_amount or 0))
    if full_amount <= 0:
        raise ValueError("INVALID_REFUND_AMOUNT")

    now = datetime.now(timezone.utc)
    txn.refund_status = REFUND_STATUS_PROCESSING
    txn.refund_amount = full_amount
    txn.refund_reason = reason[:200] if reason else None
    txn.refund_initiated_at = now
    txn.refund_initiated_by = initiated_by
    await db.flush()

    adapter = get_payment_adapter()
    # Scope the key to the amount as well: a retry after a FAILED attempt
    # with a different amount must not dedupe onto the original request.
    amount_paise = int(full_amount * 100)
    idempotency_key = hashlib.sha256(
        f"refund:{txn.id}:{amount_paise}:v1".encode()
    ).hexdigest()[:64]
    result = await adapter.refund(
        razorpay_payment_id=pl.razorpay_payment_id,
        amount_paise=amount_paise,
        idempotency_key=idempotency_key,
        notes={"transaction_id": str(txn.id), "reason": reason or "", "by": initiated_by},
    )

    if not result.success:
        # Don't roll the txn back — keep refund_status=processing so ops
        # can retry from the admin UI. Surface error in logs + Sentry.
        logger.error(
            "refund.adapter_failed",
            transaction_id=str(txn.id),
            reason=reason, by=initiated_by,
            error=result.error,
        )
        # Mark failed so the admin queue surfaces it for retry.
        txn.refund_status = REFUND_STATUS_FAILED
        return txn

    txn.razorpay_refund_id = result.razorpay_refund_id
    if result.status == "processed":
        txn.refund_status = REFUND_STATUS_COMPLETED
        txn.refund_completed_at = now
    # else stay 'processing' — Razorpay will deliver a webhook later
    # confirming completion (or we'll poll).

    logger.info(
        "refund.initiated",
        transaction_id=str(txn.id),
        amount=str(full_amount),
        by=initiated_by,
        razorpay_refund_id=result.razorpay_refund_id,
        status=txn.refund_status,
    )
    return txn


async def mark_refund_completed(
    db: AsyncSession, razorpay_refund_id: str,
) -> Transaction | None:
    """Webhook handler entry: razorpay sent a 'refund.processed' event.
    Idempotent — re-applying does nothing. Returns None if the refund id
    isn't recognized (lets the webhook return 200 anyway so Razorpay
    stops retrying)."""
    txn = (await db.execute(
        select(Transaction).where(Transaction.razorpay_refund_id == razorpay_refund_id)
    )).scalar_one_or_none()
    if not txn:
        logger.warning("refund.webhook_unknown_id", refund_id=razorpay_refund_id)
        return None
    if txn.refund_status == REFUND_STATUS_COMPLETED:
        return txn
    txn.refund_status = REFUND_STATUS_COMPLETED
    txn.refund_completed_at = datetime.now(timezone.utc)
    # If the sale had already settled to the seller's payout balance, claw
    # it back (netted against future payouts — Meesho-style). No-op when no
    # sale credit exists yet.
    from app.modules.settlement.ledger import post_refund_clawback
    await post_refund_clawback(
        db,
        seller_id=txn.seller_id,
        transaction_id=txn.id,
        memo="Buyer refund completed",
    )
    from app.modules.offers.service import _notify
    await _notify(
        db,
        txn.buyer_id,
        "refund_completed",
        "Refund completed",
        "Your Owmee refund has been completed.",
        "transaction",
        str(txn.id),
    )
    await _notify(
        db,
        txn.seller_id,
        "refund_completed_seller",
        "Buyer refund completed",
        "Owmee has completed the buyer refund for this order.",
        "transaction",
        str(txn.id),
    )
    logger.info("refund.completed", transaction_id=str(txn.id))
    return txn
