"""Transaction listing-snapshot service — Sprint 4 / Pass 4e.

Freezes listing state at transaction creation time. Disputes and the
transaction-detail view reference the snapshot so seller edits after
reservation cannot rewrite history.

Integration model:
  - freeze_snapshot() is a pure service function. Callers (e.g., the
    offer-accept code path or order creation) import it and call it
    inside the same transaction that creates the Transaction row.
  - If a transaction is created without a snapshot for any reason
    (legacy data, hook failure), admin can backfill via
    POST /v1/admin/transactions/{id}/freeze-snapshot.

All snapshot writes are idempotent: freezing an already-frozen
transaction is a no-op (returns existing snapshot).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_dependencies import AdminUser, AdminAny
from app.core.dependencies import DBSession

logger = structlog.get_logger(__name__)


# Canonical snapshot shape — fields that matter for dispute resolution.
# Extend carefully; removing fields is a breaking change for existing snapshots.
SNAPSHOT_FIELDS = [
    # Identity
    "id", "seller_id", "category_id",
    # Title / description / price
    "title", "description", "price", "original_price", "condition",
    # Product attributes
    "brand", "model", "storage", "ram", "color", "processor", "screen_size",
    "purchase_year", "accessories", "warranty_info", "battery_health",
    # Physical state — critical for disputes
    "screen_condition", "body_condition", "defects",
    # Kids / utility
    "is_kids_item", "age_suitability", "hygiene_status", "kids_safety_checklist",
    # Location
    "city", "locality",
    # Images (list of r2_key or URLs)
    "image_urls", "thumbnail_url",
    # Moderation + source
    "moderation_status", "listing_source", "reviewed_by",
    # FE trail
    "fe_visit_id",
    # IMEI / serial
    "imei_hash", "serial_number",
    # Audit
    "created_at", "published_at",
]


def _serialize_listing(listing: Any) -> dict:
    """Pluck snapshot fields from a Listing ORM object. Handles missing
    attributes gracefully (older schema versions, test doubles)."""
    snap: dict = {}
    for field in SNAPSHOT_FIELDS:
        val = getattr(listing, field, None)
        if val is None:
            continue
        # Convert UUIDs to strings
        if isinstance(val, uuid.UUID):
            snap[field] = str(val)
        # Convert datetimes to ISO strings
        elif isinstance(val, datetime):
            snap[field] = val.isoformat()
        # JSONB / dict / list pass through
        else:
            snap[field] = val
    return snap


async def freeze_snapshot(
    db: AsyncSession,
    *,
    transaction_id: uuid.UUID,
    listing_id: uuid.UUID,
) -> Optional[dict]:
    """Write the listing snapshot onto a transaction row.

    Idempotent: if snapshot is already set, returns the existing snapshot
    without overwriting. Caller is responsible for commit().
    """
    from app.modules.offers.models import Transaction
    from app.modules.listings.models import Listing

    # Load transaction
    res = await db.execute(
        select(Transaction).where(Transaction.id == transaction_id)
    )
    txn = res.scalar_one_or_none()
    if txn is None:
        logger.warning("snapshot.freeze.no_txn", transaction_id=str(transaction_id))
        return None

    # Idempotent — if already frozen, return existing
    if getattr(txn, "listing_snapshot", None):
        return txn.listing_snapshot

    # Load listing
    res = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = res.scalar_one_or_none()
    if listing is None:
        logger.warning("snapshot.freeze.no_listing",
                       transaction_id=str(transaction_id),
                       listing_id=str(listing_id))
        return None

    snap = _serialize_listing(listing)
    snap["_snapshot_version"] = 1
    snap["_frozen_at"] = datetime.now(timezone.utc).isoformat()

    txn.listing_snapshot = snap
    txn.snapshot_frozen_at = datetime.now(timezone.utc)

    logger.info(
        "snapshot.frozen",
        transaction_id=str(transaction_id),
        listing_id=str(listing_id),
        field_count=len(snap),
    )
    return snap


# ── Admin backfill endpoint ─────────────────────────────────────────────────

class FreezeSnapshotResponse(BaseModel):
    transaction_id: str
    listing_id: str
    frozen: bool
    already_frozen: bool = False
    snapshot: Optional[dict] = None


router = APIRouter(tags=["admin-transaction-snapshot"])


@router.post("/{transaction_id}/freeze-snapshot", response_model=FreezeSnapshotResponse)
async def admin_freeze_snapshot(
    transaction_id: str,
    _: AdminUser,
    db: DBSession,
):
    """Admin backfill: freeze snapshot for a transaction that doesn't have
    one yet. Useful for legacy transactions or when the automatic hook
    failed."""
    from app.modules.offers.models import Transaction

    try:
        tx_uid = uuid.UUID(transaction_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_ID", "message": "transaction_id must be a UUID"})

    res = await db.execute(select(Transaction).where(Transaction.id == tx_uid))
    txn = res.scalar_one_or_none()
    if txn is None:
        raise HTTPException(status_code=404, detail={
            "error": "NOT_FOUND", "message": "Transaction not found"})

    already = bool(getattr(txn, "listing_snapshot", None))
    if already:
        return FreezeSnapshotResponse(
            transaction_id=str(txn.id),
            listing_id=str(txn.listing_id),
            frozen=True,
            already_frozen=True,
            snapshot=txn.listing_snapshot,
        )

    snap = await freeze_snapshot(db, transaction_id=tx_uid, listing_id=txn.listing_id)
    await db.commit()

    if snap is None:
        raise HTTPException(status_code=500, detail={
            "error": "SNAPSHOT_FAILED",
            "message": "Could not freeze snapshot. Listing may have been deleted."})

    return FreezeSnapshotResponse(
        transaction_id=str(txn.id),
        listing_id=str(txn.listing_id),
        frozen=True,
        already_frozen=False,
        snapshot=snap,
    )


@router.get("/{transaction_id}/snapshot")
async def admin_get_snapshot(
    transaction_id: str,
    _: AdminAny,
    db: DBSession,
):
    """Return the frozen snapshot for a transaction."""
    from app.modules.offers.models import Transaction

    try:
        tx_uid = uuid.UUID(transaction_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_ID", "message": "transaction_id must be a UUID"})

    res = await db.execute(select(Transaction).where(Transaction.id == tx_uid))
    txn = res.scalar_one_or_none()
    if txn is None:
        raise HTTPException(status_code=404, detail={
            "error": "NOT_FOUND", "message": "Transaction not found"})

    snap = getattr(txn, "listing_snapshot", None)
    frozen_at = getattr(txn, "snapshot_frozen_at", None)
    return {
        "transaction_id": str(txn.id),
        "listing_id": str(txn.listing_id),
        "snapshot": snap,
        "frozen_at": frozen_at.isoformat() if frozen_at else None,
    }
