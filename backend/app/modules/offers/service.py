"""
Offers service — business logic.

India UX review changes (v2):
- Tiered offer expiry: 24h <5K, 48h 5K–20K, 72h >20K
- Offer note field (buyer context with offer)
- Payment link expiry: 30min <5K, 24h >=5K
- Pickup readiness SLA: seller_response_deadline = payment_captured + 4h
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
from app.modules.risk.engine import check_offer_spam, adjust_trust_score, check_listing_risk
from app.modules.offers.models import (
    NotificationEvent, NotificationPreference, Offer, PaymentLink,
    Rating, Reservation, Transaction, Wishlist,
)
from app.modules.listings.models import Category, Listing
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


# ── Pricing — Owmee V1 model ──────────────────────────────────────────────
# Zero platform fee. ₹100 delivery fee on small-appliances only. Buyer
# pays (agreed_price + delivery_fee); seller receives (agreed_price - TDS);
# Owmee keeps delivery_fee.
DELIVERY_FEE_BY_CATEGORY: dict[str, Decimal] = {
    "small-appliances": Decimal("100"),
}


def delivery_fee_for(category_slug: str | None) -> Decimal:
    if not category_slug:
        return Decimal("0")
    return DELIVERY_FEE_BY_CATEGORY.get(category_slug, Decimal("0"))


# Sprint trust pillar: every product priced over ₹1000 gets FE-inspected
# at pickup. Items at or below ₹1000 are FE-collected only (no condition
# inspection) so we keep unit economics workable on small items.
FE_INSPECTION_PRICE_THRESHOLD: Decimal = Decimal("1000")


def requires_fe_inspection(price: Decimal | float | int | None) -> bool:
    if price is None:
        return False
    p = price if isinstance(price, Decimal) else Decimal(str(price))
    return p > FE_INSPECTION_PRICE_THRESHOLD


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
        asyncio.create_task(push_notify(
            user_id,
            event_type,
            title,
            body,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            persist_in_app=False,
        ))
    except Exception:
        pass


# ── Offer logic ─────────────────────────────────────────────────────────────────

async def make_offer(
    db: AsyncSession,
    listing_id: UUID,
    buyer_id: UUID,
    offered_price: Decimal,
) -> Offer:
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing or listing.status != "active":
        raise ValueError("LISTING_NOT_AVAILABLE")
    if listing.seller_id == buyer_id:
        raise ValueError("CANNOT_OFFER_OWN_LISTING")
    if offered_price <= 0:
        raise ValueError("INVALID_PRICE")

    # Sprint 6b: 7-day cooldown after rejection/counter-expiry. The
    # lockout_until column is set on the prior offer when it terminates
    # negatively; we just need to honor any future-dated value here.
    now = datetime.now(timezone.utc)
    lockout_result = await db.execute(
        select(func.max(Offer.lockout_until)).where(and_(
            Offer.buyer_id == buyer_id,
            Offer.listing_id == listing_id,
        ))
    )
    lockout = lockout_result.scalar_one_or_none()
    if lockout and lockout > now:
        raise ValueError("LOCKOUT_ACTIVE")

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
    spam = await check_offer_spam(buyer_id, listing_id, db=db)
    if spam.get("should_block"):
        raise ValueError(f"OFFER_SPAM:{spam['message']}")

    expiry_hours = _offer_expiry_hours(offered_price)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
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
        f"₹{offered_price:,.0f} offer on '{listing.title}'",
        "offer", str(offer.id),
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

    now = datetime.now(timezone.utc)
    offer.status = "countered"
    offer.counter_price = counter_price
    offer.counter_offered_at = now
    # Sprint 6b: counter has its own 48h clock. Buyer accepts/rejects within
    # this window, otherwise the offer expires and the 7-day lockout kicks in.
    offer.counter_expires_at = now + timedelta(hours=48)
    # Predictive lockout: if buyer never responds, this date is already
    # set. accept_offer clears it; rejection paths overwrite to a 7-day
    # window starting now.
    offer.lockout_until = offer.counter_expires_at + timedelta(days=7)
    offer.expires_at = offer.counter_expires_at

    await _notify(
        db, offer.buyer_id,
        "offer_countered",
        "Counter-offer received",
        f"Seller countered at ₹{counter_price:,.0f} — accept or let it expire",
        "offer", str(offer.id),
    )
    return offer


# Sprint 6b — buyer revises their offer price. Capped at 3 revisions.
async def update_offer_price(
    db: AsyncSession,
    offer_id: UUID,
    buyer_id: UUID,
    new_price: Decimal,
) -> Offer:
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer or offer.buyer_id != buyer_id:
        raise ValueError("OFFER_NOT_FOUND")
    if offer.status != "pending":
        # Once seller has countered, only accept/reject is allowed; once
        # accepted/rejected, it's terminal.
        raise ValueError(f"INVALID_STATUS:{offer.status}")
    if offer.update_count >= 3:
        raise ValueError("UPDATE_LIMIT_REACHED")
    if new_price <= 0:
        raise ValueError("INVALID_PRICE")

    offer.offered_price = new_price
    offer.update_count += 1
    # Refresh expiry to the tier appropriate for the new price.
    offer.expires_at = datetime.now(timezone.utc) + timedelta(
        hours=_offer_expiry_hours(new_price)
    )

    remaining = 3 - offer.update_count
    rem_text = f" ({remaining} update{'s' if remaining != 1 else ''} left)" if remaining > 0 else " (locked — seller must respond)"
    await _notify(
        db, offer.seller_id,
        "offer_updated",
        "Buyer updated their offer",
        f"New price: ₹{new_price:,.0f}{rem_text}",
        "offer", str(offer.id),
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

    # Lock the listing row to serialize concurrent accept attempts; without
    # this, two flows racing on the same listing could both pass the
    # status="active" check and both create reservations.
    listing_result = await db.execute(
        select(Listing).where(Listing.id == offer.listing_id).with_for_update()
    )
    listing = listing_result.scalar_one_or_none()
    if not listing or listing.status != "active":
        raise ValueError("LISTING_NO_LONGER_AVAILABLE")

    agreed_price = offer.counter_price if is_buyer_accepting_counter else offer.offered_price
    now = datetime.now(timezone.utc)
    offer.status = "accepted"
    offer.responded_at = now
    # Sprint 6b: clear the predictive lockout that counter_offer set —
    # accepted offers don't trigger a cooldown.
    offer.lockout_until = None
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

    # Pricing: zero platform fee, conditional delivery fee. Buyer pays
    # (agreed_price + delivery_fee); seller receives (agreed_price - TDS);
    # Owmee keeps delivery_fee.
    cat_result = await db.execute(
        select(Category.slug).where(Category.id == listing.category_id)
    )
    cat_slug = cat_result.scalar_one_or_none()
    fee = delivery_fee_for(cat_slug)
    buyer_pays = agreed_price + fee

    payment_method = "upi"  # Sprint 6c: direct seller-buyer handoff removed

    txn = Transaction(
        reservation_id=reservation.id,
        listing_id=offer.listing_id,
        buyer_id=offer.buyer_id,
        seller_id=offer.seller_id,
        listing_snapshot_id=snapshot.id,
        transaction_type="shipped",
        payment_method=payment_method,
        gross_amount=buyer_pays,
        delivery_fee=fee,
        # net_payout placeholder — final value computed at TDS time.
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
        expiry_minutes = _payment_link_expiry_minutes(buyer_pays)
        link_result = await adapter.create_payment_link(
            # buyer pays gross_amount = agreed_price + delivery_fee
            amount_paise=int(buyer_pays * 100),
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
            amount=buyer_pays,
            status="created",
            idempotency_key=idempotency_key,
            expires_at=now + timedelta(minutes=expiry_minutes),
        )
        db.add(payment_link)

        expiry_label = "24 hours" if expiry_minutes >= 1440 else "30 minutes"
        fee_note = f" (incl. ₹{int(fee)} delivery)" if fee > 0 else ""
        await _notify(
            db, offer.buyer_id, "offer_accepted",
            f"{listing.title[:30]} — offer accepted!",
            f"Pay ₹{buyer_pays:,.0f}{fee_note} to confirm. Link valid for {expiry_label}.",
            "transaction", str(txn.id),
        )
    else:
        # Cash deal — move directly to awaiting_confirmation
        txn.status = "awaiting_confirmation"
        await _notify(
            db, offer.buyer_id, "offer_accepted",
            f"{listing.title[:30]} — offer accepted!",
            f"Deal confirmed at ₹{agreed_price:,.0f}. Owmee will guide delivery next.",
            "transaction", str(txn.id),
        )

    await _notify(
        db, offer.seller_id, "offer_accepted_seller",
        "You accepted the offer",
        f"Deal at ₹{agreed_price:,.0f}. Owmee will guide packing and delivery.",
        "transaction", str(txn.id),
    )
    # Sprint 6b: chat removed. All buyer-seller communication is now
    # structured via offer mechanics + transaction status updates.

    return offer, reservation, txn, payment_link




async def reject_offer(db, offer_id, seller_id, reason=""):
    result = await db.execute(select(Offer).where(Offer.id == offer_id))
    offer = result.scalar_one_or_none()
    if not offer or offer.seller_id != seller_id:
        raise ValueError("OFFER_NOT_FOUND")
    if offer.status not in ("pending",):
        raise ValueError(f"INVALID_STATUS:{offer.status}")
    now = datetime.now(timezone.utc)
    offer.status = "rejected"
    offer.responded_at = now
    offer.reject_reason = reason[:100] if reason else None
    # Sprint 6b: 7-day cooldown on the (buyer, listing) pair.
    offer.lockout_until = now + timedelta(days=7)
    await _notify(db, offer.buyer_id, "offer_rejected",
        "Offer not accepted",
        "The seller passed on your offer. You can offer again on this listing in 7 days.",
        "offer", str(offer.id))
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
    # Lock the PaymentLink row so the (status check → status write)
    # sequence is atomic. Razorpay delivers `payment.captured` more than
    # once in normal operation; without the lock two concurrent webhook
    # deliveries would both see status != "paid", both update the txn,
    # both fire notifications, both reset confirmation_deadline.
    result = await db.execute(
        select(PaymentLink)
        .where(PaymentLink.razorpay_link_id == razorpay_link_id)
        .with_for_update()
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
    # Seller readiness deadline: surface stale post-payment handoffs to ops.
    txn.seller_response_deadline = now + timedelta(hours=SELLER_RESPONSE_HOURS)

    await _notify(db, txn.seller_id, "payment_confirmed",
        "Payment received",
        f"₹{txn.gross_amount:,.0f} paid. Owmee delivery prep is next.",
        "transaction", str(txn.id))
    await _notify(db, txn.buyer_id, "payment_confirmed",
        "Payment confirmed",
        f"₹{txn.gross_amount:,.0f} sent. Track delivery in Owmee.",
        "transaction", str(txn.id))
    logger.info("payment.confirmed", transaction_id=str(txn.id))
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

    # Compute TDS on seller-side gross (agreed_price = gross_amount -
    # delivery_fee). Delivery fee is Owmee revenue, not seller payout.
    from app.modules.transactions.shipped import compute_tds
    seller_gross = Decimal(str(txn.gross_amount or 0)) - Decimal(str(txn.delivery_fee or 0))
    tds_result = await compute_tds(
        db, txn.seller_id, seller_gross, transaction_id
    )
    txn.tds_withheld = tds_result["tds_amount"]
    txn.platform_fee = tds_result["platform_fee"]
    txn.gst_on_fee = tds_result["gst_on_fee"]
    txn.net_payout = tds_result["net_payout"]

    txn.status = "completed"
    txn.buyer_confirmed_at = now
    txn.completed_at = now
    txn.payout_flagged_at = now

    # Trust gate: payout cannot release until seller's bank/UPI is KYC-
    # verified. Release is ops-driven; the admin payout queue must filter
    # on seller_payout_verified() before disbursing. Log here so unverified-
    # seller flags are observable in Sentry/logs.
    from app.modules.transactions.shipped import seller_payout_verified
    if not await seller_payout_verified(db, txn.seller_id):
        logger.warning(
            "payout.flagged_for_unverified_seller",
            transaction_id=str(transaction_id),
            seller_id=str(txn.seller_id),
            net_payout=str(txn.net_payout),
        )

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
            "transaction", str(transaction_id))

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
