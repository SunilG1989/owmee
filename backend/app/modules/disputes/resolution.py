"""Single source of truth for applying a dispute resolution.

Both callers go through this:
  - the synchronous admin endpoint POST /v1/admin/disputes/{id}/resolve, and
  - the durable DisputeWorkflow's ``act_apply_dispute_resolution`` activity.

Previously these diverged: the HTTP path called ``initiate_refund`` (money
actually moved) while the Temporal path only flipped ``txn.status='refunded'``
and never called the payment adapter — so any dispute resolved by
auto-escalation/timeout told the buyer "refunded" while the money never came
back. Funnelling both through one function removes that divergence and gives
``partial_refund`` a real amount.

The caller owns the transaction boundary (commit), so this only mutates rows.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import Listing
from app.modules.offers.models import Transaction
from app.modules.transactions.refund_service import initiate_refund

logger = structlog.get_logger()

REFUND_RESOLUTIONS = ("full_refund", "partial_refund")


async def apply_dispute_resolution(
    db: AsyncSession,
    *,
    dispute,
    txn: Transaction | None,
    resolution: str,
    resolution_note: str = "",
    refund_amount: Decimal | None = None,
    initiated_by: str,
) -> dict:
    """Apply ``resolution`` to the dispute + transaction, moving money for
    refund resolutions. Returns a dict with the realized ``refund_status``.

    ``refund_amount`` is honored only for ``partial_refund``; ``full_refund``
    always refunds the full captured amount (``amount=None``).
    """
    now = datetime.now(timezone.utc)

    if dispute is not None:
        dispute.status = "resolved"
        dispute.resolution = resolution
        dispute.resolution_note = resolution_note
        dispute.resolved_at = now

    refund_status: str | None = None
    if txn is not None:
        if resolution in REFUND_RESOLUTIONS:
            amount = refund_amount if resolution == "partial_refund" else None
            try:
                await initiate_refund(
                    db,
                    txn,
                    reason=f"Dispute resolved: {resolution}. {resolution_note or ''}"[:200],
                    initiated_by=initiated_by,
                    amount=amount,
                )
                refund_status = txn.refund_status
            except ValueError as exc:
                # ALREADY_REFUNDED (pickup auto-refunded earlier) or NOT_PAID
                # (dispute opened before capture). The dispute outcome still
                # stands; we just couldn't move money on this call.
                logger.warning(
                    "dispute.refund_skip",
                    transaction_id=str(txn.id),
                    error=str(exc),
                )
                refund_status = "skipped"
            txn.status = "refunded"
            txn.cancelled_at = now
            await _reopen_listing(db, txn)
        elif resolution == "full_release":
            txn.status = "completed"
            txn.completed_at = now
            txn.payout_flagged_at = now
        # "dismissed": dispute closed with no money movement / state change.

    logger.info(
        "dispute.resolution_applied",
        resolution=resolution,
        refund_status=refund_status,
        transaction_id=str(txn.id) if txn is not None else None,
    )
    return {"resolution": resolution, "refund_status": refund_status}


async def _reopen_listing(db: AsyncSession, txn: Transaction) -> None:
    if not txn.listing_id:
        return
    listing = (
        await db.execute(select(Listing).where(Listing.id == txn.listing_id))
    ).scalar_one_or_none()
    if listing and listing.status in ("reserved", "disputed"):
        listing.status = "active"
