"""Seller-facing settlement surface: balances, ledger, payout history.

Meesho-style seller money view: reserve (custody established, protection
window still open), available (settled, awaiting the next payout run), and
what has already been paid with which reference.
"""
from __future__ import annotations

from decimal import Decimal

import structlog
from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.dependencies import BasicUser, DBSession
from app.modules.offers.models import Transaction
from app.modules.settlement.accounts import active_payout_account
from app.modules.settlement.ledger import available_balance
from app.modules.settlement.models import SellerLedgerEntry, SellerPayout

logger = structlog.get_logger()
router = APIRouter()

RESERVE_STATUSES = ("at_hub", "delivery_in_progress", "delivered")


@router.get("/me/payouts")
async def my_payouts(current_user: BasicUser, db: DBSession):
    seller_id = current_user.user_id

    available = await available_balance(db, seller_id)

    # Reserve: custody established (payout processing started) but the
    # buyer-protection window hasn't closed, so no ledger credit yet.
    reserve = (await db.execute(
        select(func.coalesce(func.sum(Transaction.net_payout), 0)).where(
            Transaction.seller_id == seller_id,
            Transaction.status.in_(RESERVE_STATUSES),
            Transaction.payout_flagged_at.is_not(None),
        )
    )).scalar()

    account = await active_payout_account(db, seller_id)

    entries = (await db.execute(
        select(SellerLedgerEntry)
        .where(SellerLedgerEntry.seller_id == seller_id)
        .order_by(SellerLedgerEntry.created_at.desc())
        .limit(50)
    )).scalars().all()

    payouts = (await db.execute(
        select(SellerPayout)
        .where(SellerPayout.seller_id == seller_id)
        .order_by(SellerPayout.created_at.desc())
        .limit(20)
    )).scalars().all()

    return {
        "available_balance": str(available),
        "reserve_balance": str(Decimal(str(reserve or 0))),
        "payout_account": (
            {
                "account_type": account.account_type,
                "masked_display": account.masked_display,
                "verified": account.verified_at is not None,
            }
            if account
            else None
        ),
        "ledger": [
            {
                "entry_type": e.entry_type,
                "amount": str(e.amount_inr),
                "memo": e.memo,
                "transaction_id": str(e.transaction_id) if e.transaction_id else None,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in entries
        ],
        "payouts": [
            {
                "id": str(p.id),
                "amount": str(p.amount_inr),
                "method": p.method,
                "utr_reference": p.utr_reference,
                "status": p.status,
                "paid_at": p.paid_at.isoformat() if p.paid_at else None,
            }
            for p in payouts
        ],
    }
