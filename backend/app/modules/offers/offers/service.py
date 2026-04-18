"""
Offers service — business logic for Epic 4.

Covers:
- Make offer (verified buyer)
- Counter-offer (verified seller)
- Accept offer (verified seller)
- Reject offer
- Withdraw offer (buyer)
- Create transaction from accepted offer
- Create payment link
- Confirm deal (buyer, 48h window)
- Auto-confirm on deadline expiry
- Submit rating at deal close
- Wishlist add/remove
- In-app notification creation
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.offers.models import (
    NotificationEvent, Offer, PaymentLink, Rating, Reservation,
    Transaction, Wishlist,
)
from app.modules.listings.models import Listing
from app.modules.listings.service import create_snapshot

logger = structlog.get_logger()

OFFER_EXPIRY_HOURS = 24
RESERVATION_EXPIRY_HOURS = 48
CONFIRMATION_WINDOW_HOURS = 48
PAYMENT_LINK_EXPIRY_MINUTES = 30


# ── Notifications ───────────────────────────────────────────────────────────────

async def _notify(
    db: AsyncSession,
    user_id: UUID,
    event_type: str,
    title: str,
    body: str,
    entity_type: str,
    entity_id: str,
) -> None:
    n = NotificationEvent(
        user_id=user_id,
        event_type=event_type,
        title=title,
        body=body,
        entity_type=entity_type,
        entity_id=str(entity_id),
    )
    db.add(n)


# ── Offer logic ─────────────────────────────────────────────────────────────────

async def make_offer(
    db: AsyncSession,
    listing_id: UUID,
    buyer_id: UUID,
    offered_price: Decimal,
) -> Offer:
    """
    Buyer makes an offer on a listing.
    - Listing must be active
    - Buyer must not be the seller
    - Only one pending/countered offer per buyer per listing
    """
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing or listing.status != "active":
        raise ValueError("LISTING_NOT_AVAILABLE")
    if listing.seller_id == buyer_id:
        raise ValueError("CANNOT_OFFER_OWN_LISTING")
    if offered_price <= 0:
        raise ValueError("INVALID_PRICE")

    # Check for existing active offer from this buyer on this listing
    existing = await db.execute(
        select(Offer).where(
            and_(
                Offer.listing_id == listing_id,
                Offer.buyer_id == buyer_id,
                Offer.status.in_(["pending", "countered"]),
            )
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("OFFER_ALREADY_EXISTS")

    expires_at = datetime.now(timezone.utc) + timedelta(hours=OFFER_EXPIRY_HOURS)
    offer = Offer(
        listing_id=listing_id,
        buyer_id=buyer_id,
        seller_id=listing.seller_id,
        offered_price=offered_price,
        status="pending",
        expires_at=expires_at,
    )
    db.add(offer)
    await db.flush()

    await _notify(
        db, listing.seller_id,
        "offer_received",
        "New offer received",
        f"You received an offer of ₹{offered_price:,.0f} on '{listing.title}'",
        "offer", str(offer.id),
    )
    logger.info("offer.created", offer_id=str(offer.id), listing_id=str(listing_id))
    return offer


async def counter_offer(
    db: AsyncSession,
    offer_id: UUID,
    seller_id: UUID,
    counter_price: Decimal,
) -> Offer:
    """
    Seller counters a pending offer.
    Original offer moves to 'countered' status.
    """
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer:
        raise ValueError("OFFER_NOT_FOUND")
    if offer.seller_id != seller_id:
        raise ValueError("NOT_YOUR_OFFER")
    if offer.status != "pending":
        raise ValueError(f"INVALID_STATUS:{offer.status}")
    if counter_price <= 0 or counter_price >= offer.offered_price:
        raise ValueError("COUNTER_MUST_BE_LESS_THAN_OFFER")

    offer.status = "countered"
    offer.counter_price = counter_price
    offer.counter_offered_at = datetime.now(timezone.utc)
    # Extend expiry for buyer to respond
    offer.expires_at = datetime.now(timezone.utc) + timedelta(hours=OFFER_EXPIRY_HOURS)

    await _notify(
        db, offer.buyer_id,
        "offer_countered",
        "Seller made a counter-offer",
        f"Seller countered at ₹{counter_price:,.0f}. Accept or let it expire.",
        "offer", str(offer.id),
    )
    logger.info("offer.countered", offer_id=str(offer_id), counter_price=str(counter_price))
    return offer


async def accept_offer(
    db: AsyncSession,
    offer_id: UUID,
    seller_id: UUID,
) -> tuple[Offer, Reservation, Transaction, PaymentLink]:
    """
    Seller accepts an offer (pending or buyer accepting counter).
    Creates: reservation → listing snapshot → transaction → payment link.
    """
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer:
        raise ValueError("OFFER_NOT_FOUND")

    # Either seller accepting buyer's offer, OR buyer accepting counter-offer
    is_seller_accepting = (offer.seller_id == seller_id and offer.status == "pending")
    is_buyer_accepting_counter = (offer.buyer_id == seller_id and offer.status == "countered")
    if not (is_seller_accepting or is_buyer_accepting_counter):
        raise ValueError("CANNOT_ACCEPT")

    # Check listing is still active
    listing_result = await db.execute(select(Listing).where(Listing.id == offer.listing_id))
    listing = listing_result.scalar_one_or_none()
    if not listing or listing.status != "active":
        raise ValueError("LISTING_NO_LONGER_AVAILABLE")

    # Determine the agreed price
    agreed_price = offer.counter_price if is_buyer_accepting_counter else offer.offered_price

    now = datetime.now(timezone.utc)
    offer.status = "accepted"
    offer.responded_at = now

    # Reserve listing
    listing.status = "reserved"

    # Create reservation
    reservation = Reservation(
        offer_id=offer.id,
        listing_id=offer.listing_id,
        buyer_id=offer.buyer_id,
        seller_id=offer.seller_id,
        agreed_price=agreed_price,
        status="active",
        expires_at=now + timedelta(hours=RESERVATION_EXPIRY_HOURS),
        activated_at=now,
    )
    db.add(reservation)
    await db.flush()

    # Freeze listing snapshot
    snapshot = await create_snapshot(db, offer.listing_id, reservation.id)

    # Create transaction
    transaction = Transaction(
        reservation_id=reservation.id,
        listing_id=offer.listing_id,
        buyer_id=offer.buyer_id,
        seller_id=offer.seller_id,
        listing_snapshot_id=snapshot.id,
        transaction_type="local",
        gross_amount=agreed_price,
        net_payout=agreed_price,
        status="payment_pending",
        confirmation_deadline=now + timedelta(hours=CONFIRMATION_WINDOW_HOURS),
    )
    db.add(transaction)
    await db.flush()

    # Create payment link via adapter
    from app.modules.payments.adapter import get_payment_adapter
    from app.modules.identity_auth.models import User

    buyer_result = await db.execute(select(User).where(User.id == offer.buyer_id))
    buyer = buyer_result.scalar_one_or_none()
    buyer_phone = buyer.phone_number if buyer else ""

    idempotency_key = hashlib.sha256(f"txn:{transaction.id}:v1".encode()).hexdigest()[:64]
    adapter = get_payment_adapter()
    link_result = await adapter.create_payment_link(
        amount_paise=int(agreed_price * 100),
        transaction_id=str(transaction.id),
        buyer_phone=buyer_phone,
        description=f"Owmee payment for {listing.title[:60]}",
        idempotency_key=idempotency_key,
        expire_minutes=PAYMENT_LINK_EXPIRY_MINUTES,
    )

    if not link_result.success:
        raise ValueError(f"PAYMENT_LINK_FAILED:{link_result.error}")

    payment_link = PaymentLink(
        transaction_id=transaction.id,
        razorpay_link_id=link_result.razorpay_link_id,
        short_url=link_result.short_url,
        amount=agreed_price,
        status="created",
        idempotency_key=idempotency_key,
        expires_at=link_result.expires_at,
    )
    db.add(payment_link)

    # Notify buyer
    await _notify(
        db, offer.buyer_id,
        "offer_accepted",
        "Your offer was accepted!",
        f"Pay ₹{agreed_price:,.0f} to confirm the deal. Link expires in {PAYMENT_LINK_EXPIRY_MINUTES} minutes.",
        "transaction", str(transaction.id),
    )

    logger.info("offer.accepted", offer_id=str(offer_id), transaction_id=str(transaction.id))
    return offer, reservation, transaction, payment_link


async def reject_offer(
    db: AsyncSession,
    offer_id: UUID,
    seller_id: UUID,
    reason: str = "",
) -> Offer:
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer or offer.seller_id != seller_id:
        raise ValueError("OFFER_NOT_FOUND")
    if offer.status not in ("pending",):
        raise ValueError(f"INVALID_STATUS:{offer.status}")
    offer.status = "rejected"
    offer.responded_at = datetime.now(timezone.utc)
    offer.reject_reason = reason[:100] if reason else None
    await _notify(
        db, offer.buyer_id,
        "offer_rejected",
        "Your offer was not accepted",
        "The seller has passed on your offer. You can make a new offer.",
        "offer", str(offer.id),
    )
    return offer


async def withdraw_offer(db: AsyncSession, offer_id: UUID, buyer_id: UUID) -> Offer:
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer or offer.buyer_id != buyer_id:
        raise ValueError("OFFER_NOT_FOUND")
    if offer.status not in ("pending", "countered"):
        raise ValueError(f"INVALID_STATUS:{offer.status}")
    offer.status = "withdrawn"
    offer.responded_at = datetime.now(timezone.utc)
    return offer


# ── Payment webhook processing ──────────────────────────────────────────────────

async def process_payment_paid(
    db: AsyncSession,
    razorpay_link_id: str,
    razorpay_payment_id: str,
    webhook_payload: dict,
) -> Transaction | None:
    """
    Called when Razorpay fires payment_link.paid webhook.
    Idempotent — safe to call multiple times with same link_id.
    """
    result = await db.execute(
        select(PaymentLink).where(PaymentLink.razorpay_link_id == razorpay_link_id)
    )
    pl = result.scalar_one_or_none()
    if not pl:
        logger.warning("webhook.payment_link_not_found", link_id=razorpay_link_id)
        return None

    # Idempotency — already processed
    if pl.status == "paid":
        logger.info("webhook.already_processed", link_id=razorpay_link_id)
        return None

    now = datetime.now(timezone.utc)
    pl.status = "paid"
    pl.paid_at = now
    pl.razorpay_payment_id = razorpay_payment_id
    pl.webhook_payload = webhook_payload

    # Advance transaction
    txn_result = await db.execute(select(Transaction).where(Transaction.id == pl.transaction_id))
    txn = txn_result.scalar_one_or_none()
    if not txn:
        return None

    txn.status = "payment_captured"
    txn.confirmation_deadline = now + timedelta(hours=CONFIRMATION_WINDOW_HOURS)

    # Notify seller
    await _notify(
        db, txn.seller_id,
        "payment_confirmed",
        "Payment received!",
        f"Buyer has paid ₹{txn.gross_amount:,.0f}. Schedule your meetup.",
        "transaction", str(txn.id),
    )
    await _notify(
        db, txn.buyer_id,
        "payment_confirmed",
        "Payment sent successfully",
        "Your payment is confirmed. Arrange meetup with the seller.",
        "transaction", str(txn.id),
    )
    logger.info("payment.confirmed", transaction_id=str(txn.id), payment_id=razorpay_payment_id)
    return txn


# ── Deal confirmation ───────────────────────────────────────────────────────────

async def buyer_confirm_deal(
    db: AsyncSession,
    transaction_id: UUID,
    buyer_id: UUID,
) -> Transaction:
    """
    Buyer confirms item received and as described.
    Closes transaction, flags payout for finance ops.
    """
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.buyer_id != buyer_id:
        raise ValueError("NOT_YOUR_TRANSACTION")
    if txn.status not in ("payment_captured", "awaiting_confirmation"):
        raise ValueError(f"INVALID_STATUS:{txn.status}")

    now = datetime.now(timezone.utc)
    txn.status = "completed"
    txn.buyer_confirmed_at = now
    txn.completed_at = now
    txn.payout_flagged_at = now

    # Mark listing as sold
    listing_result = await db.execute(select(Listing).where(Listing.id == txn.listing_id))
    listing = listing_result.scalar_one_or_none()
    if listing:
        listing.status = "sold"

    await _notify(
        db, txn.seller_id,
        "deal_confirmed",
        "Deal confirmed — payout queued",
        f"Buyer confirmed the deal. Payout of ₹{txn.net_payout:,.0f} will be processed by our team.",
        "transaction", str(txn.id),
    )
    logger.info("deal.confirmed", transaction_id=str(transaction_id))
    return txn


# ── Ratings ─────────────────────────────────────────────────────────────────────

async def submit_rating(
    db: AsyncSession,
    transaction_id: UUID,
    rater_id: UUID,
    stars: int,
    comment: str | None,
) -> Rating:
    """Submit a 1-5 star rating after deal completion. One per rater per transaction."""
    if not 1 <= stars <= 5:
        raise ValueError("INVALID_STARS")

    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.status not in ("completed", "auto_completed"):
        raise ValueError("DEAL_NOT_COMPLETE")
    if rater_id not in (txn.buyer_id, txn.seller_id):
        raise ValueError("NOT_YOUR_TRANSACTION")

    ratee_id = txn.seller_id if rater_id == txn.buyer_id else txn.buyer_id
    role = "buyer" if rater_id == txn.buyer_id else "seller"

    # Check not already rated
    existing = await db.execute(
        select(Rating).where(
            and_(Rating.transaction_id == transaction_id, Rating.rater_id == rater_id)
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("ALREADY_RATED")

    rating = Rating(
        transaction_id=transaction_id,
        rater_id=rater_id,
        ratee_id=ratee_id,
        role=role,
        stars=stars,
        comment=comment[:500] if comment else None,
    )
    db.add(rating)

    # Update ratee trust score (simple average increment)
    from app.modules.identity_auth.models import User
    user_result = await db.execute(select(User).where(User.id == ratee_id))
    user = user_result.scalar_one_or_none()
    if user:
        # Simple weighted nudge: move score toward (stars * 20)
        target = stars * 20
        user.trust_score = int(user.trust_score * 0.9 + target * 0.1)

    await _notify(
        db, ratee_id,
        "rating_received",
        f"You received a {stars}-star rating",
        comment[:100] if comment else "No comment left.",
        "transaction", str(transaction_id),
    )
    logger.info("rating.submitted", transaction_id=str(transaction_id), stars=stars)
    return rating


# ── Wishlist ─────────────────────────────────────────────────────────────────────

async def add_to_wishlist(db: AsyncSession, user_id: UUID, listing_id: UUID) -> Wishlist:
    # Check listing exists
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    if not result.scalar_one_or_none():
        raise ValueError("LISTING_NOT_FOUND")

    # Check not already wishlisted
    existing = await db.execute(
        select(Wishlist).where(
            and_(Wishlist.user_id == user_id, Wishlist.listing_id == listing_id)
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("ALREADY_WISHLISTED")

    w = Wishlist(user_id=user_id, listing_id=listing_id)
    db.add(w)
    await db.flush()
    return w


async def remove_from_wishlist(db: AsyncSession, user_id: UUID, listing_id: UUID) -> None:
    result = await db.execute(
        select(Wishlist).where(
            and_(Wishlist.user_id == user_id, Wishlist.listing_id == listing_id)
        )
    )
    w = result.scalar_one_or_none()
    if not w:
        raise ValueError("NOT_IN_WISHLIST")
    await db.delete(w)
