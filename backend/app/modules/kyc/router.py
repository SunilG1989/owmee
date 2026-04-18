"""
KYC router — Epic 2

Endpoints:
  POST /v1/kyc/consent                   — record DPDP consent before each step
  POST /v1/kyc/aadhaar/initiate          — start Aadhaar OTP flow
  POST /v1/kyc/aadhaar/verify            — submit OTP + get result
  POST /v1/kyc/pan/verify                — verify PAN + linkage + name match
  POST /v1/kyc/liveness/session          — create liveness session
  POST /v1/kyc/liveness/verify           — verify liveness result
  POST /v1/kyc/payout-account/verify     — verify bank/UPI payout account
  GET  /v1/kyc/status                    — current KYC status + next step

Sprint 4 / v3: after every successful KYC step the router calls
`derive_tri_state_from_kyc(db, user_id)` so the user's seller_tier and
buyer_eligible fields update immediately, not just when kyc_status changes.
"""
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
import structlog

from app.core.dependencies import BasicUser, DBSession
from app.modules.kyc.service import (
    derive_tri_state_from_kyc,
    get_or_create_verification,
    next_pending_step,
    record_consent,
    update_user_kyc_status,
)
from app.modules.kyc.activities import (
    ActivityAadhaarInitInput,
    ActivityAadhaarVerifyInput,
    ActivityPANVerifyInput,
    ActivityLivenessSessionInput,
    ActivityLivenessVerifyInput,
    ActivityPayoutVerifyInput,
    act_aadhaar_otp_initiate,
    act_aadhaar_otp_verify,
    act_pan_verify,
    act_liveness_create_session,
    act_liveness_verify,
    act_payout_account_verify,
)

router = APIRouter()
logger = structlog.get_logger()


# ── Schemas ────────────────────────────────────────────────────────────────────

class ConsentRequest(BaseModel):
    consent_type: str = Field(
        ...,
        description="aadhaar_kyc | pan_kyc | liveness | financial_account"
    )
    consent_version: str = "v1.0"


class AadhaarInitRequest(BaseModel):
    pass   # phone comes from JWT


class AadhaarVerifyRequest(BaseModel):
    request_id: str
    otp: str = Field(..., min_length=6, max_length=6)


class PANVerifyRequest(BaseModel):
    pan_number: str = Field(..., min_length=10, max_length=10)


class LivenessVerifyRequest(BaseModel):
    session_id: str


class PayoutAccountRequest(BaseModel):
    account_type: str = Field(..., pattern="^(bank|upi)$")
    account_value: str = Field(..., min_length=3, max_length=100)
    # UPI ID (e.g. user@upi) or bank account number
    # ifsc_code required if account_type = bank
    ifsc_code: str | None = None


class KYCStatusResponse(BaseModel):
    kyc_status: str
    next_step: str
    aadhaar_verified: bool
    pan_verified: bool
    pan_aadhaar_linked: bool
    name_match_result: str | None
    liveness_verified: bool
    payout_verified: bool


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/consent", status_code=status.HTTP_204_NO_CONTENT)
async def record_kyc_consent(
    body: ConsentRequest,
    current_user: BasicUser,
    db: DBSession,
    request: Request,
):
    """
    DPDP: record explicit consent before collecting any KYC data.
    Must be called before each KYC step (aadhaar_kyc, pan_kyc, liveness, financial_account).
    """
    v = await get_or_create_verification(db, current_user.user_id)
    await record_consent(
        db,
        user_id=current_user.user_id,
        verification_id=v.id,
        consent_type=body.consent_type,
        action="granted",
        ip_address=request.client.host if request.client else None,
        consent_version=body.consent_version,
    )
    logger.info("kyc.consent_recorded", user_id=str(current_user.user_id), type=body.consent_type)


@router.post("/aadhaar/initiate")
async def aadhaar_otp_initiate(
    current_user: BasicUser,
    db: DBSession,
):
    """
    Initiate Aadhaar OTP via KYC partner.
    Phone number is taken from the authenticated user's account.
    """
    from sqlalchemy import select
    from app.modules.identity_auth.models import User

    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    act_result = await act_aadhaar_otp_initiate(
        ActivityAadhaarInitInput(
            user_id=str(current_user.user_id),
            phone=user.phone_number,
        )
    )

    if not act_result["success"]:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "KYC_PARTNER_ERROR", "message": "Could not initiate Aadhaar verification. Please try again."},
        )

    return {"request_id": act_result["request_id"], "expires_in_seconds": 600}


@router.post("/aadhaar/verify")
async def aadhaar_otp_verify(
    body: AadhaarVerifyRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """
    Submit Aadhaar OTP. On success, stores partner ref and non-sensitive derived fields.
    Performs minor check. Never stores Aadhaar number.
    """
    act_result = await act_aadhaar_otp_verify(
        ActivityAadhaarVerifyInput(
            user_id=str(current_user.user_id),
            request_id=body.request_id,
            otp=body.otp,
        )
    )

    if not act_result["success"]:
        error_code = act_result.get("error_code", "AADHAAR_VERIFY_FAILED")
        messages = {
            "OTP_INVALID": "Incorrect OTP. Check your message and try again.",
            "MINOR_DETECTED": "You must be 18 or older to use Owmee.",
            "OTP_EXPIRED": "OTP has expired. Please request a new one.",
        }
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": error_code,
                "message": messages.get(error_code, "Aadhaar verification failed. Please try again."),
            },
        )

    # Sprint 4: advance seller_tier / buyer_eligible based on newly-set flags
    await derive_tri_state_from_kyc(db, current_user.user_id)
    await db.commit()

    return {
        "success": True,
        "next_step": "pan",
        "message": "Aadhaar verified. Next: verify your PAN.",
    }


@router.post("/pan/verify")
async def pan_verify(
    body: PANVerifyRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """
    Verify PAN number with PAN-Aadhaar linkage check and name fuzzy match.
    """
    act_result = await act_pan_verify(
        ActivityPANVerifyInput(
            user_id=str(current_user.user_id),
            pan_number=body.pan_number.upper(),
        )
    )

    if not act_result["success"]:
        error_code = act_result.get("error_code", "PAN_VERIFY_FAILED")
        messages = {
            "PAN_NOT_FOUND": "PAN number not found. Check and try again.",
            "PAN_AADHAAR_INOPERATIVE": "Your PAN is not linked to Aadhaar. Please link at incometax.gov.in and try again.",
            "NAME_MISMATCH": "The name on your PAN does not match your Aadhaar. Please contact support.",
        }
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": error_code,
                "message": messages.get(error_code, "PAN verification failed."),
            },
        )

    name_match_result = act_result.get("name_match_result", "pass")

    # Sprint 4: advance seller_tier / buyer_eligible based on newly-set flags
    # (still Lite at this point unless liveness was done out of order)
    await derive_tri_state_from_kyc(db, current_user.user_id)
    await db.commit()

    if name_match_result == "manual_review":
        return {
            "success": True,
            "next_step": "manual_review",
            "message": "Your documents have been submitted for review. We'll notify you within 4 hours.",
        }

    return {
        "success": True,
        "next_step": "liveness",
        "message": "PAN verified. Next: complete a quick selfie check.",
    }


@router.post("/liveness/session")
async def liveness_create_session(current_user: BasicUser):
    """Create a liveness session. Returns SDK token for the mobile app."""
    act_result = await act_liveness_create_session(
        ActivityLivenessSessionInput(user_id=str(current_user.user_id))
    )
    if not act_result["success"]:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": "LIVENESS_SESSION_FAILED", "message": "Could not start liveness check. Please try again."},
        )
    return {
        "session_id": act_result["session_id"],
        "sdk_token": act_result["sdk_token"],
    }


@router.post("/liveness/verify")
async def liveness_verify(
    body: LivenessVerifyRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Submit liveness session result."""
    act_result = await act_liveness_verify(
        ActivityLivenessVerifyInput(
            user_id=str(current_user.user_id),
            session_id=body.session_id,
        )
    )
    if not act_result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "LIVENESS_FAILED", "message": "Liveness check failed. Please retry in a well-lit area."},
        )

    # Sprint 4: this is where Lite -> Full promotion happens
    await derive_tri_state_from_kyc(db, current_user.user_id)
    await db.commit()

    return {
        "success": True,
        "next_step": "payout_account",
        "message": "Identity confirmed. Last step: add your payout account.",
    }


@router.post("/payout-account/verify")
async def payout_account_verify(
    body: PayoutAccountRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """
    Verify bank account (penny-drop) or UPI ID.
    On success, marks user as fully verified if all other steps are complete.
    """
    act_result = await act_payout_account_verify(
        ActivityPayoutVerifyInput(
            user_id=str(current_user.user_id),
            account_type=body.account_type,
            account_value=body.account_value,
        )
    )
    if not act_result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "PAYOUT_ACCOUNT_FAILED",
                "message": "Could not verify your account. Check details and try again.",
            },
        )

    # Check if all steps are now complete → mark verified
    v = await get_or_create_verification(db, current_user.user_id)
    if (
        v.aadhaar_verified
        and v.pan_verified
        and v.liveness_verified
        and v.payout_verified
        and v.name_match_result in ("pass", None)
    ):
        v.kyc_status = "verified"
        # update_user_kyc_status also runs derive_tri_state_from_kyc internally,
        # which flips buyer_eligible -> True.
        await update_user_kyc_status(db, current_user.user_id, "verified")
        await db.commit()
        logger.info("kyc.completed", user_id=str(current_user.user_id))
        return {
            "success": True,
            "kyc_status": "verified",
            "message": "You're verified! You can now buy and sell on Owmee.",
        }

    # Not all steps done yet — still advance tri-state based on what IS done
    await derive_tri_state_from_kyc(db, current_user.user_id)
    await db.commit()

    return {
        "success": True,
        "next_step": next_pending_step(v),
        "message": "Account added.",
    }


@router.get("/status", response_model=KYCStatusResponse)
async def get_kyc_status(current_user: BasicUser, db: DBSession):
    """Return current KYC status and next pending step."""
    v = await get_or_create_verification(db, current_user.user_id)
    return KYCStatusResponse(
        kyc_status=v.kyc_status,
        next_step=next_pending_step(v),
        aadhaar_verified=v.aadhaar_verified or False,
        pan_verified=v.pan_verified or False,
        pan_aadhaar_linked=v.pan_aadhaar_linked or False,
        name_match_result=v.name_match_result,
        liveness_verified=v.liveness_verified or False,
        payout_verified=v.payout_verified or False,
    )


# ── Sprint 3: Address confirm (after Aadhaar) ──────────────────────────────────

class AddressConfirmRequest(BaseModel):
    address_house: str | None = Field(None, max_length=500)
    address_street: str | None = Field(None, max_length=500)
    address_locality: str | None = Field(None, max_length=200)
    address_city: str = Field(..., min_length=2, max_length=100)
    address_pincode: str = Field(..., min_length=5, max_length=10)
    address_state: str = Field(..., min_length=2, max_length=100)
    source: str = Field("aadhaar", pattern="^(aadhaar|manual)$")


@router.post("/address/confirm")
async def confirm_address(
    body: AddressConfirmRequest,
    current_user: BasicUser,
    db: DBSession,
    request: Request,
):
    """
    Confirm address after Aadhaar verification.
    Auto-filled from Aadhaar response or manually entered.
    Saves to user profile and logs DPDP consent event.
    No migration needed — address columns exist from migration 0010.
    """
    from sqlalchemy import select
    from app.modules.identity_auth.models import User

    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    user.address_house = body.address_house
    user.address_street = body.address_street
    user.address_locality = body.address_locality
    user.address_city = body.address_city
    user.address_pincode = body.address_pincode
    user.address_state = body.address_state

    v = await get_or_create_verification(db, current_user.user_id)
    await record_consent(
        db,
        user_id=current_user.user_id,
        verification_id=v.id,
        consent_type="address_usage",
        action="granted",
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()

    logger.info("kyc.address_confirmed", user_id=str(current_user.user_id),
                source=body.source, city=body.address_city)

    return {
        "success": True,
        "message": "Address saved successfully.",
        "address": {
            "house": user.address_house,
            "street": user.address_street,
            "locality": user.address_locality,
            "city": user.address_city,
            "pincode": user.address_pincode,
            "state": user.address_state,
        },
    }
