"""Immutable address snapshots for transaction logistics.

Saved addresses are mutable because buyers and sellers can edit defaults at
any time. A paid order needs its own frozen buyer-delivery and seller-pickup
records so FE/admin task payloads never drift after checkout.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity_auth.models import UserAddress


def _full_address(row: UserAddress) -> str:
    return ", ".join(
        part
        for part in [
            row.flat_house_number,
            row.building_name,
            row.floor,
            row.address_line_1,
            row.locality,
            row.city,
            row.state,
            row.pincode,
        ]
        if part
    )


def snapshot_from_user_address(row: UserAddress, *, role: str) -> dict[str, Any]:
    """Return a stable JSON shape for buyer delivery or seller pickup."""
    return {
        "snapshot_version": 1,
        "source": "user_addresses",
        "role": role,
        "snapshotted_at": datetime.now(timezone.utc).isoformat(),
        "address_id": str(row.id),
        "user_id": str(row.user_id),
        "label": row.label,
        "custom_label": row.custom_label,
        "full_name": row.full_name,
        "phone_number": row.phone_number,
        "lat": float(row.lat),
        "lng": float(row.lng),
        "flat_house_number": row.flat_house_number,
        "building_name": row.building_name,
        "floor": row.floor,
        "landmark": row.landmark,
        "address_line_1": row.address_line_1,
        "locality": row.locality,
        "city": row.city,
        "state": row.state,
        "pincode": row.pincode,
        "full_address": _full_address(row),
        # Legacy aliases for consumers modelled after FEVisit.address_snapshot.
        "house": row.flat_house_number,
        "street": row.address_line_1,
    }


async def snapshot_owned_address(
    db: AsyncSession,
    *,
    address_id: UUID,
    user_id: UUID,
    role: str,
) -> dict[str, Any]:
    row = (await db.execute(
        select(UserAddress).where(
            UserAddress.id == address_id,
            UserAddress.user_id == user_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise ValueError("ADDRESS_NOT_FOUND")
    return snapshot_from_user_address(row, role=role)


async def snapshot_default_address(
    db: AsyncSession,
    *,
    user_id: UUID,
    role: str,
) -> dict[str, Any] | None:
    row = (await db.execute(
        select(UserAddress)
        .where(UserAddress.user_id == user_id, UserAddress.is_default == True)  # noqa: E712
        .order_by(UserAddress.updated_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if row is None:
        row = (await db.execute(
            select(UserAddress)
            .where(UserAddress.user_id == user_id)
            .order_by(UserAddress.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()
    return snapshot_from_user_address(row, role=role) if row else None


def snapshot_summary(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    """Small non-sensitive shape for mobile/admin cards."""
    if not snapshot:
        return None
    return {
        "full_name": snapshot.get("full_name"),
        "phone_number": snapshot.get("phone_number"),
        "full_address": snapshot.get("full_address"),
        "locality": snapshot.get("locality"),
        "city": snapshot.get("city"),
        "state": snapshot.get("state"),
        "pincode": snapshot.get("pincode"),
        "lat": snapshot.get("lat"),
        "lng": snapshot.get("lng"),
    }
