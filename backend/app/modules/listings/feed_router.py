"""Feed router — blockbuster deals + explore feed.

Sprint 8 Phase 1 — clean rebuild.
Uses raw SQL throughout (Listing/User SQLAlchemy models don't declare the
columns added by migration 0019/0020). Allows guests via OptionalUser.
"""
from __future__ import annotations

import base64
import json
import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.core.dependencies import DBSession, OptionalUser
from app.core.redis import get_redis

router = APIRouter(prefix="/v1/feed", tags=["feed"])
log = logging.getLogger(__name__)

RADIUS_BY_PAGE = {0: 15, 1: 50, 2: 150}
RADIUS_DEFAULT = 500
EARTH_KM = 6371.0


def _haversine_km(lat1, lng1, lat2, lng2):
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def _radius_for_page(page):
    return RADIUS_BY_PAGE.get(page, RADIUS_DEFAULT)


def _seller_short_name(name):
    full = (name or "").strip()
    if not full:
        return "Seller"
    parts = full.split()
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


async def _get_user_coords(db, user_id):
    """Returns (lat, lng, state). Karnataka default for guests."""
    if user_id is None:
        return None, None, "Karnataka"
    row = await db.execute(
        text("SELECT lat, lng, COALESCE(state, address_state) FROM users WHERE id = :uid"),
        {"uid": user_id},
    )
    rec = row.first()
    if not rec:
        return None, None, "Karnataka"
    return rec[0], rec[1], (rec[2] or "Karnataka")


def _serialize_row(r, distance_km):
    is_owmee_verified = bool(
        r.get("seller_kyc_status") == "verified"
        and r.get("seller_kyc_verified_at_listing_time")
    )
    created_at = r.get("created_at")
    return {
        "id": str(r["id"]),
        "title": r.get("title"),
        "description": r.get("description"),
        "price": float(r["price"]) if r.get("price") is not None else 0.0,
        "original_price": float(r["original_price"]) if r.get("original_price") is not None else None,
        "discount_pct": float(r["discount_pct"]) if r.get("discount_pct") is not None else None,
        "image_urls": r.get("image_urls") or [],
        "thumbnail_url": r.get("thumbnail_url"),
        "city": r.get("city"),
        "state": r.get("state"),
        "category_slug": r.get("category_slug"),
        "shipping_eligible": bool(r.get("shipping_eligible")),
        "created_at": created_at.isoformat() if created_at else None,
        "seller_id": str(r["seller_id"]),
        "seller_name": _seller_short_name(r.get("seller_name")),
        "is_owmee_verified": is_owmee_verified,
        "distance_km": round(distance_km, 1) if distance_km is not None else None,
    }


@router.get("/blockbuster-deals")
async def blockbuster_deals(current_user: OptionalUser, db: DBSession):
    user_id = current_user.user_id if current_user else None
    user_lat, user_lng, user_state = await _get_user_coords(db, user_id)
    cache_key = f"blockbuster:{user_state}"

    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached if isinstance(cached, str) else cached.decode())
    except Exception as e:
        log.warning("Redis read miss for %s: %s", cache_key, e)

    sql = text("""
        SELECT
            l.id, l.title, l.description, l.price, l.original_price, l.discount_pct,
            l.image_urls, l.thumbnail_url, l.city, l.state, l.created_at,
            l.seller_id, l.seller_kyc_verified_at_listing_time,
            ST_Y(l.geo_point::geometry) AS listing_lat,
            ST_X(l.geo_point::geometry) AS listing_lng,
            c.slug AS category_slug, c.shipping_eligible,
            u.name AS seller_name, u.kyc_status AS seller_kyc_status
        FROM listings l
        JOIN categories c ON l.category_id = c.id
        JOIN users u ON l.seller_id = u.id
        WHERE l.status = 'active'
          AND l.discount_pct IS NOT NULL
          AND l.discount_pct >= 15
          AND l.state = :state
        ORDER BY l.discount_pct DESC, l.created_at DESC
        LIMIT 12
    """)

    result = await db.execute(sql, {"state": user_state})
    rows = result.mappings().all()

    items = []
    for r in rows:
        d_km = None
        if user_lat is not None and user_lng is not None:
            llat, llng = r.get("listing_lat"), r.get("listing_lng")
            if llat is not None and llng is not None:
                d_km = _haversine_km(user_lat, user_lng, llat, llng)
        items.append(_serialize_row(dict(r), d_km))

    payload = {"items": items, "count": len(items)}

    try:
        redis = await get_redis()
        await redis.set(cache_key, json.dumps(payload), ex=3600)
    except Exception as e:
        log.warning("Redis write miss for %s: %s", cache_key, e)

    return payload


@router.get("/explore")
async def explore_feed(
    current_user: OptionalUser,
    db: DBSession,
    page: int = Query(0, ge=0, le=20),
    cursor: str | None = Query(None),
):
    radius_km = _radius_for_page(page)
    user_id = current_user.user_id if current_user else None
    user_lat, user_lng, user_state = await _get_user_coords(db, user_id)

    cursor_score = None
    cursor_id = None
    if cursor:
        try:
            decoded = base64.urlsafe_b64decode(cursor.encode()).decode()
            score_str, id_str = decoded.split(":", 1)
            cursor_score = float(score_str)
            cursor_id = id_str
        except Exception:
            log.warning("Bad cursor: %s", cursor)

    sql = text("""
        SELECT
            l.id, l.title, l.description, l.price, l.original_price, l.discount_pct,
            l.image_urls, l.thumbnail_url, l.city, l.state, l.created_at,
            l.seller_id, l.seller_kyc_verified_at_listing_time,
            ST_Y(l.geo_point::geometry) AS listing_lat,
            ST_X(l.geo_point::geometry) AS listing_lng,
            c.slug AS category_slug, c.shipping_eligible,
            u.name AS seller_name, u.kyc_status AS seller_kyc_status
        FROM listings l
        JOIN categories c ON l.category_id = c.id
        JOIN users u ON l.seller_id = u.id
        WHERE l.status = 'active'
          AND l.state = :state
        ORDER BY l.created_at DESC
        LIMIT 200
    """)

    result = await db.execute(sql, {"state": user_state})
    rows = result.mappings().all()

    now = datetime.now(timezone.utc)
    scored = []

    for r in rows:
        d_km = None
        llat, llng = r.get("listing_lat"), r.get("listing_lng")
        if user_lat is not None and user_lng is not None and llat is not None and llng is not None:
            d_km = _haversine_km(user_lat, user_lng, llat, llng)

        ships = bool(r.get("shipping_eligible"))
        in_radius = d_km is not None and d_km <= radius_km
        no_user_coords = user_lat is None or user_lng is None
        if not (in_radius or ships or no_user_coords):
            continue

        created = r.get("created_at") or now
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        days_old = max(0.0, (now - created).total_seconds() / 86400.0)
        freshness = 1.0 / (1.0 + days_old)

        proximity = (1.0 / (1.0 + d_km / max(radius_km, 1))) if d_km is not None else 0.5
        deal = max(0.0, float(r.get("discount_pct") or 0) / 100.0)
        trust = 1.0 if r.get("seller_kyc_status") == "verified" else 0.0

        score = 0.30 * freshness + 0.40 * proximity + 0.20 * deal + 0.10 * trust
        scored.append((score, _serialize_row(dict(r), d_km)))

    scored.sort(key=lambda t: (-t[0], t[1]["id"]))

    if cursor_score is not None and cursor_id is not None:
        scored = [t for t in scored if (t[0], t[1]["id"]) < (cursor_score, cursor_id)]

    page_items = scored[:20]
    next_cursor = None
    if len(scored) > 20 and page_items:
        last_score, last_item = page_items[-1]
        next_cursor = base64.urlsafe_b64encode(f"{last_score}:{last_item['id']}".encode()).decode()

    return {
        "items": [item for _, item in page_items],
        "next_cursor": next_cursor,
        "current_radius_km": radius_km,
        "page": page,
    }
