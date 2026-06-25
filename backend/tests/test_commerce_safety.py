"""Money-safety regression tests for Wave 2 commerce hardening.

Covers:
  - Counter 48h window enforced server-side at accept (S7).
  - A countered offer can be rejected and arms the cooldown (M6).
  - DB-level uniqueness for active offers and ratings (H4).
  - Dispute resolution actually moves money via the shared path (C1/S2/H1).
  - Payment webhook rejects underpayment (S8).

Runs against the dev Postgres using the same rolled-back outer-transaction
isolation as test_offer_v2 (no data persists).
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.settings import settings
from app.modules.identity_auth.models import User
from app.modules.listings.models import Category, Listing
from app.modules.listings.service import create_snapshot
from app.modules.offers.models import Offer, PaymentLink, Rating, Reservation, Transaction
from app.modules.offers.service import (
    accept_offer,
    cancel_unpaid_transaction,
    counter_offer,
    expire_due_unpaid_transactions,
    make_offer,
    process_payment_paid,
    reject_offer,
)


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


async def _seed_listing_and_users(db: AsyncSession):
    buyer = User(phone_number=f"+91900000{uuid4().hex[:4]}", phone_verified=True, kyc_status="verified",
                 buyer_eligible=True, seller_tier="full", auth_state="otp_verified")
    seller = User(phone_number=f"+91900000{uuid4().hex[:4]}", phone_verified=True, kyc_status="verified",
                  seller_tier="full")
    db.add_all([buyer, seller])
    await db.flush()

    cat = (await db.execute(select(Category).limit(1))).scalar_one_or_none()
    if cat is None:
        cat = Category(name=f"TestCat-{uuid4().hex[:6]}", slug=f"test-{uuid4().hex[:6]}", is_active=True)
        db.add(cat)
        await db.flush()

    listing = Listing(
        seller_id=seller.id, category_id=cat.id, title="Test phone", description="Test",
        price=Decimal("10000"), condition="good", city="Bangalore", state="Karnataka",
        status="active", moderation_status="approved",
    )
    db.add(listing)
    await db.flush()
    return buyer, seller, listing


async def _seed_refundable_txn(db: AsyncSession, *, listing_status="reserved"):
    """A captured transaction with a paid PaymentLink that initiate_refund can
    act on (razorpay_payment_id present)."""
    buyer, seller, listing = await _seed_listing_and_users(db)
    listing.status = listing_status
    now = datetime.now(timezone.utc)
    offer = Offer(listing_id=listing.id, buyer_id=buyer.id, seller_id=seller.id,
                  offered_price=Decimal("9000"), status="accepted",
                  expires_at=now + timedelta(hours=24), responded_at=now)
    db.add(offer)
    await db.flush()
    reservation = Reservation(offer_id=offer.id, listing_id=listing.id, buyer_id=buyer.id,
                              seller_id=seller.id, agreed_price=Decimal("9000"), status="active",
                              expires_at=now + timedelta(hours=48), activated_at=now)
    db.add(reservation)
    await db.flush()
    snapshot = await create_snapshot(db, listing.id, reservation.id)
    txn = Transaction(reservation_id=reservation.id, listing_id=listing.id, buyer_id=buyer.id,
                      seller_id=seller.id, listing_snapshot_id=snapshot.id, transaction_type="shipped",
                      payment_method="upi", gross_amount=Decimal("9000"), delivery_fee=Decimal("0"),
                      net_payout=Decimal("9000"), status="delivered")
    db.add(txn)
    await db.flush()
    pl = PaymentLink(transaction_id=txn.id, razorpay_link_id=f"link_{uuid4().hex[:8]}",
                     short_url="https://rzp.io/x", amount=Decimal("9000"), status="paid",
                     razorpay_payment_id=f"pay_{uuid4().hex[:8]}",
                     idempotency_key=uuid4().hex, expires_at=now + timedelta(hours=1))
    db.add(pl)
    await db.flush()
    return buyer, seller, listing, txn, pl


async def _seed_unpaid_txn(db: AsyncSession):
    buyer, seller, listing = await _seed_listing_and_users(db)
    listing.status = "reserved"
    now = datetime.now(timezone.utc)
    offer = Offer(listing_id=listing.id, buyer_id=buyer.id, seller_id=seller.id,
                  offered_price=Decimal("9000"), status="accepted",
                  expires_at=now + timedelta(hours=24), responded_at=now)
    db.add(offer)
    await db.flush()
    reservation = Reservation(offer_id=offer.id, listing_id=listing.id, buyer_id=buyer.id,
                              seller_id=seller.id, agreed_price=Decimal("9000"), status="active",
                              expires_at=now + timedelta(hours=48), activated_at=now)
    db.add(reservation)
    await db.flush()
    snapshot = await create_snapshot(db, listing.id, reservation.id)
    txn = Transaction(reservation_id=reservation.id, listing_id=listing.id, buyer_id=buyer.id,
                      seller_id=seller.id, listing_snapshot_id=snapshot.id, transaction_type="shipped",
                      payment_method="upi", gross_amount=Decimal("9000"), delivery_fee=Decimal("0"),
                      net_payout=Decimal("9000"), status="payment_pending")
    db.add(txn)
    await db.flush()
    pl = PaymentLink(transaction_id=txn.id, razorpay_link_id=f"order_{uuid4().hex[:12]}",
                     short_url=None, amount=Decimal("9000"), status="failed",
                     idempotency_key=uuid4().hex, expires_at=now + timedelta(minutes=30))
    db.add(pl)
    await db.flush()
    return buyer, seller, listing, offer, reservation, txn, pl


# ── S7: counter window enforced at accept ────────────────────────────────────

@pytest.mark.asyncio
async def test_accept_expired_counter_is_rejected(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    await counter_offer(db, offer.id, seller.id, Decimal("8500"))
    # Force the counter window into the past.
    offer.counter_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    await db.flush()
    with pytest.raises(ValueError, match="COUNTER_EXPIRED"):
        await accept_offer(db, offer.id, buyer.id)


@pytest.mark.asyncio
async def test_accept_live_counter_still_works(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    await counter_offer(db, offer.id, seller.id, Decimal("8500"))
    # Counter window is in the future (set by counter_offer) — accept succeeds.
    acc_offer, reservation, txn, _link = await accept_offer(db, offer.id, buyer.id)
    assert acc_offer.status == "accepted"
    assert txn.gross_amount == Decimal("8500")  # agreed counter price, no delivery fee


@pytest.mark.asyncio
async def test_second_buyer_cannot_accept_after_listing_is_reserved(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    buyer2 = User(
        phone_number=f"+91900000{uuid4().hex[:4]}",
        phone_verified=True,
        kyc_status="verified",
        buyer_eligible=True,
        seller_tier="full",
        auth_state="otp_verified",
    )
    db.add(buyer2)
    await db.flush()

    first_offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    second_offer = await make_offer(db, listing.id, buyer2.id, Decimal("9100"))
    await db.flush()

    _accepted, _reservation, first_txn, _link = await accept_offer(db, first_offer.id, seller.id)
    await db.flush()

    assert first_txn.status == "payment_pending"
    assert listing.status == "reserved"
    with pytest.raises(ValueError, match="LISTING_NO_LONGER_AVAILABLE"):
        await accept_offer(db, second_offer.id, seller.id)


# ── M6: reject a countered offer ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reject_countered_offer_arms_cooldown(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    await counter_offer(db, offer.id, seller.id, Decimal("8500"))
    rejected = await reject_offer(db, offer.id, seller.id, reason="changed mind")
    assert rejected.status == "rejected"
    assert rejected.lockout_until is not None
    assert rejected.lockout_until > datetime.now(timezone.utc)


# ── H4: DB-level uniqueness backstops ────────────────────────────────────────

@pytest.mark.asyncio
async def test_unique_active_offer_index(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    now = datetime.now(timezone.utc)
    db.add(Offer(listing_id=listing.id, buyer_id=buyer.id, seller_id=seller.id,
                 offered_price=Decimal("9000"), status="pending", expires_at=now + timedelta(hours=24)))
    await db.flush()
    db.add(Offer(listing_id=listing.id, buyer_id=buyer.id, seller_id=seller.id,
                 offered_price=Decimal("9100"), status="pending", expires_at=now + timedelta(hours=24)))
    with pytest.raises(IntegrityError):
        await db.flush()


@pytest.mark.asyncio
async def test_unique_rating_index(db):
    _b, _s, _l, txn, _pl = await _seed_refundable_txn(db)
    rater = txn.buyer_id
    db.add(Rating(transaction_id=txn.id, rater_id=rater, ratee_id=txn.seller_id,
                  role="buyer", stars=5))
    await db.flush()
    db.add(Rating(transaction_id=txn.id, rater_id=rater, ratee_id=txn.seller_id,
                  role="buyer", stars=1))
    with pytest.raises(IntegrityError):
        await db.flush()


# ── C1 / S2 / H1: dispute resolution moves money ─────────────────────────────

@pytest.mark.asyncio
async def test_dispute_full_refund_moves_money_and_reopens_listing(db):
    from app.modules.disputes.resolution import apply_dispute_resolution

    _b, _s, listing, txn, _pl = await _seed_refundable_txn(db, listing_status="disputed")
    out = await apply_dispute_resolution(
        db, dispute=None, txn=txn, resolution="full_refund",
        resolution_note="item not received", initiated_by="admin",
    )
    await db.flush()
    # The dev payment adapter reports refunds as processed -> completed.
    assert out["refund_status"] in ("completed", "processing")
    assert txn.status == "refunded"
    assert txn.refund_amount == Decimal("9000")
    assert listing.status == "active"


@pytest.mark.asyncio
async def test_dispute_partial_refund_honors_amount(db):
    from app.modules.disputes.resolution import apply_dispute_resolution

    _b, _s, _l, txn, _pl = await _seed_refundable_txn(db)
    out = await apply_dispute_resolution(
        db, dispute=None, txn=txn, resolution="partial_refund",
        resolution_note="minor defect", refund_amount=Decimal("2500"), initiated_by="admin",
    )
    await db.flush()
    assert txn.refund_amount == Decimal("2500")  # NOT the full 9000
    assert out["refund_status"] in ("completed", "processing")


# ── S8: webhook underpayment is held, not captured ───────────────────────────

@pytest.mark.asyncio
async def test_webhook_underpayment_is_held(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    now = datetime.now(timezone.utc)
    listing.status = "reserved"
    reservation = Reservation(offer_id=None, listing_id=listing.id, buyer_id=buyer.id,
                              seller_id=seller.id, agreed_price=Decimal("9000"), status="active",
                              expires_at=now + timedelta(hours=48), activated_at=now)
    # offer_id is nullable? if not, create an offer first
    offer = Offer(listing_id=listing.id, buyer_id=buyer.id, seller_id=seller.id,
                  offered_price=Decimal("9000"), status="accepted",
                  expires_at=now + timedelta(hours=24), responded_at=now)
    db.add(offer)
    await db.flush()
    reservation.offer_id = offer.id
    db.add(reservation)
    await db.flush()
    snapshot = await create_snapshot(db, listing.id, reservation.id)
    txn = Transaction(reservation_id=reservation.id, listing_id=listing.id, buyer_id=buyer.id,
                      seller_id=seller.id, listing_snapshot_id=snapshot.id, transaction_type="shipped",
                      payment_method="upi", gross_amount=Decimal("9000"), delivery_fee=Decimal("0"),
                      net_payout=Decimal("9000"), status="payment_pending")
    db.add(txn)
    await db.flush()
    link_id = f"link_{uuid4().hex[:8]}"
    pl = PaymentLink(transaction_id=txn.id, razorpay_link_id=link_id, short_url="https://rzp.io/x",
                     amount=Decimal("9000"), status="created", idempotency_key=uuid4().hex,
                     expires_at=now + timedelta(hours=1))
    db.add(pl)
    await db.flush()

    # Webhook claims only ₹1 (100 paise) was captured against a ₹9000 order.
    underpaid = {"payload": {"payment": {"entity": {"amount": 100}}}}
    out = await process_payment_paid(db, link_id, "pay_x", underpaid)
    assert out is not None
    assert out.status == "payment_capture_uncertain"


@pytest.mark.asyncio
async def test_cancel_unpaid_transaction_releases_reserved_listing(db):
    buyer, _seller, listing, offer, reservation, txn, payment_attempt = await _seed_unpaid_txn(db)

    out = await cancel_unpaid_transaction(db, txn.id, buyer.id, reason="payment_failed")
    await db.flush()

    assert out is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_failed"
    assert listing.status == "active"
    assert reservation.status == "cancelled"
    assert reservation.cancelled_at is not None
    assert offer.status == "cancelled"
    assert offer.reject_reason == "payment_failed"
    assert payment_attempt.status == "failed"


@pytest.mark.asyncio
async def test_payment_timeout_sweep_releases_abandoned_order(db):
    _buyer, _seller, listing, offer, reservation, txn, payment_attempt = await _seed_unpaid_txn(db)
    payment_attempt.status = "created"
    payment_attempt.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db.flush()

    expired = await expire_due_unpaid_transactions(db, limit=10)
    await db.flush()

    assert expired == 1
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_timeout"
    assert listing.status == "active"
    assert reservation.status == "cancelled"
    assert offer.status == "cancelled"
    assert payment_attempt.status == "expired"
