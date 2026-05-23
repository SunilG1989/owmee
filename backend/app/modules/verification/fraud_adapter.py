"""Fraud/risk provider adapters.

Bureau should live behind this adapter. The rest of Owmee consumes normalized
FraudCheckResult values, not provider-specific payloads.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import httpx
import structlog

from app.core.settings import settings

logger = structlog.get_logger()


@dataclass(frozen=True)
class FraudCheckRequest:
    user_id: str
    phone: str
    device_id: str | None = None
    device_model: str | None = None
    os: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    context: dict = field(default_factory=dict)


@dataclass(frozen=True)
class FraudCheckResult:
    success: bool
    provider: str
    provider_ref: str = ""
    risk_band: str = "unknown"
    decision: str = "step_up"
    reason_codes: list[str] = field(default_factory=list)
    score: float | None = None
    error: str | None = None


class FraudAdapter(Protocol):
    async def check_onboarding(self, request: FraudCheckRequest) -> FraudCheckResult: ...


class _MockFraudAdapter:
    async def check_onboarding(self, request: FraudCheckRequest) -> FraudCheckResult:
        return FraudCheckResult(
            success=True,
            provider="mock",
            provider_ref=f"mock_fraud_{request.user_id[-8:]}",
            risk_band="low",
            decision="allow",
            reason_codes=["MOCK_LOW_RISK"],
            score=0.05,
        )


class _BureauFraudAdapter:
    """Bureau adapter shell.

    Bureau account contracts can vary by product bundle. Keep the endpoint path
    configurable and normalize common response shapes into Owmee's internal
    decision contract.
    """

    def __init__(self):
        self._base_url = settings.fraud_api_base_url.rstrip("/")
        self._path = settings.fraud_onboarding_path

    async def check_onboarding(self, request: FraudCheckRequest) -> FraudCheckResult:
        if not settings.fraud_api_key or not self._base_url:
            return FraudCheckResult(
                success=False,
                provider="bureau",
                error="FRAUD_API_KEY and FRAUD_API_BASE_URL are required for Bureau",
            )

        payload = {
            "user_id": request.user_id,
            "phone": request.phone,
            "device": {
                "id": request.device_id,
                "model": request.device_model,
                "os": request.os,
            },
            "ip_address": request.ip_address,
            "user_agent": request.user_agent,
            "context": request.context or {},
        }
        headers = {
            "Authorization": f"Bearer {settings.fraud_api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                headers=headers,
                timeout=settings.fraud_timeout_seconds,
            ) as client:
                resp = await client.post(self._path, json=payload)
            data = resp.json() if resp.content else {}
        except Exception as exc:
            logger.error("fraud.bureau.exception", error=str(exc), user_id=request.user_id)
            return FraudCheckResult(success=False, provider="bureau", error=str(exc))

        if not (200 <= resp.status_code < 300):
            error = str(data.get("message") or data.get("error") or f"HTTP {resp.status_code}")[:300]
            logger.error("fraud.bureau.failed", status=resp.status_code, error=error, user_id=request.user_id)
            return FraudCheckResult(success=False, provider="bureau", error=error)

        risk_band = _normalize_risk_band(data)
        decision = _normalize_decision(data, risk_band)
        reason_codes = data.get("reason_codes") or data.get("reasons") or []
        if isinstance(reason_codes, str):
            reason_codes = [reason_codes]

        return FraudCheckResult(
            success=True,
            provider="bureau",
            provider_ref=str(data.get("id") or data.get("reference_id") or data.get("request_id") or ""),
            risk_band=risk_band,
            decision=decision,
            reason_codes=[str(code)[:80] for code in reason_codes],
            score=_extract_score(data),
        )


def _extract_score(data: dict) -> float | None:
    value = data.get("score", data.get("risk_score"))
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _normalize_risk_band(data: dict) -> str:
    raw = str(data.get("risk_band") or data.get("riskBand") or data.get("risk_level") or "").lower()
    if raw in {"low", "medium", "high", "unknown"}:
        return raw
    score = _extract_score(data)
    if score is None:
        return "unknown"
    # Accept both 0..1 and 0..100 scoring conventions.
    score_100 = score * 100 if score <= 1 else score
    if score_100 >= 80:
        return "high"
    if score_100 >= 50:
        return "medium"
    return "low"


def _normalize_decision(data: dict, risk_band: str) -> str:
    raw = str(data.get("decision") or data.get("recommendation") or "").lower()
    if raw in {"allow", "approve", "approved", "accept", "pass"}:
        return "allow"
    if raw in {"step_up", "step-up", "review", "verify"}:
        return "step_up"
    if raw in {"manual_review", "manual-review"}:
        return "manual_review"
    if raw in {"block", "blocked", "reject", "deny"}:
        return "block"
    if risk_band == "high":
        return "block"
    if risk_band in {"medium", "unknown"}:
        return "step_up"
    return "allow"


def fraud_provider_is_mock() -> bool:
    provider = (settings.fraud_provider or "").strip().lower()
    if settings.env == "development":
        return True
    return provider in {"mock", "dev", "log"}


def get_fraud_adapter() -> FraudAdapter:
    provider = (settings.fraud_provider or "").strip().lower()
    if fraud_provider_is_mock():
        return _MockFraudAdapter()
    if provider == "":
        raise RuntimeError("FRAUD_PROVIDER must be set")
    if provider == "bureau":
        return _BureauFraudAdapter()
    raise RuntimeError(f"Unsupported FRAUD_PROVIDER={settings.fraud_provider!r}")
