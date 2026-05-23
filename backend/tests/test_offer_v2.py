"""Sprint 6b offer v2 mechanics tests.

Covers the four invariants from SPRINT_6_BRIEF.md §2.4:
  - Buyer can update offer price up to 3 times, then it's locked.
  - Seller counter has a 48h clock (counter_expires_at).
  - Reject sets a 7-day lockout on (buyer, listing).
  - make_offer rejects when lockout is active OR an active offer exists.

These run against the dev Postgres (the only DB whose schema matches the
SQLAlchemy models — they use server_default=text("now()") which SQLite
doesn't speak). Each test wraps its work in an outer transaction that
rolls back at the end, so no data persists.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.settings import settings
from app.modules.offers.models import Offer, Reservation, Transaction
from app.modules.identity_auth.models import User
from app.modules.listings.models import Category, Listing
from app.modules.listings.service import create_snapshot
from app.modules.offers.service import (
    buyer_confirm_deal,
    confirm_seller_readiness,
    counter_offer,
    decline_seller_readiness,
    make_offer,
    reject_offer,
    update_offer_price,
)


# ── Postgres + savepoint fixture ─────────────────────────────────────────────

# Function-scoped engine with NullPool. asyncpg pools cache per event loop;
# pytest-asyncio creates a fresh loop per test under STRICT mode, so any
# pool that survives a test gets its connections orphaned. NullPool +
# per-test engine sidesteps that entirely.
from sqlalchemy.pool import NullPool


@pytest_asyncio.fixture
async def db():
    """Yield an AsyncSession bound to a transaction that rolls back at
    the end — keeps the dev DB clean of test artifacts."""
    engine = create_async_engine(
        settings.database_url, echo=False, poolclass=NullPool,
    )
    async with engine.connect() as conn:
        outer = await conn.begin()
        Session = async_sessionmaker(bind=conn, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            try:
                yield session
            finally:
                # asyncpg connections occasionally end up bound to a
                # different event loop after a test catches a ValueError;
                # the rollback then crashes during teardown even though
                # the assertion passed. Swallow the teardown noise — the
                # connection is going to be discarded anyway since this
                # engine is per-test with NullPool.
                try:
                    await outer.rollback()
                except RuntimeError:
                    pass


async def _seed_listing_and_users(db: AsyncSession):
    """Make a buyer, a seller, and one active listing — the minimum needed
    for the offer flow. The whole test runs inside a rolled-back outer
    transaction, so cleanup is automatic."""
    buyer = User(
        phone_number=f"+91900000{uuid4().hex[:4]}",
        phone_verified=True,
        kyc_status="not_started",
    )
    seller = User(
        phone_number=f"+91900000{uuid4().hex[:4]}",
        phone_verified=True,
        kyc_status="verified",
    )
    db.add_all([buyer, seller])
    await db.flush()

    # Reuse any active category in the live schema to satisfy the FK.
    cat = (await db.execute(select(Category).limit(1))).scalar_one_or_none()
    if cat is None:
        cat = Category(name=f"TestCat-{uuid4().hex[:6]}", slug=f"test-{uuid4().hex[:6]}", is_active=True)
        db.add(cat)
        await db.flush()

    listing = Listing(
        seller_id=seller.id,
        category_id=cat.id,
        title="Test phone",
        description="Test",
        price=Decimal("10000"),
        condition="good",
        city="Bangalore",
        state="Karnataka",
        status="active",
        moderation_status="approved",
    )
    db.add(listing)
    await db.flush()
    return buyer, seller, listing


def _address_snapshot(user_id, role: str, name: str) -> dict:
    return {
        "snapshot_version": 1,
        "source": "test",
        "role": role,
        "user_id": str(user_id),
        "full_name": name,
        "phone_number": "9999999999",
        "lat": 12.9716,
        "lng": 77.5946,
        "flat_house_number": "12",
        "address_line_1": "Pilot Street",
        "locality": "Indiranagar",
        "city": "Bengaluru",
        "state": "Karnataka",
        "pincode": "560038",
        "full_address": "12, Pilot Street, Indiranagar, Bengaluru, Karnataka, 560038",
    }


async def _seed_paid_transaction(
    db: AsyncSession,
    *,
    buyer_snapshot: bool = True,
    seller_snapshot: bool = True,
):
    buyer, seller, listing = await _seed_listing_and_users(db)
    now = datetime.now(timezone.utc)
    offer = Offer(
        listing_id=listing.id,
        buyer_id=buyer.id,
        seller_id=seller.id,
        offered_price=Decimal("9000"),
        status="accepted",
        expires_at=now + timedelta(hours=24),
        responded_at=now,
    )
    db.add(offer)
    await db.flush()

    listing.status = "reserved"
    reservation = Reservation(
        offer_id=offer.id,
        listing_id=listing.id,
        buyer_id=buyer.id,
        seller_id=seller.id,
        agreed_price=Decimal("9000"),
        status="active",
        expires_at=now + timedelta(hours=48),
        activated_at=now,
    )
    db.add(reservation)
    await db.flush()

    snapshot = await create_snapshot(db, listing.id, reservation.id)
    txn = Transaction(
        reservation_id=reservation.id,
        listing_id=listing.id,
        buyer_id=buyer.id,
        seller_id=seller.id,
        listing_snapshot_id=snapshot.id,
        transaction_type="shipped",
        payment_method="upi",
        gross_amount=Decimal("9000"),
        delivery_fee=Decimal("0"),
        net_payout=Decimal("9000"),
        status="payment_captured",
        seller_response_deadline=now + timedelta(hours=4),
        seller_readiness_status="pending",
        buyer_delivery_address_snapshot=(
            _address_snapshot(buyer.id, "buyer_delivery", "Buyer Test")
            if buyer_snapshot else None
        ),
        seller_pickup_address_snapshot=(
            _address_snapshot(seller.id, "seller_pickup", "Seller Test")
            if seller_snapshot else None
        ),
    )
    db.add(txn)
    await db.flush()
    return buyer, seller, listing, txn


# ── update_offer_price ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_price_increments_count_and_remaining_decrements(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    assert offer.update_count == 0

    o1 = await update_offer_price(db, offer.id, buyer.id, Decimal("9200"))
    assert o1.update_count == 1
    assert o1.offered_price == Decimal("9200")

    o2 = await update_offer_price(db, offer.id, buyer.id, Decimal("9400"))
    assert o2.update_count == 2

    o3 = await update_offer_price(db, offer.id, buyer.id, Decimal("9500"))
    assert o3.update_count == 3


@pytest.mark.asyncio
async def test_update_price_locks_after_three(db):
    """Sprint 6b §2.4: 'After 3 updates, offer is locked — seller must respond.'"""
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    for new in (Decimal("9100"), Decimal("9200"), Decimal("9300")):
        await update_offer_price(db, offer.id, buyer.id, new)
    with pytest.raises(ValueError, match="UPDATE_LIMIT_REACHED"):
        await update_offer_price(db, offer.id, buyer.id, Decimal("9400"))


@pytest.mark.asyncio
async def test_update_price_only_owner_can_update(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    other_user_id = uuid4()
    with pytest.raises(ValueError, match="OFFER_NOT_FOUND"):
        await update_offer_price(db, offer.id, other_user_id, Decimal("9100"))


@pytest.mark.asyncio
async def test_update_price_blocked_after_counter(db):
    """Once seller counters, only accept/reject is allowed — no more
    buyer-side price updates per the spec."""
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    await counter_offer(db, offer.id, seller.id, Decimal("8500"))
    with pytest.raises(ValueError, match=r"INVALID_STATUS:countered"):
        await update_offer_price(db, offer.id, buyer.id, Decimal("9100"))


@pytest.mark.asyncio
async def test_update_price_rejects_zero_or_negative(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    with pytest.raises(ValueError, match="INVALID_PRICE"):
        await update_offer_price(db, offer.id, buyer.id, Decimal("0"))


# ── counter_offer 48h clock ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_counter_sets_48h_expiry(db):
    """Sprint 6b §2.4: 'Counter-offer expiry: 48 hours.'"""
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    before = datetime.now(timezone.utc)
    countered = await counter_offer(db, offer.id, seller.id, Decimal("8500"))
    after = datetime.now(timezone.utc)
    assert countered.status == "countered"
    assert countered.counter_expires_at is not None
    # Should be ~48h after counter time, allow ±1 minute slop.
    expected_min = before + timedelta(hours=48) - timedelta(minutes=1)
    expected_max = after + timedelta(hours=48) + timedelta(minutes=1)
    assert expected_min <= countered.counter_expires_at <= expected_max


@pytest.mark.asyncio
async def test_counter_predictively_sets_lockout(db):
    """If the buyer never responds to the counter, the 7-day cooldown
    should already be set so the lockout-check at make-offer time
    enforces it without needing a background sweeper."""
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    countered = await counter_offer(db, offer.id, seller.id, Decimal("8500"))
    assert countered.lockout_until is not None
    # lockout = counter_expires_at + 7 days
    assert countered.lockout_until == countered.counter_expires_at + timedelta(days=7)


# ── reject_offer 7-day cooldown ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reject_sets_seven_day_lockout(db):
    """Sprint 6b §2.4: 'If offer expires or is rejected: buyer in 7-day
    cooldown on that listing.'"""
    buyer, seller, listing = await _seed_listing_and_users(db)
    offer = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    before = datetime.now(timezone.utc)
    rejected = await reject_offer(db, offer.id, seller.id, "Too low")
    assert rejected.status == "rejected"
    assert rejected.lockout_until is not None
    expected_min = before + timedelta(days=7) - timedelta(minutes=1)
    assert rejected.lockout_until >= expected_min


# ── make_offer — lockout + duplicate guards ──────────────────────────────────

@pytest.mark.asyncio
async def test_make_offer_blocked_during_lockout(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    o1 = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    await reject_offer(db, o1.id, seller.id, "Too low")

    with pytest.raises(ValueError, match="LOCKOUT_ACTIVE"):
        await make_offer(db, listing.id, buyer.id, Decimal("9500"))


@pytest.mark.asyncio
async def test_make_offer_allowed_after_lockout_expiry(db):
    """The lockout is per (buyer, listing); after it lapses, a new offer
    is fine. We simulate by writing a past lockout_until directly."""
    buyer, seller, listing = await _seed_listing_and_users(db)
    o1 = await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    await reject_offer(db, o1.id, seller.id, "Too low")
    # Backdate the rejected offer's lockout so it's already lapsed.
    rej = (await db.execute(
        __import__("sqlalchemy").select(Offer).where(Offer.id == o1.id)
    )).scalar_one()
    rej.lockout_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.flush()

    o2 = await make_offer(db, listing.id, buyer.id, Decimal("9500"))
    assert o2.status == "pending"


@pytest.mark.asyncio
async def test_make_offer_blocks_duplicate_active(db):
    buyer, seller, listing = await _seed_listing_and_users(db)
    await make_offer(db, listing.id, buyer.id, Decimal("9000"))
    await db.flush()
    with pytest.raises(ValueError, match="OFFER_ALREADY_EXISTS"):
        await make_offer(db, listing.id, buyer.id, Decimal("9500"))


# ── Seller readiness gate after captured payment ─────────────────────────────

@pytest.mark.asyncio
async def test_seller_readiness_confirm_opens_pickup_assignment(db):
    buyer, seller, listing, txn = await _seed_paid_transaction(db)

    ready = await confirm_seller_readiness(db, txn.id, seller.id)

    assert ready.status == "payment_captured"
    assert ready.seller_readiness_status == "confirmed"
    assert ready.seller_responded_at is not None
    assert ready.pickup_ready_at is not None
    assert ready.buyer_delivery_address_snapshot["full_name"] == "Buyer Test"
    assert ready.seller_pickup_address_snapshot["full_name"] == "Seller Test"


@pytest.mark.asyncio
async def test_seller_readiness_requires_pickup_address_snapshot(db):
    buyer, seller, listing, txn = await _seed_paid_transaction(db, seller_snapshot=False)

    with pytest.raises(ValueError, match="PICKUP_ADDRESS_REQUIRED"):
        await confirm_seller_readiness(db, txn.id, seller.id)


@pytest.mark.asyncio
async def test_seller_readiness_decline_cancels_and_suppresses_listing(db):
    buyer, seller, listing, txn = await _seed_paid_transaction(db)

    declined = await decline_seller_readiness(
        db,
        txn.id,
        seller.id,
        reason="sold_elsewhere",
    )

    assert declined.status == "cancelled"
    assert declined.seller_readiness_status == "declined"
    assert declined.cancelled_reason == "seller_sold_elsewhere"
    assert listing.status == "sold_elsewhere"


@pytest.mark.asyncio
async def test_buyer_cannot_confirm_before_delivery(db):
    buyer, seller, listing, txn = await _seed_paid_transaction(db)

    with pytest.raises(ValueError, match=r"INVALID_STATUS:payment_captured"):
        await buyer_confirm_deal(db, txn.id, buyer.id)
