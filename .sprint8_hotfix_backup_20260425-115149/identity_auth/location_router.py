"""User location endpoint.

POST /v1/users/me/location

Called by the new Swiggy-style location screen after user picks an exact
location (via GPS or map pan). Stores lat/lng and human-readable display
fields on the user, and writes an audit row to user_location_history.

This is added as a separate router rather than inlined into the existing
identity_auth/router.py to keep the install simple.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.core.dependencies import DBSession, BasicUser

from app.modules.identity_auth.models import User

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
    """Update the current user's location."""
    # Update user row
    user_stmt = text("""
        UPDATE users
        SET lat = :lat,
            lng = :lng,
            location_display_name = :display_name,
            address_full = :full_address,
            city = :city,
            state = :state,
            pincode = :pincode,
            updated_at = NOW()
        WHERE id = :uid
    """)
    await db.execute(user_stmt, {
        "lat": payload.lat,
        "lng": payload.lng,
        "display_name": payload.display_name,
        "full_address": payload.full_address,
        "city": payload.city,
        "state": payload.state,
        "pincode": payload.pincode,
        "uid": current_user.user_id,
    })

    # Append history row
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

    await db.commit()

    return {
        "ok": True,
        "display_name": payload.display_name,
    }
