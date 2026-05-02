"""Geo-fence — Owmee V1 city-wide pilot.

History
-------
The original pilot was hyperlocal (two ~2 km micro-zones around
Judicial Layout and Vijay Bank Layout). 2026-05-02: founder relaxed
the constraint to all of Bengaluru — operations team confident routes
remain manageable at city scale with the FE pool we have.

Both seller's pickup address AND buyer's delivery address must still
fall within at least one launch zone for a transaction to proceed.

Zones use a simple lat/lng + radius model — adequate at city scale.
Switch to polygons later if a finer-grained boundary is needed (e.g.
to exclude airport / military areas).
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


# 25 km from MG Road covers the Bengaluru metro area — Whitefield in the
# east, Yelahanka in the north, Kanakapura Road / Bannerghatta in the
# south, Kengeri / Mysore Road in the west. Tighten or split if the FE
# routing economics break at this scale.
LAUNCH_ZONES: tuple[Zone, ...] = (
    Zone(
        name="Bengaluru",
        slug="bengaluru",
        lat=12.9716,
        lng=77.5946,
        radius_km=25.0,
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
            "Owmee currently serves Bengaluru. We're expanding soon — "
            "leave your email and we'll let you know when we cover your city."
        ),
        "zones": [
            {"slug": z.slug, "name": z.name, "lat": z.lat, "lng": z.lng, "radius_km": z.radius_km}
            for z in LAUNCH_ZONES
        ],
    }
