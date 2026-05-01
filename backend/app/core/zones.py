"""Geo-fence — Owmee V1 hyperlocal pilot.

V1 launch zones (per founder direction, 2026-05-01):
  1. Kanakapura Road — Judicial Layout
  2. Bannerghatta Road — Vijay Bank Layout

Both seller's pickup address AND buyer's delivery address must fall
within at least one zone for a transaction to proceed. This is the
hard constraint that makes "no buyer-seller meetup, FE-managed pickup
+ delivery" operationally feasible at launch — single FE pool, single
hub, ~5 km routes max.

Zones use a simple lat/lng + radius model. Switch to polygons later if
the radius approximation excludes / includes the wrong streets.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Zone:
    name: str        # human label
    slug: str        # stable identifier for logs / messaging
    lat: float
    lng: float
    radius_km: float


# Centroids approximate; tighten / replace with polygon when ground-truth
# data from the FE pilot comes in.
LAUNCH_ZONES: tuple[Zone, ...] = (
    Zone(
        name="Kanakapura Road — Judicial Layout",
        slug="judicial-layout",
        lat=12.8732,
        lng=77.5471,
        radius_km=2.0,
    ),
    Zone(
        name="Bannerghatta Road — Vijay Bank Layout",
        slug="vijay-bank-layout",
        lat=12.8841,
        lng=77.5969,
        radius_km=2.0,
    ),
)


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def zone_for(lat: float | None, lng: float | None) -> Zone | None:
    """Return the Zone the coordinate falls inside, or None if out of service."""
    if lat is None or lng is None:
        return None
    for z in LAUNCH_ZONES:
        if _haversine_km(lat, lng, z.lat, z.lng) <= z.radius_km:
            return z
    return None


def is_in_service_area(lat: float | None, lng: float | None) -> bool:
    return zone_for(lat, lng) is not None


def out_of_service_message() -> dict:
    """Standard shape for the "we don't deliver here yet" error response.
    Kept here so all callers send identical copy."""
    return {
        "error": "OUT_OF_SERVICE_AREA",
        "message": (
            "Owmee currently serves Judicial Layout (Kanakapura Road) and "
            "Vijay Bank Layout (Bannerghatta Road). We're expanding soon — "
            "leave your email and we'll let you know when we cover your area."
        ),
        "zones": [
            {"slug": z.slug, "name": z.name, "lat": z.lat, "lng": z.lng, "radius_km": z.radius_km}
            for z in LAUNCH_ZONES
        ],
    }
