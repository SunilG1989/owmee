"""Redis-backed access-token revocation.

Access tokens are short-lived (15 min) and self-validating, so a bare JWT has
no server-side kill switch — logout, suspension, or deactivation would not take
effect until the token expired on its own. This module adds the kill switch:

- ``revoke_session(session_id)`` — invalidate a single access token (logout).
- ``revoke_all_user_sessions(user_id)`` — invalidate every access token issued
  to a user up to *now* (suspension / deactivation / "log out everywhere").
- ``is_revoked(...)`` — consulted by ``require_auth`` on every authenticated
  request. O(1) Redis lookups; markers auto-expire after the access-token
  lifetime so the store stays bounded (a marker only needs to outlive the
  longest-lived token it must kill).

Fail-open on a Redis outage (consistent with ``rate_limit``): a Redis blip
should not lock out the entire user base, and the short token TTL bounds the
exposure window to at most one access-token lifetime.
"""
from __future__ import annotations

import time

import structlog

from app.core.redis import get_redis
from app.core.settings import settings

logger = structlog.get_logger()


def _session_key(session_id: str) -> str:
    return f"auth:revoked_session:{session_id}"


def _user_epoch_key(user_id: str) -> str:
    return f"auth:revoked_after:{user_id}"


def _access_ttl_seconds() -> int:
    # Markers only need to outlive the longest-lived access token they kill.
    return max(60, int(settings.jwt_access_token_expire_minutes) * 60)


async def revoke_session(session_id: str | None) -> None:
    """Kill a single access token by its session id (logout)."""
    if not session_id:
        return
    try:
        redis = await get_redis()
        await redis.setex(_session_key(str(session_id)), _access_ttl_seconds(), "1")
    except Exception as exc:  # pragma: no cover - redis blip
        logger.warning("revocation.write_failed", scope="session", error=str(exc))


async def revoke_all_user_sessions(user_id: str | None) -> None:
    """Invalidate every access token issued to this user up to now.

    Tokens minted *after* this call carry a later ``iat`` and remain valid, so a
    user who is later un-suspended and logs in again is unaffected.
    """
    if not user_id:
        return
    try:
        redis = await get_redis()
        await redis.setex(
            _user_epoch_key(str(user_id)),
            _access_ttl_seconds(),
            str(int(time.time())),
        )
    except Exception as exc:  # pragma: no cover - redis blip
        logger.warning("revocation.write_failed", scope="user", error=str(exc))


async def is_revoked(
    session_id: str | None,
    user_id: str,
    issued_at: int | None,
) -> bool:
    """True if this access token has been revoked (session-level or user-level)."""
    try:
        redis = await get_redis()
        if session_id and await redis.get(_session_key(str(session_id))):
            return True
        epoch = await redis.get(_user_epoch_key(str(user_id)))
        if epoch and issued_at is not None and int(issued_at) < int(epoch):
            return True
        return False
    except Exception as exc:  # pragma: no cover - redis blip
        # Fail open: the short access-token TTL bounds the exposure window.
        logger.warning("revocation.check_failed", error=str(exc))
        return False
