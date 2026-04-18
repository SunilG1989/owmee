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
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {
        "sub": user_id,
        "session_id": session_id,
        "phone_verified": phone_verified,
        "tier": tier,
        "kyc_status": kyc_status,
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
