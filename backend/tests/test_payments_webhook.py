"""Wave 7: Razorpay webhook HMAC signature verification.

The money path trusts webhook events; the signature check is the only thing
stopping a forged 'paid'/'refunded' event. It had NO test.
"""
import hashlib
import hmac
import json

from app.core.settings import settings
from app.modules.payments.adapter import _RazorpayAdapter


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
