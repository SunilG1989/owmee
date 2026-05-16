"""Provider-neutral geocoding adapters.

The API router owns request validation and caching. This module owns the
third-party geocoder contract so switching Photon to a hosted/self-hosted
alternative stays localized.
"""
from __future__ import annotations

from typing import Any, Protocol

import httpx

from app.core.settings import settings


class GeocodingProviderError(Exception):
    """Raised when the configured geocoding provider cannot return a result."""


class ReverseGeocoder(Protocol):
    async def reverse(self, lat: float, lng: float) -> dict[str, Any]: ...


class _PhotonReverseGeocoder:
    async def reverse(self, lat: float, lng: float) -> dict[str, Any]:
        url = f"{settings.photon_url.rstrip('/')}/reverse"
        params = {"lat": lat, "lon": lng, "lang": "en"}
        headers = {"User-Agent": "Owmee/1.0 (contact@owmee.in)"}
        try:
            async with httpx.AsyncClient(timeout=settings.photon_timeout_seconds) as client:
                resp = await client.get(url, params=params, headers=headers)
                resp.raise_for_status()
                raw = resp.json()
        except httpx.HTTPError as exc:
            raise GeocodingProviderError(str(exc)) from exc

        normalized = _normalize_photon(raw)
        if not settings.is_production:
            normalized["raw_provider_response"] = raw
        return normalized


def _normalize_photon(raw: dict[str, Any]) -> dict[str, Any]:
    """Map Photon's GeoJSON response to the Owmee address shape."""
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
    p = features[0].get("properties") or {}

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


def get_reverse_geocoder() -> ReverseGeocoder:
    provider = (settings.geocoding_provider or "photon").strip().lower()
    if provider in {"", "photon"}:
        return _PhotonReverseGeocoder()
    raise RuntimeError(f"Unsupported GEOCODING_PROVIDER={settings.geocoding_provider!r}")


async def reverse_geocode(lat: float, lng: float) -> dict[str, Any]:
    return await get_reverse_geocoder().reverse(lat, lng)
