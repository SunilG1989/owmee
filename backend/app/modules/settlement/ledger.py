"""Marketplace seller ledger — the single source of truth for what Owmee
owes each seller.

Design: docs/OWMEE_SELLER_PAYOUTS.md.

Rules (ledger canon):
- Append-only. Corrections are new entries, never mutations.
- Every business event posts at most once: ``reference_id`` is unique, and
  ``post_entry`` treats a duplicate as an idempotent no-op.
- Balances are sums over entries. A negative available balance is legal
  (clawback after payout) and nets against future credits — refunds to
  buyers are never gated on the seller's balance.
"""
from __future__ import annotations

from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.settlement.models import (
    ENTRY_PAYOUT_DEBIT,
    ENTRY_REFUND_CLAWBACK,
    ENTRY_SALE_CREDIT,
    SellerLedgerEntry,
)

logger = structlog.get_logger()


def sale_reference(transaction_id: UUID | str) -> str:
    return f"sale:{transaction_id}"


def clawback_reference(transaction_id: UUID | str) -> str:
    return f"clawback:{transaction_id}"


def payout_reference(payout_id: UUID | str) -> str:
    return f"payout:{payout_id}"


async def post_entry(
    db: AsyncSession,
    *,
    seller_id: UUID,
    entry_type: str,
    amount_inr: Decimal,
    reference_id: str,
    transaction_id: UUID | None = None,
    payout_id: UUID | None = None,
    memo: str | None = None,
    created_by: str = "system",
) -> SellerLedgerEntry | None:
    """Post one ledger entry. Returns the entry, or None when an entry with
    this reference_id already exists (idempotent replay). Caller commits."""
    existing = (await db.execute(
        select(SellerLedgerEntry).where(SellerLedgerEntry.reference_id == reference_id)
    )).scalar_one_or_none()
    if existing is not None:
        return None

    entry = SellerLedgerEntry(
        seller_id=seller_id,
        entry_type=entry_type,
        amount_inr=amount_inr,
        reference_id=reference_id,
        transaction_id=transaction_id,
        payout_id=payout_id,
        memo=(memo or "")[:300] or None,
        created_by=created_by,
    )
    db.add(entry)
    try:
        await db.flush()
    except IntegrityError:
        # Concurrent poster won the unique(reference_id) race — idempotent.
        await db.rollback()
        logger.info("ledger.duplicate_reference", reference_id=reference_id)
        return None

    logger.info(
        "ledger.posted",
        seller_id=str(seller_id),
        entry_type=entry_type,
        amount=str(amount_inr),
        reference_id=reference_id,
    )
    return entry


async def post_sale_credit(
    db: AsyncSession,
    *,
    seller_id: UUID,
    transaction_id: UUID,
    net_payout: Decimal,
    memo: str | None = None,
) -> SellerLedgerEntry | None:
    """Credit the seller once the buyer-protection window has closed
    (completed / auto_completed). Idempotent per transaction."""
    if net_payout <= 0:
        logger.warning(
            "ledger.sale_credit_nonpositive_skipped",
            transaction_id=str(transaction_id),
            net_payout=str(net_payout),
        )
        return None
    return await post_entry(
        db,
        seller_id=seller_id,
        entry_type=ENTRY_SALE_CREDIT,
        amount_inr=net_payout,
        reference_id=sale_reference(transaction_id),
        transaction_id=transaction_id,
        memo=memo or "Sale settled after buyer-protection window",
    )


async def post_refund_clawback(
    db: AsyncSession,
    *,
    seller_id: UUID,
    transaction_id: UUID,
    memo: str | None = None,
) -> SellerLedgerEntry | None:
    """Reverse a prior sale credit after a completed refund/return.

    Posts only if a sale_credit exists for the transaction (before the
    credit there is nothing to claw back — the payout simply never becomes
    eligible). Amount mirrors the credit, negated. Idempotent per
    transaction."""
    credit = (await db.execute(
        select(SellerLedgerEntry).where(
            SellerLedgerEntry.reference_id == sale_reference(transaction_id)
        )
    )).scalar_one_or_none()
    if credit is None:
        return None
    return await post_entry(
        db,
        seller_id=seller_id,
        entry_type=ENTRY_REFUND_CLAWBACK,
        amount_inr=-Decimal(str(credit.amount_inr)),
        reference_id=clawback_reference(transaction_id),
        transaction_id=transaction_id,
        memo=memo or "Refund/return completed after settlement",
    )


async def post_payout_debit(
    db: AsyncSession,
    *,
    seller_id: UUID,
    payout_id: UUID,
    amount_inr: Decimal,
    created_by: str,
) -> SellerLedgerEntry | None:
    return await post_entry(
        db,
        seller_id=seller_id,
        entry_type=ENTRY_PAYOUT_DEBIT,
        amount_inr=-abs(amount_inr),
        reference_id=payout_reference(payout_id),
        payout_id=payout_id,
        memo="Payout released",
        created_by=created_by,
    )


async def available_balance(db: AsyncSession, seller_id: UUID) -> Decimal:
    """Σ all ledger entries for the seller. May be negative after clawbacks."""
    total = (await db.execute(
        select(func.coalesce(func.sum(SellerLedgerEntry.amount_inr), 0)).where(
            SellerLedgerEntry.seller_id == seller_id
        )
    )).scalar()
    return Decimal(str(total or 0))


async def sellers_with_positive_balance(db: AsyncSession) -> list[tuple[UUID, Decimal]]:
    """Finance queue source: sellers whose available balance is > 0."""
    rows = (await db.execute(
        select(
            SellerLedgerEntry.seller_id,
            func.sum(SellerLedgerEntry.amount_inr).label("balance"),
        )
        .group_by(SellerLedgerEntry.seller_id)
        .having(func.sum(SellerLedgerEntry.amount_inr) > 0)
        .order_by(func.sum(SellerLedgerEntry.amount_inr).desc())
    )).all()
    return [(row.seller_id, Decimal(str(row.balance))) for row in rows]
