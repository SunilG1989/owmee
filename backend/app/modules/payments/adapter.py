"""
Razorpay Payment Link adapter.

In dev mode (ENV=development): returns a fake payment link and simulates
the webhook payload so we can test the full flow without Razorpay credentials.

In production: calls Razorpay API to create a real payment link.

The adapter NEVER stores the raw Razorpay API secret — it only reads it from settings.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
import structlog

from app.core.settings import settings

logger = structlog.get_logger()


# ── Response types ──────────────────────────────────────────────────────────────

class PaymentLinkResult:
    def __init__(
        self,
        success: bool,
        razorpay_link_id: str = "",
        short_url: str = "",
        expires_at: datetime | None = None,
        error: str | None = None,
    ):
        self.success = success
        self.razorpay_link_id = razorpay_link_id
        self.short_url = short_url
        self.expires_at = expires_at
        self.error = error


class WebhookVerifyResult:
    def __init__(self, valid: bool, event: str = "", payment_link_id: str = "", payment_id: str = ""):
        self.valid = valid
        self.event = event
        self.payment_link_id = payment_link_id
        self.payment_id = payment_id


# ── Dev stub ────────────────────────────────────────────────────────────────────

class _DevPaymentAdapter:
    """
    Dev mode: returns a mock payment link pointing to localhost.
    Simulates a paid webhook payload for testing.
    """

    async def create_payment_link(
        self,
        amount_paise: int,
        transaction_id: str,
        buyer_phone: str,
        description: str,
        idempotency_key: str,
        expire_minutes: int = 30,
    ) -> PaymentLinkResult:
        fake_id = f"plink_dev_{uuid4().hex[:12]}"
        fake_url = f"http://localhost:8000/v1/dev/pay/{fake_id}"
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
        logger.info(
            "payment_link.dev_created",
            link_id=fake_id,
            amount_rupees=amount_paise / 100,
            transaction_id=transaction_id,
        )
        return PaymentLinkResult(
            success=True,
            razorpay_link_id=fake_id,
            short_url=fake_url,
            expires_at=expires_at,
        )

    def verify_webhook(self, payload_body: bytes, signature: str) -> WebhookVerifyResult:
        """Dev: accept any payload, extract ids from JSON."""
        import json
        try:
            data = json.loads(payload_body)
            event = data.get("event", "")
            entity = data.get("payload", {}).get("payment_link", {}).get("entity", {})
            pl_id = entity.get("id", "")
            payment_id = (
                data.get("payload", {})
                .get("payment", {})
                .get("entity", {})
                .get("id", "")
            )
            return WebhookVerifyResult(valid=True, event=event, payment_link_id=pl_id, payment_id=payment_id)
        except Exception as e:
            return WebhookVerifyResult(valid=False)

    def build_dev_paid_webhook(self, razorpay_link_id: str, transaction_id: str) -> dict:
        """Build a realistic-looking webhook payload for dev testing."""
        return {
            "event": "payment_link.paid",
            "payload": {
                "payment_link": {
                    "entity": {
                        "id": razorpay_link_id,
                        "reference_id": transaction_id,
                        "status": "paid",
                    }
                },
                "payment": {
                    "entity": {
                        "id": f"pay_dev_{uuid4().hex[:12]}",
                        "amount": 100,
                        "status": "captured",
                        "method": "upi",
                    }
                },
            },
        }


# ── Razorpay production adapter ──────────────────────────────────────────────────

class _RazorpayAdapter:

    BASE = "https://api.razorpay.com/v1"

    def _auth(self):
        return (settings.pa_key_id, settings.pa_key_secret)

    async def create_payment_link(
        self,
        amount_paise: int,
        transaction_id: str,
        buyer_phone: str,
        description: str,
        idempotency_key: str,
        expire_minutes: int = 30,
    ) -> PaymentLinkResult:
        expire_by = int(time.time()) + (expire_minutes * 60)
        payload = {
            "amount": amount_paise,
            "currency": "INR",
            "accept_partial": False,
            "reference_id": transaction_id,
            "expire_by": expire_by,
            "description": description[:255],
            "customer": {"contact": buyer_phone},
            "notify": {"sms": True, "email": False},
            "reminder_enable": False,
            "notes": {"transaction_id": transaction_id},
            "callback_url": f"{settings.app_base_url}/v1/payments/webhook/razorpay",
            "callback_method": "get",
        }
        try:
            async with httpx.AsyncClient(auth=self._auth(), timeout=15) as client:
                resp = await client.post(f"{self.BASE}/payment_links", json=payload)
            data = resp.json()
            if resp.status_code == 200:
                expires_at = datetime.fromtimestamp(data["expire_by"], tz=timezone.utc)
                return PaymentLinkResult(
                    success=True,
                    razorpay_link_id=data["id"],
                    short_url=data["short_url"],
                    expires_at=expires_at,
                )
            return PaymentLinkResult(
                success=False,
                error=data.get("error", {}).get("description", "Razorpay error"),
            )
        except Exception as e:
            logger.error("razorpay.payment_link.error", error=str(e))
            return PaymentLinkResult(success=False, error=str(e))

    def verify_webhook(self, payload_body: bytes, signature: str) -> WebhookVerifyResult:
        import json
        expected = hmac.new(
            settings.pa_webhook_secret.encode(),
            payload_body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return WebhookVerifyResult(valid=False)
        try:
            data = json.loads(payload_body)
            event = data.get("event", "")
            entity = data.get("payload", {}).get("payment_link", {}).get("entity", {})
            pl_id = entity.get("id", "")
            payment_id = (
                data.get("payload", {})
                .get("payment", {})
                .get("entity", {})
                .get("id", "")
            )
            return WebhookVerifyResult(valid=True, event=event, payment_link_id=pl_id, payment_id=payment_id)
        except Exception:
            return WebhookVerifyResult(valid=False)


# ── Factory ──────────────────────────────────────────────────────────────────────

def get_payment_adapter() -> _DevPaymentAdapter | _RazorpayAdapter:
    if settings.env == "development" or not settings.pa_key_id:
        return _DevPaymentAdapter()
    return _RazorpayAdapter()
