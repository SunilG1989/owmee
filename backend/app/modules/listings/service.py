"""
Listings service — business logic layer.

Handles:
- Draft creation and validation
- Category eligibility enforcement
- IMEI hashing (never store raw IMEI)
- Publish gate (requires verified tier)
- Listing expiry scheduling
- Listing snapshot creation at reservation time
- Moderation queue helpers
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.listings.models import (
    Category, Listing, ListingImage, ListingSnapshot
)

logger = structlog.get_logger()

LISTING_EXPIRY_DAYS = 30
LISTING_INACTIVITY_NUDGE_DAYS = 14


def hash_imei(imei: str) -> str:
    """SHA-256 hash of IMEI — never store raw IMEI."""
    return hashlib.sha256(imei.strip().encode()).hexdigest()


async def get_category(db: AsyncSession, category_id: UUID) -> Category | None:
    result = await db.execute(
        select(Category).where(Category.id == category_id, Category.is_active == True)
    )
    return result.scalar_one_or_none()


async def get_all_categories(db: AsyncSession) -> list[Category]:
    result = await db.execute(
        select(Category)
        .where(Category.is_active == True, Category.parent_id == None)
        .order_by(Category.sort_order)
    )
    return list(result.scalars().all())


async def create_draft(
    db: AsyncSession,
    seller_id: UUID,
    category_id: UUID,
    title: str,
    description: str | None,
    price: Decimal,
    condition: str,
    city: str,
    state: str,
    locality: str | None = None,
    imei: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
) -> Listing:
    """
    Create a listing draft. Available to basic-tier users.
    IMEI is hashed immediately — raw value never stored.
    """
    category = await get_category(db, category_id)
    if not category:
        raise ValueError("CATEGORY_NOT_FOUND")

    listing = Listing(
        seller_id=seller_id,
        category_id=category_id,
        title=title.strip(),
        description=description,
        price=price,
        condition=condition,
        status="draft",
        moderation_status="pending",
        image_urls=[],
        city=city,
        state=state,
        locality=locality,
        imei_hash=hash_imei(imei) if imei else None,
    )

    # Set geo_point if coordinates provided
    if lat is not None and lng is not None:
        from sqlalchemy import text
        listing.geo_point = f"SRID=4326;POINT({lng} {lat})"

    db.add(listing)
    await db.flush()
    logger.info("listing.draft_created", listing_id=str(listing.id), seller_id=str(seller_id))
    return listing


async def add_image_record(
    db: AsyncSession,
    listing_id: UUID,
    r2_key: str,
    sort_order: int = 0,
    is_primary: bool = False,
) -> ListingImage:
    """Record an uploaded image against a listing."""
    image = ListingImage(
        listing_id=listing_id,
        r2_key=r2_key,
        sort_order=sort_order,
        is_primary=is_primary,
        moderation_status="pending",
    )
    db.add(image)
    await db.flush()
    return image


MIN_PHOTOS_REQUIRED = 3


async def publish_listing(
    db: AsyncSession,
    listing_id: UUID,
    seller_id: UUID,
) -> Listing:
    """
    Publish a draft listing. Requires verified tier (enforced at router level).
    Enforces minimum 3 photos (India UX: single-photo listings destroy buyer trust).
    Warns on duplicate title from same seller.
    """
    result = await db.execute(
        select(Listing).where(
            Listing.id == listing_id,
            Listing.seller_id == seller_id,
        )
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise ValueError("LISTING_NOT_FOUND")
    if listing.status not in ("draft",):
        raise ValueError(f"INVALID_STATUS:{listing.status}")

    # Enforce minimum 3 photos
    img_result = await db.execute(
        select(ListingImage).where(ListingImage.listing_id == listing_id)
    )
    images = img_result.scalars().all()
    if not images:
        raise ValueError("NO_IMAGES")
    if len(images) < MIN_PHOTOS_REQUIRED:
        raise ValueError(f"MIN_PHOTOS_REQUIRED:{len(images)}:{MIN_PHOTOS_REQUIRED}")

    # Duplicate detection — warn (not block) if same seller has same title active
    dup_result = await db.execute(
        select(Listing).where(
            Listing.seller_id == seller_id,
            Listing.id != listing_id,
            Listing.title == listing.title,
            Listing.status.in_(["active", "pending_moderation"]),
        )
    )
    duplicate = dup_result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    listing.status = "pending_moderation"
    listing.published_at = now
    listing.expires_at = now + timedelta(days=LISTING_EXPIRY_DAYS)

    logger.info("listing.publish_requested", listing_id=str(listing_id),
                duplicate_detected=bool(duplicate))

    if duplicate:
        # Attach warning to listing — not a block, just flagged
        listing.moderation_flag = f"POSSIBLE_DUPLICATE:{str(duplicate.id)}"

    return listing


async def approve_listing(db: AsyncSession, listing_id: UUID) -> Listing:
    """Moderator approves listing — moves to active."""
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise ValueError("LISTING_NOT_FOUND")
    listing.status = "active"
    listing.moderation_status = "approved"
    logger.info("listing.approved", listing_id=str(listing_id))
    return listing


async def reject_listing(
    db: AsyncSession, listing_id: UUID, flag: str
) -> Listing:
    """Moderator rejects listing."""
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise ValueError("LISTING_NOT_FOUND")
    listing.status = "removed"
    listing.moderation_status = "rejected"
    listing.moderation_flag = flag
    logger.info("listing.rejected", listing_id=str(listing_id), flag=flag)
    return listing


async def create_snapshot(
    db: AsyncSession,
    listing_id: UUID,
    reservation_id: UUID,
) -> ListingSnapshot:
    """
    Freeze listing state at reservation time. Immutable.
    Edits after this point do not affect the snapshot.
    """
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise ValueError("LISTING_NOT_FOUND")

    snapshot_data = {
        "listing_id": str(listing.id),
        "title": listing.title,
        "description": listing.description,
        "price": str(listing.price),
        "condition": listing.condition,
        "category_id": str(listing.category_id),
        "image_urls": listing.image_urls or [],
        "city": listing.city,
        "state": listing.state,
        "locality": listing.locality,
        "snapshotted_at": datetime.now(timezone.utc).isoformat(),
    }

    snapshot = ListingSnapshot(
        listing_id=listing_id,
        reservation_id=reservation_id,
        snapshot_data=snapshot_data,
    )
    db.add(snapshot)
    await db.flush()
    logger.info("listing.snapshot_created", listing_id=str(listing_id), reservation_id=str(reservation_id))
    return snapshot
