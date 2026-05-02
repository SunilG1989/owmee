"""Saved addresses for the logged-in user.

CRUD endpoints under /v1/users/me/addresses. Owner-only — every endpoint
filters by current_user.user_id; an attempt to fetch / mutate someone
else's address returns 404.

Default-promotion atomicity
---------------------------
The DB has a partial-unique index `ux_user_addresses_default_per_user`
that allows at most one is_default=true row per user. The router clears
the flag on all other rows for that user *before* flipping the new
row's flag, all inside a single transaction. Without this two-step,
the partial-unique would reject the second default insert with a
constraint violation.

Last-default policy
-------------------
When the default address is deleted, we promote the next-most-recent
address to default. If there are no other addresses, the user simply
has no default — the home pill shows "Set location" until they add
one (PRD section 9.8). Pilot decision: hard delete, no soft-delete.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from app.core.dependencies import AuthUser, DBSession
from app.modules.identity_auth.models import UserAddress

logger = structlog.get_logger()
router = APIRouter(prefix="/v1/users/me/addresses", tags=["user-addresses"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class AddressBase(BaseModel):
    label: str = Field(..., pattern=r"^(home|work|other)$")
    custom_label: Optional[str] = Field(None, max_length=50)
    lat: float
    lng: float
    flat_house_number: str = Field(..., min_length=1, max_length=100)
    building_name: Optional[str] = Field(None, max_length=200)
    floor: Optional[str] = Field(None, max_length=20)
    landmark: Optional[str] = Field(None, max_length=200)
    address_line_1: Optional[str] = Field(None, max_length=300)
    locality: Optional[str] = Field(None, max_length=200)
    city: str = Field(..., min_length=1, max_length=100)
    state: str = Field(..., min_length=1, max_length=100)
    pincode: Optional[str] = Field(None, pattern=r"^\d{6}$")
    is_default: bool = False
    source: str = Field(
        default="manual",
        pattern=r"^(gps_detected|manual|imported_from_profile)$",
    )


class AddressCreateRequest(AddressBase):
    pass


class AddressUpdateRequest(BaseModel):
    """Partial update — every field optional."""
    label: Optional[str] = Field(None, pattern=r"^(home|work|other)$")
    custom_label: Optional[str] = Field(None, max_length=50)
    lat: Optional[float] = None
    lng: Optional[float] = None
    flat_house_number: Optional[str] = Field(None, min_length=1, max_length=100)
    building_name: Optional[str] = Field(None, max_length=200)
    floor: Optional[str] = Field(None, max_length=20)
    landmark: Optional[str] = Field(None, max_length=200)
    address_line_1: Optional[str] = Field(None, max_length=300)
    locality: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, min_length=1, max_length=100)
    state: Optional[str] = Field(None, min_length=1, max_length=100)
    pincode: Optional[str] = Field(None, pattern=r"^\d{6}$")
    is_default: Optional[bool] = None


class AddressResponse(BaseModel):
    id: UUID
    label: str
    custom_label: Optional[str]
    lat: float
    lng: float
    flat_house_number: str
    building_name: Optional[str]
    floor: Optional[str]
    landmark: Optional[str]
    address_line_1: Optional[str]
    locality: Optional[str]
    city: str
    state: str
    pincode: Optional[str]
    is_default: bool
    source: str

    @classmethod
    def from_row(cls, row: UserAddress) -> "AddressResponse":
        return cls(
            id=row.id,
            label=row.label,
            custom_label=row.custom_label,
            lat=float(row.lat),
            lng=float(row.lng),
            flat_house_number=row.flat_house_number,
            building_name=row.building_name,
            floor=row.floor,
            landmark=row.landmark,
            address_line_1=row.address_line_1,
            locality=row.locality,
            city=row.city,
            state=row.state,
            pincode=row.pincode,
            is_default=row.is_default,
            source=row.source,
        )


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _clear_other_defaults(db, user_id: UUID, except_id: Optional[UUID] = None) -> None:
    """Set is_default=false on all of this user's addresses except `except_id`."""
    stmt = (
        update(UserAddress)
        .where(UserAddress.user_id == user_id, UserAddress.is_default == True)  # noqa: E712
        .values(is_default=False)
    )
    if except_id is not None:
        stmt = stmt.where(UserAddress.id != except_id)
    await db.execute(stmt)


async def _load_owned(db, addr_id: UUID, user_id: UUID) -> UserAddress:
    """Fetch an address by id, asserting ownership. 404 if not found / not owned."""
    res = await db.execute(
        select(UserAddress).where(
            UserAddress.id == addr_id,
            UserAddress.user_id == user_id,
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "ADDRESS_NOT_FOUND"},
        )
    return row


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("", response_model=list[AddressResponse])
async def list_addresses(current_user: AuthUser, db: DBSession):
    """List the current user's saved addresses. Default first, then newest first."""
    res = await db.execute(
        select(UserAddress)
        .where(UserAddress.user_id == current_user.user_id)
        .order_by(UserAddress.is_default.desc(), UserAddress.created_at.desc())
    )
    rows = res.scalars().all()
    return [AddressResponse.from_row(r) for r in rows]


@router.post("", response_model=AddressResponse, status_code=status.HTTP_201_CREATED)
async def create_address(
    body: AddressCreateRequest,
    current_user: AuthUser,
    db: DBSession,
):
    """Create a new saved address. If is_default=true, atomically demote
    any existing default for this user before inserting the new row.

    First-address shortcut: if the user has no addresses yet, we force
    is_default=true regardless of the request flag — having no default
    leaves all downstream "where is the user?" queries with nothing to
    return.
    """
    has_existing = await db.execute(
        select(UserAddress.id).where(UserAddress.user_id == current_user.user_id).limit(1)
    )
    is_first = has_existing.scalar_one_or_none() is None
    make_default = body.is_default or is_first

    if make_default:
        await _clear_other_defaults(db, current_user.user_id)

    row = UserAddress(
        user_id=current_user.user_id,
        label=body.label,
        custom_label=body.custom_label if body.label == "other" else None,
        lat=body.lat,
        lng=body.lng,
        flat_house_number=body.flat_house_number,
        building_name=body.building_name,
        floor=body.floor,
        landmark=body.landmark,
        address_line_1=body.address_line_1,
        locality=body.locality,
        city=body.city,
        state=body.state,
        pincode=body.pincode,
        is_default=make_default,
        source=body.source,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info(
        "user_address.created",
        user_id=str(current_user.user_id),
        address_id=str(row.id),
        is_default=make_default,
        source=body.source,
    )
    return AddressResponse.from_row(row)


@router.patch("/{addr_id}", response_model=AddressResponse)
async def update_address(
    addr_id: UUID,
    body: AddressUpdateRequest,
    current_user: AuthUser,
    db: DBSession,
):
    """Partial update. If is_default flips to true, promote atomically."""
    row = await _load_owned(db, addr_id, current_user.user_id)

    data = body.model_dump(exclude_unset=True)

    if data.get("is_default") is True and not row.is_default:
        await _clear_other_defaults(db, current_user.user_id, except_id=row.id)

    # custom_label only meaningful when label == 'other'. If label is being
    # set to something else, blank it.
    new_label = data.get("label", row.label)
    if new_label != "other":
        data["custom_label"] = None

    for k, v in data.items():
        setattr(row, k, v)

    await db.commit()
    await db.refresh(row)
    logger.info(
        "user_address.updated",
        user_id=str(current_user.user_id),
        address_id=str(row.id),
        fields=list(data.keys()),
    )
    return AddressResponse.from_row(row)


@router.delete("/{addr_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_address(
    addr_id: UUID,
    current_user: AuthUser,
    db: DBSession,
):
    """Delete an address. If it was the default, promote the next-most-recent
    address (if any) to default. Hard delete — no soft-delete in pilot scope.
    """
    row = await _load_owned(db, addr_id, current_user.user_id)
    was_default = row.is_default
    await db.delete(row)
    # Flush so the delete is visible to the next SELECT — without this,
    # the about-to-be-deleted row still appears as a candidate and
    # promotion silently no-ops.
    await db.flush()

    if was_default:
        # Promote the most-recently-created remaining address.
        next_res = await db.execute(
            select(UserAddress)
            .where(UserAddress.user_id == current_user.user_id)
            .order_by(UserAddress.created_at.desc())
            .limit(1)
        )
        next_row = next_res.scalar_one_or_none()
        if next_row is not None:
            next_row.is_default = True

    await db.commit()
    logger.info(
        "user_address.deleted",
        user_id=str(current_user.user_id),
        address_id=str(addr_id),
        was_default=was_default,
    )
    return None
