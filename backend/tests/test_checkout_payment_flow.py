from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.modules.offers import service as offer_service
from app.modules.payments import adapter as payments_adapter
from app.modules.payments.adapter import PaymentStatusResult


class _Result:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value

    def scalars(self):
        return self

    def first(self):
        if isinstance(self.value, list):
            return self.value[0] if self.value else None
        return self.value

    def all(self):
        if isinstance(self.value, list):
            return self.value
        return []


class _DB:
    def __init__(self, *values):
        self.values = list(values)

    async def execute(self, *_args, **_kwargs):
        if not self.values:
            raise AssertionError("unexpected db.execute")
        return _Result(self.values.pop(0))

    async def flush(self):
        return None


class _Adapter:
    def __init__(self, *, signature_ok=True, status="captured", amount_paise=12345, created_at=None):
        self.signature_ok = signature_ok
        self.status = status
        self.amount_paise = amount_paise
        self.created_at = created_at

    def verify_checkout_signature(self, **_kwargs):
        return self.signature_ok

    async def fetch_payment_status(self, payment_id: str):
        return PaymentStatusResult(
            success=True,
            provider="razorpay",
            payment_id=payment_id,
            order_id="order_123",
            status=self.status,
            amount_paise=self.amount_paise,
            created_at=self.created_at,
        )


def _txn(*, status="payment_pending"):
    buyer_id = uuid4()
    return SimpleNamespace(
        id=uuid4(),
        buyer_id=buyer_id,
        seller_id=uuid4(),
        listing_id=uuid4(),
        reservation_id=uuid4(),
        status=status,
        cancelled_at=None,
        cancelled_reason=None,
        seller_response_deadline=None,
    )


def _payment_attempt(txn):
    return SimpleNamespace(
        transaction_id=txn.id,
        razorpay_link_id="order_123",
        status="created",
        amount=Decimal("123.45"),
    )


@pytest.mark.asyncio
async def test_checkout_success_verifies_signature_status_order_and_amount(monkeypatch):
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    captured = {}

    async def fake_process_payment_paid(db, razorpay_link_id, razorpay_payment_id, webhook_payload):
        captured["link_id"] = razorpay_link_id
        captured["payment_id"] = razorpay_payment_id
        captured["payload"] = webhook_payload
        txn.status = "payment_captured"
        return txn

    monkeypatch.setattr(payments_adapter, "get_payment_adapter", lambda: _Adapter())
    monkeypatch.setattr(offer_service, "process_payment_paid", fake_process_payment_paid)

    result = await offer_service.process_checkout_payment_success(
        _DB(txn, payment_attempt),
        transaction_id=txn.id,
        buyer_id=txn.buyer_id,
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_123",
        razorpay_signature="sig_123",
    )

    assert result.status == "payment_captured"
    assert captured["link_id"] == "order_123"
    assert captured["payment_id"] == "pay_123"
    assert captured["payload"]["payload"]["payment"]["entity"]["amount"] == 12345


@pytest.mark.asyncio
async def test_checkout_success_can_recover_after_failed_attempt(monkeypatch):
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    payment_attempt.status = "failed"
    captured = {}

    async def fake_process_payment_paid(db, razorpay_link_id, razorpay_payment_id, webhook_payload):
        captured["link_id"] = razorpay_link_id
        payment_attempt.status = "paid"
        txn.status = "payment_captured"
        return txn

    monkeypatch.setattr(payments_adapter, "get_payment_adapter", lambda: _Adapter())
    monkeypatch.setattr(offer_service, "process_payment_paid", fake_process_payment_paid)

    result = await offer_service.process_checkout_payment_success(
        _DB(txn, payment_attempt),
        transaction_id=txn.id,
        buyer_id=txn.buyer_id,
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_retry_success",
        razorpay_signature="sig_123",
    )

    assert result.status == "payment_captured"
    assert payment_attempt.status == "paid"
    assert captured["link_id"] == "order_123"


@pytest.mark.asyncio
async def test_checkout_rejects_invalid_signature(monkeypatch):
    txn = _txn()
    payment_attempt = _payment_attempt(txn)

    monkeypatch.setattr(payments_adapter, "get_payment_adapter", lambda: _Adapter(signature_ok=False))

    with pytest.raises(ValueError, match="INVALID_PAYMENT_SIGNATURE"):
        await offer_service.process_checkout_payment_success(
            _DB(txn, payment_attempt),
            transaction_id=txn.id,
            buyer_id=txn.buyer_id,
            razorpay_order_id="order_123",
            razorpay_payment_id="pay_123",
            razorpay_signature="bad_sig",
        )


@pytest.mark.asyncio
async def test_checkout_waits_for_webhook_when_payment_is_not_captured(monkeypatch):
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    process_called = False

    async def fake_process_payment_paid(*_args, **_kwargs):
        nonlocal process_called
        process_called = True

    monkeypatch.setattr(payments_adapter, "get_payment_adapter", lambda: _Adapter(status="authorized"))
    monkeypatch.setattr(offer_service, "process_payment_paid", fake_process_payment_paid)

    result = await offer_service.process_checkout_payment_success(
        _DB(txn, payment_attempt),
        transaction_id=txn.id,
        buyer_id=txn.buyer_id,
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_123",
        razorpay_signature="sig_123",
    )

    assert result.status == "payment_pending"
    assert process_called is False


@pytest.mark.asyncio
async def test_checkout_rejects_underpayment_even_after_capture(monkeypatch):
    txn = _txn()
    payment_attempt = _payment_attempt(txn)

    monkeypatch.setattr(payments_adapter, "get_payment_adapter", lambda: _Adapter(amount_paise=12000))

    with pytest.raises(ValueError, match="PAYMENT_AMOUNT_MISMATCH"):
        await offer_service.process_checkout_payment_success(
            _DB(txn, payment_attempt),
            transaction_id=txn.id,
            buyer_id=txn.buyer_id,
            razorpay_order_id="order_123",
            razorpay_payment_id="pay_123",
            razorpay_signature="sig_123",
        )


@pytest.mark.asyncio
async def test_checkout_confirm_is_idempotent_after_transaction_is_captured(monkeypatch):
    txn = _txn(status="payment_captured")

    def fail_if_called():
        raise AssertionError("adapter should not be needed")

    monkeypatch.setattr(payments_adapter, "get_payment_adapter", fail_if_called)

    result = await offer_service.process_checkout_payment_success(
        _DB(txn),
        transaction_id=txn.id,
        buyer_id=txn.buyer_id,
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_123",
        razorpay_signature="sig_123",
    )

    assert result is txn


@pytest.mark.asyncio
async def test_payment_failed_releases_inventory(monkeypatch):
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    reservation = SimpleNamespace(id=txn.reservation_id, offer_id=uuid4(), status="active", cancelled_at=None)
    offer = SimpleNamespace(id=reservation.offer_id, status="accepted", reject_reason=None, responded_at=None)
    listing = SimpleNamespace(id=txn.listing_id, status="reserved")

    async def noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(offer_service, "_notify", noop_notify)

    result = await offer_service.process_payment_failed(
        _DB(payment_attempt, txn, [payment_attempt], reservation, offer, listing),
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_failed",
        webhook_payload={
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_failed",
                        "order_id": "order_123",
                        "status": "failed",
                        "error_reason": "payment_failed",
                    }
                }
            }
        },
    )

    assert result is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_failed"
    assert listing.status == "active"
    assert payment_attempt.status == "failed"
    assert payment_attempt.razorpay_payment_id == "pay_failed"


@pytest.mark.asyncio
async def test_duplicate_payment_failed_release_is_idempotent(monkeypatch):
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    payment_attempt.status = "failed"
    reservation = SimpleNamespace(id=txn.reservation_id, offer_id=uuid4(), status="active", cancelled_at=None)
    offer = SimpleNamespace(id=reservation.offer_id, status="accepted", reject_reason=None, responded_at=None)
    listing = SimpleNamespace(id=txn.listing_id, status="reserved")
    notified = []

    async def fake_notify(*args, **_kwargs):
        notified.append(args)

    monkeypatch.setattr(offer_service, "_notify", fake_notify)

    result = await offer_service.process_payment_failed(
        _DB(payment_attempt, txn, [payment_attempt], reservation, offer, listing),
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_failed_retry",
        webhook_payload={"payload": {"payment": {"entity": {"status": "failed"}}}},
    )

    assert result is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_failed"
    assert listing.status == "active"
    assert payment_attempt.status == "failed"
    assert notified == []


@pytest.mark.asyncio
async def test_payment_failed_after_window_releases_as_failure(monkeypatch):
    now = datetime.now(timezone.utc)
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = now - timedelta(minutes=1)
    reservation = SimpleNamespace(id=txn.reservation_id, offer_id=uuid4(), status="active", cancelled_at=None)
    offer = SimpleNamespace(id=reservation.offer_id, status="accepted", reject_reason=None, responded_at=None)
    listing = SimpleNamespace(id=txn.listing_id, status="reserved")

    async def noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(offer_service, "_notify", noop_notify)

    result = await offer_service.process_payment_failed(
        _DB(payment_attempt, txn, [payment_attempt], reservation, offer, listing),
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_failed_timeout",
        webhook_payload={"payload": {"payment": {"entity": {"status": "failed"}}}},
    )

    assert result is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_failed"
    assert payment_attempt.status == "failed"
    assert listing.status == "active"


@pytest.mark.asyncio
async def test_late_payment_failed_does_not_reopen_cancelled_attempt(monkeypatch):
    txn = _txn(status="cancelled")
    payment_attempt = _payment_attempt(txn)
    payment_attempt.status = "cancelled"

    async def fail_if_notified(*_args, **_kwargs):
        raise AssertionError("cancelled payment attempts should not notify on late failed webhook")

    monkeypatch.setattr(offer_service, "_notify", fail_if_notified)

    result = await offer_service.process_payment_failed(
        _DB(payment_attempt),
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_failed_late",
        webhook_payload={"payload": {"payment": {"entity": {"status": "failed"}}}},
    )

    assert result is None
    assert payment_attempt.status == "cancelled"
    assert getattr(payment_attempt, "razorpay_payment_id", None) is None


@pytest.mark.asyncio
async def test_late_capture_after_cancel_does_not_reopen_sale(monkeypatch):
    txn = _txn(status="cancelled")
    payment_attempt = _payment_attempt(txn)
    refund_called = {}

    async def noop_notify(*_args, **_kwargs):
        return None

    async def fake_refund(db, refund_txn, *, reason, initiated_by, amount=None):
        refund_called["txn"] = refund_txn
        refund_called["reason"] = reason
        refund_called["initiated_by"] = initiated_by
        refund_txn.refund_status = "processing"
        return refund_txn

    from app.modules.transactions import refund_service

    monkeypatch.setattr(offer_service, "_notify", noop_notify)
    monkeypatch.setattr(refund_service, "initiate_refund", fake_refund)

    result = await offer_service.process_payment_paid(
        _DB(payment_attempt, txn),
        "order_123",
        "pay_late",
        {"payload": {"payment": {"entity": {"amount": 12345}}}},
    )

    assert result is txn
    assert txn.status == "cancelled"
    assert payment_attempt.status == "paid"
    assert payment_attempt.razorpay_payment_id == "pay_late"
    assert refund_called == {
        "txn": txn,
        "reason": "Payment captured after order cancellation",
        "initiated_by": "system_late_capture",
    }


@pytest.mark.asyncio
async def test_capture_after_payment_window_releases_and_refunds(monkeypatch):
    now = datetime.now(timezone.utc)
    txn = _txn()
    txn.gross_amount = Decimal("123.45")
    txn.refund_status = "none"
    txn.refund_amount = None
    txn.refund_reason = None
    txn.refund_initiated_at = None
    txn.refund_initiated_by = None
    txn.razorpay_refund_id = None
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = now - timedelta(minutes=1)
    payment_attempt.created_at = now - timedelta(minutes=31)
    payment_attempt.paid_at = None
    reservation = SimpleNamespace(id=txn.reservation_id, offer_id=uuid4(), status="active", cancelled_at=None)
    offer = SimpleNamespace(id=reservation.offer_id, status="accepted", reject_reason=None, responded_at=None)
    listing = SimpleNamespace(id=txn.listing_id, status="reserved")
    notifications = []

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        notifications.append((user_id, event_type))

    class _RefundAdapter:
        async def refund(self, **_kwargs):
            return SimpleNamespace(success=True, razorpay_refund_id="rfnd_timeout", status="processed")

    from app.modules.transactions import refund_service

    monkeypatch.setattr(offer_service, "_notify", fake_notify)
    monkeypatch.setattr(refund_service, "get_payment_adapter", lambda: _RefundAdapter())

    result = await offer_service.process_payment_paid(
        _DB(payment_attempt, txn, [payment_attempt], reservation, offer, listing, payment_attempt),
        "order_123",
        "pay_after_timeout",
        {
            "payload": {
                "payment": {
                    "entity": {
                        "amount": 12345,
                        "created_at": int((now + timedelta(seconds=1)).timestamp()),
                    }
                }
            }
        },
    )

    assert result is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_timeout"
    assert listing.status == "active"
    assert payment_attempt.status == "paid"
    assert payment_attempt.razorpay_payment_id == "pay_after_timeout"
    assert txn.refund_status == "completed"
    assert txn.razorpay_refund_id == "rfnd_timeout"
    assert (txn.buyer_id, "payment_late_capture_refund") in notifications


@pytest.mark.asyncio
async def test_checkout_authorized_after_window_expires_unpaid_order(monkeypatch):
    now = datetime.now(timezone.utc)
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = now - timedelta(minutes=1)
    reservation = SimpleNamespace(id=txn.reservation_id, offer_id=uuid4(), status="active", cancelled_at=None)
    offer = SimpleNamespace(id=reservation.offer_id, status="accepted", reject_reason=None, responded_at=None)
    listing = SimpleNamespace(id=txn.listing_id, status="reserved")

    async def noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(payments_adapter, "get_payment_adapter", lambda: _Adapter(status="authorized"))
    monkeypatch.setattr(offer_service, "_notify", noop_notify)

    result = await offer_service.process_checkout_payment_success(
        _DB(txn, payment_attempt, [payment_attempt], [payment_attempt], reservation, offer, listing),
        transaction_id=txn.id,
        buyer_id=txn.buyer_id,
        razorpay_order_id="order_123",
        razorpay_payment_id="pay_authorized",
        razorpay_signature="sig_123",
    )

    assert result is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_timeout"
    assert payment_attempt.status == "expired"
    assert listing.status == "active"


@pytest.mark.asyncio
async def test_cancel_unpaid_transaction_requires_buyer_owner():
    txn = _txn()

    with pytest.raises(ValueError, match="TRANSACTION_NOT_FOUND"):
        await offer_service.cancel_unpaid_transaction(
            _DB(txn),
            txn.id,
            uuid4(),
            reason="buyer_cancelled_payment",
        )


@pytest.mark.asyncio
async def test_cancel_unpaid_transaction_rejects_captured_order():
    txn = _txn(status="payment_captured")

    with pytest.raises(ValueError, match="INVALID_STATUS:payment_captured"):
        await offer_service.cancel_unpaid_transaction(
            _DB(txn),
            txn.id,
            txn.buyer_id,
            reason="buyer_cancelled_payment",
        )


@pytest.mark.asyncio
async def test_expire_unpaid_transaction_releases_inventory_after_window(monkeypatch):
    now = datetime.now(timezone.utc)
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = now - timedelta(minutes=1)
    payment_attempt.status = "failed"
    reservation = SimpleNamespace(id=txn.reservation_id, offer_id=uuid4(), status="active", cancelled_at=None)
    offer = SimpleNamespace(id=reservation.offer_id, status="accepted", reject_reason=None, responded_at=None)
    listing = SimpleNamespace(id=txn.listing_id, status="reserved")

    async def noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(offer_service, "_notify", noop_notify)

    out = await offer_service.expire_unpaid_transaction(
        _DB([payment_attempt], [payment_attempt], reservation, offer, listing),
        txn,
    )

    assert out is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_timeout"
    assert payment_attempt.status == "expired"
    assert reservation.status == "cancelled"
    assert offer.status == "cancelled"
    assert listing.status == "active"


@pytest.mark.asyncio
async def test_expire_unpaid_transaction_keeps_inventory_before_window():
    txn = _txn()
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)

    with pytest.raises(ValueError, match="PAYMENT_WINDOW_NOT_EXPIRED"):
        await offer_service.expire_unpaid_transaction(_DB([payment_attempt]), txn)


@pytest.mark.asyncio
async def test_expire_unpaid_transaction_uses_created_at_fallback_for_legacy_attempt(monkeypatch):
    txn = _txn()
    txn.gross_amount = Decimal("100")
    txn.created_at = datetime.now(timezone.utc) - timedelta(minutes=31)
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = None
    reservation = SimpleNamespace(id=txn.reservation_id, offer_id=uuid4(), status="active", cancelled_at=None)
    offer = SimpleNamespace(id=reservation.offer_id, status="accepted", reject_reason=None, responded_at=None)
    listing = SimpleNamespace(id=txn.listing_id, status="reserved")

    async def noop_notify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(offer_service, "_notify", noop_notify)

    out = await offer_service.expire_unpaid_transaction(
        _DB([payment_attempt], [payment_attempt], reservation, offer, listing),
        txn,
    )

    assert out is txn
    assert txn.status == "cancelled"
    assert txn.cancelled_reason == "payment_timeout"
    assert payment_attempt.status == "expired"
    assert listing.status == "active"


@pytest.mark.asyncio
async def test_expire_unpaid_transaction_keeps_fresh_legacy_attempt_pending():
    txn = _txn()
    txn.gross_amount = Decimal("100")
    txn.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = None

    with pytest.raises(ValueError, match="PAYMENT_WINDOW_NOT_EXPIRED"):
        await offer_service.expire_unpaid_transaction(_DB([payment_attempt]), txn)


@pytest.mark.asyncio
async def test_expire_unpaid_transaction_does_not_release_paid_pending_attempt():
    txn = _txn()
    txn.gross_amount = Decimal("100")
    txn.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
    payment_attempt = _payment_attempt(txn)
    payment_attempt.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    payment_attempt.status = "paid"
    payment_attempt.paid_at = datetime.now(timezone.utc) - timedelta(hours=1)

    with pytest.raises(ValueError, match="PAYMENT_WINDOW_NOT_EXPIRED"):
        await offer_service.expire_unpaid_transaction(_DB([payment_attempt]), txn)
