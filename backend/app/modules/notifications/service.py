"""
Push notification service.

Dev mode: logs notification, stores in DB only.
Production: sends FCM (Android) or APNs (iOS) + falls back to in-app if push fails.

Usage:
  from app.modules.notifications.service import push
  await push(user_id, "offer_accepted", title="Offer accepted!", body="₹16,000 offer accepted.", data={...})
"""
from __future__ import annotations

import asyncio
from uuid import UUID

import structlog

from app.core.settings import settings
from app.modules.notifications.push_adapter import get_push_adapter

logger = structlog.get_logger()


# Notification event types → bucket mapping
BUCKET_MAP = {
    "offer_received":        "transactions",
    "offer_accepted":        "transactions",
    "offer_rejected":        "transactions",
    "offer_countered":       "transactions",
    "payment_confirmed":     "transactions",
    "payment_failed":        "transactions",
    "payment_cancelled":     "transactions",
    "payment_late_capture_refund": "transactions",
    "payment_under_review":  "transactions",
    "delivery_address_required": "transactions",
    "seller_readiness_required": "transactions",
    "seller_ready":          "transactions",
    "seller_unavailable_refund": "transactions",
    "seller_timeout_refund": "transactions",
    "seller_readiness_declined": "transactions",
    "seller_readiness_expired": "transactions",
    "buyer_payment_not_completed": "transactions",
    "buyer_cancelled_refund": "transactions",
    "buyer_cancelled_before_pickup": "transactions",
    "pickup_assigned":       "transactions",
    "pickup_completed":      "transactions",
    "item_at_hub":           "transactions",
    "pickup_rejected_refund": "transactions",
    "out_for_delivery":      "transactions",
    "delivery_in_progress":  "transactions",
    "delivered_confirm_receipt": "transactions",
    "delivered_awaiting_confirmation": "transactions",
    "deal_confirmed":        "transactions",
    "deal_confirmed_buyer":  "transactions",
    "payout_eligible":       "transactions",
    "payout_processing_started": "transactions",
    "payout_verification_required": "transactions",
    "dispute_opened":        "transactions",
    "price_drop":            "transactions",
    "promo_badge":           "promotions",
    # ── Concierge Phase 2 — trust theater (master spec section 5) ──
    "concierge_visit_booked":      "transactions",  # N1
    "concierge_specialist_assigned": "transactions",  # N2
    "concierge_day_before":        "transactions",  # N3
    "concierge_specialist_starting": "transactions",  # N4
    "concierge_specialist_arriving": "transactions",  # N5
    "concierge_specialist_at_door": "transactions",  # N6
    # ── Concierge Phase 4 — passive timeline ─────────────────────
    "concierge_item_sold":         "transactions",
    "concierge_pickup_scheduled":  "transactions",
    "concierge_money_credited":    "transactions",
    # ── Concierge Phase 5 — safety + NPS ─────────────────────────
    "concierge_visit_receipt":     "transactions",
    "concierge_nps_request":       "transactions",
}


async def push(
    user_id: UUID,
    event_type: str,
    title: str,
    body: str,
    data: dict | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    persist_in_app: bool = True,
) -> bool:
    """
    Send a push notification to a user.
    Always creates in-app notification. Attempts FCM if token exists and env=production.
    Returns True if FCM push was sent, False if in-app only.
    """
    if not persist_in_app and not settings.is_production:
        return False

    from app.db.session import AsyncSessionLocal
    from app.modules.offers.models import NotificationEvent, NotificationPreference
    from sqlalchemy import select

    bucket = BUCKET_MAP.get(event_type, "transactions")

    async with AsyncSessionLocal() as db:
        # Check user preferences
        pref_result = await db.execute(
            select(NotificationPreference).where(NotificationPreference.user_id == user_id)
        )
        pref = pref_result.scalar_one_or_none()

        if pref:
            if bucket == "transactions" and not pref.transactions_enabled:
                return False
            if bucket == "promotions" and not pref.promotions_enabled:
                return False

        if persist_in_app:
            n = NotificationEvent(
                user_id=user_id,
                event_type=event_type,
                notification_bucket=bucket,
                title=title,
                body=body,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id else None,
            )
            db.add(n)
            await db.commit()
            logger.info("notification.created", user_id=str(user_id), event_type=event_type)

    # Attempt push in production. In-app notification is already persisted, so
    # provider failures never block core transaction state changes.
    if not settings.is_production:
        return False

    return await _send_push(user_id, title, body, event_type, data or {})


async def _send_push(
    user_id: UUID,
    title: str,
    body: str,
    event_type: str,
    data: dict,
) -> bool:
    """Send push through the configured provider adapter."""
    from app.db.session import AsyncSessionLocal
    from app.modules.identity_auth.models import User
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.fcm_token:
            return False
        push_token = user.fcm_token

    try:
        result = await get_push_adapter().send(push_token, title, body, event_type, data)
        if result.success:
            logger.info("push.sent", user_id=str(user_id), event_type=event_type, provider=result.provider)
            return True
        if result.invalid_token:
            logger.warning("push.token_invalid", user_id=str(user_id), provider=result.provider)
            await _clear_fcm_token(user_id)
            return False
        logger.error("push.error", provider=result.provider, error=result.error)
        return False
    except Exception as e:
        logger.error("push.exception", error=str(e), user_id=str(user_id))
        return False


async def _clear_fcm_token(user_id: UUID):
    from app.db.session import AsyncSessionLocal
    from app.modules.identity_auth.models import User
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            user.fcm_token = None
            await db.commit()


# ── Bulk push helpers ─────────────────────────────────────────────────────────

async def push_many(
    user_ids: list[UUID],
    event_type: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> int:
    """Send push to multiple users. Returns count sent."""
    tasks = [push(uid, event_type, title, body, data) for uid in user_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return sum(1 for r in results if r is True)


# ── Event-specific helpers ────────────────────────────────────────────────────

async def notify_offer_received(seller_id: UUID, buyer_phone: str, price: str, listing_id: str):
    await push(
        seller_id, "offer_received",
        title="New offer",
        body=f"₹{int(float(price)):,} offer on your listing",
        entity_type="listing", entity_id=listing_id,
    )

async def notify_offer_accepted(buyer_id: UUID, price: str, listing_title: str, transaction_id: str):
    await push(
        buyer_id, "offer_accepted",
        title="Offer accepted!",
        body=f"₹{int(float(price)):,} offer on \"{listing_title[:40]}\" accepted. Pay now.",
        entity_type="transaction", entity_id=transaction_id,
    )

async def notify_payment_confirmed(seller_id: UUID, buyer_id: UUID, price: str, transaction_id: str):
    await push(
        seller_id, "payment_confirmed",
        title="Payment received",
        body=f"₹{int(float(price)):,} payment confirmed. Owmee delivery prep is next.",
        entity_type="transaction", entity_id=transaction_id,
    )
    await push(
        buyer_id, "payment_confirmed",
        title="Payment sent",
        body="Payment confirmed. Track delivery in Owmee.",
        entity_type="transaction", entity_id=transaction_id,
    )

async def notify_price_drop_wishlist(user_id: UUID, listing_title: str, old_price: str, new_price: str, listing_id: str):
    drop_pct = round((1 - float(new_price) / float(old_price)) * 100)
    await push(
        user_id, "price_drop",
        title=f"Price drop — {drop_pct}% off",
        body=f'"{listing_title[:40]}" is now ₹{int(float(new_price)):,}',
        entity_type="listing", entity_id=listing_id,
    )

async def notify_dispute_opened(seller_id: UUID, buyer_id: UUID, transaction_id: str):
    await push(
        seller_id, "dispute_opened",
        title="Dispute opened",
        body="Buyer raised a dispute. Our team will review within 48 hours.",
        entity_type="transaction", entity_id=transaction_id,
    )
