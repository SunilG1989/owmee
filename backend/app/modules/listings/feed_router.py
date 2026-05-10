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
from app.core.storage import generate_presigned_download_url


def _img_url(key: str | None) -> str | None:
    """Turn an R2 object key into a phone-reachable URL.

    Defensive: if the value already looks like a URL (legacy AI-flow
    listings where _store_photo accidentally saved a presigned URL into
    image_urls), pass it through unchanged rather than re-presigning the
    URL as if it were a key — that produced double-prefixed URLs that
    couldn't be loaded. Same logic in app.modules.listings.router._img_url.
    """
    if not key:
        return None
    if key.startswith(("http://", "https://", "r2://")):
        # Legacy data: full URL or sentinel. r2:// strings won't load
        # but at least the row doesn't blow up the response.
        return key if not key.startswith("r2://") else None
    try:
        return generate_presigned_download_url(key, expires_in=60 * 60 * 6)
    except Exception:
        return None

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
    """Returns (lat, lng, state). Bengaluru/Karnataka default for guests.

    Thin shim over the shared resolver in identity_auth.user_location.
    Without that resolver, every authed user who created their address
    only via the new 3-screen flow saw an empty home feed, because the
    legacy users.address_state column is NULL and the feed filters
    listings by state.
    """
    from app.modules.identity_auth.user_location import get_user_location
    lat, lng, _city, state = await get_user_location(db, user_id)
    return lat, lng, state


def _serialize_row(r, distance_km):
    reviewed_by = (r.get("reviewed_by") or "none").lower()
    is_owmee_verified = bool(
        r.get("seller_kyc_status") == "verified"
        or r.get("seller_kyc_verified_at_listing_time")
        or reviewed_by in {"fe", "ops", "fe_and_ops"}
    )
    accessories = (r.get("accessories") or "").lower()
    warranty_info = (r.get("warranty_info") or "").strip()
    warranty_lower = warranty_info.lower()
    warranty_active = bool(
        warranty_info
        and not any(token in warranty_lower for token in ("no warranty", "none", "expired"))
    )
    created_at = r.get("created_at")
    seller_created_at = r.get("seller_created_at")
    return {
        "id": str(r["id"]),
        "title": r.get("title"),
        "description": r.get("description"),
        "price": float(r["price"]) if r.get("price") is not None else 0.0,
        "condition": r.get("condition"),
        "original_price": float(r["original_price"]) if r.get("original_price") is not None else None,
        "discount_pct": float(r["discount_pct"]) if r.get("discount_pct") is not None else None,
        # image_urls in DB is a list of object keys, not absolute URLs —
        # mobile needs presigned URLs to actually fetch them.
        "image_urls": [u for u in (_img_url(k) for k in (r.get("image_urls") or [])) if u],
        "thumbnail_url": _img_url(r.get("thumbnail_url")),
        "city": r.get("city"),
        "state": r.get("state"),
        "category_slug": r.get("category_slug"),
        "shipping_eligible": bool(r.get("shipping_eligible")),
        "created_at": created_at.isoformat() if created_at else None,
        "seller_id": str(r["seller_id"]),
        "seller_name": _seller_short_name(r.get("seller_name")),
        "seller_member_since": seller_created_at.isoformat() if seller_created_at else None,
        "seller_completed_deals": int(r.get("seller_completed_deals") or 0),
        "is_owmee_verified": is_owmee_verified,
        "bill_available": bool(r.get("has_bill")) or "bill" in accessories or "invoice" in accessories,
        "box_available": bool(r.get("has_box")) or "box" in accessories,
        "warranty_active": warranty_active,
        "is_negotiable": bool(r.get("is_negotiable")),
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
            l.condition, l.image_urls, l.thumbnail_url, l.city, l.state, l.created_at,
            l.seller_id, l.seller_kyc_verified_at_listing_time,
            l.reviewed_by, l.is_negotiable, l.accessories, l.warranty_info,
            l.has_bill, l.has_box,
            ST_Y(l.geo_point::geometry) AS listing_lat,
            ST_X(l.geo_point::geometry) AS listing_lng,
            c.slug AS category_slug, c.shipping_eligible,
            u.name AS seller_name, u.kyc_status AS seller_kyc_status,
            u.created_at AS seller_created_at,
            COALESCE(sd.seller_completed_deals, 0) AS seller_completed_deals
        FROM listings l
        JOIN categories c ON l.category_id = c.id
        JOIN users u ON l.seller_id = u.id
        LEFT JOIN (
            SELECT seller_id, COUNT(*)::int AS seller_completed_deals
            FROM transactions
            WHERE status IN ('completed', 'auto_completed')
            GROUP BY seller_id
        ) sd ON sd.seller_id = l.seller_id
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
            l.condition, l.image_urls, l.thumbnail_url, l.city, l.state, l.created_at,
            l.seller_id, l.seller_kyc_verified_at_listing_time,
            l.reviewed_by, l.is_negotiable, l.accessories, l.warranty_info,
            l.has_bill, l.has_box,
            ST_Y(l.geo_point::geometry) AS listing_lat,
            ST_X(l.geo_point::geometry) AS listing_lng,
            c.slug AS category_slug, c.shipping_eligible,
            u.name AS seller_name, u.kyc_status AS seller_kyc_status,
            u.created_at AS seller_created_at,
            COALESCE(sd.seller_completed_deals, 0) AS seller_completed_deals
        FROM listings l
        JOIN categories c ON l.category_id = c.id
        JOIN users u ON l.seller_id = u.id
        LEFT JOIN (
            SELECT seller_id, COUNT(*)::int AS seller_completed_deals
            FROM transactions
            WHERE status IN ('completed', 'auto_completed')
            GROUP BY seller_id
        ) sd ON sd.seller_id = l.seller_id
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
        reviewed_by = (r.get("reviewed_by") or "none").lower()
        trust = 1.0 if (
            r.get("seller_kyc_status") == "verified"
            or r.get("seller_kyc_verified_at_listing_time")
            or reviewed_by in {"fe", "ops", "fe_and_ops"}
        ) else 0.0

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
