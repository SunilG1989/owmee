from datetime import datetime, timedelta, timezone
"""
Listings router — Epic 3 + Epic 5 + UI v3 fixes + Sprint 4 Pass 3

GET  /v1/listings/categories
GET  /v1/listings/search
GET  /v1/listings/me          — seller dashboard
GET  /v1/listings/me/listings — my listings (all statuses)
POST /v1/listings
GET  /v1/listings/{id}        — full detail with seller info
POST /v1/listings/{id}/images/request
POST /v1/listings/{id}/images/confirm
POST /v1/listings/{id}/publish
GET  /v1/listings             — browse
DELETE /v1/listings/{id}

Pass 3 (3h): listings now carry a kids_safety_checklist JSONB field that is
accepted on create and surfaced on detail. The mobile FE capture flow and
the consumer listing detail screen both read this field.
"""
from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update

from app.core.dependencies import BasicUser, DBSession, OptionalUser, VerifiedUser
from app.core.storage import generate_presigned_upload_url, object_key_for_listing_image, public_url
from app.modules.listings.models import Category, Listing, ListingImage
from app.modules.listings.service import (
    add_image_record, create_draft, get_all_categories, publish_listing,
)
from app.modules.offers.models import Offer, Rating, Transaction
from app.modules.identity_auth.models import User

router = APIRouter()
logger = structlog.get_logger()


# ── Schemas ────────────────────────────────────────────────────────────────────

class CreateListingRequest(BaseModel):
    category_id: UUID
    title: str = Field(..., min_length=3, max_length=200)
    description: str | None = Field(None, max_length=2000)
    price: Decimal = Field(..., gt=0, le=10000000)
    condition: str = Field(..., pattern="^(new|like_new|good|fair)$")
    city: str = Field(..., min_length=2, max_length=100)
    state: str = Field(..., min_length=2, max_length=100)
    locality: str | None = Field(None, max_length=200)
    imei: str | None = Field(None, min_length=15, max_length=17)
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    # UI v3 fields
    accessories: str | None = Field(None, max_length=300)
    warranty_info: str | None = Field(None, max_length=200)
    battery_health: int | None = Field(None, ge=0, le=100)
    age_suitability: str | None = Field(None, max_length=50)
    hygiene_status: str | None = Field(None, max_length=50)
    is_kids_item: bool = False
    is_negotiable: bool = True
    # Sprint 2: Product detail fields (all optional — category-specific)
    brand: str | None = Field(None, max_length=100)
    model: str | None = Field(None, max_length=200)
    storage: str | None = Field(None, max_length=20)
    ram: str | None = Field(None, max_length=20)
    color: str | None = Field(None, max_length=50)
    processor: str | None = Field(None, max_length=100)
    screen_size: str | None = Field(None, max_length=20)
    purchase_year: int | None = Field(None, ge=2000, le=2030)
    screen_condition: str | None = Field(None, pattern="^(flawless|minor_scratches|cracked)$")
    body_condition: str | None = Field(None, pattern="^(flawless|minor_dents|major_damage)$")
    defects: list[str] | None = None
    original_price: float | None = Field(None, gt=0, le=10000000)
    serial_number: str | None = Field(None, max_length=50)
    # Sprint 4 / Pass 3: kids safety checklist
    kids_safety_checklist: dict | None = None


class ImageUploadRequest(BaseModel):
    content_type: str = Field("image/jpeg", pattern="^image/(jpeg|png|webp)$")
    sort_order: int = Field(0, ge=0, le=9)


class ImageConfirmRequest(BaseModel):
    r2_key: str
    sort_order: int = Field(0, ge=0, le=9)
    is_primary: bool = False


# ── Formatters ─────────────────────────────────────────────────────────────────

def _fmt_card(listing: Listing, seller_verified: bool = False) -> dict:
    """Minimal format for browse/search listing cards — includes seller_verified for UI badge."""
    return {
        "id": str(listing.id),
        "title": listing.title,
        "price": str(listing.price),
        "condition": listing.condition,
        "status": listing.status,
        "city": listing.city,
        "locality": listing.locality,
        "category_id": str(listing.category_id),
        "image_urls": [public_url(k) for k in (listing.image_urls or [])],
        "thumbnail_url": public_url(listing.thumbnail_url) if listing.thumbnail_url else None,
        "view_count": listing.view_count,
        "seller_verified": seller_verified,
        "is_kids_item": listing.is_kids_item,
        "is_negotiable": listing.is_negotiable,
        "brand": listing.brand,
        "model": listing.model,
        "storage": listing.storage,
        "ram": listing.ram,
        "color": listing.color,
        "processor": listing.processor,
        "screen_size": listing.screen_size,
        "purchase_year": listing.purchase_year,
        "screen_condition": listing.screen_condition,
        "body_condition": listing.body_condition,
        "defects": listing.defects,
        "original_price": str(listing.original_price) if listing.original_price else None,
        "serial_number": listing.serial_number,
        "age_suitability": listing.age_suitability,
        "published_at": listing.published_at.isoformat() if listing.published_at else None,
        "created_at": listing.created_at.isoformat() if listing.created_at else None,
    }


def _fmt_detail(listing: Listing, seller: User | None, avg_rating: float | None, deal_count: int) -> dict:
    """Full format for listing detail page — all metadata visible above fold."""
    base = _fmt_card(listing, seller_verified=(seller.kyc_status == "verified") if seller else False)
    base.update({
        "description": listing.description,
        "state": listing.state,
        "moderation_status": listing.moderation_status,
        # UI v3 metadata
        "accessories": listing.accessories,
        "warranty_info": listing.warranty_info,
        "battery_health": listing.battery_health,
        "hygiene_status": listing.hygiene_status,
        # Sprint 4 / Pass 2: provenance badges
        "listing_source": listing.listing_source,
        "reviewed_by": listing.reviewed_by,
        # Sprint 4 / Pass 3: kids safety checklist
        "kids_safety_checklist": listing.kids_safety_checklist,
        # Seller info embedded — no second fetch needed from UI
        "seller": {
            "id": str(seller.id) if seller else None,
            "trust_score": seller.trust_score if seller else None,
            "kyc_verified": seller.kyc_status == "verified" if seller else False,
            "avg_rating": round(avg_rating, 1) if avg_rating else None,
            "deal_count": deal_count,
        } if seller else None,
    })
    return base


def _fmt_my(listing: Listing) -> dict:
    """My listings — all statuses including drafts."""
    return {
        "id": str(listing.id),
        "title": listing.title,
        "price": str(listing.price),
        "condition": listing.condition,
        "status": listing.status,
        "moderation_status": listing.moderation_status,
        "city": listing.city,
        "category_id": str(listing.category_id),
        "image_urls": [public_url(k) for k in (listing.image_urls or [])],
        "thumbnail_url": public_url(listing.thumbnail_url) if listing.thumbnail_url else None,
        "view_count": listing.view_count,
        "is_kids_item": listing.is_kids_item,
        "is_negotiable": listing.is_negotiable,
        "brand": listing.brand,
        "model": listing.model,
        "storage": listing.storage,
        "ram": listing.ram,
        "color": listing.color,
        "processor": listing.processor,
        "screen_size": listing.screen_size,
        "purchase_year": listing.purchase_year,
        "screen_condition": listing.screen_condition,
        "body_condition": listing.body_condition,
        "defects": listing.defects,
        "original_price": str(listing.original_price) if listing.original_price else None,
        "serial_number": listing.serial_number,
        "listing_source": listing.listing_source,
        "reviewed_by": listing.reviewed_by,
        "created_at": listing.created_at.isoformat() if listing.created_at else None,
        "published_at": listing.published_at.isoformat() if listing.published_at else None,
    }


# ── Helper: get seller rating + deal count ─────────────────────────────────────

async def _seller_stats(db: DBSession, seller_id: UUID) -> tuple[float | None, int]:
    ratings_result = await db.execute(
        select(Rating).where(Rating.ratee_id == seller_id)
    )
    ratings = ratings_result.scalars().all()
    avg = sum(r.stars for r in ratings) / len(ratings) if ratings else None

    deals_result = await db.execute(
        select(Transaction).where(
            Transaction.seller_id == seller_id,
            Transaction.status.in_(["completed", "auto_completed"]),
        )
    )
    deal_count = len(deals_result.scalars().all())
    return avg, deal_count


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/categories")
async def list_categories(db: DBSession):
    categories = await get_all_categories(db)
    return {"categories": [
        {
            "id": str(c.id),
            "name": c.name,
            "slug": c.slug,
            "shipping_eligible": getattr(c, "shipping_eligible", False),
            "local_eligible": getattr(c, "local_eligible", True),
            "imei_required": c.imei_required,
        }
        for c in categories
    ]}


@router.get("/search")
async def search_listings(
    db: DBSession,
    q: str = Query(..., min_length=2, max_length=100),
    city: str | None = Query(None),
    category_slug: str | None = Query(None),
    condition: str | None = Query(None),
    min_price: float | None = Query(None),
    max_price: float | None = Query(None),
    kids_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    query = select(Listing).where(Listing.status == "active")
    ts_query = func.plainto_tsquery("english", q)
    query = query.where(
        or_(Listing.search_vector.op("@@")(ts_query), Listing.title.ilike(f"%{q}%"))
    )
    if city:
        query = query.where(Listing.city.ilike(f"%{city}%"))
    if condition:
        query = query.where(Listing.condition == condition)
    if min_price is not None:
        query = query.where(Listing.price >= min_price)
    if max_price is not None:
        query = query.where(Listing.price <= max_price)
    if kids_only:
        query = query.where(Listing.is_kids_item == True)
    if category_slug:
        cr = await db.execute(select(Category).where(Category.slug == category_slug))
        cat = cr.scalar_one_or_none()
        if cat:
            query = query.where(Listing.category_id == cat.id)
    query = query.order_by(
        func.ts_rank(Listing.search_vector, ts_query).desc(),
        Listing.published_at.desc()
    ).limit(limit).offset(offset)
    result = await db.execute(query)
    listings = result.scalars().all()

    # Get seller verified status for each listing
    seller_ids = list({l.seller_id for l in listings})
    sellers = {}
    if seller_ids:
        sr = await db.execute(select(User).where(User.id.in_(seller_ids)))
        for s in sr.scalars().all():
            sellers[s.id] = s

    return {
        "query": q,
        "listings": [_fmt_card(l, seller_verified=(sellers.get(l.seller_id, User()).kyc_status == "verified")) for l in listings],
        "count": len(listings),
        "offset": offset,
        "limit": limit,
    }


@router.get("/me")
async def seller_dashboard(current_user: VerifiedUser, db: DBSession):
    listings_result = await db.execute(
        select(Listing).where(Listing.seller_id == current_user.user_id)
        .order_by(Listing.created_at.desc())
    )
    listings = listings_result.scalars().all()

    offers_result = await db.execute(
        select(Offer).where(
            Offer.seller_id == current_user.user_id,
            Offer.status.in_(["pending", "countered"]),
        ).order_by(Offer.created_at.desc())
    )
    pending_offers = offers_result.scalars().all()

    txn_result = await db.execute(
        select(Transaction).where(
            Transaction.seller_id == current_user.user_id,
            Transaction.status.in_(["completed", "auto_completed"]),
        )
    )
    completed_txns = txn_result.scalars().all()

    ratings_result = await db.execute(select(Rating).where(Rating.ratee_id == current_user.user_id))
    ratings = ratings_result.scalars().all()

    total_earnings = sum(float(t.net_payout or 0) for t in completed_txns)
    payout_pending = sum(
        float(t.net_payout or 0) for t in completed_txns
        if t.payout_flagged_at and not t.payout_released_at
    )
    avg_rating = round(sum(r.stars for r in ratings) / len(ratings), 1) if ratings else None
    status_counts = {}
    for l in listings:
        status_counts[l.status] = status_counts.get(l.status, 0) + 1

    return {
        "seller_id": str(current_user.user_id),
        "stats": {
            "total_listings": len(listings),
            "listings_by_status": status_counts,
            "total_views": sum(l.view_count for l in listings),
            "pending_offers": len(pending_offers),
            "completed_deals": len(completed_txns),
            "total_earnings": total_earnings,
            "payout_pending": payout_pending,
            "avg_rating": avg_rating,
            "ratings_count": len(ratings),
        },
        "listings": [_fmt_my(l) for l in listings],
        "pending_offers": [
            {
                "id": str(o.id),
                "listing_id": str(o.listing_id),
                "offered_price": str(o.offered_price),
                "counter_price": str(o.counter_price) if o.counter_price else None,
                "status": o.status,
                "expires_at": o.expires_at.isoformat() if o.expires_at else None,
            }
            for o in pending_offers
        ],
    }


@router.get("/me/listings")
async def my_listings(current_user: BasicUser, db: DBSession,
                      status_filter: str | None = Query(None)):
    query = select(Listing).where(Listing.seller_id == current_user.user_id)
    if status_filter:
        query = query.where(Listing.status == status_filter)
    result = await db.execute(query.order_by(Listing.created_at.desc()))
    listings = result.scalars().all()
    return {"listings": [_fmt_my(l) for l in listings], "count": len(listings)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_listing(body: CreateListingRequest, current_user: BasicUser, db: DBSession):
    result = await db.execute(select(Category).where(Category.id == body.category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=400, detail={"error": "CATEGORY_NOT_FOUND"})
    if category.imei_required and not body.imei:
        raise HTTPException(status_code=400, detail={
            "error": "IMEI_REQUIRED",
            "message": f"IMEI is required for {category.name} listings.",
        })
    try:
        listing = await create_draft(
            db=db, seller_id=current_user.user_id,
            category_id=body.category_id, title=body.title,
            description=body.description, price=body.price,
            condition=body.condition, city=body.city, state=body.state,
            locality=body.locality, imei=body.imei, lat=body.lat, lng=body.lng,
        )
        # Set UI v3 fields
        listing.accessories = body.accessories
        listing.is_negotiable = body.is_negotiable
        listing.warranty_info = body.warranty_info
        listing.battery_health = body.battery_health
        listing.age_suitability = body.age_suitability
        listing.hygiene_status = body.hygiene_status
        listing.is_kids_item = body.is_kids_item
        # Sprint 2: Product details
        listing.brand = body.brand
        listing.model = body.model
        listing.storage = body.storage
        listing.ram = body.ram
        listing.color = body.color
        listing.processor = body.processor
        listing.screen_size = body.screen_size
        listing.purchase_year = body.purchase_year
        listing.screen_condition = body.screen_condition
        listing.body_condition = body.body_condition
        listing.defects = body.defects
        listing.original_price = body.original_price
        listing.serial_number = body.serial_number
        # Sprint 4 / Pass 3
        listing.kids_safety_checklist = body.kids_safety_checklist
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})
    return {"listing_id": str(listing.id), "status": "draft",
            "message": "Draft created. Upload images then publish when ready."}


@router.post("/{listing_id}/images/request")
async def request_image_upload(listing_id: UUID, body: ImageUploadRequest,
                                current_user: BasicUser, db: DBSession):
    result = await db.execute(select(Listing).where(
        Listing.id == listing_id, Listing.seller_id == current_user.user_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})
    if listing.status not in ("draft", "active"):
        raise HTTPException(status_code=400, detail={"error": "INVALID_STATUS"})
    count = await db.execute(select(ListingImage).where(ListingImage.listing_id == listing_id))
    if len(count.scalars().all()) >= 10:
        raise HTTPException(status_code=400, detail={"error": "MAX_IMAGES"})
    r2_key = object_key_for_listing_image(str(listing_id))
    upload_url = generate_presigned_upload_url(r2_key, content_type=body.content_type, expires_in=300)
    return {"upload_url": upload_url, "r2_key": r2_key, "expires_in_seconds": 300}


@router.post("/{listing_id}/images/confirm")
async def confirm_image_upload(listing_id: UUID, body: ImageConfirmRequest,
                                current_user: BasicUser, db: DBSession):
    result = await db.execute(select(Listing).where(
        Listing.id == listing_id, Listing.seller_id == current_user.user_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})
    image = await add_image_record(db, listing_id, body.r2_key, body.sort_order, body.is_primary)
    current_urls = listing.image_urls or []
    if body.r2_key not in current_urls:
        listing.image_urls = current_urls + [body.r2_key]
    if body.is_primary:
        listing.thumbnail_url = body.r2_key
    await db.commit()
    return {"image_id": str(image.id), "r2_key": body.r2_key,
            "public_url": public_url(body.r2_key), "moderation_status": "pending"}


@router.post("/{listing_id}/publish")
async def publish(listing_id: UUID, current_user: VerifiedUser, db: DBSession):
    try:
        listing = await publish_listing(db, listing_id, current_user.user_id)
        await db.commit()
    except ValueError as e:
        code = str(e)
        if code.startswith("INVALID_STATUS:"):
            raise HTTPException(status_code=400, detail={"error": "INVALID_STATUS"})
        if code.startswith("MIN_PHOTOS_REQUIRED:"):
            parts = code.split(":")
            have, need = int(parts[1]), int(parts[2])
            raise HTTPException(status_code=400, detail={
                "error": "MIN_PHOTOS_REQUIRED",
                "message": f"Listings need at least {need} photos — you have {have}. Add more to build buyer trust.",
                "photos_uploaded": have,
                "photos_required": need,
            })
        if code == "NO_IMAGES":
            raise HTTPException(status_code=400, detail={
                "error": "NO_IMAGES",
                "message": "Add at least 3 photos before publishing.",
            })
        raise HTTPException(status_code=400, detail={"error": code})

    # Check for duplicate warning flag
    has_duplicate = listing.moderation_flag and listing.moderation_flag.startswith("POSSIBLE_DUPLICATE:")
    response = {
        "listing_id": str(listing.id),
        "status": "pending_moderation",
        "message": "Listing submitted for review. Usually live within 2 hours.",
    }
    if has_duplicate:
        dup_id = listing.moderation_flag.split(":")[1]
        response["warning"] = "POSSIBLE_DUPLICATE"
        response["duplicate_listing_id"] = dup_id
        response["warning_message"] = "You already have a similar listing. Consider updating that one to avoid duplication."
    return response


@router.get("")
async def browse_listings(
    db: DBSession,
    current_user: OptionalUser = None,
    city: str | None = Query(None),
    category_slug: str | None = Query(None),
    condition: str | None = Query(None),
    min_price: float | None = Query(None),
    max_price: float | None = Query(None),
    kids_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    query = select(Listing).where(Listing.status == "active")
    if city:
        query = query.where(Listing.city.ilike(f"%{city}%"))
    if condition:
        query = query.where(Listing.condition == condition)
    if min_price is not None:
        query = query.where(Listing.price >= min_price)
    if max_price is not None:
        query = query.where(Listing.price <= max_price)
    if kids_only:
        query = query.where(Listing.is_kids_item == True)
    if category_slug:
        cr = await db.execute(select(Category).where(Category.slug == category_slug))
        cat = cr.scalar_one_or_none()
        if cat:
            query = query.where(Listing.category_id == cat.id)
    result = await db.execute(
        query.order_by(Listing.published_at.desc()).limit(limit).offset(offset))
    listings = result.scalars().all()

    # Batch fetch seller verified status
    seller_ids = list({l.seller_id for l in listings})
    sellers = {}
    if seller_ids:
        sr = await db.execute(select(User).where(User.id.in_(seller_ids)))
        for s in sr.scalars().all():
            sellers[s.id] = s

    return {
        "listings": [_fmt_card(l, seller_verified=(sellers.get(l.seller_id, User()).kyc_status == "verified")) for l in listings],
        "count": len(listings),
        "offset": offset,
        "limit": limit,
    }


@router.get("/activity")
async def listing_activity(
    db: DBSession,
    city: str | None = Query(None),
):
    """
    Home screen social proof ticker.
    Returns deal count + listing count for the activity feed.
    """
    from datetime import timedelta
    from app.modules.offers.models import Transaction
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    deals_result = await db.execute(
        select(Transaction).where(
            Transaction.status.in_(["completed", "auto_completed"]),
            Transaction.completed_at >= cutoff,
        )
    )
    deals_today = len(deals_result.scalars().all())

    q = select(Listing).where(Listing.status == "active", Listing.published_at >= cutoff)
    if city:
        q = q.where(Listing.city.ilike(f"%{city}%"))
    new_listings = len((await db.execute(q)).scalars().all())

    q2 = select(Listing).where(Listing.status == "active")
    if city:
        q2 = q2.where(Listing.city.ilike(f"%{city}%"))
    total_active = len((await db.execute(q2)).scalars().all())

    return {
        "deals_completed_today": deals_today,
        "new_listings_24h": new_listings,
        "total_active_listings": total_active,
        "city": city,
        "ticker_deals": f"{deals_today} deal{'s' if deals_today != 1 else ''} completed today" if deals_today else "Be the first to complete a deal today",
        "ticker_listings": f"{new_listings} new listing{'s' if new_listings != 1 else ''} in {city or 'your city'} today" if new_listings else f"{total_active} listing{'s' if total_active != 1 else ''} available",
    }


@router.get("/new-since-visit")
async def new_since_last_visit(
    current_user: BasicUser,
    db: DBSession,
    city: str | None = Query(None),
):
    """
    Home screen retention: 'New since your last visit'
    Updates user.last_seen_at on every call — so next visit shows delta.
    """
    from app.modules.identity_auth.models import User as UserModel

    # Fetch user's last_seen_at
    user_result = await db.execute(select(UserModel).where(UserModel.id == current_user.user_id))
    user = user_result.scalar_one_or_none()

    last_seen = user.last_seen_at if user and user.last_seen_at else None
    now = datetime.now(timezone.utc)

    # Update last_seen_at to now (for next call)
    if user:
        user.last_seen_at = now
        await db.commit()

    if not last_seen:
        # First visit — show last 24h of listings as "new"
        last_seen = now - timedelta(hours=24)

    q = select(Listing).where(
        Listing.status == "active",
        Listing.published_at >= last_seen,
    )
    if city:
        q = q.where(Listing.city.ilike(f"%{city}%"))
    q = q.order_by(Listing.published_at.desc()).limit(10)
    result = await db.execute(q)
    listings = result.scalars().all()

    return {
        "since": last_seen.isoformat(),
        "count": len(listings),
        "listings": [_fmt_card(l) for l in listings],
        "label": f"{len(listings)} new listing{'s' if len(listings) != 1 else ''} since your last visit" if listings else "You're all caught up",
    }



@router.get("/{listing_id}")
async def get_listing(listing_id: UUID, db: DBSession):
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})

    # Increment view count for active listings
    if listing.status == "active":
        await db.execute(
            update(Listing).where(Listing.id == listing_id)
            .values(view_count=Listing.view_count + 1)
        )
        await db.commit()
        listing.view_count += 1

    # Fetch seller info
    seller_result = await db.execute(select(User).where(User.id == listing.seller_id))
    seller = seller_result.scalar_one_or_none()
    avg_rating, deal_count = await _seller_stats(db, listing.seller_id)

    return _fmt_detail(listing, seller, avg_rating, deal_count)


@router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_listing(listing_id: UUID, current_user: BasicUser, db: DBSession):
    result = await db.execute(select(Listing).where(
        Listing.id == listing_id, Listing.seller_id == current_user.user_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})
    if listing.status in ("reserved", "sold"):
        raise HTTPException(status_code=400, detail={"error": "CANNOT_DELETE"})
    listing.status = "removed"
    await db.commit()
