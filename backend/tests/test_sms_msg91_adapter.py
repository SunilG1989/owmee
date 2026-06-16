from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.settings import Settings, settings
from app.modules.identity_auth import sms_adapter


def _base_prod_kwargs(**overrides):
    kwargs = dict(
        env="production",
        database_url="postgresql://u:p@db:5432/owmee",
        redis_url="redis://cache:6379/0",
        r2_endpoint="https://acct.r2.cloudflarestorage.com",
        r2_access_key="ak",
        r2_secret_key="sk",
        secret_key="x" * 48,
        jwt_private_key="inline-private-key-material",
        jwt_public_key="inline-public-key-material",
        jwt_algorithm="RS256",
        allowed_origins="https://app.owmee.com",
        sms_provider="msg91",
        sms_api_key="msg91-auth-key",
        sms_template_id="msg91-template-id",
        otp_whitelist="",
        fraud_provider="bureau",
        fraud_enforcement_enabled=True,
    )
    kwargs.update(overrides)
    return kwargs


class _FakeResponse:
    status_code = 200
    content = b'{"type":"success","request_id":"req_123"}'

    def json(self):
        return {"type": "success", "request_id": "req_123"}


class _FakeAsyncClient:
    calls = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return None

    async def post(self, url, *, params, headers, json):
        self.calls.append({
            "url": url,
            "params": params,
            "headers": headers,
            "json": json,
            "timeout": self.kwargs.get("timeout"),
        })
        return _FakeResponse()


@pytest.mark.asyncio
async def test_msg91_adapter_sends_required_otp_payload(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(settings, "sms_api_base_url", "https://control.msg91.com/")
    monkeypatch.setattr(settings, "sms_api_key", "auth_key")
    monkeypatch.setattr(settings, "sms_template_id", "template_123")
    monkeypatch.setattr(settings, "sms_msg91_timeout_seconds", 7.0)
    monkeypatch.setattr(settings, "sms_msg91_otp_expiry_minutes", 10)
    monkeypatch.setattr(sms_adapter.httpx, "AsyncClient", _FakeAsyncClient)

    result = await sms_adapter._Msg91SMSAdapter().send_otp("+919876543210", "123456")

    assert result.success is True
    assert result.provider == "msg91"
    assert result.provider_message_id == "req_123"
    assert _FakeAsyncClient.calls == [
        {
            "url": "https://control.msg91.com/api/v5/otp",
            "params": {
                "template_id": "template_123",
                "mobile": "919876543210",
                "otp": "123456",
                "otp_expiry": "10",
            },
            "headers": {
                "accept": "application/json",
                "authkey": "auth_key",
            },
            "json": {},
            "timeout": 7.0,
        }
    ]


@pytest.mark.asyncio
async def test_msg91_adapter_fails_closed_without_template_id(monkeypatch):
    monkeypatch.setattr(settings, "sms_api_key", "auth_key")
    monkeypatch.setattr(settings, "sms_template_id", "")

    result = await sms_adapter._Msg91SMSAdapter().send_otp("+919876543210", "123456")

    assert result.success is False
    assert result.provider == "msg91"
    assert "SMS_TEMPLATE_ID" in result.error


@pytest.mark.asyncio
async def test_msg91_adapter_fails_closed_with_placeholder_template_id(monkeypatch):
    monkeypatch.setattr(settings, "sms_api_key", "auth_key")
    monkeypatch.setattr(settings, "sms_template_id", "REPLACE_WITH_MSG91_TEMPLATE_ID")

    result = await sms_adapter._Msg91SMSAdapter().send_otp("+919876543210", "123456")

    assert result.success is False
    assert result.provider == "msg91"
    assert "SMS_TEMPLATE_ID" in result.error


@pytest.mark.asyncio
async def test_msg91_adapter_does_not_treat_error_request_id_as_success(monkeypatch):
    class _ErrorResponse:
        status_code = 200
        content = b'{"type":"error","request_id":"req_123","message":"Template mismatch"}'
        text = '{"type":"error","request_id":"req_123","message":"Template mismatch"}'

        def json(self):
            return {"type": "error", "request_id": "req_123", "message": "Template mismatch"}

    class _ErrorClient(_FakeAsyncClient):
        async def post(self, url, *, params, headers, json):
            self.calls.append({"url": url, "params": params, "headers": headers, "json": json})
            return _ErrorResponse()

    monkeypatch.setattr(settings, "sms_api_key", "auth_key")
    monkeypatch.setattr(settings, "sms_template_id", "template_123")
    monkeypatch.setattr(sms_adapter.httpx, "AsyncClient", _ErrorClient)

    result = await sms_adapter._Msg91SMSAdapter().send_otp("+91 98765 43210", "123456")

    assert result.success is False
    assert result.provider == "msg91"
    assert result.error == "Template mismatch"


def test_render_blueprint_declares_required_msg91_env_slots():
    render_yaml = Path(__file__).resolve().parents[2] / "render.yaml"
    text = render_yaml.read_text()

    assert text.count("key: SMS_PROVIDER") == 2
    assert text.count("key: SMS_API_BASE_URL") == 2
    assert text.count("key: SMS_API_KEY") == 2
    assert text.count("key: SMS_TEMPLATE_ID") == 2
    assert text.count("key: SMS_SENDER_ID") == 2
    assert text.count("key: SMS_DLT_ENTITY_ID") == 2
    assert text.count("key: SMS_MSG91_TIMEOUT_SECONDS") == 2
    assert text.count("key: SMS_MSG91_OTP_EXPIRY_MINUTES") == 2
    assert "REPLACE_WITH_MSG91_TEMPLATE_ID" not in text


@pytest.mark.parametrize("field", ["sms_api_key", "sms_template_id"])
def test_msg91_required_values_refused_when_missing_in_production(field):
    with pytest.raises(ValidationError):
        Settings(**_base_prod_kwargs(**{field: ""}))


@pytest.mark.parametrize("field", ["sms_api_key", "sms_template_id"])
def test_msg91_placeholder_values_refused_in_production(field):
    with pytest.raises(ValidationError):
        Settings(**_base_prod_kwargs(**{field: "REPLACE_WITH_MSG91_VALUE"}))
