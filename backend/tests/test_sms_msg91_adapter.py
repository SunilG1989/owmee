from pathlib import Path

import pytest

from app.core.settings import settings
from app.modules.identity_auth import sms_adapter


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

    async def post(self, url, *, params, json):
        self.calls.append({"url": url, "params": params, "json": json, "timeout": self.kwargs.get("timeout")})
        return _FakeResponse()


@pytest.mark.asyncio
async def test_msg91_adapter_sends_required_otp_payload(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(settings, "sms_api_base_url", "https://control.msg91.com/")
    monkeypatch.setattr(settings, "sms_api_key", "auth_key")
    monkeypatch.setattr(settings, "sms_template_id", "template_123")
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
                "authkey": "auth_key",
                "otp": "123456",
            },
            "json": {},
            "timeout": 10.0,
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


def test_render_blueprint_declares_required_msg91_env_slots():
    render_yaml = Path(__file__).resolve().parents[2] / "render.yaml"
    text = render_yaml.read_text()

    assert text.count("key: SMS_PROVIDER") == 2
    assert text.count("key: SMS_API_BASE_URL") == 2
    assert text.count("key: SMS_API_KEY") == 2
    assert text.count("key: SMS_TEMPLATE_ID") == 2
    assert text.count("key: SMS_SENDER_ID") == 2
    assert text.count("key: SMS_DLT_ENTITY_ID") == 2
