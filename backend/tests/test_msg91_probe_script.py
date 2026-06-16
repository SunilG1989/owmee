import argparse
import json

import pytest

from app.core.settings import settings
from app.modules.identity_auth.sms_adapter import SMSDeliveryResult
from scripts import probe_msg91_otp


def _configure_msg91(monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "msg91")
    monkeypatch.setattr(settings, "sms_api_key", "auth_key")
    monkeypatch.setattr(settings, "sms_template_id", "template_123")


@pytest.mark.asyncio
async def test_probe_requires_confirm_send_and_does_not_call_adapter(monkeypatch, capsys):
    _configure_msg91(monkeypatch)

    class FailingAdapter:
        async def send_otp(self, _phone, _otp):
            raise AssertionError("probe should not send without --confirm-send")

    monkeypatch.setattr(probe_msg91_otp, "_Msg91SMSAdapter", FailingAdapter)
    args = argparse.Namespace(
        phone="+919876543210",
        otp="123456",
        confirm_send=False,
        show_otp=False,
    )

    exit_code = await probe_msg91_otp.run_probe(args)

    assert exit_code == 2
    output = capsys.readouterr().out
    payload = json.loads(output)
    assert payload["success"] is False
    assert payload["phone"] == "********3210"
    assert "Add --confirm-send" in payload["errors"][0]
    assert "123456" not in output


@pytest.mark.asyncio
async def test_probe_success_payload_redacts_otp_by_default(monkeypatch, capsys):
    _configure_msg91(monkeypatch)

    class SuccessfulAdapter:
        async def send_otp(self, phone, otp):
            assert phone == "+919876543210"
            assert otp == "654321"
            return SMSDeliveryResult(
                success=True,
                provider="msg91",
                provider_message_id="req_abc",
            )

    monkeypatch.setattr(probe_msg91_otp, "_Msg91SMSAdapter", SuccessfulAdapter)
    args = argparse.Namespace(
        phone="+919876543210",
        otp="654321",
        confirm_send=True,
        show_otp=False,
    )

    exit_code = await probe_msg91_otp.run_probe(args)

    assert exit_code == 0
    output = capsys.readouterr().out
    payload = json.loads(output)
    assert payload["success"] is True
    assert payload["provider_message_id"] == "req_abc"
    assert payload["raw_result"]["provider_message_id"] == "req_abc"
    assert payload["stores_redis_otp"] is False
    assert payload["phone"] == "********3210"
    assert "otp" not in payload
    assert "654321" not in output


@pytest.mark.asyncio
async def test_probe_shows_otp_only_when_requested(monkeypatch, capsys):
    _configure_msg91(monkeypatch)

    class SuccessfulAdapter:
        async def send_otp(self, _phone, _otp):
            return SMSDeliveryResult(
                success=True,
                provider="msg91",
                provider_message_id="req_abc",
            )

    monkeypatch.setattr(probe_msg91_otp, "_Msg91SMSAdapter", SuccessfulAdapter)
    args = argparse.Namespace(
        phone="+919876543210",
        otp="654321",
        confirm_send=True,
        show_otp=True,
    )

    exit_code = await probe_msg91_otp.run_probe(args)

    assert exit_code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["otp"] == "654321"


def test_probe_reports_missing_msg91_configuration(monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "mock")
    monkeypatch.setattr(settings, "sms_api_key", "REPLACE_WITH_MSG91_AUTHKEY")
    monkeypatch.setattr(settings, "sms_template_id", "")

    errors = probe_msg91_otp.validate_probe_inputs(
        phone="+919876543210",
        otp="123456",
        confirm_send=True,
    )

    assert errors == [
        "SMS_PROVIDER must be msg91 for this probe.",
        "SMS_API_KEY must be set to a real MSG91 authkey.",
        "SMS_TEMPLATE_ID must be set to the MSG91 OTP template id.",
    ]
