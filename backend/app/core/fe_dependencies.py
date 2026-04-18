"""
FE-role dependency — Sprint 4 / Pass 2.

Gated by JWT claim `role == 'fe'`. The claim is set at token-issue time by
reading `field_executives.active` for the user. We keep this in a separate
module to avoid rewriting `app/core/dependencies.py` as a drop-in replacement.
"""
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from app.core.dependencies import CurrentUser, _extract_user


async def require_fe_role(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    user = await _extract_user(authorization)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "AUTHENTICATION_REQUIRED",
                "message": "Sign in with your FE account to continue.",
            },
        )
    if user.auth_state == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "ACCOUNT_SUSPENDED",
                "message": "This account is suspended. Please contact support.",
            },
        )
    if getattr(user, "role", None) != "fe":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "FE_ROLE_REQUIRED",
                "message": "This endpoint is only for Owmee Field Executives.",
            },
        )
    return user


FEUser = Annotated[CurrentUser, Depends(require_fe_role)]
