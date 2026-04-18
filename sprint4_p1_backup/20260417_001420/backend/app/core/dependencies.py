from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jwt import decode_token
from app.db.session import get_db


class CurrentUser:
    def __init__(
        self,
        user_id: str,
        session_id: str,
        phone_verified: bool,
        tier: str,
        kyc_status: str,
    ):
        self.user_id = UUID(user_id)
        self.session_id = session_id
        self.phone_verified = phone_verified
        self.tier = tier
        self.kyc_status = kyc_status


async def _extract_user(authorization: str | None) -> CurrentUser | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return CurrentUser(
            user_id=payload["sub"],
            session_id=payload["session_id"],
            phone_verified=payload.get("phone_verified", False),
            tier=payload.get("tier", "basic"),
            kyc_status=payload.get("kyc_status", "not_started"),
        )
    except (ValueError, KeyError):
        return None


async def get_optional_user(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser | None:
    """Public endpoints — user optional."""
    return await _extract_user(authorization)


async def require_auth(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Any logged-in user (basic or verified)."""
    user = await _extract_user(authorization)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "AUTHENTICATION_REQUIRED", "message": "Sign in with your mobile number to continue."},
        )
    return user


async def require_basic(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Mobile OTP verified — tier = basic or verified."""
    return await require_auth(authorization)


async def require_verified(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Full KYC verified — tier = verified only."""
    user = await require_auth(authorization)
    if user.tier != "verified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "KYC_REQUIRED",
                "message": "Identity verification required to buy or sell on Owmee.",
                "kyc_status": user.kyc_status,
                "next_step": _next_kyc_step(user.kyc_status),
            },
        )
    return user


def _next_kyc_step(kyc_status: str) -> str:
    mapping = {
        "not_started": "aadhaar_otp",
        "in_progress": "aadhaar_otp",
        "pending_review": "manual_review",
        "rejected": "aadhaar_otp",
        "re_verification_required": "aadhaar_otp",
    }
    return mapping.get(kyc_status, "aadhaar_otp")


# Convenience type aliases
OptionalUser = Annotated[CurrentUser | None, Depends(get_optional_user)]
AuthUser = Annotated[CurrentUser, Depends(require_auth)]
BasicUser = Annotated[CurrentUser, Depends(require_basic)]
VerifiedUser = Annotated[CurrentUser, Depends(require_verified)]
DBSession = Annotated[AsyncSession, Depends(get_db)]
