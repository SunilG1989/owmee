"""Redis-backed token-bucket rate limiter.

Designed for FastAPI dependencies — drop into a route's `dependencies=`
list and you get 429 on overflow without touching the route body.

Why token bucket vs leaky bucket vs sliding window
--------------------------------------------------
For the abuse vectors we actually care about (OTP-bombing, scripted
listing creation, offer flooding) bursts matter as much as steady
rate. Token bucket lets a legit user retry a few times in quick
succession after a network hiccup without being penalised, while
still capping sustained abuse. The Redis side is a single INCR + a
ttl-bound key per (key, window), no Lua needed.

Failure mode: if Redis is down we *fail open* (allow the request). The
alternative — failing closed — would let a Redis outage take down OTP
delivery for the whole user base, which is a worse failure than letting
abuse through for the few minutes it takes to recover.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Awaitable, Callable

import structlog
from fastapi import HTTPException, Request, status

from app.core.dependencies import BasicUser
from app.core.redis import get_redis

logger = structlog.get_logger()


@dataclass(frozen=True)
class RateLimit:
    max_requests: int  # bucket size
    window_seconds: int  # over how long


def _bucket_key(prefix: str, ident: str, window_seconds: int) -> str:
    """Window-pinned key. By using time-bucketed keys we get auto-expiry
    via TTL without needing a sliding-window data structure."""
    bucket = int(time.time()) // window_seconds
    return f"rl:{prefix}:{ident}:{bucket}"


async def _check_or_raise(prefix: str, ident: str, limit: RateLimit) -> None:
    if not ident:
        # No id to rate-limit on (e.g. unauthenticated request without
        # phone number) — let it through; route's own auth gate covers it.
        return
    try:
        redis = await get_redis()
        key = _bucket_key(prefix, ident, limit.window_seconds)
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, limit.window_seconds)
        if n > limit.max_requests:
            logger.warning(
                "ratelimit.exceeded",
                prefix=prefix, ident=ident,
                count=n, limit=limit.max_requests, window=limit.window_seconds,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "RATE_LIMITED",
                    "message": f"Too many requests. Try again in {limit.window_seconds}s.",
                },
            )
    except HTTPException:
        raise
    except Exception as e:
        # Redis blip / config issue / etc — fail open. Better to allow a
        # few abusive requests than to take down the whole funnel.
        logger.warning("ratelimit.redis_unavailable", error=str(e), prefix=prefix)


def limit_by_phone(prefix: str, limit: RateLimit) -> Callable[[Request], Awaitable[None]]:
    """Rate-limit by phone number from the request body. Used for
    pre-auth endpoints (OTP send) where there's no current_user yet.
    Reads the phone field non-destructively — FastAPI's Pydantic body
    parser will read it again."""
    async def _dep(request: Request) -> None:
        try:
            body = await request.json()
        except Exception:
            return  # malformed body — let route handler reject it
        phone = (body.get("phone_number") or body.get("phone") or "").strip()
        await _check_or_raise(prefix, phone, limit)
    return _dep


def limit_by_user(prefix: str, limit: RateLimit) -> Callable[..., Awaitable[None]]:
    """Rate-limit by authenticated user id. Pull current_user via the
    standard dependency chain so this composes cleanly with other route
    dependencies."""
    async def _dep(current_user: BasicUser) -> None:
        await _check_or_raise(prefix, str(current_user.user_id), limit)
    return _dep


def limit_by_ip(prefix: str, limit: RateLimit) -> Callable[[Request], Awaitable[None]]:
    """Rate-limit by IP. Use as a coarse backstop on endpoints where the
    abuser doesn't have a user account yet."""
    async def _dep(request: Request) -> None:
        ip = (request.client.host if request.client else "") or ""
        await _check_or_raise(prefix, ip, limit)
    return _dep


# ── Common policies ──────────────────────────────────────────────────────────

# OTP send: 3 per hour per phone number — matches settings.otp_rate_limit_per_hour
# spec but enforced live at the door instead of inside the OTP service so abuse
# doesn't reach our SMS-partner billing.
OTP_PER_PHONE = RateLimit(max_requests=3, window_seconds=3600)
OTP_PER_IP = RateLimit(max_requests=20, window_seconds=3600)

# Listing create: 30 per hour per user. Real sellers list <5/day; bots that
# script-create flood the feed.
LISTING_CREATE_PER_USER = RateLimit(max_requests=30, window_seconds=3600)

# Offer create: 60 per hour per user. Buyers might browse aggressively but
# >1 offer per minute sustained is bot-like.
OFFER_CREATE_PER_USER = RateLimit(max_requests=60, window_seconds=3600)
