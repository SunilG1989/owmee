import pytest
from fastapi import HTTPException

from app.core.settings import settings
from app.modules.identity_auth import router as auth_router


def test_production_msg91_ignores_stale_otp_whitelist(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "sms_provider", "msg91")
    monkeypatch.setattr(settings, "otp_whitelist", "+919876543210,9876543211")

    assert auth_router._is_whitelisted_phone("+919876543210") is False
    assert auth_router._uses_fixed_otp("+919876543210") is False


def test_development_can_still_use_otp_whitelist(monkeypatch):
    monkeypatch.setattr(settings, "env", "development")
    monkeypatch.setattr(settings, "sms_provider", "msg91")
    monkeypatch.setattr(settings, "otp_whitelist", "+919876543210")

    assert auth_router._is_whitelisted_phone("+91 98765 43210") is True
    assert auth_router._uses_fixed_otp("+91 98765 43210") is True


@pytest.mark.asyncio
async def test_send_otp_removes_stored_code_when_sms_delivery_fails(monkeypatch):
    stored: list[tuple[str, str, bool]] = []
    deleted: list[str] = []

    async def fake_check_rate_limit(phone: str) -> None:
        return None

    def fake_limit_by_ip(_name: str, _limit: int):
        async def limiter(_request):
            return None

        return limiter

    async def fake_store_otp(phone: str, otp: str, *, count_rate: bool = True) -> None:
        stored.append((phone, otp, count_rate))

    async def fake_send_sms(_phone: str, _otp: str) -> None:
        raise HTTPException(status_code=503, detail={"error": "OTP_DELIVERY_FAILED"})

    class FakeRedis:
        async def delete(self, *keys):
            deleted.extend(keys)

    async def fake_get_redis():
        return FakeRedis()

    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "sms_provider", "msg91")
    monkeypatch.setattr(settings, "otp_whitelist", "")
    monkeypatch.setattr(auth_router, "_check_rate_limit", fake_check_rate_limit)
    monkeypatch.setattr(auth_router, "limit_by_ip", fake_limit_by_ip)
    monkeypatch.setattr(auth_router, "_store_otp", fake_store_otp)
    monkeypatch.setattr(auth_router, "_send_sms", fake_send_sms)
    monkeypatch.setattr(auth_router, "get_redis", fake_get_redis)

    with pytest.raises(HTTPException) as exc:
        await auth_router.send_otp(
            auth_router.SendOTPRequest(phone_number="+91 98765 43210"),
            request=object(),
        )

    assert exc.value.status_code == 503
    assert stored and stored[0][0] == "+919876543210"
    assert set(deleted) == {
        auth_router._otp_value_key("+919876543210"),
        auth_router._otp_attempts_key("+919876543210"),
        auth_router._otp_lock_key("+919876543210"),
    }
