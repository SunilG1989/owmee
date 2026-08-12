"""Seller settlement path: ledger idempotency, the delivered auto-complete
sweeper, refund clawback, and manual payout release.

Design under test: docs/OWMEE_SELLER_PAYOUTS.md. Runs against the dev
Postgres with rolled-back outer-transaction isolation (same pattern as
test_commerce_safety).
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.settings import settings
from app.modules.identity_auth.models import User
from app.modules.listings.models import Category, Listing
from app.modules.listings.service import create_snapshot
from app.modules.offers.models import Offer, Reservation, Transaction
from app.modules.settlement import ledger as ledger_service
from app.modules.settlement.accounts import (
    active_payout_account,
    mask_payout_destination,
    record_verified_payout_account,
)
from app.modules.settlement.models import SellerLedgerEntry
from app.modules.settlement.payouts import PayoutError, release_seller_payout
from app.modules.settlement.service import auto_complete_due_delivered_transactions


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(settings.database_url, echo=False, poolclass=NullPool)
    try:
        Session = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            await session.begin()
            try:
                yield session
            finally:
                await session.rollback()
    finally:
        await engine.dispose()


@pytest.fixture(autouse=True)
def quiet_notify(monkeypatch):
    async def noop_notify(*_args, **_kwargs):
        return None

    import app.modules.offers.service as offer_service

    monkeypatch.setattr(offer_service, "_notify", noop_notify)


async def _seed_delivered_txn(db: AsyncSession, *, deadline_delta_hours: int):
    buyer = User(phone_number=f"+91900000{uuid4().hex[:4]}", phone_verified=True,
                 kyc_status="verified", buyer_eligible=True, seller_tier="full",
                 auth_state="otp_verified")
    seller = User(phone_number=f"+91900000{uuid4().hex[:4]}", phone_verified=True,
                  kyc_status="verified", seller_tier="full")
    db.add_all([buyer, seller])
    await db.flush()

    cat = (await db.execute(select(Category).limit(1))).scalar_one_or_none()
    if cat is None:
        cat = Category(name=f"TestCat-{uuid4().hex[:6]}", slug=f"test-{uuid4().hex[:6]}",
                       is_active=True)
        db.add(cat)
        await db.flush()

    listing = Listing(seller_id=seller.id, category_id=cat.id, title="Settle phone",
                      description="Test", price=Decimal("10000"), condition="good",
                      city="Bangalore", state="Karnataka", status="reserved",
                      moderation_status="approved")
    db.add(listing)
    await db.flush()

    now = datetime.now(timezone.utc)
    offer = Offer(listing_id=listing.id, buyer_id=buyer.id, seller_id=seller.id,
                  offered_price=Decimal("9000"), status="accepted",
                  expires_at=now + timedelta(hours=24), responded_at=now)
    db.add(offer)
    await db.flush()
    reservation = Reservation(offer_id=offer.id, listing_id=listing.id, buyer_id=buyer.id,
                              seller_id=seller.id, agreed_price=Decimal("9000"),
                              status="active", expires_at=now + timedelta(hours=48),
                              activated_at=now)
    db.add(reservation)
    await db.flush()
    snapshot = await create_snapshot(db, listing.id, reservation.id)
    txn = Transaction(reservation_id=reservation.id, listing_id=listing.id,
                      buyer_id=buyer.id, seller_id=seller.id,
                      listing_snapshot_id=snapshot.id, transaction_type="shipped",
                      payment_method="upi", gross_amount=Decimal("9000"),
                      delivery_fee=Decimal("0"), net_payout=Decimal("9000"),
                      status="delivered",
                      confirmation_deadline=now + timedelta(hours=deadline_delta_hours),
                      payout_flagged_at=now - timedelta(hours=24))
    db.add(txn)
    await db.flush()
    return buyer, seller, listing, txn


# ── Ledger canon ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sale_credit_is_idempotent_per_transaction(db):
    seller_id = uuid4()
    txn_id = uuid4()

    first = await ledger_service.post_sale_credit(
        db, seller_id=seller_id, transaction_id=txn_id, net_payout=Decimal("9000"))
    replay = await ledger_service.post_sale_credit(
        db, seller_id=seller_id, transaction_id=txn_id, net_payout=Decimal("9000"))

    assert first is not None
    assert replay is None
    assert await ledger_service.available_balance(db, seller_id) == Decimal("9000")


@pytest.mark.asyncio
async def test_clawback_posts_only_after_credit_and_once(db):
    seller_id = uuid4()
    txn_id = uuid4()

    premature = await ledger_service.post_refund_clawback(
        db, seller_id=seller_id, transaction_id=txn_id)
    assert premature is None

    await ledger_service.post_sale_credit(
        db, seller_id=seller_id, transaction_id=txn_id, net_payout=Decimal("9000"))
    clawback = await ledger_service.post_refund_clawback(
        db, seller_id=seller_id, transaction_id=txn_id)
    replay = await ledger_service.post_refund_clawback(
        db, seller_id=seller_id, transaction_id=txn_id)

    assert clawback is not None
    assert Decimal(str(clawback.amount_inr)) == Decimal("-9000")
    assert replay is None
    assert await ledger_service.available_balance(db, seller_id) == Decimal("0")


# ── Auto-complete sweeper ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sweeper_settles_delivered_past_deadline(db):
    _, seller, listing, txn = await _seed_delivered_txn(db, deadline_delta_hours=-1)

    completed = await auto_complete_due_delivered_transactions(db)

    assert completed == 1
    assert txn.status == "auto_completed"
    assert txn.completed_at is not None
    assert listing.status == "sold"
    entry = (await db.execute(
        select(SellerLedgerEntry).where(
            SellerLedgerEntry.reference_id == ledger_service.sale_reference(txn.id))
    )).scalar_one()
    assert entry.entry_type == "sale_credit"
    # A second sweep finds nothing (status moved) and posts nothing new.
    assert await auto_complete_due_delivered_transactions(db) == 0


@pytest.mark.asyncio
async def test_sweeper_leaves_open_window_alone(db):
    _, _, _, txn = await _seed_delivered_txn(db, deadline_delta_hours=+12)

    completed = await auto_complete_due_delivered_transactions(db)

    assert completed == 0
    assert txn.status == "delivered"


# ── Payout destination ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_payout_account_recorded_and_masked(db):
    user_id = uuid4()

    first = await record_verified_payout_account(
        db, user_id=user_id, account_type="upi", account_value="ravi@okaxis",
        ifsc_code=None, provider_ref="digio_ref_1")
    assert first.masked_display == "ra***@okaxis"

    replacement = await record_verified_payout_account(
        db, user_id=user_id, account_type="bank", account_value="12345678901234",
        ifsc_code="HDFC0001234", provider_ref="digio_ref_2")

    active = await active_payout_account(db, user_id)
    assert active is not None
    assert active.id == replacement.id
    assert active.masked_display == "••••1234 · HDFC0001234"
    assert first.is_active is False


def test_mask_never_exposes_full_value():
    assert "@" in mask_payout_destination("upi", "someone@ybl")
    assert "someone" not in mask_payout_destination("upi", "someone@ybl")
    assert mask_payout_destination("bank", "99887766554433").endswith("4433")
    assert "9988" not in mask_payout_destination("bank", "99887766554433")


# ── Release ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_release_full_balance_and_utr_idempotency(db):
    _, seller, _, txn = await _seed_delivered_txn(db, deadline_delta_hours=-1)
    await auto_complete_due_delivered_transactions(db)
    await record_verified_payout_account(
        db, user_id=seller.id, account_type="upi", account_value="seller@upi",
        ifsc_code=None, provider_ref="ref")

    payout = await release_seller_payout(
        db, seller_id=seller.id, utr_reference="UTR1234567", initiated_by="admin-1")

    assert Decimal(str(payout.amount_inr)) == Decimal("9000")
    assert await ledger_service.available_balance(db, seller.id) == Decimal("0")
    assert txn.payout_released_at is not None

    replay = await release_seller_payout(
        db, seller_id=seller.id, utr_reference="UTR1234567", initiated_by="admin-1")
    assert replay.id == payout.id

    with pytest.raises(PayoutError, match="NO_AVAILABLE_BALANCE"):
        await release_seller_payout(
            db, seller_id=seller.id, utr_reference="UTR7654321", initiated_by="admin-1")


@pytest.mark.asyncio
async def test_release_requires_verified_account(db):
    _, seller, _, _ = await _seed_delivered_txn(db, deadline_delta_hours=-1)
    await auto_complete_due_delivered_transactions(db)

    with pytest.raises(PayoutError, match="NO_VERIFIED_PAYOUT_ACCOUNT"):
        await release_seller_payout(
            db, seller_id=seller.id, utr_reference="UTR1234567", initiated_by="admin-1")
