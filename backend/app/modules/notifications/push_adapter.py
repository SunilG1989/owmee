"""Provider-neutral push notification adapters."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx
import structlog

from app.core.settings import settings

logger = structlog.get_logger()


@dataclass(frozen=True)
class PushDeliveryResult:
    success: bool
    provider: str
    invalid_token: bool = False
    error: str | None = None


class PushAdapter(Protocol):
    async def send(
        self,
        token: str,
        title: str,
        body: str,
        event_type: str,
        data: dict,
    ) -> PushDeliveryResult: ...


class _NoopPushAdapter:
    async def send(
        self,
        token: str,
        title: str,
        body: str,
        event_type: str,
        data: dict,
    ) -> PushDeliveryResult:
        return PushDeliveryResult(success=False, provider="noop", error="push disabled")


class _FCMPushAdapter:
    async def send(
        self,
        token: str,
        title: str,
        body: str,
        event_type: str,
        data: dict,
    ) -> PushDeliveryResult:
        if not settings.fcm_server_key:
            return PushDeliveryResult(success=False, provider="fcm", error="FCM_SERVER_KEY missing")

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                res = await client.post(
                    "https://fcm.googleapis.com/fcm/send",
                    headers={
                        "Authorization": f"key={settings.fcm_server_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "to": token,
                        "notification": {
                            "title": title,
                            "body": body,
                            "sound": "default",
                            "badge": "1",
                        },
                        "data": {
                            "event_type": event_type,
                            **{k: str(v) for k, v in data.items()},
                        },
                        "priority": "high",
                        "android": {
                            "notification": {
                                "channel_id": "owmee_transactions",
                                "priority": "high",
                            }
                        },
                    },
                )
        except Exception as exc:
            logger.error("push.fcm.exception", error=str(exc))
            return PushDeliveryResult(success=False, provider="fcm", error=str(exc))

        try:
            resp_data = res.json() if res.content else {}
        except Exception:
            resp_data = {}

        if res.status_code == 200 and resp_data.get("failure", 0) == 0:
            return PushDeliveryResult(success=True, provider="fcm")

        invalid_token = res.status_code == 200 and resp_data.get("failure", 0) > 0
        error = str(resp_data.get("results") or resp_data.get("error") or res.text[:200])
        return PushDeliveryResult(
            success=False,
            provider="fcm",
            invalid_token=invalid_token,
            error=error[:300],
        )


def get_push_adapter() -> PushAdapter:
    provider = (settings.push_provider or "fcm").strip().lower()
    if provider in {"", "noop", "mock", "dev", "disabled"}:
        return _NoopPushAdapter()
    if provider == "fcm":
        return _FCMPushAdapter()
    raise RuntimeError(f"Unsupported PUSH_PROVIDER={settings.push_provider!r}")
