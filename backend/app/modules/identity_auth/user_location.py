"""Shared resolver for "where is this user?".

Why
---
The Address PRD (migration 0033) introduced `user_addresses` as the
canonical place to store a user's location. The legacy `users.lat`,
`users.lng`, `users.address_state`, `users.address_city` columns are
still populated for old users but stay NULL for users who created
their address only via the new 3-screen flow.

Multiple call sites need (lat, lng, city, state) for a user:
  - feed_router._get_user_coords  → state for the home feed filter
  - ai_assistant.router            → seller geo for AI listing creation
  - listings.create_listing        → service-area gating
  - kids/community feed scoring    → distance ranking

Without a shared resolver, each site forgets to check `user_addresses`
first and silently breaks for new users (their feed is empty, their
listing is rejected as out-of-zone, etc.). This module is the single
source of truth.

Resolution order:
  1. The user's default `user_addresses` row (or most recent if none
     marked default). Lat/lng/city/state all come from there.
  2. Legacy `users.lat / lng / address_city / address_state` columns.
  3. Bengaluru / Karnataka default for guest users + brand-new
     authed users with no address yet.
"""
from __future__ import annotations

from typing import Optional, Tuple
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


_DEFAULT_LAT = 12.9716
_DEFAULT_LNG = 77.5946
_DEFAULT_STATE = "Karnataka"
_DEFAULT_CITY = "Bengaluru"


async def get_user_location(
    db: AsyncSession,
    user_id: Optional[UUID],
) -> Tuple[Optional[float], Optional[float], str, str]:
    """Return (lat, lng, city, state) for the user, falling back to
    Bengaluru/Karnataka defaults when nothing is set.

    Lat/lng can be None if the user has no address row AND no legacy
    coords; city/state always have a non-empty value (default fallback).
    """
    if user_id is None:
        return _DEFAULT_LAT, _DEFAULT_LNG, _DEFAULT_CITY, _DEFAULT_STATE

    # Step 1 — saved-address row (Address PRD source of truth).
    addr_row = await db.execute(
        text(
            """
            SELECT lat, lng, city, state
            FROM user_addresses
            WHERE user_id = :uid
            ORDER BY is_default DESC, created_at DESC
            LIMIT 1
            """
        ),
        {"uid": user_id},
    )
    addr = addr_row.first()
    if addr is not None and addr[3]:  # has state value
        return (
            float(addr[0]) if addr[0] is not None else None,
            float(addr[1]) if addr[1] is not None else None,
            addr[2] or _DEFAULT_CITY,
            addr[3],
        )

    # Step 2 — legacy user-row columns.
    row = await db.execute(
        text(
            """
            SELECT lat, lng,
                   COALESCE(NULLIF(TRIM(address_city), ''), :default_city) AS city,
                   COALESCE(NULLIF(TRIM(state), ''), NULLIF(TRIM(address_state), ''), :default_state) AS state
            FROM users WHERE id = :uid
            """
        ),
        {"uid": user_id, "default_city": _DEFAULT_CITY, "default_state": _DEFAULT_STATE},
    )
    rec = row.first()
    if rec is None:
        return _DEFAULT_LAT, _DEFAULT_LNG, _DEFAULT_CITY, _DEFAULT_STATE
    return (
        float(rec[0]) if rec[0] is not None else None,
        float(rec[1]) if rec[1] is not None else None,
        rec[2] or _DEFAULT_CITY,
        rec[3] or _DEFAULT_STATE,
    )
