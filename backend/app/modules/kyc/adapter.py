"""
KYC partner adapter — abstracts Digio (primary), Karza (fallback).

All partner integrations go through this adapter.
The adapter NEVER logs or stores Aadhaar numbers.
It returns only opaque partner reference IDs and derived non-sensitive fields.

In development (ENV=development), all calls return mocked successful responses.
"""
from __future__ import annotations

import httpx
import structlog

from app.core.settings import settings

logger = structlog.get_logger()


# ── Response types ─────────────────────────────────────────────────────────────

class AadhaarOTPInitResponse:
    def __init__(self, request_id: str, success: bool, error: str | None = None):
        self.request_id = request_id
        self.success = success
        self.error = error


class AadhaarOTPVerifyResponse:
    def __init__(
        self,
        partner_ref: str,
        success: bool,
        name: str | None = None,
        dob: str | None = None,
        gender: str | None = None,
        state_ut: str | None = None,
        error: str | None = None,
        error_code: str | None = None,
    ):
        self.partner_ref = partner_ref
        self.success = success
        self.name = name
        self.dob = dob
        self.gender = gender
        self.state_ut = state_ut
        self.error = error
        self.error_code = error_code


class PANVerifyResponse:
    def __init__(
        self,
        success: bool,
        name: str | None = None,
        pan_aadhaar_linked: bool = False,
        error: str | None = None,
        error_code: str | None = None,
    ):
        self.success = success
        self.name = name
        self.pan_aadhaar_linked = pan_aadhaar_linked
        self.error = error
        self.error_code = error_code


class LivenessSessionResponse:
    def __init__(self, session_id: str, sdk_token: str, success: bool):
        self.session_id = session_id
        self.sdk_token = sdk_token
        self.success = success


class LivenessVerifyResponse:
    def __init__(self, partner_ref: str, success: bool, error: str | None = None):
        self.partner_ref = partner_ref
        self.success = success
        self.error = error


class PayoutAccountVerifyResponse:
    def __init__(
        self,
        success: bool,
        account_ref: str | None = None,
        error: str | None = None,
    ):
        self.success = success
        self.account_ref = account_ref
        self.error = error


# ── Dev stubs ──────────────────────────────────────────────────────────────────

DEV_OTP = "123456"


class _DevKYCAdapter:
    """Returns mocked successful responses in development mode."""

    async def aadhaar_otp_initiate(self, phone: str) -> AadhaarOTPInitResponse:
        logger.info("kyc.dev.aadhaar_otp_initiate", phone_suffix=phone[-4:])
        return AadhaarOTPInitResponse(request_id="dev_request_001", success=True)

    async def aadhaar_otp_verify(
        self, request_id: str, otp: str
    ) -> AadhaarOTPVerifyResponse:
        if otp != DEV_OTP:
            return AadhaarOTPVerifyResponse(
                partner_ref="",
                success=False,
                error="Invalid OTP",
                error_code="OTP_INVALID",
            )
        return AadhaarOTPVerifyResponse(
            partner_ref="dev_aadhaar_ref_abc123",
            success=True,
            name="Dev User",
            dob="1990-06-15",
            gender="M",
            state_ut="Karnataka",
        )

    async def pan_verify_with_linkage(
        self, pan: str
    ) -> PANVerifyResponse:
        if pan.upper() == "INVALID":
            return PANVerifyResponse(success=False, error_code="PAN_NOT_FOUND")
        return PANVerifyResponse(
            success=True,
            name="Dev User",
            pan_aadhaar_linked=True,
        )

    async def liveness_create_session(
        self, user_id: str
    ) -> LivenessSessionResponse:
        return LivenessSessionResponse(
            session_id="dev_liveness_session_001",
            sdk_token="dev_sdk_token_xyz",
            success=True,
        )

    async def liveness_verify(
        self, session_id: str
    ) -> LivenessVerifyResponse:
        return LivenessVerifyResponse(
            partner_ref="dev_liveness_ref_001",
            success=True,
        )

    async def payout_account_verify(
        self, account_type: str, account_value: str
    ) -> PayoutAccountVerifyResponse:
        return PayoutAccountVerifyResponse(
            success=True,
            account_ref="dev_payout_ref_001",
        )


# ── Digio adapter ──────────────────────────────────────────────────────────────

class _DigioKYCAdapter:
    """
    Production Digio integration.
    All endpoints return only derived non-sensitive fields — never raw Aadhaar.
    """

    def __init__(self):
        self._client = httpx.AsyncClient(
            base_url=settings.kyc_partner_base_url,
            headers={
                "Authorization": f"Bearer {settings.kyc_partner_api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    async def aadhaar_otp_initiate(self, phone: str) -> AadhaarOTPInitResponse:
        try:
            resp = await self._client.post(
                "/v2/kyc/aadhaar/otp/initiate",
                json={"mobile": phone},
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return AadhaarOTPInitResponse(
                    request_id=data["request_id"], success=True
                )
            return AadhaarOTPInitResponse(
                request_id="", success=False, error=data.get("message")
            )
        except Exception as e:
            logger.error("kyc.aadhaar_otp_initiate.error", error=str(e))
            return AadhaarOTPInitResponse(request_id="", success=False, error=str(e))

    async def aadhaar_otp_verify(
        self, request_id: str, otp: str
    ) -> AadhaarOTPVerifyResponse:
        try:
            resp = await self._client.post(
                "/v2/kyc/aadhaar/otp/verify",
                json={"request_id": request_id, "otp": otp},
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                kyc_data = data.get("kyc_data", {})
                return AadhaarOTPVerifyResponse(
                    partner_ref=data["reference_id"],
                    success=True,
                    name=kyc_data.get("name"),
                    dob=kyc_data.get("dob"),
                    gender=kyc_data.get("gender"),
                    state_ut=kyc_data.get("address", {}).get("state"),
                )
            return AadhaarOTPVerifyResponse(
                partner_ref="",
                success=False,
                error=data.get("message"),
                error_code=data.get("error_code"),
            )
        except Exception as e:
            logger.error("kyc.aadhaar_otp_verify.error", error=str(e))
            return AadhaarOTPVerifyResponse(partner_ref="", success=False, error=str(e))

    async def pan_verify_with_linkage(self, pan: str) -> PANVerifyResponse:
        try:
            resp = await self._client.post(
                "/v2/kyc/pan/verify-with-linkage",
                json={"pan": pan.upper()},
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return PANVerifyResponse(
                    success=True,
                    name=data.get("name_on_pan"),
                    pan_aadhaar_linked=data.get("aadhaar_linked", False),
                )
            return PANVerifyResponse(
                success=False,
                error=data.get("message"),
                error_code=data.get("error_code"),
            )
        except Exception as e:
            logger.error("kyc.pan_verify.error", error=str(e))
            return PANVerifyResponse(success=False, error=str(e))

    async def liveness_create_session(self, user_id: str) -> LivenessSessionResponse:
        try:
            resp = await self._client.post(
                "/v2/kyc/liveness/session",
                json={"reference_id": user_id},
            )
            data = resp.json()
            return LivenessSessionResponse(
                session_id=data["session_id"],
                sdk_token=data["token"],
                success=True,
            )
        except Exception as e:
            logger.error("kyc.liveness_session.error", error=str(e))
            return LivenessSessionResponse(session_id="", sdk_token="", success=False)

    async def liveness_verify(self, session_id: str) -> LivenessVerifyResponse:
        try:
            resp = await self._client.post(
                "/v2/kyc/liveness/verify",
                json={"session_id": session_id},
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return LivenessVerifyResponse(
                    partner_ref=data["reference_id"], success=True
                )
            return LivenessVerifyResponse(
                partner_ref="",
                success=False,
                error=data.get("message"),
            )
        except Exception as e:
            logger.error("kyc.liveness_verify.error", error=str(e))
            return LivenessVerifyResponse(partner_ref="", success=False, error=str(e))

    async def payout_account_verify(
        self, account_type: str, account_value: str
    ) -> PayoutAccountVerifyResponse:
        try:
            endpoint = (
                "/v2/kyc/bank/penny-drop"
                if account_type == "bank"
                else "/v2/kyc/upi/verify"
            )
            resp = await self._client.post(
                endpoint,
                json={"account": account_value, "type": account_type},
            )
            data = resp.json()
            if resp.status_code == 200 and data.get("success"):
                return PayoutAccountVerifyResponse(
                    success=True, account_ref=data["reference_id"]
                )
            return PayoutAccountVerifyResponse(
                success=False, error=data.get("message")
            )
        except Exception as e:
            logger.error("kyc.payout_verify.error", error=str(e))
            return PayoutAccountVerifyResponse(success=False, error=str(e))


# ── Factory ────────────────────────────────────────────────────────────────────

def get_kyc_adapter() -> _DevKYCAdapter | _DigioKYCAdapter:
    if settings.env == "development":
        return _DevKYCAdapter()
    return _DigioKYCAdapter()
