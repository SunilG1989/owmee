"""Geo router — Nominatim + Photon proxy with Redis caching.

All mobile location lookups go through here. Three endpoints:

GET /v1/geo/reverse?lat=&lng=
    Legacy Nominatim reverse geocode. Returns a flat shape retained for
    backward-compatible clients.

GET /v1/geo/search?q=
    Forward search for address autocomplete. Nominatim-backed.

GET /v1/geo/reverse-geocode?lat=&lng=
    Address PRD section 5.1. Photon-backed (better India coverage than
    Nominatim per PRD section 8.1). Returns the structured shape the
    new 3-screen address flow expects: approximate_address +
    address_line_1 + locality + city + state + pincode.
    Cache: 1 hour, rounded to 4 decimals (~11m).

Cache strategy
--------------
All reverse-geocode lookups round (lat, lng) to 4 decimals before hashing
into Redis. Pan-and-pause on the map fires many requests with sub-meter
deltas; without rounding we'd burn cache on every wiggle.

If Photon rate-limits us in pilot: deploy self-hosted Photon and point
PHOTON_URL at it. No code changes needed.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.redis import get_redis  # adjust import path if redis client lives elsewhere
from app.core.settings import settings

router = APIRouter(prefix="/v1/geo", tags=["geo"])
log = logging.getLogger(__name__)

NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
USER_AGENT = "Owmee/1.0 (contact@owmee.in)"
HTTP_TIMEOUT = 8.0

REVERSE_CACHE_TTL = 7 * 24 * 60 * 60  # 7 days (legacy nominatim)
SEARCH_CACHE_TTL = 24 * 60 * 60       # 24 hours (legacy nominatim)
PHOTON_CACHE_TTL = 60 * 60            # 1 hour (PRD section 5.1)


def _pick_display_name(addr: dict[str, Any]) -> str:
    """Pick the most specific human-friendly label from a Nominatim address dict.

    Priority: suburb → neighbourhood → city_district → village → town → city → state.
    """
    for key in ("suburb", "neighbourhood", "city_district", "village", "town", "city", "state"):
        v = addr.get(key)
        if v and not v.lower().startswith("ward "):
            return v
    return addr.get("state") or "Unknown"


def _normalize_reverse(raw: dict[str, Any]) -> dict[str, Any]:
    """Reduce a Nominatim reverse response to the shape mobile expects."""
    addr = raw.get("address", {}) or {}
    return {
        "display_name": _pick_display_name(addr),
        "full_address": raw.get("display_name", ""),
        "neighborhood": addr.get("suburb") or addr.get("neighbourhood"),
        "city": addr.get("city") or addr.get("town") or addr.get("village") or "",
        "state": addr.get("state") or "",
        "pincode": addr.get("postcode"),
        "country": addr.get("country") or "India",
    }


def _normalize_search_item(raw: dict[str, Any]) -> dict[str, Any]:
    addr = raw.get("address", {}) or {}
    return {
        "display_name": _pick_display_name(addr),
        "full_address": raw.get("display_name", ""),
        "lat": float(raw.get("lat", 0)),
        "lng": float(raw.get("lon", 0)),
        "city": addr.get("city") or addr.get("town") or addr.get("village") or "",
        "state": addr.get("state") or "",
    }


@router.get("/reverse")
async def reverse_geocode(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
):
    """Reverse geocode lat/lng to a normalized address."""
    lat4 = round(lat, 4)
    lng4 = round(lng, 4)
    cache_key = f"revgeo:{lat4}:{lng4}"

    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached if isinstance(cached, str) else cached.decode())
    except Exception as e:
        log.warning("Redis cache miss (read) for %s: %s", cache_key, e)

    url = f"{NOMINATIM_BASE}/reverse"
    params = {"format": "json", "lat": lat, "lon": lng, "addressdetails": 1, "zoom": 18}
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en"}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            raw = resp.json()
    except httpx.HTTPError as e:
        log.error("Nominatim reverse failed: %s", e)
        raise HTTPException(status_code=503, detail="Geocoding service unavailable")

    normalized = _normalize_reverse(raw)

    try:
        redis = await get_redis()
        await redis.set(cache_key, json.dumps(normalized), ex=REVERSE_CACHE_TTL)
    except Exception as e:
        log.warning("Redis cache miss (write) for %s: %s", cache_key, e)

    return normalized


@router.get("/search")
async def search_address(
    q: str = Query(..., min_length=3, max_length=120),
):
    """Forward search for addresses, biased to India."""
    q_norm = q.strip().lower()
    cache_key = f"geosearch:{q_norm}"

    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached if isinstance(cached, str) else cached.decode())
    except Exception as e:
        log.warning("Redis cache miss (read) for %s: %s", cache_key, e)

    url = f"{NOMINATIM_BASE}/search"
    params = {
        "format": "json",
        "q": q,
        "countrycodes": "in",
        "limit": 8,
        "addressdetails": 1,
    }
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en"}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            raw_list = resp.json()
    except httpx.HTTPError as e:
        log.error("Nominatim search failed: %s", e)
        raise HTTPException(status_code=503, detail="Geocoding service unavailable")

    payload = {"results": [_normalize_search_item(item) for item in raw_list]}

    try:
        redis = await get_redis()
        await redis.set(cache_key, json.dumps(payload), ex=SEARCH_CACHE_TTL)
    except Exception as e:
        log.warning("Redis cache miss (write) for %s: %s", cache_key, e)

    return payload


# ── Photon reverse geocode (Address PRD section 5.1) ─────────────────────────


# Rough India bounding box. lat 6° to 37°, lng 68° to 98°. We don't enforce
# this hard — pilot users may legitimately save a non-Indian address for a
# relative — but we flag it so the booking flow can warn.
_INDIA_LAT_MIN, _INDIA_LAT_MAX = 6.0, 38.0
_INDIA_LNG_MIN, _INDIA_LNG_MAX = 68.0, 98.0


def _normalize_photon(raw: dict[str, Any]) -> dict[str, Any]:
    """Map Photon's GeoJSON response to the Owmee address shape.

    Indian Photon responses often put the locality in 'district' rather
    than 'suburb'. Fallback chain handles missing fields gracefully —
    user can edit on the AddressDetails screen.
    """
    features = raw.get("features") or []
    if not features:
        return {
            "approximate_address": "",
            "address_line_1": None,
            "locality": None,
            "city": "",
            "state": "",
            "country": "",
            "pincode": None,
        }
    p = (features[0].get("properties") or {})

    address_line_1 = p.get("street") or p.get("name")
    locality = p.get("district") or p.get("suburb")
    city = p.get("city") or p.get("county") or ""
    state = p.get("state") or ""
    country = p.get("country") or ""
    pincode = p.get("postcode")

    parts = [x for x in (address_line_1, locality, city) if x]
    approximate_address = ", ".join(parts)

    return {
        "approximate_address": approximate_address,
        "address_line_1": address_line_1,
        "locality": locality,
        "city": city,
        "state": state,
        "country": country,
        "pincode": pincode,
    }


@router.get("/reverse-geocode")
async def reverse_geocode_photon(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
):
    """Photon-backed reverse geocode used by the new 3-screen address flow.

    Returns the structured shape expected by mobile's AddressDetailsScreen
    (PRD section 5.1). Caches by 4-decimal-rounded lat/lng for 1 hour.
    Returns 503 if Photon is unreachable or returns an error.
    """
    lat4 = round(lat, 4)
    lng4 = round(lng, 4)
    cache_key = f"photon:rev:{lat4}:{lng4}"

    in_service_area = (
        _INDIA_LAT_MIN <= lat <= _INDIA_LAT_MAX
        and _INDIA_LNG_MIN <= lng <= _INDIA_LNG_MAX
    )

    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            payload = json.loads(cached if isinstance(cached, str) else cached.decode())
            payload["in_service_area"] = in_service_area
            return payload
    except Exception as e:
        log.warning("Photon cache read failed for %s: %s", cache_key, e)

    url = f"{settings.photon_url.rstrip('/')}/reverse"
    params = {"lat": lat, "lon": lng, "lang": "en"}
    headers = {"User-Agent": USER_AGENT}

    try:
        async with httpx.AsyncClient(timeout=settings.photon_timeout_seconds) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            raw = resp.json()
    except httpx.HTTPError as e:
        log.error("Photon reverse failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail={
                "error": "REVERSE_GEOCODE_UNAVAILABLE",
                "message": "Reverse geocoding temporarily unavailable",
            },
        )

    normalized = _normalize_photon(raw)

    # Surface the raw provider response in dev for debugging — never in prod.
    if not settings.is_production:
        normalized["raw_provider_response"] = raw

    try:
        redis = await get_redis()
        # Cache the normalized response *without* in_service_area (that's
        # computed per-request from the input lat/lng, not cached).
        cache_value = {k: v for k, v in normalized.items() if k != "raw_provider_response"}
        await redis.set(cache_key, json.dumps(cache_value), ex=PHOTON_CACHE_TTL)
    except Exception as e:
        log.warning("Photon cache write failed for %s: %s", cache_key, e)

    normalized["in_service_area"] = in_service_area
    return normalized
