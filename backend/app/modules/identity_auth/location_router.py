"""User location endpoint.

POST /v1/users/me/location

Called by the new Swiggy-style location screen after the user picks an exact
location. Stores lat/lng + display name on the user, writes audit row.

Schema notes (specific to this codebase):
- CurrentUser exposes `.user_id` (UUID), not `.id`.
- DBSession (from app.core.dependencies) yields an AsyncSession that
  auto-commits on yield exit. We must NOT call db.commit() ourselves —
  doing so would result in a double commit on the wrapping context manager.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.dependencies import BasicUser, DBSession

router = APIRouter(prefix="/v1/users", tags=["user-location"])


class LocationPayload(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    display_name: str = Field(..., min_length=1, max_length=120)
    full_address: str = Field("", max_length=400)
    city: str = Field("", max_length=80)
    state: str = Field("", max_length=80)
    pincode: Optional[str] = Field(None, max_length=10)
    source: str = Field("gps", max_length=20)  # gps | search | manual


@router.post("/me/location")
async def set_my_location(
    payload: LocationPayload,
    current_user: BasicUser,
    db: DBSession,
):
    """Update the current user's location and write an audit row."""
    # Update user — note: we write to BOTH the new (city, state, pincode) and
    # the legacy (address_city, address_state, address_pincode) columns to
    # keep both systems in sync until the codebase is consolidated.
    user_stmt = text("""
        UPDATE users
        SET lat = :lat,
            lng = :lng,
            location_display_name = CAST(:display_name AS VARCHAR(120)),
            city = CAST(:city AS VARCHAR(80)),
            state = CAST(:state AS VARCHAR(80)),
            pincode = CAST(:pincode AS VARCHAR(10)),
            address_city = COALESCE(NULLIF(CAST(:city AS VARCHAR(100)), ''), address_city),
            address_state = COALESCE(NULLIF(CAST(:state AS VARCHAR(100)), ''), address_state),
            address_pincode = COALESCE(NULLIF(CAST(:pincode AS VARCHAR(10)), ''), address_pincode),
            updated_at = NOW()
        WHERE id = :uid
    """)
    await db.execute(user_stmt, {
        "lat": payload.lat,
        "lng": payload.lng,
        "display_name": payload.display_name,
        "city": payload.city,
        "state": payload.state,
        "pincode": payload.pincode,
        "uid": current_user.user_id,
    })

    # Audit row
    history_stmt = text("""
        INSERT INTO user_location_history
            (user_id, lat, lng, display_name, full_address, city, state, pincode, source)
        VALUES
            (:uid, :lat, :lng, :display_name, :full_address, :city, :state, :pincode, :source)
    """)
    await db.execute(history_stmt, {
        "uid": current_user.user_id,
        "lat": payload.lat,
        "lng": payload.lng,
        "display_name": payload.display_name,
        "full_address": payload.full_address,
        "city": payload.city,
        "state": payload.state,
        "pincode": payload.pincode,
        "source": payload.source,
    })

    # Note: get_db() auto-commits on yield exit. Don't commit here.

    return {
        "ok": True,
        "display_name": payload.display_name,
    }
