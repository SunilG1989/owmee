"""Return flow service.

State machine
-------------
  none → requested        (buyer hits "Return this item" within window)
  requested → approved    (admin approves)
  requested → rejected    (admin rejects with note)
  approved → pickup_scheduled  (admin assigns return-pickup FE)
  pickup_scheduled → picked_up (FE confirms collection from buyer)
  picked_up → completed   (auto: triggers refund + notifies seller)

Trust posture: V1 we approve all returns by default for the pilot. Once
we have abuse data we'll tighten — for now the seller's listing is
already FE-inspected at original pickup, so a buyer disputing the item
genuinely is rare and the cost of investigating is higher than the cost
of refunding the buyer.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.offers.models import Transaction
from app.modules.transactions.refund_service import (
    INITIATED_BY_SYSTEM_PICKUP, INITIATED_BY_ADMIN, INITIATED_BY_BUYER,
    initiate_refund,
)

logger = structlog.get_logger()

# How many days post-delivery a buyer can request a return.
RETURN_WINDOW_DAYS = 7

# Valid reason categories the mobile UI offers.
VALID_RETURN_REASONS = {
    "item_not_as_described",
    "damaged_in_transit",
    "wrong_item",
    "other",
}


def _is_within_return_window(txn: Transaction) -> bool:
    if not txn.delivered_at:
        return False
    cutoff = txn.delivered_at + timedelta(days=RETURN_WINDOW_DAYS)
    return datetime.now(timezone.utc) <= cutoff


async def request_return(
    db: AsyncSession, txn: Transaction, buyer_id: UUID,
    *, reason: str, description: str,
) -> Transaction:
    """Buyer-initiated. Caller must have ensured the buyer is verified
    (KYC required for refund/return/dispute per Sprint 6 brief)."""
    if txn.buyer_id != buyer_id:
        raise ValueError("NOT_YOUR_TRANSACTION")
    if reason not in VALID_RETURN_REASONS:
        raise ValueError(f"INVALID_REASON:{reason}")
    if txn.status not in ("delivered", "completed"):
        raise ValueError(f"NOT_RETURNABLE:{txn.status}")
    if txn.return_status not in ("none", "rejected"):
        raise ValueError(f"RETURN_ALREADY_OPEN:{txn.return_status}")
    if not _is_within_return_window(txn):
        raise ValueError("RETURN_WINDOW_EXPIRED")

    now = datetime.now(timezone.utc)
    txn.return_status = "requested"
    txn.return_reason = reason
    txn.return_description = description[:1000] if description else None
    txn.return_requested_at = now
    # Reset prior decision fields so a re-request after rejection is clean.
    txn.return_decision_at = None
    txn.return_decision_by = None
    txn.return_decision_note = None

    logger.info(
        "return.requested",
        transaction_id=str(txn.id), buyer_id=str(buyer_id), reason=reason,
    )
    return txn


async def admin_approve_return(
    db: AsyncSession, txn: Transaction, admin_id: UUID, note: str = "",
) -> Transaction:
    if txn.return_status != "requested":
        raise ValueError(f"NOT_PENDING:{txn.return_status}")
    now = datetime.now(timezone.utc)
    txn.return_status = "approved"
    txn.return_decision_at = now
    txn.return_decision_by = admin_id
    txn.return_decision_note = note[:500] if note else None
    logger.info("return.approved", transaction_id=str(txn.id), admin_id=str(admin_id))
    return txn


async def admin_reject_return(
    db: AsyncSession, txn: Transaction, admin_id: UUID, note: str,
) -> Transaction:
    if txn.return_status != "requested":
        raise ValueError(f"NOT_PENDING:{txn.return_status}")
    if not note or len(note.strip()) < 5:
        # Force admins to give a real reason — the buyer will see it.
        raise ValueError("REJECTION_NOTE_REQUIRED")
    now = datetime.now(timezone.utc)
    txn.return_status = "rejected"
    txn.return_decision_at = now
    txn.return_decision_by = admin_id
    txn.return_decision_note = note[:500]
    logger.info("return.rejected", transaction_id=str(txn.id), admin_id=str(admin_id))
    return txn


async def admin_assign_return_pickup(
    db: AsyncSession, txn: Transaction, admin_id: UUID, fe_user_id: UUID,
) -> Transaction:
    if txn.return_status != "approved":
        raise ValueError(f"NOT_APPROVED:{txn.return_status}")
    txn.return_pickup_fe_id = fe_user_id
    txn.return_status = "pickup_scheduled"
    logger.info(
        "return.assigned_pickup",
        transaction_id=str(txn.id), fe_user_id=str(fe_user_id), admin_id=str(admin_id),
    )
    return txn


async def fe_complete_return_pickup(
    db: AsyncSession, txn: Transaction, fe_user_id: UUID,
) -> Transaction:
    """FE confirms they collected the returned item from the buyer.
    Triggers the buyer refund automatically — once Owmee has the item
    back in custody we owe the buyer their money."""
    if txn.return_pickup_fe_id != fe_user_id:
        raise ValueError("NOT_YOUR_RETURN_PICKUP")
    if txn.return_status != "pickup_scheduled":
        raise ValueError(f"NOT_SCHEDULED:{txn.return_status}")

    now = datetime.now(timezone.utc)
    txn.return_status = "picked_up"
    txn.return_picked_up_at = now

    # Auto-refund. If a refund's already in flight (rare — would only
    # happen if the buyer also opened a dispute that resolved as refund
    # before the return picked up), initiate_refund's idempotency layer
    # makes this a no-op rather than a double-refund.
    try:
        await initiate_refund(
            db, txn,
            reason=f"Return approved + picked up: {txn.return_reason}. {txn.return_description or ''}"[:200],
            initiated_by=INITIATED_BY_BUYER,
        )
    except ValueError as e:
        logger.warning("return.refund_skip", transaction_id=str(txn.id), error=str(e))

    txn.return_status = "completed"
    txn.return_completed_at = now
    logger.info("return.completed", transaction_id=str(txn.id), fe_user_id=str(fe_user_id))
    return txn
