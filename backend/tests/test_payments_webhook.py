"""Wave 7: Razorpay webhook HMAC signature verification.

The money path trusts webhook events; the signature check is the only thing
stopping a forged 'paid'/'refunded' event. It had NO test.
"""
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

import pytest
from app.core.settings import settings
from app.modules.payments import adapter as payments_adapter
from app.modules.payments.adapter import _RazorpayAdapter, get_payment_adapter


class _FakeResponse:
    def __init__(self, status_code=200, data=None):
        self.status_code = status_code
        self._data = data or {}
        self.content = b"{}"

    def json(self):
        return self._data


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_valid_signature_is_accepted_and_parsed(monkeypatch):
    monkeypatch.setattr(settings, "pa_webhook_secret", "whsec_test", raising=False)
    body = json.dumps({
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {"entity": {"id": "plink_1"}},
            "payment": {"entity": {"id": "pay_1"}},
        },
    }).encode()
    res = _RazorpayAdapter().verify_webhook(body, _sign("whsec_test", body))
    assert res.valid is True
    assert res.event == "payment_link.paid"
    assert res.payment_link_id == "plink_1"
    assert res.payment_id == "pay_1"


def test_order_paid_signature_is_accepted_and_parses_order(monkeypatch):
    monkeypatch.setattr(settings, "pa_webhook_secret", "whsec_test", raising=False)
    body = json.dumps({
        "event": "order.paid",
        "payload": {
            "order": {"entity": {"id": "order_123"}},
            "payment": {"entity": {"id": "pay_123", "order_id": "order_123"}},
        },
    }).encode()

    res = _RazorpayAdapter().verify_webhook(body, _sign("whsec_test", body))

    assert res.valid is True
    assert res.event == "order.paid"
    assert res.order_id == "order_123"
    assert res.payment_id == "pay_123"


def test_payment_captured_signature_parses_order_from_payment_entity(monkeypatch):
    monkeypatch.setattr(settings, "pa_webhook_secret", "whsec_test", raising=False)
    body = json.dumps({
        "event": "payment.captured",
        "payload": {
            "payment": {"entity": {"id": "pay_123", "order_id": "order_123"}},
        },
    }).encode()

    res = _RazorpayAdapter().verify_webhook(body, _sign("whsec_test", body))

    assert res.valid is True
    assert res.event == "payment.captured"
    assert res.order_id == "order_123"
    assert res.payment_id == "pay_123"


def test_payment_failed_signature_parses_order_from_payment_entity(monkeypatch):
    monkeypatch.setattr(settings, "pa_webhook_secret", "whsec_test", raising=False)
    body = json.dumps({
        "event": "payment.failed",
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_123",
                    "order_id": "order_123",
                    "status": "failed",
                    "error_reason": "payment_failed",
                }
            },
        },
    }).encode()

    res = _RazorpayAdapter().verify_webhook(body, _sign("whsec_test", body))

    assert res.valid is True
    assert res.event == "payment.failed"
    assert res.order_id == "order_123"
    assert res.payment_id == "pay_123"


def test_tampered_signature_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "pa_webhook_secret", "whsec_test", raising=False)
    body = b'{"event":"payment_link.paid"}'
    assert _RazorpayAdapter().verify_webhook(body, "deadbeef").valid is False


def test_signature_from_wrong_secret_is_rejected(monkeypatch):
    monkeypatch.setattr(settings, "pa_webhook_secret", "whsec_test", raising=False)
    body = b'{"event":"payment_link.paid"}'
    forged = _sign("attacker_secret", body)
    assert _RazorpayAdapter().verify_webhook(body, forged).valid is False


def test_mutated_body_breaks_the_signature(monkeypatch):
    """A valid signature for one body must not validate a different body
    (e.g. an attacker bumping the amount)."""
    monkeypatch.setattr(settings, "pa_webhook_secret", "whsec_test", raising=False)
    original = b'{"amount":100}'
    sig = _sign("whsec_test", original)
    tampered = b'{"amount":999999}'
    assert _RazorpayAdapter().verify_webhook(tampered, sig).valid is False


def test_empty_webhook_secret_rejects_even_matching_hmac(monkeypatch):
    monkeypatch.setattr(settings, "pa_webhook_secret", "", raising=False)
    body = b'{"event":"payment_link.paid"}'
    assert _RazorpayAdapter().verify_webhook(body, _sign("", body)).valid is False


def test_razorpay_factory_requires_webhook_secret(monkeypatch):
    monkeypatch.setattr(settings, "env", "production", raising=False)
    monkeypatch.setattr(settings, "pa_provider", "razorpay", raising=False)
    monkeypatch.setattr(settings, "pa_key_id", "rzp_live_key", raising=False)
    monkeypatch.setattr(settings, "pa_key_secret", "rzp_live_secret", raising=False)
    monkeypatch.setattr(settings, "pa_webhook_secret", "", raising=False)

    with pytest.raises(RuntimeError, match="PA_WEBHOOK_SECRET"):
        get_payment_adapter()


def test_checkout_signature_verification_uses_order_pipe_payment(monkeypatch):
    monkeypatch.setattr(settings, "pa_key_secret", "rzp_secret", raising=False)
    expected = hmac.new(
        b"rzp_secret",
        b"order_123|pay_123",
        hashlib.sha256,
    ).hexdigest()

    adapter = _RazorpayAdapter()

    assert adapter.verify_checkout_signature(
        order_id="order_123",
        payment_id="pay_123",
        signature=expected,
    ) is True
    assert adapter.verify_checkout_signature(
        order_id="order_123",
        payment_id="pay_999",
        signature=expected,
    ) is False


@pytest.mark.asyncio
async def test_razorpay_payment_order_payload_uses_orders_api(monkeypatch):
    captured = {}

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            captured["client_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, url, **kwargs):
            captured["url"] = url
            captured["request"] = kwargs
            return _FakeResponse(
                data={
                    "id": "order_test",
                    "amount": 12345,
                    "currency": "INR",
                    "status": "created",
                }
            )

    monkeypatch.setattr(settings, "pa_key_id", "rzp_key", raising=False)
    monkeypatch.setattr(settings, "pa_key_secret", "rzp_secret", raising=False)
    monkeypatch.setattr(payments_adapter.httpx, "AsyncClient", FakeAsyncClient)

    result = await _RazorpayAdapter().create_payment_order(
        amount_paise=12345,
        transaction_id="txn_123",
        receipt="txn_receipt_1234567890",
        idempotency_key="idem_1234567890",
    )

    payload = captured["request"]["json"]
    assert result.success is True
    assert result.razorpay_order_id == "order_test"
    assert captured["url"].endswith("/orders")
    assert captured["client_kwargs"]["auth"] == ("rzp_key", "rzp_secret")
    assert payload == {
        "amount": 12345,
        "currency": "INR",
        "receipt": "txn_receipt_1234567890",
        "notes": {"transaction_id": "txn_123", "idempotency_key": "idem_1234567890"},
    }


@pytest.mark.asyncio
async def test_razorpay_payment_status_fetch_parses_capture(monkeypatch):
    captured = {}
    created_at_ts = int(time.time())

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            captured["client_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url, **kwargs):
            captured["url"] = url
            captured["request"] = kwargs
            return _FakeResponse(
                data={
                    "id": "pay_123",
                    "order_id": "order_123",
                    "amount": 12345,
                    "status": "captured",
                    "created_at": created_at_ts,
                }
            )

    monkeypatch.setattr(settings, "pa_key_id", "rzp_key", raising=False)
    monkeypatch.setattr(settings, "pa_key_secret", "rzp_secret", raising=False)
    monkeypatch.setattr(payments_adapter.httpx, "AsyncClient", FakeAsyncClient)

    result = await _RazorpayAdapter().fetch_payment_status("pay_123")

    assert result.success is True
    assert result.payment_id == "pay_123"
    assert result.order_id == "order_123"
    assert result.status == "captured"
    assert result.amount_paise == 12345
    assert result.created_at == datetime.fromtimestamp(created_at_ts, tz=timezone.utc)
    assert captured["url"].endswith("/payments/pay_123")
    assert captured["request"]["auth"] == ("rzp_key", "rzp_secret")


@pytest.mark.asyncio
async def test_razorpay_payment_link_payload_does_not_use_webhook_as_callback(monkeypatch):
    captured = {}

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            captured["client_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, url, **kwargs):
            captured["url"] = url
            captured["request"] = kwargs
            return _FakeResponse(
                data={
                    "id": "plink_test",
                    "short_url": "https://rzp.io/i/test",
                    "expire_by": int(time.time()) + 1800,
                }
            )

    monkeypatch.setattr(settings, "pa_key_id", "rzp_key", raising=False)
    monkeypatch.setattr(settings, "pa_key_secret", "rzp_secret", raising=False)
    monkeypatch.setattr(payments_adapter.httpx, "AsyncClient", FakeAsyncClient)

    result = await _RazorpayAdapter().create_payment_link(
        amount_paise=12345,
        transaction_id="txn_123",
        buyer_phone="+918095918925",
        description="Owmee order txn_123",
        idempotency_key="idem_1234567890",
    )

    payload = captured["request"]["json"]
    assert result.success is True
    assert captured["url"].endswith("/payment_links")
    assert captured["client_kwargs"]["auth"] == ("rzp_key", "rzp_secret")
    assert payload["amount"] == 12345
    assert payload["currency"] == "INR"
    assert payload["accept_partial"] is False
    assert payload["reference_id"] == "txn_123"
    assert payload["customer"] == {"contact": "+918095918925"}
    assert payload["notes"] == {"transaction_id": "txn_123"}
    assert "callback_url" not in payload
    assert "callback_method" not in payload


@pytest.mark.asyncio
async def test_razorpay_refund_uses_refund_idempotency_header(monkeypatch):
    captured = {}

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            captured["client_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, url, **kwargs):
            captured["url"] = url
            captured["request"] = kwargs
            return _FakeResponse(data={"id": "rfnd_test", "status": "processed"})

    monkeypatch.setattr(settings, "pa_key_id", "rzp_key", raising=False)
    monkeypatch.setattr(settings, "pa_key_secret", "rzp_secret", raising=False)
    monkeypatch.setattr(payments_adapter.httpx, "AsyncClient", FakeAsyncClient)

    result = await _RazorpayAdapter().refund(
        razorpay_payment_id="pay_123",
        amount_paise=5000,
        idempotency_key="refund_key_123456",
        notes={"transaction_id": "txn_123"},
    )

    assert result.success is True
    assert captured["url"].endswith("/payments/pay_123/refund")
    assert captured["request"]["auth"] == ("rzp_key", "rzp_secret")
    assert captured["request"]["json"] == {
        "amount": 5000,
        "notes": {"transaction_id": "txn_123"},
    }
    assert captured["request"]["headers"] == {
        "X-Refund-Idempotency": "refund_key_123456",
    }
    assert "X-Razorpay-Idempotency-Key" not in captured["request"]["headers"]
