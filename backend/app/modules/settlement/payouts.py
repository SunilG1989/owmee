"""Payout release — the money-out event.

v1 is the manual finance rail: a money-role admin makes the bank/UPI
transfer outside the system, then records it here with the UTR. Recording
is the atomic settlement event: it posts the ledger debit, stamps
``payout_released_at`` on the covered transactions, audit-logs, and
notifies the seller. An API rail (RazorpayX/Route) later replaces the
"make the transfer by hand" step but keeps this exact bookkeeping.

Concurrency: a per-seller Postgres advisory transaction lock serializes
concurrent releases (two finance tabs), and the idempotency key
``manual:{seller_id}:{utr}`` makes re-submitting the same UTR a no-op.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.offers.models import Transaction
from app.modules.settlement.accounts import active_payout_account
from app.modules.settlement.ledger import available_balance, post_payout_debit
from app.modules.settlement.models import (
    PAYOUT_STATUS_RECORDED,
    SellerPayout,
    SellerPayoutAccount,
)

logger = structlog.get_logger()


class PayoutError(ValueError):
    """Raised with a machine-readable code the caller can surface."""


async def release_seller_payout(
    db: AsyncSession,
    *,
    seller_id: UUID,
    utr_reference: str,
    initiated_by: str,
) -> SellerPayout:
    """Record a full-available-balance payout to the seller's active
    verified account. Caller commits.

    v1 deliberately releases the FULL available balance (like a settlement
    run) — partial releases complicate which transactions count as paid and
    add no pilot value.
    """
    utr = (utr_reference or "").strip()
    if len(utr) < 6:
        raise PayoutError("UTR_REQUIRED")

    # Serialize per-seller: balance-check → insert must not interleave with
    # a concurrent release for the same seller.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('seller_payout:' || :sid))"),
        {"sid": str(seller_id)},
    )

    idempotency_key = f"manual:{seller_id}:{utr}"
    existing = (await db.execute(
        select(SellerPayout).where(SellerPayout.idempotency_key == idempotency_key)
    )).scalar_one_or_none()
    if existing is not None:
        return existing

    account = await active_payout_account(db, seller_id)
    if account is None or account.verified_at is None:
        raise PayoutError("NO_VERIFIED_PAYOUT_ACCOUNT")

    balance = await available_balance(db, seller_id)
    if balance <= 0:
        raise PayoutError("NO_AVAILABLE_BALANCE")

    now = datetime.now(timezone.utc)
    payout = SellerPayout(
        seller_id=seller_id,
        amount_inr=balance,
        status=PAYOUT_STATUS_RECORDED,
        method="manual_upi" if account.account_type == "upi" else "manual_bank",
        payout_account_id=account.id,
        utr_reference=utr,
        initiated_by=initiated_by,
        idempotency_key=idempotency_key,
        paid_at=now,
    )
    db.add(payout)
    await db.flush()

    await post_payout_debit(
        db,
        seller_id=seller_id,
        payout_id=payout.id,
        amount_inr=balance,
        created_by=initiated_by,
    )

    # Stamp every settled-but-unpaid transaction as released. The full-
    # balance rule makes this well-defined: everything credited so far is
    # covered by this payout.
    settled_txn_ids = (await db.execute(
        text("""
            SELECT transaction_id FROM seller_ledger_entries
            WHERE seller_id = :seller_id
              AND entry_type = 'sale_credit'
              AND transaction_id IS NOT NULL
        """),
        {"seller_id": str(seller_id)},
    )).scalars().all()
    if settled_txn_ids:
        txns = (await db.execute(
            select(Transaction).where(
                Transaction.id.in_(settled_txn_ids),
                Transaction.payout_released_at.is_(None),
            )
        )).scalars().all()
        for txn in txns:
            txn.payout_released_at = now

    from app.modules.offers.service import _notify

    await _notify(
        db,
        seller_id,
        "payout_released",
        "Payout released",
        f"₹{balance:,.0f} was sent to {account.masked_display}. Ref: {utr}.",
        "payout",
        str(payout.id),
    )

    logger.info(
        "payout.released",
        payout_id=str(payout.id),
        seller_id=str(seller_id),
        amount=str(balance),
        utr=utr,
        initiated_by=initiated_by,
    )
    return payout


async def payout_queue(db: AsyncSession) -> list[dict]:
    """Finance queue rows: sellers with positive available balance, their
    active account (masked), and how many settled-unpaid orders the balance
    covers."""
    from app.modules.settlement.ledger import sellers_with_positive_balance

    rows: list[dict] = []
    for seller_id, balance in await sellers_with_positive_balance(db):
        account = await active_payout_account(db, seller_id)
        unpaid_count = (await db.execute(
            text("""
                SELECT count(*) FROM seller_ledger_entries e
                JOIN transactions t ON t.id = e.transaction_id
                WHERE e.seller_id = :seller_id
                  AND e.entry_type = 'sale_credit'
                  AND t.payout_released_at IS NULL
            """),
            {"seller_id": str(seller_id)},
        )).scalar()
        rows.append({
            "seller_id": seller_id,
            "balance": Decimal(str(balance)),
            "account_masked": account.masked_display if account else None,
            "account_verified": bool(account and account.verified_at),
            "unpaid_orders": int(unpaid_count or 0),
        })
    return rows
