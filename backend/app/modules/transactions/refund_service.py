"""Refund flow — owns the (initiate → process → complete) state machine
for buyer refunds. Triggered from three places:

  1. Auto: FE pickup-rejected. The item didn't match the listing; buyer
     paid in good faith and gets refunded immediately.
  2. Admin: ops decides to refund (from the admin web /admin/refunds
     queue, or directly from a transaction detail page).
  3. Buyer-initiated: pre-delivery cancel (currently a TODO, blocked on
     dispute flow rebuild — not exposed yet).

Idempotency
-----------
Two layers:
  - DB-level: refund_status check before initiating (won't double-fire).
  - Adapter-level: Razorpay accepts an X-Razorpay-Idempotency-Key header.
    We pass `f"refund:{txn.id}:v1"` so retries dedupe on the partner
    side too.
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
    if txn.refund_status == REFUND_STATUS_COMPLETED:
        raise ValueError("ALREADY_REFUNDED")
    if txn.refund_status == REFUND_STATUS_PROCESSING:
        # Idempotent — caller asked twice; return the in-flight refund.
        return txn

    pl = (await db.execute(
        select(PaymentLink)
        .where(PaymentLink.transaction_id == txn.id)
        .order_by(PaymentLink.created_at.desc())
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
    idempotency_key = hashlib.sha256(f"refund:{txn.id}:v1".encode()).hexdigest()[:64]
    result = await adapter.refund(
        razorpay_payment_id=pl.razorpay_payment_id,
        amount_paise=int(full_amount * 100),
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
    logger.info("refund.completed", transaction_id=str(txn.id))
    return txn
