"""
Payment provider adapters.

In dev mode (ENV=development): returns a fake payment link and simulates
the webhook payload so we can test the full flow without Razorpay credentials.

In production: calls the selected payment provider adapter.

The adapter NEVER stores raw provider secrets — it only reads them from settings.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone
from typing import Protocol
from uuid import uuid4

import httpx
import structlog

from app.core.settings import settings

logger = structlog.get_logger()


# ── Secret validation ───────────────────────────────────────────────────────────

def _missing_payment_secret(value: str | None) -> bool:
    raw = str(value or "").strip()
    return not raw or raw.startswith("REPLACE_WITH_")


# ── Response types ──────────────────────────────────────────────────────────────

class PaymentLinkResult:
    def __init__(
        self,
        success: bool,
        razorpay_link_id: str = "",
        provider_link_id: str | None = None,
        provider: str = "",
        short_url: str = "",
        expires_at: datetime | None = None,
        error: str | None = None,
    ):
        self.success = success
        self.provider = provider
        self.provider_link_id = provider_link_id or razorpay_link_id
        # Legacy DB column compatibility. New code should prefer
        # provider_link_id, but existing migrations still store this field.
        self.razorpay_link_id = razorpay_link_id or self.provider_link_id
        self.short_url = short_url
        self.expires_at = expires_at
        self.error = error


class PaymentOrderResult:
    def __init__(
        self,
        success: bool,
        provider_order_id: str = "",
        provider: str = "",
        amount_paise: int = 0,
        currency: str = "INR",
        status: str = "",
        key_id: str = "",
        error: str | None = None,
    ):
        self.success = success
        self.provider = provider
        self.provider_order_id = provider_order_id
        # Razorpay-specific compatibility for callers/tests.
        self.razorpay_order_id = provider_order_id
        self.amount_paise = amount_paise
        self.currency = currency
        self.status = status
        self.key_id = key_id
        self.error = error


class RefundResult:
    """Adapter response for refund attempts. razorpay_refund_id is the
    payment-partner's id we store for idempotent retries."""

    def __init__(
        self,
        success: bool,
        razorpay_refund_id: str = "",
        provider_refund_id: str | None = None,
        provider: str = "",
        status: str = "",
        error: str | None = None,
    ):
        self.success = success
        self.provider = provider
        self.provider_refund_id = provider_refund_id or razorpay_refund_id
        # Legacy DB column compatibility.
        self.razorpay_refund_id = razorpay_refund_id or self.provider_refund_id
        self.status = status  # 'created' | 'processed' | 'failed'
        self.error = error


class PaymentStatusResult:
    def __init__(
        self,
        success: bool,
        provider: str = "",
        payment_id: str = "",
        order_id: str = "",
        status: str = "",
        amount_paise: int | None = None,
        created_at: datetime | None = None,
        error: str | None = None,
    ):
        self.success = success
        self.provider = provider
        self.payment_id = payment_id
        self.order_id = order_id
        self.status = status
        self.amount_paise = amount_paise
        self.created_at = created_at
        self.error = error


class WebhookVerifyResult:
    def __init__(
        self, valid: bool, event: str = "",
        payment_link_id: str = "", payment_id: str = "",
        refund_id: str = "", order_id: str = "",
    ):
        self.valid = valid
        self.event = event
        self.payment_link_id = payment_link_id
        self.order_id = order_id
        self.refund_id = refund_id
        self.payment_id = payment_id


class PaymentAdapter(Protocol):
    async def create_payment_order(
        self,
        amount_paise: int,
        transaction_id: str,
        receipt: str,
        idempotency_key: str,
    ) -> PaymentOrderResult: ...

    async def create_payment_link(
        self,
        amount_paise: int,
        transaction_id: str,
        buyer_phone: str,
        description: str,
        idempotency_key: str,
        expire_minutes: int = 30,
    ) -> PaymentLinkResult: ...

    def verify_checkout_signature(
        self,
        *,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> bool: ...

    def verify_webhook(self, payload_body: bytes, signature: str) -> WebhookVerifyResult: ...

    async def fetch_payment_status(self, payment_id: str) -> PaymentStatusResult: ...

    async def refund(
        self,
        razorpay_payment_id: str,
        amount_paise: int,
        idempotency_key: str,
        notes: dict | None = None,
    ) -> RefundResult: ...


# ── Dev stub ────────────────────────────────────────────────────────────────────

class _DevPaymentAdapter:
    """
    Dev mode: returns a mock payment link pointing to localhost.
    Simulates a paid webhook payload for testing.
    """

    async def create_payment_order(
        self,
        amount_paise: int,
        transaction_id: str,
        receipt: str,
        idempotency_key: str,
    ) -> PaymentOrderResult:
        fake_id = f"order_dev_{uuid4().hex[:12]}"
        logger.info(
            "payment_order.dev_created",
            order_id=fake_id,
            amount_rupees=amount_paise / 100,
            transaction_id=transaction_id,
        )
        return PaymentOrderResult(
            success=True,
            provider="dev",
            provider_order_id=fake_id,
            amount_paise=amount_paise,
            currency="INR",
            status="created",
            key_id="rzp_test_dev",
        )

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
        fake_url = f"{settings.app_base_url.rstrip('/')}/v1/dev/pay/{fake_id}"
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
        logger.info(
            "payment_link.dev_created",
            link_id=fake_id,
            amount_rupees=amount_paise / 100,
            transaction_id=transaction_id,
        )
        return PaymentLinkResult(
            success=True,
            provider="dev",
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
            # Refund events carry the refund entity instead of (or in
            # addition to) payment / payment_link.
            refund_id = (
                data.get("payload", {})
                .get("refund", {})
                .get("entity", {})
                .get("id", "")
            )
            return WebhookVerifyResult(
                valid=True, event=event,
                payment_link_id=pl_id,
                order_id=_extract_order_id(data),
                payment_id=payment_id,
                refund_id=refund_id,
            )
        except Exception as e:
            return WebhookVerifyResult(valid=False)

    def verify_checkout_signature(
        self,
        *,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> bool:
        return bool(order_id and payment_id and signature)

    async def fetch_payment_status(self, payment_id: str) -> PaymentStatusResult:
        return PaymentStatusResult(
            success=True,
            provider="dev",
            payment_id=payment_id,
            status="captured",
            created_at=datetime.now(timezone.utc),
        )

    async def refund(
        self,
        razorpay_payment_id: str,
        amount_paise: int,
        idempotency_key: str,
        notes: dict | None = None,
    ) -> RefundResult:
        """Dev: pretend the refund succeeded immediately."""
        fake_id = f"rfnd_dev_{uuid4().hex[:12]}"
        logger.info(
            "refund.dev_processed",
            refund_id=fake_id,
            razorpay_payment_id=razorpay_payment_id,
            amount_rupees=amount_paise / 100,
        )
        return RefundResult(
            success=True,
            provider="dev",
            razorpay_refund_id=fake_id,
            status="processed",
        )

    def build_dev_paid_webhook(
        self, razorpay_link_id: str, transaction_id: str, amount_paise: int = 0
    ) -> dict:
        """Build a realistic-looking webhook payload for dev testing.

        ``amount_paise`` reflects the real link amount so the server-side
        amount-validation in process_payment_paid passes for legitimate dev
        payments (a hardcoded amount would always look like an underpayment).
        """
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
                        "amount": int(amount_paise) if amount_paise else 100,
                        "status": "captured",
                        "method": "upi",
                    }
                },
            },
        }

    def build_dev_order_paid_webhook(
        self, razorpay_order_id: str, transaction_id: str, amount_paise: int = 0
    ) -> dict:
        return {
            "event": "order.paid",
            "payload": {
                "order": {
                    "entity": {
                        "id": razorpay_order_id,
                        "receipt": f"txn_{transaction_id}"[:40],
                        "status": "paid",
                        "notes": {"transaction_id": transaction_id},
                    }
                },
                "payment": {
                    "entity": {
                        "id": f"pay_dev_{uuid4().hex[:12]}",
                        "order_id": razorpay_order_id,
                        "amount": int(amount_paise) if amount_paise else 100,
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

    async def create_payment_order(
        self,
        amount_paise: int,
        transaction_id: str,
        receipt: str,
        idempotency_key: str,
    ) -> PaymentOrderResult:
        payload = {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": receipt[:40],
            "notes": {"transaction_id": transaction_id, "idempotency_key": idempotency_key[:64]},
        }
        try:
            async with httpx.AsyncClient(auth=self._auth(), timeout=15) as client:
                resp = await client.post(f"{self.BASE}/orders", json=payload)
            data = resp.json() if resp.content else {}
            if resp.status_code in (200, 201):
                return PaymentOrderResult(
                    success=True,
                    provider="razorpay",
                    provider_order_id=data["id"],
                    amount_paise=int(data.get("amount") or amount_paise),
                    currency=data.get("currency", "INR"),
                    status=data.get("status", "created"),
                    key_id=settings.pa_key_id,
                )
            return PaymentOrderResult(
                success=False,
                provider="razorpay",
                error=data.get("error", {}).get("description", "Razorpay order error"),
            )
        except Exception as e:
            logger.error("razorpay.payment_order.error", error=str(e))
            return PaymentOrderResult(success=False, provider="razorpay", error=str(e))

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
        }
        try:
            async with httpx.AsyncClient(auth=self._auth(), timeout=15) as client:
                resp = await client.post(f"{self.BASE}/payment_links", json=payload)
            data = resp.json()
            if resp.status_code in (200, 201):
                expires_at = datetime.fromtimestamp(data["expire_by"], tz=timezone.utc)
                return PaymentLinkResult(
                    success=True,
                    provider="razorpay",
                    razorpay_link_id=data["id"],
                    short_url=data["short_url"],
                    expires_at=expires_at,
                )
            return PaymentLinkResult(
                success=False,
                provider="razorpay",
                error=data.get("error", {}).get("description", "Razorpay error"),
            )
        except Exception as e:
            logger.error("razorpay.payment_link.error", error=str(e))
            return PaymentLinkResult(success=False, provider="razorpay", error=str(e))

    async def refund(
        self,
        razorpay_payment_id: str,
        amount_paise: int,
        idempotency_key: str,
        notes: dict | None = None,
    ) -> RefundResult:
        """Razorpay refund. Idempotent via the X-Refund-Idempotency
        header — calling twice with the same key returns the same refund.

        Razorpay docs: POST /payments/{id}/refund — body {amount, notes?}.
        Async response status is one of: 'pending' | 'processed' | 'failed'.
        """
        url = f"{self.BASE}/payments/{razorpay_payment_id}/refund"
        body = {"amount": amount_paise}
        if notes:
            body["notes"] = notes
        headers = {"X-Refund-Idempotency": idempotency_key}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(url, auth=self._auth(), json=body, headers=headers)
            data = r.json() if r.content else {}
            if r.status_code in (200, 201):
                return RefundResult(
                    success=True,
                    provider="razorpay",
                    razorpay_refund_id=data.get("id", ""),
                    status=data.get("status", "processed"),
                )
            logger.error("razorpay.refund.failed", status=r.status_code, body=data)
            return RefundResult(
                success=False,
                provider="razorpay",
                error=data.get("error", {}).get("description", f"HTTP {r.status_code}"),
            )
        except Exception as e:
            logger.error("razorpay.refund.error", error=str(e))
            return RefundResult(success=False, provider="razorpay", error=str(e))

    def verify_webhook(self, payload_body: bytes, signature: str) -> WebhookVerifyResult:
        import json
        if _missing_payment_secret(settings.pa_webhook_secret):
            logger.error("razorpay.webhook_secret_missing")
            return WebhookVerifyResult(valid=False)
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
            # Refund events carry the refund entity instead of (or in
            # addition to) payment / payment_link.
            refund_id = (
                data.get("payload", {})
                .get("refund", {})
                .get("entity", {})
                .get("id", "")
            )
            return WebhookVerifyResult(
                valid=True, event=event,
                payment_link_id=pl_id,
                order_id=_extract_order_id(data),
                payment_id=payment_id,
                refund_id=refund_id,
            )
        except Exception:
            return WebhookVerifyResult(valid=False)

    def verify_checkout_signature(
        self,
        *,
        order_id: str,
        payment_id: str,
        signature: str,
    ) -> bool:
        if _missing_payment_secret(settings.pa_key_secret):
            logger.error("razorpay.key_secret_missing_for_checkout_verify")
            return False
        if not order_id or not payment_id or not signature:
            return False
        expected = hmac.new(
            settings.pa_key_secret.encode(),
            f"{order_id}|{payment_id}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    async def fetch_payment_status(self, payment_id: str) -> PaymentStatusResult:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(f"{self.BASE}/payments/{payment_id}", auth=self._auth())
            data = resp.json() if resp.content else {}
            if resp.status_code == 200:
                created_at = None
                if data.get("created_at") is not None:
                    created_at = datetime.fromtimestamp(int(data["created_at"]), tz=timezone.utc)
                return PaymentStatusResult(
                    success=True,
                    provider="razorpay",
                    payment_id=data.get("id", payment_id),
                    order_id=data.get("order_id") or "",
                    status=data.get("status") or "",
                    amount_paise=int(data["amount"]) if data.get("amount") is not None else None,
                    created_at=created_at,
                )
            return PaymentStatusResult(
                success=False,
                provider="razorpay",
                payment_id=payment_id,
                error=data.get("error", {}).get("description", f"HTTP {resp.status_code}"),
            )
        except Exception as e:
            logger.error("razorpay.payment_fetch.error", payment_id=payment_id, error=str(e))
            return PaymentStatusResult(success=False, provider="razorpay", payment_id=payment_id, error=str(e))


def _extract_order_id(data: dict) -> str:
    payload = data.get("payload", {}) if isinstance(data, dict) else {}
    order_entity = payload.get("order", {}).get("entity", {})
    if isinstance(order_entity, dict) and order_entity.get("id"):
        return order_entity.get("id", "")
    payment_entity = payload.get("payment", {}).get("entity", {})
    if isinstance(payment_entity, dict):
        return payment_entity.get("order_id") or ""
    return ""


# ── Factory ──────────────────────────────────────────────────────────────────────

def get_payment_adapter() -> PaymentAdapter:
    provider = (settings.pa_provider or "").strip().lower()
    if settings.env == "development":
        return _DevPaymentAdapter()
    if provider in {"mock", "dev"}:
        return _DevPaymentAdapter()
    if provider == "":
        raise RuntimeError("PA_PROVIDER must be set")
    if provider in {"razorpay", "rzp"}:
        missing = [
            name
            for name, value in {
                "PA_KEY_ID": settings.pa_key_id,
                "PA_KEY_SECRET": settings.pa_key_secret,
                "PA_WEBHOOK_SECRET": settings.pa_webhook_secret,
            }.items()
            if _missing_payment_secret(value)
        ]
        if missing:
            raise RuntimeError(
                "Razorpay payment adapter requires real values for "
                + ", ".join(missing)
            )
        return _RazorpayAdapter()
    raise RuntimeError(f"Unsupported PA_PROVIDER={settings.pa_provider!r}")
