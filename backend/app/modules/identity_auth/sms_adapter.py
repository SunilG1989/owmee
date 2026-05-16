"""Provider-neutral SMS delivery adapters for OTP auth.

Auth routes store and verify OTPs; this module owns third-party delivery.
Adding a new SMS vendor should mean adding one adapter here and selecting it
with SMS_PROVIDER, not editing auth flow code.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx
import structlog

from app.core.settings import settings

logger = structlog.get_logger()


@dataclass(frozen=True)
class SMSDeliveryResult:
    success: bool
    provider: str
    provider_message_id: str = ""
    error: str | None = None


class SMSAdapter(Protocol):
    async def send_otp(self, phone: str, otp: str) -> SMSDeliveryResult: ...


class _MockSMSAdapter:
    async def send_otp(self, phone: str, otp: str) -> SMSDeliveryResult:
        logger.info("otp.mock_delivery", phone_suffix=phone[-4:], otp=otp)
        return SMSDeliveryResult(success=True, provider="mock")


class _Msg91SMSAdapter:
    """MSG91 OTP delivery adapter.

    Uses the provider's SendOTP API shape. Keep response parsing permissive:
    providers often vary casing/status messages while still returning a
    successful request id.
    """

    async def send_otp(self, phone: str, otp: str) -> SMSDeliveryResult:
        if not settings.sms_api_key or not settings.sms_template_id:
            return SMSDeliveryResult(
                success=False,
                provider="msg91",
                error="SMS_API_KEY and SMS_TEMPLATE_ID are required for MSG91",
            )

        mobile = phone.lstrip("+")
        url = f"{settings.sms_api_base_url.rstrip('/')}/api/v5/otp"
        params = {
            "template_id": settings.sms_template_id,
            "mobile": mobile,
            "authkey": settings.sms_api_key,
            "otp": otp,
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, params=params, json={})
            data = resp.json() if resp.content else {}
        except Exception as exc:
            logger.error("sms.msg91.exception", error=str(exc), phone_suffix=phone[-4:])
            return SMSDeliveryResult(success=False, provider="msg91", error=str(exc))

        if 200 <= resp.status_code < 300 and _looks_successful_msg91_response(data):
            request_id = str(data.get("request_id") or data.get("requestId") or data.get("message") or "")
            logger.info("sms.msg91.sent", phone_suffix=phone[-4:], request_id=request_id)
            return SMSDeliveryResult(
                success=True,
                provider="msg91",
                provider_message_id=request_id,
            )

        error = str(data.get("message") or data.get("error") or f"HTTP {resp.status_code}")[:300]
        logger.error(
            "sms.msg91.failed",
            status=resp.status_code,
            error=error,
            phone_suffix=phone[-4:],
        )
        return SMSDeliveryResult(success=False, provider="msg91", error=error)


def _looks_successful_msg91_response(data: dict) -> bool:
    status = str(data.get("type") or data.get("status") or "").lower()
    if status in {"success", "sent"}:
        return True
    return bool(data.get("request_id") or data.get("requestId"))


def sms_provider_is_mock() -> bool:
    provider = (settings.sms_provider or "").strip().lower()
    if settings.env == "development":
        return True
    return provider in {"mock", "dev", "log"}


def get_sms_adapter() -> SMSAdapter:
    provider = (settings.sms_provider or "").strip().lower()
    if sms_provider_is_mock():
        return _MockSMSAdapter()
    if provider == "":
        raise RuntimeError("SMS_PROVIDER must be set")
    if provider in {"msg91", "msg-91"}:
        return _Msg91SMSAdapter()
    raise RuntimeError(f"Unsupported SMS_PROVIDER={settings.sms_provider!r}")
