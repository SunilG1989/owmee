import pytest

from app.core.settings import settings
from app.modules.ai_assistant import provider as ai_provider
from app.modules.geo.provider import get_reverse_geocoder
from app.modules.identity_auth.sms_adapter import get_sms_adapter
from app.modules.kyc.adapter import get_kyc_adapter
from app.modules.notifications.push_adapter import get_push_adapter
from app.modules.payments.adapter import get_payment_adapter


def test_ai_provider_rejects_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "unknown-ai")
    with pytest.raises(RuntimeError, match="Unsupported AI_PROVIDER"):
        ai_provider.get_ai_listing_provider()


def test_payment_provider_uses_dev_adapter_in_development(monkeypatch):
    monkeypatch.setattr(settings, "env", "development")
    monkeypatch.setattr(settings, "pa_provider", "razorpay")
    adapter = get_payment_adapter()
    assert adapter.__class__.__name__ == "_DevPaymentAdapter"


def test_payment_provider_rejects_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "pa_provider", "unknown-pay")
    with pytest.raises(RuntimeError, match="Unsupported PA_PROVIDER"):
        get_payment_adapter()


def test_payment_provider_rejects_empty_outside_development(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "pa_provider", "")
    with pytest.raises(RuntimeError, match="PA_PROVIDER must be set"):
        get_payment_adapter()


def test_payment_provider_allows_explicit_mock_for_private_staging(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "pa_provider", "mock")
    adapter = get_payment_adapter()
    assert adapter.__class__.__name__ == "_DevPaymentAdapter"


def test_sms_provider_uses_mock_adapter_in_development(monkeypatch):
    monkeypatch.setattr(settings, "env", "development")
    monkeypatch.setattr(settings, "sms_provider", "msg91")
    adapter = get_sms_adapter()
    assert adapter.__class__.__name__ == "_MockSMSAdapter"


def test_sms_provider_rejects_empty_in_production(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "sms_provider", "")
    with pytest.raises(RuntimeError, match="SMS_PROVIDER must be set"):
        get_sms_adapter()


def test_sms_provider_allows_explicit_mock_for_private_staging(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "sms_provider", "mock")
    adapter = get_sms_adapter()
    assert adapter.__class__.__name__ == "_MockSMSAdapter"


def test_kyc_provider_rejects_empty_outside_development(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "kyc_partner", "")
    with pytest.raises(RuntimeError, match="KYC_PARTNER must be set"):
        get_kyc_adapter()


def test_kyc_provider_allows_explicit_mock_for_private_staging(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "kyc_partner", "mock")
    adapter = get_kyc_adapter()
    assert adapter.__class__.__name__ == "_DevKYCAdapter"


def test_geo_provider_rejects_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "geocoding_provider", "unknown-geo")
    with pytest.raises(RuntimeError, match="Unsupported GEOCODING_PROVIDER"):
        get_reverse_geocoder()


def test_push_provider_rejects_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "push_provider", "unknown-push")
    with pytest.raises(RuntimeError, match="Unsupported PUSH_PROVIDER"):
        get_push_adapter()
