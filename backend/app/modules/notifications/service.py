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
import json
from datetime import datetime, timezone
from uuid import UUID

import httpx
import structlog

from app.core.settings import settings

logger = structlog.get_logger()


# ── FCM v1 HTTP API ───────────────────────────────────────────────────────────

FCM_ENDPOINT = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"

# Notification event types → bucket mapping
BUCKET_MAP = {
    "offer_received":        "transactions",
    "offer_accepted":        "transactions",
    "offer_rejected":        "transactions",
    "offer_countered":       "transactions",
    "payment_confirmed":     "transactions",
    "meetup_confirmed":      "transactions",
    "deal_confirmed":        "transactions",
    "deal_confirmed_buyer":  "transactions",
    "payout_eligible":       "transactions",
    "dispute_opened":        "transactions",
    "price_drop":            "transactions",
    "new_message":           "messages",
    "promo_badge":           "promotions",
}


async def push(
    user_id: UUID,
    event_type: str,
    title: str,
    body: str,
    data: dict | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> bool:
    """
    Send a push notification to a user.
    Always creates in-app notification. Attempts FCM if token exists and env=production.
    Returns True if FCM push was sent, False if in-app only.
    """
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
            if bucket == "messages" and not pref.messages_enabled:
                return False
            if bucket == "promotions" and not pref.promotions_enabled:
                return False

        # Create in-app notification
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

    # Attempt FCM push in production
    if not settings.is_production or not settings.fcm_server_key:
        return False

    return await _send_fcm(user_id, title, body, event_type, data or {})


async def _send_fcm(
    user_id: UUID,
    title: str,
    body: str,
    event_type: str,
    data: dict,
) -> bool:
    """Send FCM notification via legacy HTTP API (server key)."""
    from app.db.session import AsyncSessionLocal
    from app.modules.identity_auth.models import User
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.fcm_token:
            return False
        fcm_token = user.fcm_token

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                "https://fcm.googleapis.com/fcm/send",
                headers={
                    "Authorization": f"key={settings.fcm_server_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "to": fcm_token,
                    "notification": {
                        "title": title,
                        "body": body,
                        "sound": "default",
                        "badge": "1",
                    },
                    "data": {
                        "event_type": event_type,
                        **{k: str(v) for k, v in data.items()},
                    },
                    "priority": "high",
                    "android": {
                        "notification": {
                            "channel_id": "owmee_transactions",
                            "priority": "high",
                        }
                    },
                },
            )
            if res.status_code == 200:
                resp_data = res.json()
                if resp_data.get("failure", 0) == 0:
                    logger.info("fcm.sent", user_id=str(user_id), event_type=event_type)
                    return True
                else:
                    # Token invalid — clear it
                    logger.warning("fcm.token_invalid", user_id=str(user_id))
                    await _clear_fcm_token(user_id)
                    return False
            else:
                logger.error("fcm.error", status=res.status_code, body=res.text[:200])
                return False
    except Exception as e:
        logger.error("fcm.exception", error=str(e), user_id=str(user_id))
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
        body=f"₹{int(float(price)):,} payment confirmed. Arrange meetup.",
        entity_type="transaction", entity_id=transaction_id,
    )
    await push(
        buyer_id, "payment_confirmed",
        title="Payment sent",
        body="Payment confirmed. Seller will contact you.",
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
