from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from jose import JWTError, jwt

from app.core.settings import settings


def _load_key(path: str) -> str:
    return Path(path).read_text()


def _private_key() -> str:
    return _load_key(settings.jwt_private_key_path)


def _public_key() -> str:
    return _load_key(settings.jwt_public_key_path)


def create_access_token(
    user_id: str,
    session_id: str,
    phone_verified: bool,
    tier: str,
    kyc_status: str,
    auth_state: str | None = None,
    buyer_eligible: bool | None = None,
    seller_tier: str | None = None,
    role: str | None = None,
) -> str:
    """
    Create an access token.

    Sprint 4 / v3: adds three new claims (auth_state, buyer_eligible,
    seller_tier). Pass 2: adds `role` claim ('user' | 'fe'). The existing
    `tier` and `kyc_status` claims are preserved for backward compatibility;
    callers that haven't been updated yet will still work — the new claims
    default to values inferred from Sprint 3 state.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)

    # Defaults for backward-compat callers
    if auth_state is None:
        auth_state = "otp_verified" if phone_verified else "guest"
    if buyer_eligible is None:
        buyer_eligible = tier == "verified"
    if seller_tier is None:
        seller_tier = "full" if tier == "verified" else "not_eligible"
    if role is None:
        role = "user"

    payload = {
        "sub": user_id,
        "session_id": session_id,
        "phone_verified": phone_verified,
        "tier": tier,
        "kyc_status": kyc_status,
        # ── Sprint 4 / v3 claims ──────────────────────────────────────────
        "auth_state": auth_state,
        "buyer_eligible": buyer_eligible,
        "seller_tier": seller_tier,
        # ── Sprint 4 / Pass 2 claim ───────────────────────────────────────
        "role": role,
        # ──────────────────────────────────────────────────────────────────
        "iat": now,
        "exp": expire,
        "jti": str(uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, _private_key(), algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, session_id: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.jwt_refresh_token_expire_days)
    payload = {
        "sub": user_id,
        "session_id": session_id,
        "iat": now,
        "exp": expire,
        "jti": str(uuid4()),
        "type": "refresh",
    }
    return jwt.encode(payload, _private_key(), algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            _public_key(),
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as e:
        raise ValueError(f"Invalid token: {e}") from e
