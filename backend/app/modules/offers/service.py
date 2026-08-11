"""
Offers service — business logic.

India UX review changes (v2):
- Tiered offer expiry: 24h <5K, 48h 5K–20K, 72h >20K
- Make Offer note/chat removed; structured updates only
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
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import settings
from app.modules.notifications.service import dispatch_existing_notification_push
from app.modules.risk.engine import check_offer_spam, adjust_trust_score, check_listing_risk
from app.modules.offers.models import (
    NotificationEvent, NotificationPreference, Offer, PaymentLink,
    Rating, Reservation, Transaction, Wishlist,
)
from app.modules.listings.models import Category, Listing
from app.modules.listings.service import create_snapshot
from app.modules.transactions.address_snapshots import snapshot_default_address

# Sprint 5a: analytics hook
from app.modules.analytics import track

logger = structlog.get_logger()

# ── Tunable constants ──────────────────────────────────────────────────────────
RESERVATION_EXPIRY_HOURS = 48
CONFIRMATION_WINDOW_HOURS = 48
RATING_DELAY_HOURS = 2          # Rate available 2h after deal complete
BLIND_RATING_DAYS = 7           # Reveal ratings after 7 days if peer hasn't rated
SELLER_RESPONSE_HOURS = 4       # Auto-escalate if seller silent after payment

SELLER_READINESS_PENDING = "pending"
SELLER_READINESS_CONFIRMED = "confirmed"
SELLER_READINESS_DECLINED = "declined"
SELLER_READINESS_EXPIRED = "expired"

SELLER_DECLINE_REASONS = {
    "sold_elsewhere",
    "item_damaged",
    "changed_mind",
    "cannot_pickup",
    "other",
}


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


def _payment_attempt_amount_paise(amount: Decimal) -> int:
    return int(Decimal(str(amount)) * 100)


def _payment_attempt_receipt(transaction_id: UUID) -> str:
    # Razorpay receipt is unique and capped at 40 ASCII chars.
    return f"txn_{str(transaction_id).replace('-', '')}"[:40]


def _payment_order_idempotency_key(transaction_id: UUID) -> str:
    return hashlib.sha256(f"txn:{transaction_id}:checkout-order:v1".encode()).hexdigest()[:64]


def _payment_link_idempotency_key(transaction_id: UUID) -> str:
    return hashlib.sha256(f"txn:{transaction_id}:payment-link-fallback:v1".encode()).hexdigest()[:64]


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _payment_window_deadline(
    txn: Transaction,
    attempts: list[PaymentLink],
) -> datetime | None:
    """Return the latest safe deadline for an unpaid checkout hold.

    Modern rows store PaymentLink.expires_at. Some legacy/test rows predate
    that field, so fall back to the transaction creation time plus Owmee's
    amount-based payment window. Never synthesize a deadline when a provider
    attempt is already paid; that state needs capture/reconciliation, not an
    inventory release.
    """
    if any(
        getattr(a, "status", None) == "paid" or getattr(a, "paid_at", None)
        for a in attempts
    ):
        return None

    txn_created_at = _as_utc(getattr(txn, "created_at", None))
    deadlines: list[datetime] = []
    for attempt in attempts:
        expires_at = _as_utc(getattr(attempt, "expires_at", None))
        if expires_at is not None:
            deadlines.append(expires_at)
            continue

        basis_candidates = [
            value for value in (
                txn_created_at,
                _as_utc(getattr(attempt, "created_at", None)),
            )
            if value is not None
        ]
        if not basis_candidates:
            continue
        amount = Decimal(str(getattr(attempt, "amount", None) or txn.gross_amount or 0))
        deadlines.append(
            max(basis_candidates) + timedelta(minutes=_payment_link_expiry_minutes(amount))
        )

    if deadlines:
        return max(deadlines)

    if not txn_created_at:
        return None
    amount = Decimal(str(txn.gross_amount or 0))
    return txn_created_at + timedelta(minutes=_payment_link_expiry_minutes(amount))


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
    idempotency_key: str | None = None,
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

    idempotency_key = idempotency_key or _notification_idempotency_key(
        user_id=user_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    notification_id: UUID | None = None

    # Use savepoint so notification failure never rolls back the main transaction
    try:
        async with db.begin_nested():
            existing = (await db.execute(
                select(NotificationEvent).where(NotificationEvent.idempotency_key == idempotency_key)
            )).scalar_one_or_none()
            if existing:
                return
            n = NotificationEvent(
                user_id=user_id,
                event_type=event_type,
                notification_bucket=bucket,
                idempotency_key=idempotency_key,
                title=title,
                body=body,
                entity_type=entity_type,
                entity_id=str(entity_id),
                push_status="pending" if settings.is_production else "in_app_only",
            )
            db.add(n)
            await db.flush()
            notification_id = n.id
    except Exception as e:
        logger.warning("notification.failed", error=str(e), event_type=event_type)

    # Best-effort FCM push (never blocks main transaction)
    try:
        import asyncio
        if notification_id:
            asyncio.create_task(dispatch_existing_notification_push(
                notification_id,
                user_id,
                event_type,
                title,
                body,
                data={"entity_type": entity_type, "entity_id": str(entity_id) if entity_id else ""},
            ))
    except Exception:
        pass


def _notification_idempotency_key(
    *,
    user_id: UUID,
    event_type: str,
    entity_type: str,
    entity_id: str,
) -> str:
    raw = f"{user_id}:{event_type}:{entity_type}:{entity_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:64]


# ── Offer logic ─────────────────────────────────────────────────────────────────

async def _expire_stale_offers(
    db: AsyncSession,
    *,
    buyer_id: UUID | None = None,
    listing_id: UUID | None = None,
) -> int:
    """Mark offers whose window has elapsed as 'expired'.

    - pending offers past ``expires_at``
    - countered offers past ``counter_expires_at`` (the buyer's 48h window)

    The 7-day cooldown for an expired counter is already armed on the row by
    ``counter_offer`` (lockout_until), so make_offer's lockout check honors it
    even before/without this sweep. Scope to a (buyer, listing) for the hot
    path, or call unscoped from a periodic worker. Returns rows updated.
    """
    now = datetime.now(timezone.utc)
    conds = [
        or_(
            and_(Offer.status == "pending", Offer.expires_at < now),
            and_(Offer.status == "countered", Offer.counter_expires_at < now),
        )
    ]
    if buyer_id is not None:
        conds.append(Offer.buyer_id == buyer_id)
    if listing_id is not None:
        conds.append(Offer.listing_id == listing_id)
    result = await db.execute(
        update(Offer).where(and_(*conds)).values(status="expired", responded_at=now)
    )
    return result.rowcount or 0


async def expire_stale_offers(db: AsyncSession) -> int:
    """Unscoped sweep for a periodic worker (see workers)."""
    return await _expire_stale_offers(db)


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

    # Retire any offer whose window has elapsed before evaluating "already
    # exists", so a stale pending/countered offer doesn't permanently block the
    # buyer from re-offering.
    await _expire_stale_offers(db, buyer_id=buyer_id, listing_id=listing_id)

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
    try:
        await db.flush()
    except IntegrityError:
        # uq_active_offer_per_buyer_listing — a concurrent request beat us to
        # creating the active offer. The check above missed it due to the race.
        raise ValueError("OFFER_ALREADY_EXISTS")

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
    # Lock the offer row so two concurrent accepts (e.g. seller-accept racing
    # buyer-accept-counter, or retry storms) can't both pass the status check.
    result = await db.execute(
        select(Offer).where(Offer.id == offer_id).with_for_update()
    )
    offer = result.scalar_one_or_none()
    if not offer:
        raise ValueError("OFFER_NOT_FOUND")

    is_seller_accepting = (offer.seller_id == seller_id and offer.status == "pending")
    is_buyer_accepting_counter = (offer.buyer_id == seller_id and offer.status == "countered")
    if not (is_seller_accepting or is_buyer_accepting_counter):
        raise ValueError("CANNOT_ACCEPT")

    # Sprint 6b: the buyer's 48h counter window is enforced HERE, server-side.
    # Without this a buyer could accept a stale counter days/years later at the
    # seller's old price. On expiry we retire the offer (cooldown already armed
    # by counter_offer) and refuse the accept.
    now = datetime.now(timezone.utc)
    if (
        is_buyer_accepting_counter
        and offer.counter_expires_at is not None
        and now > offer.counter_expires_at
    ):
        offer.status = "expired"
        offer.responded_at = now
        raise ValueError("COUNTER_EXPIRED")

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
    # Pricing: zero platform fee, conditional delivery fee. Buyer pays
    # (agreed_price + delivery_fee); seller receives (agreed_price - TDS);
    # Owmee keeps delivery_fee.
    cat_result = await db.execute(
        select(Category.slug).where(Category.id == listing.category_id)
    )
    cat_slug = cat_result.scalar_one_or_none()
    fee = delivery_fee_for(cat_slug)
    buyer_pays = agreed_price + fee

    from app.modules.verification.service import (
        ACTION_BUY,
        evaluate_user_action,
        record_action_policy_decision,
    )
    buyer_policy = await evaluate_user_action(
        db,
        user_id=offer.buyer_id,
        action=ACTION_BUY,
        context={
            "amount": buyer_pays,
            "listing_id": str(offer.listing_id),
            "category_slug": cat_slug,
        },
    )
    if not buyer_policy.allowed:
        await record_action_policy_decision(
            db,
            user_id=offer.buyer_id,
            action=ACTION_BUY,
            policy=buyer_policy,
            metadata={
                "listing_id": str(offer.listing_id),
                "offer_id": str(offer.id),
                "amount": str(buyer_pays),
                "category_slug": cat_slug,
            },
        )
        raise ValueError(
            f"BUYER_VERIFICATION_REQUIRED:{buyer_policy.reason_codes[0]}:{buyer_policy.required_step or 'kyc'}"
        )

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

    # Best-effort prefill. Buy Now overwrites the buyer snapshot with the
    # checkout-selected address; Make Offer falls back to default saved address.
    txn.buyer_delivery_address_snapshot = await snapshot_default_address(
        db, user_id=offer.buyer_id, role="buyer_delivery"
    )
    txn.seller_pickup_address_snapshot = await snapshot_default_address(
        db, user_id=offer.seller_id, role="seller_pickup"
    )

    await record_action_policy_decision(
        db,
        user_id=offer.buyer_id,
        action=ACTION_BUY,
        policy=buyer_policy,
        metadata={
            "listing_id": str(offer.listing_id),
            "offer_id": str(offer.id),
            "transaction_id": str(txn.id),
            "amount": str(buyer_pays),
            "category_slug": cat_slug,
        },
    )

    # Sprint 5a: analytics event — accepted managed deal
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

    # Create Razorpay Order for in-app Checkout. The table/column names are
    # legacy "payment link" names; the row is now a provider payment attempt.
    payment_link = None
    if payment_method == "upi":
        from app.modules.payments.adapter import get_payment_adapter

        idempotency_key = _payment_order_idempotency_key(txn.id)
        adapter = get_payment_adapter()
        expiry_minutes = _payment_link_expiry_minutes(buyer_pays)
        order_result = await adapter.create_payment_order(
            amount_paise=_payment_attempt_amount_paise(buyer_pays),
            transaction_id=str(txn.id),
            idempotency_key=idempotency_key,
            receipt=_payment_attempt_receipt(txn.id),
        )
        if not order_result.success:
            raise ValueError("PAYMENT_LINK_FAILED")

        payment_link = PaymentLink(
            transaction_id=txn.id,
            razorpay_link_id=order_result.razorpay_order_id,
            short_url=None,
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
    # A seller can reject a pending offer OR retract a counter they made — both
    # arm the 7-day cooldown. Previously 'countered' had no rejection path, so
    # a countered offer could never be terminated by the seller.
    if offer.status not in ("pending", "countered"):
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

def _extract_paid_amount_paise(webhook_payload) -> int | None:
    """Pull the captured amount (paise) out of a Razorpay webhook payload.
    Returns None if the shape is unexpected, so the caller can decide whether
    to trust it."""
    if not isinstance(webhook_payload, dict):
        return None
    try:
        return int(webhook_payload["payload"]["payment"]["entity"]["amount"])
    except (KeyError, TypeError, ValueError):
        return None


def _payment_failure_reason(webhook_payload) -> str:
    if not isinstance(webhook_payload, dict):
        return "payment_failed"
    entity = (
        webhook_payload.get("payload", {})
        .get("payment", {})
        .get("entity", {})
    )
    if not isinstance(entity, dict):
        return "payment_failed"
    return (
        entity.get("error_description")
        or entity.get("error_reason")
        or entity.get("error_code")
        or "payment_failed"
    )


def _extract_payment_created_at(webhook_payload) -> datetime | None:
    if not isinstance(webhook_payload, dict):
        return None
    raw = (
        webhook_payload.get("payload", {})
        .get("payment", {})
        .get("entity", {})
        .get("created_at")
    )
    if raw is None:
        raw = webhook_payload.get("created_at")
    try:
        return datetime.fromtimestamp(int(raw), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _payment_window_expired_for_capture(pl: PaymentLink, webhook_payload) -> bool:
    expires_at = getattr(pl, "expires_at", None)
    if not expires_at:
        return False
    payment_created_at = _extract_payment_created_at(webhook_payload)
    if payment_created_at:
        return payment_created_at > expires_at
    return datetime.now(timezone.utc) > expires_at


async def _refund_payment_captured_after_unpaid_release(
    db: AsyncSession,
    txn: Transaction,
    *,
    reason: str,
) -> None:
    try:
        from app.modules.transactions.refund_service import initiate_refund
        await initiate_refund(
            db,
            txn,
            reason=reason,
            initiated_by="system_late_capture",
        )
        await _notify(
            db, txn.buyer_id, "payment_late_capture_refund",
            "Payment refund started",
            "Payment came through after this order was no longer payable. Owmee has started the refund.",
            "transaction", str(txn.id),
        )
    except ValueError as exc:
        logger.warning(
            "payment.late_capture_refund_skipped",
            transaction_id=str(txn.id),
            error=str(exc),
        )


async def process_payment_paid(db, razorpay_link_id, razorpay_payment_id, webhook_payload):
    # Serialize against every other writer of this order. Razorpay delivers
    # `payment.captured` more than once in normal operation, and the timeout
    # sweeper / buyer cancel run concurrently against the same transaction:
    # without locks a capture and a release both pass their status checks and
    # the last commit wins (captured money on a cancelled order, or a paid
    # order whose listing was relisted). Locks are taken in the canonical
    # order shared with the release paths — Transaction first, then
    # PaymentLink — so the webhook and the sweeper queue behind each other
    # instead of deadlocking or interleaving.
    lookup = (await db.execute(
        select(PaymentLink.id, PaymentLink.transaction_id)
        .where(PaymentLink.razorpay_link_id == razorpay_link_id)
    )).first()
    if not lookup:
        logger.warning("webhook.payment_link_not_found", link_id=razorpay_link_id)
        return None
    pl_id, pl_transaction_id = lookup

    txn = (await db.execute(
        select(Transaction)
        .where(Transaction.id == pl_transaction_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()

    pl = (await db.execute(
        select(PaymentLink)
        .where(PaymentLink.id == pl_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one()
    if pl.status == "paid":
        return None

    now = datetime.now(timezone.utc)
    pl.status = "paid"
    pl.paid_at = now
    pl.razorpay_payment_id = razorpay_payment_id
    pl.webhook_payload = webhook_payload

    if not txn:
        return None
    if txn.status == "payment_pending" and _payment_window_expired_for_capture(pl, webhook_payload):
        await _release_unpaid_transaction(db, txn, reason="payment_timeout", notify=False)
        await _notify(
            db, txn.seller_id, "buyer_payment_not_completed",
            "Item is available again",
            "Payment arrived after the Owmee payment window, so Owmee released the item and started refund handling.",
            "transaction", str(txn.id),
        )
        await _refund_payment_captured_after_unpaid_release(
            db,
            txn,
            reason="Payment captured after payment window expired",
        )
        logger.warning(
            "payment.capture_after_window_refund_started",
            transaction_id=str(txn.id),
            link_id=razorpay_link_id,
            expires_at=(
                getattr(pl, "expires_at", None).isoformat()
                if getattr(pl, "expires_at", None)
                else None
            ),
        )
        return txn
    if txn.status != "payment_pending":
        # Late capture after a buyer/system cancelled an unpaid order must not
        # revive the sale or keep the listing locked. Refund the captured money
        # and leave the transaction in its terminal/manual-review state.
        if txn.status == "cancelled":
            await _refund_payment_captured_after_unpaid_release(
                db,
                txn,
                reason="Payment captured after order cancellation",
            )
        else:
            logger.info(
                "payment.paid_ignored_for_status",
                transaction_id=str(txn.id),
                status=txn.status,
                link_id=razorpay_link_id,
            )
        return txn

    # Money-safety: never advance to captured on an underpayment. The link is
    # created with accept_partial=False, but we still cross-check the captured
    # amount against what we charged in case of a tampered/mismatched event.
    # Only validate when the webhook actually carries an amount.
    paid_paise = _extract_paid_amount_paise(webhook_payload)
    if paid_paise is not None:
        expected_paise = int(Decimal(str(pl.amount or 0)) * 100)
        if expected_paise > 0 and paid_paise < expected_paise:
            txn.status = "payment_capture_uncertain"
            txn.seller_response_deadline = None
            logger.error(
                "payment.amount_mismatch",
                transaction_id=str(txn.id),
                expected_paise=expected_paise,
                paid_paise=paid_paise,
            )
            await _notify(db, txn.buyer_id, "payment_under_review",
                "Payment under review",
                "We received a payment, but the amount didn't match the order. Owmee is reviewing it.",
                "transaction", str(txn.id))
            return txn

    listing_result = await db.execute(select(Listing).where(Listing.id == txn.listing_id))
    listing = listing_result.scalar_one_or_none()
    cat_slug = None
    if listing:
        cat_result = await db.execute(select(Category.slug).where(Category.id == listing.category_id))
        cat_slug = cat_result.scalar_one_or_none()

    from app.modules.verification.service import (
        ACTION_BUY,
        evaluate_user_action,
        record_action_policy_decision,
    )
    buyer_policy = await evaluate_user_action(
        db,
        user_id=txn.buyer_id,
        action=ACTION_BUY,
        context={
            "amount": txn.gross_amount,
            "listing_id": str(txn.listing_id),
            "transaction_id": str(txn.id),
            "category_slug": cat_slug,
        },
    )
    await record_action_policy_decision(
        db,
        user_id=txn.buyer_id,
        action=ACTION_BUY,
        policy=buyer_policy,
        metadata={
            "listing_id": str(txn.listing_id),
            "transaction_id": str(txn.id),
            "amount": str(txn.gross_amount),
            "category_slug": cat_slug,
            "stage": "payment_webhook",
        },
    )
    if not buyer_policy.allowed:
        txn.status = "payment_capture_uncertain"
        txn.seller_response_deadline = None
        await _notify(db, txn.buyer_id, "payment_under_review",
            "Payment under review",
            "Payment was received, but Owmee needs a quick account review before delivery starts.",
            "transaction", str(txn.id))
        logger.warning(
            "payment.capture_held_by_verification",
            transaction_id=str(txn.id),
            buyer_id=str(txn.buyer_id),
            decision=buyer_policy.decision,
            reasons=buyer_policy.reason_codes,
        )
        return txn

    await _prefill_missing_transaction_snapshots(db, txn)
    if not txn.buyer_delivery_address_snapshot:
        txn.status = "payment_capture_uncertain"
        txn.seller_response_deadline = None
        await _notify(db, txn.buyer_id, "delivery_address_required",
            "Add delivery address",
            "Payment was received, but Owmee needs a delivery address before pickup starts.",
            "transaction", str(txn.id))
        logger.warning(
            "payment.capture_missing_buyer_address",
            transaction_id=str(txn.id),
            buyer_id=str(txn.buyer_id),
        )
        return txn

    txn.status = "payment_captured"
    txn.confirmation_deadline = now + timedelta(hours=CONFIRMATION_WINDOW_HOURS)
    # Seller readiness deadline: surface stale post-payment handoffs to ops.
    txn.seller_response_deadline = now + timedelta(hours=SELLER_RESPONSE_HOURS)
    txn.seller_readiness_status = SELLER_READINESS_PENDING

    await _notify(db, txn.seller_id, "seller_readiness_required",
        "Buyer paid — confirm pickup",
        "Confirm the item is available and ready before Owmee assigns pickup.",
        "transaction", str(txn.id))
    await _notify(db, txn.buyer_id, "payment_confirmed",
        "Payment confirmed",
        f"₹{txn.gross_amount:,.0f} sent. Track delivery in Owmee.",
        "transaction", str(txn.id))
    logger.info("payment.confirmed", transaction_id=str(txn.id))
    return txn


async def process_payment_failed(
    db: AsyncSession,
    *,
    razorpay_order_id: str,
    razorpay_payment_id: str | None = None,
    webhook_payload: dict | None = None,
) -> Transaction | None:
    """Record a failed payment attempt and release the item hold.

    Owmee uses BookMyShow-style inventory semantics: checkout creates a
    temporary hold, successful capture confirms the order, and a definitive
    failed attempt releases the item so another buyer can try. Razorpay can
    still late-authorize an earlier failed attempt; process_payment_paid handles
    that by refunding without reviving the released sale.
    """
    # Same canonical lock order as process_payment_paid: Transaction first,
    # then PaymentLink, so a failure webhook cannot interleave with a capture
    # webhook or the timeout sweeper on the same order.
    lookup = (await db.execute(
        select(PaymentLink.id, PaymentLink.transaction_id)
        .where(PaymentLink.razorpay_link_id == razorpay_order_id)
    )).first()
    if not lookup:
        logger.warning("payment.failed_unknown_order", order_id=razorpay_order_id)
        return None
    pl_id, pl_transaction_id = lookup

    txn = (await db.execute(
        select(Transaction)
        .where(Transaction.id == pl_transaction_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()

    pl = (await db.execute(
        select(PaymentLink)
        .where(PaymentLink.id == pl_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one()
    previous_status = pl.status
    if previous_status in {"paid", "cancelled", "expired"}:
        return None

    pl.status = "failed"
    if razorpay_payment_id:
        pl.razorpay_payment_id = razorpay_payment_id
    if webhook_payload is not None:
        pl.webhook_payload = webhook_payload

    if not txn:
        return None
    if txn.status == "payment_pending":
        reason = _payment_failure_reason(webhook_payload or {})
        if previous_status != "failed":
            logger.info(
                "payment.failed_recorded",
                transaction_id=str(txn.id),
                order_id=razorpay_order_id,
                payment_id=razorpay_payment_id,
                reason=reason,
            )
        return await _release_unpaid_transaction(
            db,
            txn,
            reason="payment_failed",
            notify=previous_status != "failed",
        )
    return txn


async def create_or_get_payment_link_fallback(
    db: AsyncSession,
    transaction_id: UUID,
    buyer_id: UUID,
) -> PaymentLink:
    """Create a browser Payment Link only when the native Checkout path fails.

    Keeping fallback creation on demand prevents every order from having two
    simultaneously visible payment instruments, but still gives support and
    older clients a recovery path.
    """
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == transaction_id).with_for_update()
    )).scalar_one_or_none()
    if not txn or txn.buyer_id != buyer_id:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.status != "payment_pending":
        raise ValueError(f"INVALID_STATUS:{txn.status}")

    latest_attempt = (await db.execute(
        select(PaymentLink)
        .where(PaymentLink.transaction_id == txn.id)
        .order_by(PaymentLink.created_at.desc())
    )).scalars().first()
    latest_expires_at = getattr(latest_attempt, "expires_at", None)
    if latest_attempt and latest_expires_at and latest_expires_at <= datetime.now(timezone.utc):
        await _release_unpaid_transaction(db, txn, reason="payment_timeout", notify=True)
        raise ValueError("PAYMENT_WINDOW_EXPIRED")

    existing = (await db.execute(
        select(PaymentLink)
        .where(
            PaymentLink.transaction_id == txn.id,
            PaymentLink.short_url.is_not(None),
            PaymentLink.status == "created",
        )
        .order_by(PaymentLink.created_at.desc())
    )).scalars().first()
    if existing:
        return existing

    listing = (await db.execute(select(Listing).where(Listing.id == txn.listing_id))).scalar_one_or_none()
    from app.modules.identity_auth.models import User
    buyer = (await db.execute(select(User).where(User.id == txn.buyer_id))).scalar_one_or_none()

    from app.modules.payments.adapter import get_payment_adapter
    adapter = get_payment_adapter()
    expiry_minutes = _payment_link_expiry_minutes(Decimal(str(txn.gross_amount or 0)))
    idempotency_key = _payment_link_idempotency_key(txn.id)
    result = await adapter.create_payment_link(
        amount_paise=_payment_attempt_amount_paise(Decimal(str(txn.gross_amount or 0))),
        transaction_id=str(txn.id),
        buyer_phone=buyer.phone_number if buyer else "",
        description=f"Owmee: {(listing.title if listing else 'Order')[:50]}",
        idempotency_key=idempotency_key,
        expire_minutes=expiry_minutes,
    )
    if not result.success:
        raise ValueError("PAYMENT_LINK_FAILED")

    payment_link = PaymentLink(
        transaction_id=txn.id,
        razorpay_link_id=result.razorpay_link_id,
        short_url=result.short_url,
        amount=txn.gross_amount,
        status="created",
        idempotency_key=idempotency_key,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes),
    )
    db.add(payment_link)
    return payment_link


async def process_checkout_payment_success(
    db: AsyncSession,
    *,
    transaction_id: UUID,
    buyer_id: UUID,
    razorpay_order_id: str,
    razorpay_payment_id: str,
    razorpay_signature: str,
):
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == transaction_id)
    )).scalar_one_or_none()
    if not txn or txn.buyer_id != buyer_id:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.status == "payment_captured":
        return txn
    if txn.status != "payment_pending":
        raise ValueError(f"INVALID_STATUS:{txn.status}")

    pl = (await db.execute(
        select(PaymentLink)
        .where(
            PaymentLink.transaction_id == txn.id,
            PaymentLink.razorpay_link_id == razorpay_order_id,
        )
        .order_by(PaymentLink.created_at.desc())
    )).scalars().first()
    if not pl:
        raise ValueError("PAYMENT_ORDER_NOT_FOUND")
    if pl.status == "paid":
        return txn

    from app.modules.payments.adapter import get_payment_adapter
    adapter = get_payment_adapter()
    if not adapter.verify_checkout_signature(
        order_id=pl.razorpay_link_id,
        payment_id=razorpay_payment_id,
        signature=razorpay_signature,
    ):
        raise ValueError("INVALID_PAYMENT_SIGNATURE")

    status = await adapter.fetch_payment_status(razorpay_payment_id)
    if status.success:
        if status.order_id and status.order_id != pl.razorpay_link_id:
            raise ValueError("PAYMENT_ORDER_MISMATCH")
        if status.status and status.status != "captured":
            expires_at = getattr(pl, "expires_at", None)
            if expires_at and expires_at <= datetime.now(timezone.utc):
                return await expire_unpaid_transaction(db, txn)
            logger.warning(
                "payment.checkout_not_captured_yet",
                transaction_id=str(txn.id),
                payment_id=razorpay_payment_id,
                payment_status=status.status,
            )
            return txn
    else:
        logger.warning(
            "payment.checkout_fetch_failed_waiting_for_webhook",
            transaction_id=str(txn.id),
            payment_id=razorpay_payment_id,
            error=status.error,
        )
        return txn

    expected_paise = _payment_attempt_amount_paise(Decimal(str(pl.amount or 0)))
    if status.amount_paise is None:
        logger.warning(
            "payment.checkout_missing_amount_waiting_for_webhook",
            transaction_id=str(txn.id),
            payment_id=razorpay_payment_id,
        )
        return txn
    if expected_paise > 0 and status.amount_paise < expected_paise:
        logger.error(
            "payment.checkout_amount_mismatch",
            transaction_id=str(txn.id),
            expected_paise=expected_paise,
            paid_paise=status.amount_paise,
        )
        raise ValueError("PAYMENT_AMOUNT_MISMATCH")

    payload = {
        "event": "checkout.success",
        "payload": {
            "order": {"entity": {"id": pl.razorpay_link_id, "status": "paid"}},
            "payment": {
                "entity": {
                    "id": razorpay_payment_id,
                    "order_id": pl.razorpay_link_id,
                    "amount": status.amount_paise,
                    "status": status.status or "captured",
                    "created_at": int(status.created_at.timestamp()) if status.created_at else None,
                }
            },
        },
    }
    return await process_payment_paid(
        db,
        razorpay_link_id=pl.razorpay_link_id,
        razorpay_payment_id=razorpay_payment_id,
        webhook_payload=payload,
    )


async def cancel_unpaid_transaction(
    db: AsyncSession,
    transaction_id: UUID,
    buyer_id: UUID,
    *,
    reason: str = "buyer_cancelled_payment",
) -> Transaction:
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == transaction_id).with_for_update()
    )).scalar_one_or_none()
    if not txn or txn.buyer_id != buyer_id:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.status == "cancelled":
        return txn
    if txn.status != "payment_pending":
        raise ValueError(f"INVALID_STATUS:{txn.status}")
    return await _release_unpaid_transaction(db, txn, reason=reason, notify=True)


async def cancel_paid_pre_pickup_transaction(
    db: AsyncSession,
    transaction_id: UUID,
    buyer_id: UUID,
    *,
    reason: str = "buyer_cancelled_before_pickup",
) -> Transaction:
    """Buyer cancellation after capture, before Owmee assigns pickup.

    Once a pickup FE is assigned, the item may already be moving through an
    ops/custody workflow; buyer cancellation then belongs to support/returns.
    Before assignment, we can safely start a refund and release the listing.
    """
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == transaction_id).with_for_update()
    )).scalar_one_or_none()
    if not txn or txn.buyer_id != buyer_id:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.status == "cancelled":
        return txn
    if txn.status != "payment_captured":
        raise ValueError(f"INVALID_STATUS:{txn.status}")
    if txn.pickup_fe_id:
        raise ValueError("PICKUP_ALREADY_ASSIGNED")

    from app.modules.transactions.refund_service import INITIATED_BY_BUYER, initiate_refund

    try:
        await initiate_refund(
            db,
            txn,
            reason=f"Buyer cancelled before pickup: {reason}"[:200],
            initiated_by=INITIATED_BY_BUYER,
        )
    except ValueError as ref_err:
        if str(ref_err) != "ALREADY_REFUNDED":
            raise

    now = datetime.now(timezone.utc)
    txn.status = "cancelled"
    txn.cancelled_at = now
    txn.cancelled_reason = reason[:100]
    txn.seller_response_deadline = None
    txn.seller_readiness_reason = "buyer_cancelled"

    reservation = (await db.execute(
        select(Reservation).where(Reservation.id == txn.reservation_id)
    )).scalar_one_or_none()
    if reservation:
        reservation.status = "cancelled"
        reservation.cancelled_at = now
        offer = (await db.execute(select(Offer).where(Offer.id == reservation.offer_id))).scalar_one_or_none()
        if offer and offer.status == "accepted":
            offer.status = "cancelled"
            offer.reject_reason = reason[:100]
            offer.responded_at = now

    listing = (await db.execute(select(Listing).where(Listing.id == txn.listing_id))).scalar_one_or_none()
    if listing and listing.status == "reserved":
        listing.status = "active"

    await _notify(
        db, txn.buyer_id, "buyer_cancelled_refund",
        "Order cancelled — refund started",
        "Owmee has cancelled the order and started your refund.",
        "transaction", str(txn.id),
    )
    await _notify(
        db, txn.seller_id, "buyer_cancelled_before_pickup",
        "Item is available again",
        "The buyer cancelled before pickup, so Owmee released the item for other buyers.",
        "transaction", str(txn.id),
    )
    logger.info("payment.paid_order_cancelled_before_pickup", transaction_id=str(txn.id), reason=reason)
    return txn


async def expire_unpaid_transaction(
    db: AsyncSession,
    txn: Transaction,
    *,
    notify: bool = True,
) -> Transaction:
    # The sweeper hands us candidates from an unlocked scan. Re-read the row
    # under FOR UPDATE before the status check so we serialize with a capture
    # webhook landing at the same instant (canonical order: Transaction →
    # PaymentLink). If the webhook won, the re-read sees payment_captured and
    # we bail instead of cancelling a paid order.
    txn = (await db.execute(
        select(Transaction)
        .where(Transaction.id == txn.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one()
    if txn.status != "payment_pending":
        raise ValueError(f"INVALID_STATUS:{txn.status}")
    attempts = (await db.execute(
        select(PaymentLink)
        .where(PaymentLink.transaction_id == txn.id)
        .order_by(PaymentLink.created_at.desc())
    )).scalars().all()
    deadline = _payment_window_deadline(txn, attempts)
    if not deadline or deadline > datetime.now(timezone.utc):
        raise ValueError("PAYMENT_WINDOW_NOT_EXPIRED")
    return await _release_unpaid_transaction(
        db,
        txn,
        reason="payment_timeout",
        notify=notify,
    )


async def expire_due_unpaid_transactions(
    db: AsyncSession,
    *,
    limit: int = 100,
    seller_id: UUID | None = None,
    listing_ids: list[UUID] | None = None,
    notify: bool = True,
) -> int:
    now = datetime.now(timezone.utc)
    missing_expiry_30m_cutoff = now - timedelta(minutes=30)
    missing_expiry_24h_cutoff = now - timedelta(minutes=1440)
    filters = [
        Transaction.status == "payment_pending",
        or_(
            PaymentLink.expires_at <= now,
            and_(
                or_(PaymentLink.id.is_(None), PaymentLink.expires_at.is_(None)),
                Transaction.gross_amount < Decimal("5000"),
                Transaction.created_at <= missing_expiry_30m_cutoff,
            ),
            and_(
                or_(PaymentLink.id.is_(None), PaymentLink.expires_at.is_(None)),
                Transaction.gross_amount >= Decimal("5000"),
                Transaction.created_at <= missing_expiry_24h_cutoff,
            ),
        ),
    ]
    if seller_id is not None:
        filters.append(Transaction.seller_id == seller_id)
    if listing_ids is not None:
        if not listing_ids:
            return 0
        filters.append(Transaction.listing_id.in_(listing_ids))

    candidates = (await db.execute(
        select(Transaction)
        .outerjoin(PaymentLink, PaymentLink.transaction_id == Transaction.id)
        .where(*filters)
        .order_by(
            PaymentLink.expires_at.asc().nullslast(),
            Transaction.created_at.asc(),
        )
        .limit(limit)
    )).scalars().all()

    expired = 0
    seen: set[UUID] = set()
    for txn in candidates:
        if txn.id in seen:
            continue
        seen.add(txn.id)
        try:
            await expire_unpaid_transaction(db, txn, notify=notify)
            expired += 1
        except ValueError as exc:
            if str(exc) != "PAYMENT_WINDOW_NOT_EXPIRED":
                logger.warning(
                    "payment.timeout_sweep_skip",
                    transaction_id=str(txn.id),
                    error=str(exc),
                )
    return expired


async def _release_unpaid_transaction(
    db: AsyncSession,
    txn: Transaction,
    *,
    reason: str,
    notify: bool,
) -> Transaction:
    now = datetime.now(timezone.utc)
    txn.status = "cancelled"
    txn.cancelled_at = now
    txn.cancelled_reason = reason[:100]
    txn.seller_response_deadline = None

    attempts = (await db.execute(
        select(PaymentLink)
        .where(PaymentLink.transaction_id == txn.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalars().all()
    for attempt in attempts:
        if attempt.status != "paid":
            if reason == "payment_timeout":
                attempt.status = "expired"
            elif reason == "payment_failed" and attempt.status == "failed":
                attempt.status = "failed"
            else:
                attempt.status = "cancelled"

    reservation = (await db.execute(
        select(Reservation).where(Reservation.id == txn.reservation_id)
    )).scalar_one_or_none()
    if reservation:
        reservation.status = "cancelled"
        reservation.cancelled_at = now
        offer = (await db.execute(select(Offer).where(Offer.id == reservation.offer_id))).scalar_one_or_none()
        if offer and offer.status == "accepted":
            offer.status = "cancelled"
            offer.reject_reason = reason[:100]
            offer.responded_at = now

    listing = (await db.execute(
        select(Listing).where(Listing.id == txn.listing_id).with_for_update()
    )).scalar_one_or_none()
    if listing and listing.status == "reserved":
        listing.status = "active"

    if notify:
        if reason == "payment_failed":
            buyer_event = "payment_failed"
            buyer_title = "Payment failed"
            buyer_body = "No money was collected. Owmee released the item so another buyer can try."
        elif reason == "payment_timeout":
            buyer_event = "payment_cancelled"
            buyer_title = "Payment window expired"
            buyer_body = "The payment window expired. Owmee released the item. No money was collected."
        else:
            buyer_event = "payment_cancelled"
            buyer_title = "Order cancelled"
            buyer_body = "The item has been released. No money was collected."
        await _notify(
            db, txn.buyer_id, buyer_event,
            buyer_title,
            buyer_body,
            "transaction", str(txn.id),
        )
        await _notify(
            db, txn.seller_id, "buyer_payment_not_completed",
            "Item is available again",
            "The buyer did not complete payment, so Owmee released the item for other buyers.",
            "transaction", str(txn.id),
        )
    logger.info("payment.unpaid_order_released", transaction_id=str(txn.id), reason=reason)
    return txn


async def _prefill_missing_transaction_snapshots(db: AsyncSession, txn: Transaction) -> None:
    if not txn.buyer_delivery_address_snapshot:
        txn.buyer_delivery_address_snapshot = await snapshot_default_address(
            db, user_id=txn.buyer_id, role="buyer_delivery"
        )
    if not txn.seller_pickup_address_snapshot:
        txn.seller_pickup_address_snapshot = await snapshot_default_address(
            db, user_id=txn.seller_id, role="seller_pickup"
        )


async def confirm_seller_readiness(
    db: AsyncSession,
    transaction_id: UUID,
    seller_id: UUID,
    *,
    pickup_address_id: UUID | None = None,
    pickup_slot_start: datetime | None = None,
    pickup_slot_end: datetime | None = None,
    item_available: bool = True,
    condition_unchanged: bool = True,
    accessories_confirmed: bool = True,
) -> Transaction:
    txn = (await db.execute(
        select(Transaction).where(Transaction.id == transaction_id).with_for_update()
    )).scalar_one_or_none()
    if not txn:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.seller_id != seller_id:
        raise ValueError("NOT_YOUR_TRANSACTION")
    if txn.status != "payment_captured":
        raise ValueError(f"INVALID_STATUS:{txn.status}")
    if txn.pickup_fe_id:
        raise ValueError("PICKUP_ALREADY_ASSIGNED")
    if txn.seller_readiness_status == SELLER_READINESS_CONFIRMED:
        return txn
    if txn.seller_readiness_status in (SELLER_READINESS_DECLINED, SELLER_READINESS_EXPIRED):
        raise ValueError(f"READINESS_CLOSED:{txn.seller_readiness_status}")
    if not item_available:
        raise ValueError("ITEM_NOT_AVAILABLE")
    if not condition_unchanged:
        raise ValueError("CONDITION_CHANGED")
    if not accessories_confirmed:
        raise ValueError("ACCESSORIES_NOT_CONFIRMED")
    if pickup_slot_start and pickup_slot_end and pickup_slot_end <= pickup_slot_start:
        raise ValueError("INVALID_PICKUP_SLOT")

    await _prefill_missing_transaction_snapshots(db, txn)
    if pickup_address_id:
        from app.modules.transactions.address_snapshots import snapshot_owned_address
        txn.seller_pickup_address_snapshot = await snapshot_owned_address(
            db, address_id=pickup_address_id, user_id=seller_id, role="seller_pickup"
        )
    if not txn.seller_pickup_address_snapshot:
        raise ValueError("PICKUP_ADDRESS_REQUIRED")
    if not txn.buyer_delivery_address_snapshot:
        raise ValueError("BUYER_DELIVERY_ADDRESS_REQUIRED")

    now = datetime.now(timezone.utc)
    txn.seller_readiness_status = SELLER_READINESS_CONFIRMED
    txn.seller_readiness_reason = None
    txn.seller_responded_at = now
    txn.pickup_ready_at = now
    txn.seller_pickup_slot_start = pickup_slot_start
    txn.seller_pickup_slot_end = pickup_slot_end

    await _notify(db, txn.buyer_id, "seller_ready",
        "Seller confirmed pickup",
        "The item is ready. Owmee will assign pickup and inspect it next.",
        "transaction", str(txn.id))
    logger.info("seller_readiness.confirmed", transaction_id=str(txn.id), seller_id=str(seller_id))
    return txn


async def decline_seller_readiness(
    db: AsyncSession,
    transaction_id: UUID,
    seller_id: UUID,
    *,
    reason: str,
) -> Transaction:
    if reason not in SELLER_DECLINE_REASONS:
        raise ValueError("INVALID_REASON")

    txn = (await db.execute(
        select(Transaction).where(Transaction.id == transaction_id).with_for_update()
    )).scalar_one_or_none()
    if not txn:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.seller_id != seller_id:
        raise ValueError("NOT_YOUR_TRANSACTION")
    if txn.status != "payment_captured":
        raise ValueError(f"INVALID_STATUS:{txn.status}")
    if txn.pickup_fe_id:
        raise ValueError("PICKUP_ALREADY_ASSIGNED")

    now = datetime.now(timezone.utc)
    txn.seller_readiness_status = SELLER_READINESS_DECLINED
    txn.seller_readiness_reason = reason
    txn.seller_responded_at = now
    txn.cancelled_at = now
    txn.cancelled_reason = f"seller_{reason}"
    txn.status = "cancelled"

    await _suppress_listing_after_seller_readiness_failure(db, txn, reason)
    await _refund_for_seller_readiness_failure(db, txn, reason=f"Seller declined: {reason}")

    await _notify(db, txn.buyer_id, "seller_unavailable_refund",
        "Order cancelled — refund started",
        "The seller could not complete pickup. Your refund is being processed.",
        "transaction", str(txn.id))
    await _notify(db, txn.seller_id, "seller_readiness_declined",
        "Order cancelled",
        "Owmee has started the buyer refund because you could not complete pickup.",
        "transaction", str(txn.id))
    logger.info("seller_readiness.declined", transaction_id=str(txn.id), seller_id=str(seller_id), reason=reason)
    return txn


async def expire_seller_readiness(db: AsyncSession, txn: Transaction) -> Transaction:
    if txn.status != "payment_captured":
        raise ValueError(f"INVALID_STATUS:{txn.status}")
    if txn.seller_readiness_status != SELLER_READINESS_PENDING:
        raise ValueError(f"INVALID_READINESS_STATUS:{txn.seller_readiness_status}")
    if txn.seller_response_deadline and txn.seller_response_deadline > datetime.now(timezone.utc):
        raise ValueError("DEADLINE_NOT_REACHED")

    now = datetime.now(timezone.utc)
    txn.seller_readiness_status = SELLER_READINESS_EXPIRED
    txn.seller_readiness_reason = "timeout"
    txn.cancelled_at = now
    txn.cancelled_reason = "seller_timeout"
    txn.status = "cancelled"

    await _suppress_listing_after_seller_readiness_failure(db, txn, "seller_timeout")
    await _refund_for_seller_readiness_failure(db, txn, reason="Seller did not confirm pickup readiness")
    await _notify(db, txn.buyer_id, "seller_timeout_refund",
        "Order cancelled — refund started",
        "The seller did not confirm pickup in time. Your refund is being processed.",
        "transaction", str(txn.id))
    await _notify(db, txn.seller_id, "seller_readiness_expired",
        "Order cancelled",
        "The pickup confirmation window expired, so Owmee cancelled and refunded the buyer.",
        "transaction", str(txn.id))
    logger.info("seller_readiness.expired", transaction_id=str(txn.id), seller_id=str(txn.seller_id))
    return txn


async def _suppress_listing_after_seller_readiness_failure(
    db: AsyncSession, txn: Transaction, reason: str
) -> None:
    listing = (await db.execute(select(Listing).where(Listing.id == txn.listing_id))).scalar_one_or_none()
    if not listing:
        return
    now = datetime.now(timezone.utc)
    if reason == "sold_elsewhere":
        listing.status = "sold_elsewhere"
        listing.deletion_reason = "sold_elsewhere"
        listing.deleted_at = now
    elif reason in {"item_damaged", "changed_mind", "cannot_pickup", "seller_timeout", "other"}:
        listing.status = "removed"
        listing.deletion_reason = "item_damaged" if reason == "item_damaged" else "other"
        listing.deleted_at = now


async def _refund_for_seller_readiness_failure(
    db: AsyncSession, txn: Transaction, *, reason: str
) -> None:
    from app.modules.transactions.refund_service import (
        INITIATED_BY_SYSTEM_SELLER,
        initiate_refund,
    )
    try:
        await initiate_refund(
            db,
            txn,
            reason=reason[:200],
            initiated_by=INITIATED_BY_SYSTEM_SELLER,
        )
    except ValueError as ref_err:
        logger.warning(
            "seller_readiness.refund_skip",
            transaction_id=str(txn.id),
            reason=str(ref_err),
        )




# ── Deal confirmation ───────────────────────────────────────────────────────────

async def buyer_confirm_deal(db, transaction_id, buyer_id):
    # Lock the transaction row so two concurrent confirms can't both pass the
    # status check and both complete the deal twice.
    result = await db.execute(
        select(Transaction).where(Transaction.id == transaction_id).with_for_update()
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise ValueError("TRANSACTION_NOT_FOUND")
    if txn.buyer_id != buyer_id:
        raise ValueError("NOT_YOUR_TRANSACTION")
    if txn.status not in ("delivered", "awaiting_confirmation"):
        raise ValueError(f"INVALID_STATUS:{txn.status}")

    now = datetime.now(timezone.utc)

    # Payout processing normally starts at successful FE pickup. For legacy or
    # manually progressed orders, ensure the payout breakdown exists here too
    # without overwriting the original processing-start timestamp.
    from app.modules.transactions.payout_service import ensure_seller_payout_processing
    await ensure_seller_payout_processing(
        db,
        txn,
        source="buyer_confirm_deal",
        now=now,
        notify=False,
    )

    txn.status = "completed"
    txn.buyer_confirmed_at = now
    txn.completed_at = now

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
        "Deal confirmed — payout processing",
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
    try:
        await db.flush()
    except IntegrityError:
        # uq_rating_per_txn_rater — a concurrent request already rated.
        raise ValueError("ALREADY_RATED")

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
