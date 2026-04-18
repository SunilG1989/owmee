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
        auth_state: str = "otp_verified",
        buyer_eligible: bool = False,
        seller_tier: str = "not_eligible",
    ):
        self.user_id = UUID(user_id)
        self.session_id = session_id
        self.phone_verified = phone_verified
        self.tier = tier
        self.kyc_status = kyc_status
        # ── Sprint 4 / v3: tri-state ──────────────────────────────────────────
        self.auth_state = auth_state
        self.buyer_eligible = buyer_eligible
        self.seller_tier = seller_tier


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
            # ── Sprint 4 / v3 ────────────────────────────────────────────────
            # Older tokens won't have these claims. For backward compatibility:
            #   - auth_state defaults to 'otp_verified' (since any token means
            #     they completed OTP at some point)
            #   - buyer_eligible inferred from tier == 'verified'
            #   - seller_tier inferred from tier == 'verified' -> 'full' else 'not_eligible'
            # Once users refresh (or the next time /me runs) the new tokens will
            # carry real values.
            auth_state=payload.get("auth_state", "otp_verified"),
            buyer_eligible=payload.get(
                "buyer_eligible",
                payload.get("tier") == "verified",
            ),
            seller_tier=payload.get(
                "seller_tier",
                "full" if payload.get("tier") == "verified" else "not_eligible",
            ),
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
    if user.auth_state == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "ACCOUNT_SUSPENDED",
                "message": "This account is suspended. Please contact support.",
            },
        )
    return user


async def require_basic(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Mobile OTP verified — any non-suspended user."""
    return await require_auth(authorization)


async def require_verified(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """
    Sprint 3 legacy gate — preserved for backward compatibility.
    New code should prefer require_buyer_eligible or require_seller_tier_any.

    A Sprint 3 `tier == 'verified'` user maps to buyer_eligible=True AND
    seller_tier='full' after the 0013 migration, so this dep is equivalent to
    `buyer_eligible AND seller_tier IN (lite, full)` in effect.
    """
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


# ── Sprint 4 / v3: tri-state eligibility gates ────────────────────────────────

async def require_buyer_eligible(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Gate for buy / offer / reserve / pay / dispute actions."""
    user = await require_auth(authorization)
    if not user.buyer_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "BUYER_VERIFICATION_REQUIRED",
                "message": "Complete buyer verification to continue.",
                "path": "buyer",
                "next_step": _next_kyc_step(user.kyc_status),
            },
        )
    return user


async def require_seller_tier_any(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """
    Gate for publish listing / accept offer / receive payout.
    Accepts Lite or Full tier.
    """
    user = await require_auth(authorization)
    if user.seller_tier not in ("lite", "full"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "SELLER_VERIFICATION_REQUIRED",
                "message": "Complete Aadhaar verification to start selling.",
                "path": "seller",
                "next_step": "aadhaar_otp",
            },
        )
    return user


async def require_seller_tier_full(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Gate for actions that require Full KYC (payouts past TDS threshold)."""
    user = await require_auth(authorization)
    if user.seller_tier != "full":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "FULL_KYC_REQUIRED",
                "message": "Complete PAN and liveness verification to continue.",
                "path": "seller",
                "next_step": "pan",
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
BuyerUser = Annotated[CurrentUser, Depends(require_buyer_eligible)]
SellerUser = Annotated[CurrentUser, Depends(require_seller_tier_any)]
SellerFullUser = Annotated[CurrentUser, Depends(require_seller_tier_full)]
DBSession = Annotated[AsyncSession, Depends(get_db)]
