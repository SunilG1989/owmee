"""
Offers service — business logic.

India UX review changes (v2):
- Tiered offer expiry: 24h <5K, 48h 5K–20K, 72h >20K
- Offer note field (buyer context with offer)
- Payment link expiry: 30min <5K, 24h >=5K
- Cash at meetup option (payment_method=cash)
- Seller ghosting: seller_response_deadline = payment_captured + 4h
- Meetup coordination: agreed_meetup_at + cancel window
- Cancel at meetup: 30-min window after agreed_meetup_at
- Blind mutual rating: hidden until both rate or 7 days
- Rating delayed 2h after deal complete
- Price-drop wishlist notification
- Duplicate listing warning on publish
- Post-listing approval buyer count notification
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import structlog
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.service import push as push_notify
from app.modules.chat.adapter import open_offer_channel
from app.modules.risk.engine import check_offer_spam, adjust_trust_score, check_listing_risk
from app.modules.offers.models import (
    NotificationEvent, NotificationPreference, Offer, PaymentLink,
    Rating, Reservation, Transaction, Wishlist,
)
from app.modules.listings.models import Listing
from app.modules.listings.service import create_snapshot

# Sprint 5a: analytics hook
from app.modules.analytics import track

logger = structlog.get_logger()

# ── Tunable constants ──────────────────────────────────────────────────────────
RESERVATION_EXPIRY_HOURS = 48
CONFIRMATION_WINDOW_HOURS = 48
RATING_DELAY_HOURS = 2          # Rate available 2h after deal complete
BLIND_RATING_DAYS = 7           # Reveal ratings after 7 days if peer hasn't rated
SELLER_RESPONSE_HOURS = 4       # Auto-escalate if seller silent after payment
MEETUP_CANCEL_MINUTES = 30      # Cancel-at-meetup window after agreed_meetup_at


def _offer_expiry_hours(price: Decimal) -> int:
    """Tiered expiry: India family decision cycle awareness."""
    if price < 5000:
        return 24
    elif price < 20000:
        return 48
    else:
        return 72


def _payment_link_expiry_minutes(amount: Decimal) -> int:
    """24h for amounts ≥₹5K — Indian family consultation time."""
    return 30 if amount < 5000 else 1440


# ── Notification helpers ────────────────────────────────────────────────────────

async def _prefs(db: AsyncSession, user_id: UUID) -> NotificationPreference | None:
    r = await db.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == user_id)
    )
    return r.scalar_one_or_none()


async def _notify(
    db: AsyncSession,
    user_id: UUID,
    event_type: str,
    title: str,
    body: str,
    entity_type: str,
    entity_id: str,
    bucket: str = "transaction",
) -> None:
    """
    Create in-app notification, respecting user preferences.
    Transactions bucket is always on — cannot be disabled.
    """
    if bucket != "transaction":
        prefs = await _prefs(db, user_id)
        if prefs:
            if bucket == "message" and not prefs.messages_enabled:
                return
            if bucket == "promotion" and not prefs.promotions_enabled:
                return

    # Use savepoint so notification failure never rolls back the main transaction
    try:
        async with db.begin_nested():
            n = NotificationEvent(
                user_id=user_id,
                event_type=event_type,
                notification_bucket=bucket,
                title=title,
                body=body,
                entity_type=entity_type,
                entity_id=str(entity_id),
            )
            db.add(n)
    except Exception as e:
        logger.warning("notification.failed", error=str(e), event_type=event_type)

    # Best-effort FCM push (never blocks main transaction)
    try:
        import asyncio
        asyncio.create_task(push_notify(user_id, event_type, title, body,
                                        entity_type=entity_type, entity_id=str(entity_id) if entity_id else None))
    except Exception:
        pass


# ── Offer logic ─────────────────────────────────────────────────────────────────

async def make_offer(
    db: AsyncSession,
    listing_id: UUID,
    buyer_id: UUID,
    offered_price: Decimal,
    offer_note: str | None = None,
) -> Offer:
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing or listing.status != "active":
        raise ValueError("LISTING_NOT_AVAILABLE")
    if listing.seller_id == buyer_id:
        raise ValueError("CANNOT_OFFER_OWN_LISTING")
    if offered_price <= 0:
        raise ValueError("INVALID_PRICE")

    existing = await db.execute(
        select(Offer).where(and_(
            Offer.listing_id == listing_id,
            Offer.buyer_id == buyer_id,
            Offer.status.in_(["pending", "countered"]),
        ))
    )
    if existing.scalar_one_or_none():
        raise ValueError("OFFER_ALREADY_EXISTS")

    # Risk: spam detection (5+ rejected offers in 24h)
    spam = await check_offer_spam(buyer_id, listing_id)
    if spam.get("should_block"):
        raise ValueError(f"OFFER_SPAM:{spam['message']}")

    expiry_hours = _offer_expiry_hours(offered_price)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    offer = Offer(
        listing_id=listing_id,
        buyer_id=buyer_id,
        seller_id=listing.seller_id,
        offered_price=offered_price,
        offer_note=offer_note[:200] if offer_note else None,
        status="pending",
        expires_at=expires_at,
    )
    db.add(offer)
    await db.flush()

    note_hint = f' · "{offer_note[:40]}"' if offer_note else ""
    await _notify(
        db, listing.seller_id,
        "offer_received",
        "New offer received",
        f"₹{offered_price:,.0f} offer on '{listing.title}'{note_hint}",
        "offer", str(offer.id), bucket="message",
    )
    logger.info("offer.created", offer_id=str(offer.id), price=str(offered_price), expiry_h=expiry_hours)
    return offer


async def counter_offer(
    db: AsyncSession,
    offer_id: UUID,
    seller_id: UUID,
    counter_price: Decimal,
) -> Offer:
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
    offer.expires_at = datetime.now(timezone.utc) + timedelta(hours=_offer_expiry_hours(counter_price))

    await _notify(
        db, offer.buyer_id,
        "offer_countered",
        "Counter-offer received",
        f"Seller countered at ₹{counter_price:,.0f} — accept or let it expire",
        "offer", str(offer.id), bucket="message",
    )
    return offer


async def accept_offer(
    db: AsyncSession,
    offer_id: UUID,
    seller_id: UUID,
) -> tuple[Offer, Reservation, Transaction, PaymentLink | None]:
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer:
        raise ValueError("OFFER_NOT_FOUND")

    is_seller_accepting = (offer.seller_id == seller_id and offer.status == "pending")
    is_buyer_accepting_counter = (offer.buyer_id == seller_id and offer.status == "countered")
    if not (is_seller_accepting or is_buyer_accepting_counter):
        raise ValueError("CANNOT_ACCEPT")

    listing_result = await db.execute(select(Listing).where(Listing.id == offer.listing_id))
    listing = listing_result.scalar_one_or_none()
    if not listing or listing.status != "active":
        raise ValueError("LISTING_NO_LONGER_AVAILABLE")

    agreed_price = offer.counter_price if is_buyer_accepting_counter else offer.offered_price
    now = datetime.now(timezone.utc)
    offer.status = "accepted"
    offer.responded_at = now
    listing.status = "reserved"

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

    snapshot = await create_snapshot(db, offer.listing_id, reservation.id)

    # Determine payment method from offer context — default UPI
    payment_method = "upi"

    txn = Transaction(
        reservation_id=reservation.id,
        listing_id=offer.listing_id,
        buyer_id=offer.buyer_id,
        seller_id=offer.seller_id,
        listing_snapshot_id=snapshot.id,
        transaction_type="local",
        payment_method=payment_method,
        gross_amount=agreed_price,
        net_payout=agreed_price,
        status="payment_pending",
        confirmation_deadline=now + timedelta(hours=CONFIRMATION_WINDOW_HOURS),
    )
    db.add(txn)
    await db.flush()

    # Sprint 5a: analytics event — fires for both UPI and cash deals
    await track(
        db,
        event_name="offer_accepted",
        actor_user_id=seller_id,
        actor_type="user",
        entity_type="offer",
        entity_id=str(offer.id),
        properties={
            "transaction_id": str(txn.id),
            "listing_id": str(offer.listing_id),
            "agreed_price": float(agreed_price),
            "payment_method": payment_method,
        },
    )

    # Create payment link for UPI transactions
    payment_link = None
    if payment_method == "upi":
        from app.modules.payments.adapter import get_payment_adapter
        from app.modules.identity_auth.models import User
        buyer_result = await db.execute(select(User).where(User.id == offer.buyer_id))
        buyer = buyer_result.scalar_one_or_none()
        buyer_phone = buyer.phone_number if buyer else ""

        idempotency_key = hashlib.sha256(f"txn:{txn.id}:v1".encode()).hexdigest()[:64]
        adapter = get_payment_adapter()
        expiry_minutes = _payment_link_expiry_minutes(agreed_price)
        link_result = await adapter.create_payment_link(
            amount_paise=int(agreed_price * 100),
            transaction_id=str(txn.id),
            description=f"Owmee: {listing.title[:50]}",
            buyer_phone=buyer_phone,
            idempotency_key=idempotency_key,
            expire_minutes=expiry_minutes,
        )
        if not link_result.success:
            raise ValueError("PAYMENT_LINK_FAILED")

        payment_link = PaymentLink(
            transaction_id=txn.id,
            razorpay_link_id=link_result.razorpay_link_id,
            short_url=link_result.short_url,
            amount=agreed_price,
            status="created",
            idempotency_key=idempotency_key,
            expires_at=now + timedelta(minutes=expiry_minutes),
        )
        db.add(payment_link)

        expiry_label = "24 hours" if expiry_minutes >= 1440 else "30 minutes"
        await _notify(
            db, offer.buyer_id, "offer_accepted",
            f"{listing.title[:30]} — offer accepted!",
            f"Pay ₹{agreed_price:,.0f} to confirm. Link valid for {expiry_label}.",
            "transaction", str(txn.id),
        )
    else:
        # Cash deal — move directly to awaiting_confirmation
        txn.status = "awaiting_confirmation"
        await _notify(
            db, offer.buyer_id, "offer_accepted",
            f"{listing.title[:30]} — offer accepted!",
            f"Cash deal at ₹{agreed_price:,.0f}. Arrange meetup with the seller.",
            "transaction", str(txn.id),
        )

    await _notify(
        db, offer.seller_id, "offer_accepted_seller",
        "You accepted the offer",
        f"Deal at ₹{agreed_price:,.0f}. Buyer will arrange meetup.",
        "transaction", str(txn.id),
    )
    # Open chat channel for buyer-seller communication
    import asyncio
    asyncio.create_task(open_offer_channel(offer.id, txn.buyer_id, txn.seller_id))

    return offer, reservation, txn, payment_link


async def accept_offer_cash(
    db: AsyncSession,
    offer_id: UUID,
    seller_id: UUID,
) -> tuple[Offer, Reservation, Transaction]:
    """Accept offer with cash payment method — skips payment link."""
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer or offer.seller_id != seller_id or offer.status != "pending":
        raise ValueError("CANNOT_ACCEPT")

    listing_result = await db.execute(select(Listing).where(Listing.id == offer.listing_id))
    listing = listing_result.scalar_one_or_none()
    if not listing or listing.status != "active":
        raise ValueError("LISTING_NO_LONGER_AVAILABLE")

    now = datetime.now(timezone.utc)
    offer.status = "accepted"
    offer.responded_at = now
    listing.status = "reserved"

    reservation = Reservation(
        offer_id=offer.id, listing_id=offer.listing_id,
        buyer_id=offer.buyer_id, seller_id=offer.seller_id,
        agreed_price=offer.offered_price, status="active",
        expires_at=now + timedelta(hours=RESERVATION_EXPIRY_HOURS),
        activated_at=now,
    )
    db.add(reservation)
    await db.flush()

    snapshot = await create_snapshot(db, offer.listing_id, reservation.id)
    txn = Transaction(
        reservation_id=reservation.id, listing_id=offer.listing_id,
        buyer_id=offer.buyer_id, seller_id=offer.seller_id,
        listing_snapshot_id=snapshot.id, transaction_type="local",
        payment_method="cash", gross_amount=offer.offered_price,
        net_payout=offer.offered_price, status="awaiting_confirmation",
        confirmation_deadline=now + timedelta(hours=CONFIRMATION_WINDOW_HOURS),
    )
    db.add(txn)
    await db.flush()

    await _notify(db, offer.buyer_id, "offer_accepted",
        f"{listing.title[:30]} — cash deal accepted!",
        f"Cash at meetup: ₹{offer.offered_price:,.0f}. Arrange meetup time with seller.",
        "transaction", str(txn.id))
    return offer, reservation, txn


async def reject_offer(db, offer_id, seller_id, reason=""):
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer or offer.seller_id != seller_id:
        raise ValueError("OFFER_NOT_FOUND")
    if offer.status not in ("pending",):
        raise ValueError(f"INVALID_STATUS:{offer.status}")
    offer.status = "rejected"
    offer.responded_at = datetime.now(timezone.utc)
    offer.reject_reason = reason[:100] if reason else None
    await _notify(db, offer.buyer_id, "offer_rejected",
        "Offer not accepted",
        "The seller passed on your offer. Make a new offer or browse more listings.",
        "offer", str(offer.id), bucket="message")
    return offer


async def withdraw_offer(db, offer_id, buyer_id):
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer or offer.buyer_id != buyer_id:
        raise ValueError("OFFER_NOT_FOUND")
    if offer.status not in ("pending", "countered"):
        raise ValueError(f"INVALID_STATUS:{offer.status}")
    offer.status = "withdrawn"
    offer.responded_at = datetime.now(timezone.utc)
    return offer


# ── Payment processing ──────────────────────────────────────────────────────────

async def process_payment_paid(db, razorpay_link_id, razorpay_payment_id, webhook_payload):
    result = await db.execute(
        select(PaymentLink).where(PaymentLink.razorpay_link_id == razorpay_link_id)
    )
    pl = result.scalar_one_or_none()
    if not pl:
        logger.warning("webhook.payment_link_not_found", link_id=razorpay_link_id)
        return None
    if pl.status == "paid":
        return None

    now = datetime.now(timezone.utc)
    pl.status = "paid"
    pl.paid_at = now
    pl.razorpay_payment_id = razorpay_payment_id
    pl.webhook_payload = webhook_payload

    txn_result = await db.execute(select(Transaction).where(Transaction.id == pl.transaction_id))
    txn = txn_result.scalar_one_or_none()
    if not txn:
        return None

    txn.status = "payment_captured"
    txn.confirmation_deadline = now + timedelta(hours=CONFIRMATION_WINDOW_HOURS)
    # Seller ghosting deadline: 4h to respond with meetup time
    txn.seller_response_deadline = now + timedelta(hours=SELLER_RESPONSE_HOURS)

    await _notify(db, txn.seller_id, "payment_confirmed",
        "Payment received — arrange meetup",
        f"₹{txn.gross_amount:,.0f} paid. Reply within 4 hours to arrange meetup.",
        "transaction", str(txn.id))
    await _notify(db, txn.buyer_id, "payment_confirmed",
        "Payment confirmed",
        f"₹{txn.gross_amount:,.0f} sent. Seller will contact you to arrange meetup.",
        "transaction", str(txn.id))
    logger.info("payment.confirmed", transaction_id=str(txn.id))
    return txn


# ── Meetup coordination ─────────────────────────────────────────────────────────

async def confirm_meetup_time(
    db: AsyncSession,
    transaction_id: UUID,
    seller_id: UUID,
    meetup_at: datetime,
) -> Transaction:
    """Seller proposes/confirms a meetup time after payment."""
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.seller_id != seller_id:
        raise ValueError("NOT_YOUR_TRANSACTION")
    if txn.status not in ("payment_captured", "awaiting_confirmation"):
        raise ValueError(f"INVALID_STATUS:{txn.status}")
    if meetup_at <= datetime.now(timezone.utc):
        raise ValueError("MEETUP_TIME_MUST_BE_FUTURE")

    txn.agreed_meetup_at = meetup_at
    txn.meetup_deadline = meetup_at + timedelta(minutes=MEETUP_CANCEL_MINUTES)
    txn.seller_responded_at = datetime.now(timezone.utc)

    await _notify(db, txn.buyer_id, "meetup_confirmed",
        "Meetup time set",
        f"Seller confirmed meetup time. Meet to inspect and complete the deal.",
        "transaction", str(txn.id))
    logger.info("meetup.confirmed", transaction_id=str(transaction_id))
    return txn


async def cancel_at_meetup(
    db: AsyncSession,
    transaction_id: UUID,
    buyer_id: UUID,
    reason: str,
) -> Transaction:
    """
    Buyer cancels at meetup — item doesn't match listing.
    Only available within MEETUP_CANCEL_MINUTES of agreed_meetup_at.
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
    # Enforce 30-min window if meetup time was set
    if txn.agreed_meetup_at and txn.meetup_deadline:
        if now > txn.meetup_deadline:
            raise ValueError("CANCEL_WINDOW_EXPIRED")

    txn.status = "cancelled_at_meetup"
    txn.cancelled_at_meetup_at = now
    txn.cancelled_reason = reason[:100] if reason else "Item does not match listing"

    # Reopen listing
    listing_result = await db.execute(select(Listing).where(Listing.id == txn.listing_id))
    listing = listing_result.scalar_one_or_none()
    if listing:
        listing.status = "active"

    await _notify(db, txn.seller_id, "cancelled_at_meetup",
        "Deal cancelled at meetup",
        f"Buyer cancelled: {txn.cancelled_reason}. Listing is back to active. Payout will be reversed.",
        "transaction", str(txn.id))
    await _notify(db, txn.buyer_id, "cancelled_at_meetup_buyer",
        "Deal cancelled — refund initiated",
        "Your payment will be refunded within 5-7 business days.",
        "transaction", str(txn.id))
    logger.info("deal.cancelled_at_meetup", transaction_id=str(transaction_id))
    return txn


# ── Deal confirmation ───────────────────────────────────────────────────────────

async def buyer_confirm_deal(db, transaction_id, buyer_id):
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
    # Update trust scores
    import asyncio
    asyncio.create_task(adjust_trust_score(txn.seller_id, "deal_completed", note="buyer_confirmed"))
    # Rating available 2h later
    txn.rate_available_at = now + timedelta(hours=RATING_DELAY_HOURS)

    listing_result = await db.execute(select(Listing).where(Listing.id == txn.listing_id))
    listing = listing_result.scalar_one_or_none()
    if listing:
        listing.status = "sold"

    await _notify(db, txn.seller_id, "deal_confirmed",
        "Deal confirmed — payout queued",
        f"₹{txn.net_payout:,.0f} payout being processed. Rate your buyer in 2 hours.",
        "transaction", str(txn.id))
    await _notify(db, txn.buyer_id, "deal_confirmed_buyer",
        "Deal complete",
        f"Great! Rate your experience with the seller in 2 hours.",
        "transaction", str(txn.id))
    logger.info("deal.confirmed", transaction_id=str(transaction_id))
    return txn


# ── Ratings (blind mutual reveal) ───────────────────────────────────────────────

async def submit_rating(
    db: AsyncSession,
    transaction_id: UUID,
    rater_id: UUID,
    stars: int,
    comment: str | None,
    item_as_described: str | None = None,  # yes | mostly | no
) -> Rating:
    if not 1 <= stars <= 5:
        raise ValueError("INVALID_STARS")
    if item_as_described and item_as_described not in ("yes", "mostly", "no"):
        raise ValueError("INVALID_ITEM_AS_DESCRIBED")

    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.status not in ("completed", "auto_completed"):
        raise ValueError("DEAL_NOT_COMPLETE")
    if rater_id not in (txn.buyer_id, txn.seller_id):
        raise ValueError("NOT_YOUR_TRANSACTION")

    # Enforce 2h delay
    now = datetime.now(timezone.utc)
    if txn.rate_available_at and now < txn.rate_available_at:
        raise ValueError("RATING_NOT_YET_AVAILABLE")

    ratee_id = txn.seller_id if rater_id == txn.buyer_id else txn.buyer_id
    role = "buyer" if rater_id == txn.buyer_id else "seller"

    existing = await db.execute(
        select(Rating).where(and_(Rating.transaction_id == transaction_id, Rating.rater_id == rater_id))
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
        item_as_described=item_as_described,
        # Not revealed yet — blind until peer rates or 7 days pass
        revealed_at=None,
    )
    db.add(rating)
    await db.flush()

    # Check if peer has also rated — if yes, reveal both
    peer_result = await db.execute(
        select(Rating).where(and_(Rating.transaction_id == transaction_id, Rating.rater_id == ratee_id))
    )
    peer_rating = peer_result.scalar_one_or_none()
    if peer_rating:
        # Both have rated — reveal now
        rating.revealed_at = now
        peer_rating.revealed_at = now
        # Update trust scores now that both are revealed
        await _update_trust_score(db, txn.seller_id, transaction_id)
        await _update_trust_score(db, txn.buyer_id, transaction_id)
        await _notify(db, ratee_id, "rating_revealed",
            "Ratings are now visible",
            f"Both ratings are revealed. You received {stars} stars.",
            "transaction", str(transaction_id))
    else:
        # First to rate — notify peer to also rate
        await _notify(db, ratee_id, "rate_reminder",
            "Rate your experience",
            "Deal complete — share your feedback. Ratings are revealed when both parties rate.",
            "transaction", str(transaction_id), bucket="message")

    logger.info("rating.submitted", transaction_id=str(transaction_id), stars=stars, revealed=bool(peer_rating))
    return rating


async def _update_trust_score(db: AsyncSession, user_id: UUID, transaction_id: UUID) -> None:
    """Recalculate trust score from revealed ratings only."""
    from app.modules.identity_auth.models import User
    ratings_result = await db.execute(
        select(Rating).where(
            and_(Rating.ratee_id == user_id, Rating.revealed_at != None)
        )
    )
    ratings = ratings_result.scalars().all()
    if not ratings:
        return
    avg = sum(r.stars for r in ratings) / len(ratings)
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user:
        user.trust_score = int(avg * 20)  # 5 stars = 100 trust score


# ── Wishlist + price-drop notification ─────────────────────────────────────────

async def add_to_wishlist(db, user_id, listing_id):
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    if not result.scalar_one_or_none():
        raise ValueError("LISTING_NOT_FOUND")
    existing = await db.execute(
        select(Wishlist).where(and_(Wishlist.user_id == user_id, Wishlist.listing_id == listing_id))
    )
    if existing.scalar_one_or_none():
        raise ValueError("ALREADY_WISHLISTED")
    w = Wishlist(user_id=user_id, listing_id=listing_id)
    db.add(w)
    await db.flush()
    return w


async def remove_from_wishlist(db, user_id, listing_id):
    result = await db.execute(
        select(Wishlist).where(and_(Wishlist.user_id == user_id, Wishlist.listing_id == listing_id))
    )
    w = result.scalar_one_or_none()
    if not w:
        raise ValueError("NOT_IN_WISHLIST")
    await db.delete(w)


async def notify_price_drop(db: AsyncSession, listing_id: UUID, old_price: Decimal, new_price: Decimal) -> int:
    """Notify all users who have this listing wishlisted of a price drop."""
    result = await db.execute(select(Wishlist).where(Wishlist.listing_id == listing_id))
    wishlisters = result.scalars().all()

    listing_result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = listing_result.scalar_one_or_none()
    title = listing.title[:40] if listing else "Item"

    for w in wishlisters:
        await _notify(
            db, w.user_id, "price_drop",
            "Price dropped on your wishlist item",
            f"{title} dropped from ₹{old_price:,.0f} to ₹{new_price:,.0f}",
            "listing", str(listing_id), bucket="promotion",
        )
    return len(wishlisters)
