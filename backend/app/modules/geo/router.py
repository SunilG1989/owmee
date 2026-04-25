"""Geo router — Nominatim proxy with Redis caching.

All mobile location lookups go through here. Two endpoints:

GET /v1/geo/reverse?lat=&lng=
    Reverse geocode a coordinate to a human-readable address.
    Cache: 7 days, keyed by (lat4, lng4) where lat4/lng4 are rounded to 4 decimals
    (~11m precision — close enough that we don't burn cache on micro-pans).

GET /v1/geo/search?q=
    Forward search for address autocomplete.
    Cache: 24 hours, keyed by query string.
    Biased to India (countrycodes=in).

Nominatim policy: requires a real User-Agent. We set Owmee/1.0. If we exceed
their free-tier rate limits, swap the provider behind this adapter without
touching mobile clients.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.core.redis import get_redis  # adjust import path if redis client lives elsewhere

router = APIRouter(prefix="/v1/geo", tags=["geo"])
log = logging.getLogger(__name__)

NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
USER_AGENT = "Owmee/1.0 (contact@owmee.in)"
HTTP_TIMEOUT = 8.0

REVERSE_CACHE_TTL = 7 * 24 * 60 * 60  # 7 days
SEARCH_CACHE_TTL = 24 * 60 * 60       # 24 hours


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
