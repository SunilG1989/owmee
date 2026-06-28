from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Any, Optional
from urllib.parse import unquote, urlparse
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
from sqlalchemy import func, inspect, or_, select, update
from sqlalchemy.orm import selectinload

from app.core.dependencies import BasicUser, DBSession, OptionalUser, VerifiedUser
from app.core.rate_limit import LISTING_CREATE_PER_USER, limit_by_user
from app.core.settings import settings
from app.core.storage import (
    generate_presigned_download_url, generate_presigned_upload_url,
    object_key_for_listing_image, process_listing_image, public_url,
)
from fastapi import Depends

_IMG_URL_CACHE: dict[str, tuple[float, str | None]] = {}
_IMG_URL_CACHE_TTL_SECONDS = 60 * 60 * 5


def _object_key_from_url(value: str) -> str | None:
    """Recover the R2 object key from legacy rows that stored signed URLs."""
    path = unquote(urlparse(value).path).lstrip("/")
    bucket = settings.r2_bucket.strip("/")
    if bucket and path.startswith(f"{bucket}/"):
        return path[len(bucket) + 1:]
    if path.startswith(("ai-drafts/", "listings/", "fe-visits/")):
        return path
    return None


def _img_url(key: str | None) -> str | None:
    """6h presigned download URL. Used by card/detail/my-listings format.
    Switched from public_url() because (a) it works on private MinIO buckets
    without a public-read policy, (b) it sidesteps the public-vs-internal
    hostname signing mismatch we hit on Android emulator, (c) feed_router
    started doing the same thing for consistency.

    Defensive cleanup: some legacy rows stored full presigned URLs instead
    of bare object keys. If the URL belongs to our media bucket, recover the
    key and issue a fresh signed URL so mobile never receives an expired hero.
    Unknown external URLs pass through unchanged. r2:// sentinel returns None
    so the response stays clean.
    """
    if not key:
        return None
    if key.startswith(("http://", "https://")):
        object_key = _object_key_from_url(key)
        if not object_key:
            return key
        key = object_key
    if key.startswith("r2://"):
        return None
    now = monotonic()
    cached = _IMG_URL_CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1]
    try:
        url = generate_presigned_download_url(key, expires_in=60 * 60 * 6)
        _IMG_URL_CACHE[key] = (now + _IMG_URL_CACHE_TTL_SECONDS, url)
        return url
    except Exception:
        _IMG_URL_CACHE[key] = (now + 60, None)
        return None


def _fe_inspection_required(price) -> bool:
    """Mirror of offers.service.requires_fe_inspection — kept here so the
    listings router doesn't need to import the offers service just for this
    one boolean."""
    from decimal import Decimal as _D
    if price is None:
        return False
    return (price if isinstance(price, _D) else _D(str(price))) > _D("1000")
from app.modules.listings.models import Category, Listing, ListingImage
from app.modules.listings.service import (
    MIN_PHOTOS_REQUIRED, add_image_record, create_draft, get_all_categories,
    hash_imei, publish_listing,
)
from app.modules.ai_assistant import ceir_client
from app.modules.ai_assistant.category_taxonomy import (
    category_family_for,
    clean_category_specifics,
    has_educational_book_detail,
    has_issue_disclosure_detail,
    required_category_specific_fields,
    requires_appliance_pickup_status,
    requires_book_set_status,
    requires_educational_book_details,
    requires_issue_disclosure_detail,
    requires_powered_toy_status,
)
from app.modules.offers.models import Offer, Rating, Transaction
from app.modules.identity_auth.models import User
from app.modules.verification.service import ACTION_PUBLISH_LISTING, evaluate_user_action

router = APIRouter()
logger = structlog.get_logger()


_PUBLIC_LISTING_STATUSES = {"active"}
_IMEI_LOCK_STATUSES = {"active", "reserved", "sold", "pending_moderation"}


def _can_view_listing_detail(listing: Listing, current_user: OptionalUser) -> bool:
    if listing.status in _PUBLIC_LISTING_STATUSES:
        return True
    return bool(current_user and str(listing.seller_id) == str(current_user.user_id))


def _min_photo_detail(photo_count: int) -> dict:
    return {
        "error": "MIN_PHOTOS_REQUIRED",
        "message": (
            f"Listings need at least {MIN_PHOTOS_REQUIRED} photos - "
            f"you have {photo_count}. Add more to build buyer trust."
        ),
        "photos_uploaded": photo_count,
        "photos_required": MIN_PHOTOS_REQUIRED,
    }


def _specific_present(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return True
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_specific_present(item) for item in value)
    return bool(value)


def _clean_manual_category_specifics(
    category_slug: str,
    body: "CreateListingRequest",
) -> tuple[str, dict[str, Any], dict | None]:
    family = category_family_for(
        category_slug,
        detected_item_type=body.model,
        title=body.title,
        model=body.model,
    )
    specifics = clean_category_specifics(family, body.category_specifics)
    if family == "toy" and not _specific_present(specifics.get("toy_type")) and body.model:
        specifics["toy_type"] = body.model
    if family == "book" and not _specific_present(specifics.get("book_type")) and body.model:
        specifics["book_type"] = body.model
    if family == "appliance" and not _specific_present(specifics.get("appliance_type")) and body.model:
        specifics["appliance_type"] = body.model

    kids_checklist = None
    if isinstance(body.kids_safety_checklist, dict):
        kids_checklist = {
            str(key): bool(value)
            for key, value in body.kids_safety_checklist.items()
            if isinstance(value, bool)
        } or None
    return family, specifics, kids_checklist


def _manual_category_specifics_rejection(
    *,
    category_slug: str,
    family: str,
    specifics: dict[str, Any],
    kids_checklist: dict | None,
    body: "CreateListingRequest",
) -> dict | None:
    if family not in {"toy", "book", "appliance"}:
        return None

    missing: list[str] = []
    for field in required_category_specific_fields(family):
        if not _specific_present(specifics.get(field)):
            missing.append(field)

    if family == "toy":
        if not _specific_present(body.age_suitability):
            missing.append("age_suitability")
        if not _specific_present(body.hygiene_status):
            missing.append("hygiene_status")
        if requires_powered_toy_status(body.model, body.title) and not (
            _specific_present(specifics.get("working_status"))
            or _specific_present(specifics.get("battery_status"))
        ):
            missing.append("battery_or_working_status")
        if category_slug == "kids-utility":
            required_checklist = ("no_small_parts", "no_loose_batteries", "no_sharp_edges")
            if not all(key in (kids_checklist or {}) for key in required_checklist):
                missing.append("kids_safety_checklist")

    if family == "book" and requires_book_set_status(body.model, body.title):
        if not _specific_present(specifics.get("set_status")):
            missing.append("set_status")
    if family == "book" and requires_educational_book_details(body.model, body.title):
        if not has_educational_book_detail(specifics):
            missing.append("class_board_edition")

    if family == "appliance":
        if not _specific_present(specifics.get("appliance_type")):
            missing.append("appliance_type")
        if requires_appliance_pickup_status(body.model, body.title):
            if not _specific_present(specifics.get("pickup_complexity")):
                missing.append("pickup_complexity")
            if not _specific_present(specifics.get("installation_status")):
                missing.append("installation_status")
    if (
        requires_issue_disclosure_detail(family, specifics)
        and not has_issue_disclosure_detail(body.description)
    ):
        missing.append("issue_disclosure")

    deduped = list(dict.fromkeys(missing))
    if not deduped:
        return None

    return {
        "error": "CATEGORY_REQUIREMENTS_REQUIRED",
        "category_family": family,
        "missing_fields": deduped,
        "message": "Complete category-specific buyer details before publishing.",
    }


def _card_image_urls(listing: Listing) -> list[str]:
    """Cards render one display-quality hero; avoid presigning the full gallery.

    `thumbnail_url` is useful for tiny surfaces, but product cards are large
    enough that stretching the thumbnail makes the hero look soft/cropped.
    Prefer the first cleaned display image and fall back to the thumbnail for
    legacy rows that do not have image_urls.
    """
    first_key = next(iter(listing.image_urls or []), None) or listing.thumbnail_url
    first_url = _img_url(first_key)
    return [first_url] if first_url else []


def _image_identity(key: str | None) -> str | None:
    if not key:
        return None
    if key.startswith(("http://", "https://")):
        key = _object_key_from_url(key) or key
    return (
        key.split("?", 1)[0]
        .removesuffix(".thumb.webp")
        .removesuffix(".display.webp")
    )


def _detail_image_urls(listing: Listing) -> list[str]:
    """Return the gallery with the stored display hero first.

    `thumbnail_url` is a fallback for legacy rows. It must not jump ahead of
    `image_urls[0]`, because AI listings store the background-cleaned hero
    there while thumbnail_url may still point at an older/original derivative.
    """
    stored_keys = list(listing.image_urls or [])
    ordered_keys: list[str] = list(stored_keys)
    if listing.thumbnail_url:
        thumb_identity = _image_identity(listing.thumbnail_url)
        has_matching_display = any(
            key != listing.thumbnail_url and _image_identity(key) == thumb_identity
            for key in stored_keys
        )
        if not has_matching_display:
            ordered_keys.append(listing.thumbnail_url)

    seen: set[str] = set()
    urls: list[str] = []
    for key in ordered_keys:
        identity = _image_identity(key) or key
        if identity in seen:
            continue
        seen.add(identity)
        url = _img_url(key)
        if url:
            urls.append(url)
    return urls


def _category_slug(listing: Listing) -> str | None:
    state = inspect(listing, raiseerr=False)
    if state is not None and "category" in state.unloaded:
        return None
    category = getattr(listing, "category", None)
    return getattr(category, "slug", None) if category else None


def _iso_or_none(value) -> str | None:
    return value.isoformat() if value else None


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
    category_family: str | None = None
    category_specifics: dict[str, Any] | None = None
    # P1 (2026-05-03) — Cashify-floor listing fields. All optional;
    # mobile router enforces required where category-specific.
    has_box: bool | None = None
    has_bill: bool | None = None
    has_charger: bool | None = None
    has_earphones: bool | None = None
    min_acceptable_price: float | None = Field(None, gt=0, le=10000000)
    water_damage_history: bool | None = None
    seller_functional_attestation: bool | None = None


class ImageUploadRequest(BaseModel):
    content_type: str = Field("image/jpeg", pattern="^image/(jpeg|png|webp)$")
    sort_order: int = Field(0, ge=0, le=9)


class ImageConfirmRequest(BaseModel):
    r2_key: str
    sort_order: int = Field(0, ge=0, le=9)
    is_primary: bool = False


# ── Formatters ─────────────────────────────────────────────────────────────────

def _seller_verified(listing: Listing, seller: User | None) -> bool:
    """Sprint 6a badge formula. Mirrors feed_router._serialize_row exactly:
    badge shows iff seller was verified at listing creation AND is still
    currently verified. The snapshot column is NOT NULL (default FALSE,
    backfilled from current state in migration 0024)."""
    return bool(
        listing.seller_kyc_verified_at_listing_time
        and seller is not None
        and seller.kyc_status == "verified"
    )


def _listing_verified(listing: Listing) -> bool:
    reviewed_by = (getattr(listing, "reviewed_by", None) or "none").lower()
    return reviewed_by in {"fe", "ops", "fe_and_ops"}


def _listing_trust_label(listing: Listing) -> tuple[str, str]:
    if _listing_verified(listing):
        return "Owmee reviewed", "owmee_reviewed"
    if getattr(listing, "ai_draft_id", None):
        return "AI-assisted", "ai_assisted"
    if _category_slug(listing) == "others":
        return "Limited review", "limited"
    return "Seller confirmed", "seller_confirmed"


def _seller_confirmed_snapshot(listing: Listing) -> dict:
    snapshot = getattr(listing, "seller_review_snapshot", None)
    if not isinstance(snapshot, dict):
        return {}
    confirmed = snapshot.get("seller_confirmed")
    return confirmed if isinstance(confirmed, dict) else {}


def _fmt_card(listing: Listing, seller_verified: bool = False) -> dict:
    """Minimal format for browse/search listing cards — includes seller_verified for UI badge."""
    listing_verified = _listing_verified(listing)
    listing_trust_label, trust_tier = _listing_trust_label(listing)
    seller_trust_label = "KYC verified" if seller_verified else "Seller self-listed"
    seller_confirmed = _seller_confirmed_snapshot(listing)
    card_images = _card_image_urls(listing)
    return {
        "id": str(listing.id),
        "title": listing.title,
        "price": str(listing.price),
        "condition": listing.condition,
        "status": listing.status,
        "city": listing.city,
        "locality": listing.locality,
        "category_id": str(listing.category_id),
        "category_slug": _category_slug(listing),
        "image_urls": card_images,
        "thumbnail_url": card_images[0] if card_images else None,
        "view_count": listing.view_count,
        "seller_verified": seller_verified,
        "seller_trust_label": seller_trust_label,
        "listing_verified": listing_verified,
        "listing_trust_label": listing_trust_label,
        "trust_tier": trust_tier,
        "ai_assisted": bool(getattr(listing, "ai_draft_id", None)),
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
        "hygiene_status": listing.hygiene_status,
        "accessories": listing.accessories,
        "warranty_info": listing.warranty_info,
        "warranty_status": listing.warranty_info,
        "battery_health": listing.battery_health,
        "has_box": getattr(listing, "has_box", None),
        "has_bill": getattr(listing, "has_bill", None),
        "has_charger": getattr(listing, "has_charger", None),
        "has_earphones": getattr(listing, "has_earphones", None),
        "water_damage_history": getattr(listing, "water_damage_history", None),
        "seller_functional_attestation": getattr(listing, "seller_functional_attestation", None),
        "category_family": seller_confirmed.get("category_family"),
        "category_specifics": seller_confirmed.get("category_specifics"),
        "published_at": _iso_or_none(getattr(listing, "published_at", None)),
        "created_at": _iso_or_none(getattr(listing, "created_at", None)),
        "listing_state": getattr(listing, "listing_state", None),
        "verification_status": getattr(listing, "verification_status", None),
        "imei_verified": getattr(listing, "verification_status", None) == "verified",
        "video_url": getattr(listing, "video_url", None),
        "listing_source": listing.listing_source,
        "reviewed_by": listing.reviewed_by,
        "verified_by_owmee": listing_verified,
        # Sprint trust pillar: items >₹1000 get FE inspection at pickup;
        # mobile uses this flag to show the right copy on listing detail.
        "fe_inspection_required": _fe_inspection_required(listing.price),
    }


def _fmt_detail(listing: Listing, seller: User | None, avg_rating: float | None, deal_count: int) -> dict:
    """Full format for listing detail page — all metadata visible above fold."""
    verified = _seller_verified(listing, seller)
    base = _fmt_card(listing, seller_verified=verified)
    base.update({
        "description": listing.description,
        "image_urls": _detail_image_urls(listing),
        "state": listing.state,
        "moderation_status": listing.moderation_status,
        # UI v3 metadata
        "accessories": listing.accessories,
        "warranty_info": listing.warranty_info,
        "warranty_status": listing.warranty_info,
        "battery_health": listing.battery_health,
        "hygiene_status": listing.hygiene_status,
        # Sprint 4 / Pass 3: kids safety checklist
        "kids_safety_checklist": listing.kids_safety_checklist,
        # Seller info embedded — no second fetch needed from UI
        "seller": {
            "id": str(seller.id) if seller else None,
            "trust_score": seller.trust_score if seller else None,
            # Sprint 6a: both fields use the snapshot+live formula so card
            # and detail cannot disagree when KYC enters re_verification_required.
            "kyc_verified": verified,
            "verified_by_owmee": verified,
            "avg_rating": round(avg_rating, 1) if avg_rating else None,
            "deal_count": deal_count,
        } if seller else None,
    })
    return base


def _seller_inventory_from_transaction(listing: Listing, txn: Transaction | None) -> dict:
    if not txn:
        if listing.status == "active":
            return {
                "seller_inventory_status": "available",
                "seller_inventory_label": "Active",
                "seller_inventory_detail": "Available for buyers",
                "seller_next_action": "manage_listing",
            }
        if listing.status == "sold":
            return {
                "seller_inventory_status": "sold",
                "seller_inventory_label": "Sold",
                "seller_inventory_detail": "Sale completed",
                "seller_next_action": "none",
            }
        if listing.status == "sold_elsewhere":
            return {
                "seller_inventory_status": "sold_elsewhere",
                "seller_inventory_label": "Sold elsewhere",
                "seller_inventory_detail": "Removed from buyer discovery",
                "seller_next_action": "none",
            }
        if listing.status == "reserved":
            return {
                "seller_inventory_status": "reserved",
                "seller_inventory_label": "Reserved",
                "seller_inventory_detail": "Order is being prepared",
                "seller_next_action": "none",
            }
        return {
            "seller_inventory_status": listing.status,
            "seller_inventory_label": listing.status.replace("_", " ").title(),
            "seller_inventory_detail": None,
            "seller_next_action": "none",
        }

    base = {
        "active_transaction_id": str(txn.id),
        "active_transaction_status": txn.status,
        "seller_readiness_status": txn.seller_readiness_status,
    }
    if txn.status == "payment_pending":
        return {
            **base,
            "seller_inventory_status": "payment_pending",
            "seller_inventory_label": "Payment pending",
            "seller_inventory_detail": "Buyer is paying. Item is hidden from marketplace.",
            "seller_next_action": "open_order",
        }
    if txn.status == "payment_capture_uncertain":
        return {
            **base,
            "seller_inventory_status": "payment_review",
            "seller_inventory_label": "Payment review",
            "seller_inventory_detail": "Owmee is checking this payment before pickup.",
            "seller_next_action": "open_order",
        }
    if txn.status == "payment_captured":
        if txn.seller_readiness_status == "pending":
            return {
                **base,
                "seller_inventory_status": "seller_action_required",
                "seller_inventory_label": "Paid - confirm pickup",
                "seller_inventory_detail": "Buyer paid. Confirm item availability.",
                "seller_next_action": "confirm_pickup",
            }
        if txn.seller_readiness_status == "confirmed":
            return {
                **base,
                "seller_inventory_status": "pickup_pending",
                "seller_inventory_label": "Pickup pending",
                "seller_inventory_detail": "Owmee will collect and inspect the item.",
                "seller_next_action": "open_order",
            }
        return {
            **base,
            "seller_inventory_status": "payment_captured",
            "seller_inventory_label": "Payment captured",
            "seller_inventory_detail": "Owmee is preparing the next step.",
            "seller_next_action": "open_order",
        }
    if txn.status in {"at_hub", "delivery_in_progress"}:
        return {
            **base,
            "seller_inventory_status": "in_logistics",
            "seller_inventory_label": "In Owmee logistics",
            "seller_inventory_detail": "Item collected. Delivery is in progress.",
            "seller_next_action": "open_order",
        }
    if txn.status == "delivered":
        return {
            **base,
            "seller_inventory_status": "delivered_waiting_buyer",
            "seller_inventory_label": "Delivered",
            "seller_inventory_detail": "Waiting for buyer confirmation or auto-complete.",
            "seller_next_action": "open_order",
        }
    if txn.status in {"completed", "auto_completed"}:
        return {
            **base,
            "seller_inventory_status": "sold",
            "seller_inventory_label": "Sold via Owmee",
            "seller_inventory_detail": "Sale completed. Payout processing continues as applicable.",
            "seller_next_action": "open_order",
            "sold_at": _iso_or_none(txn.completed_at),
        }
    if txn.status in {"cancelled", "refunded", "pickup_rejected"}:
        if listing.status == "active":
            return {
                **base,
                "seller_inventory_status": "available",
                "seller_inventory_label": "Active",
                "seller_inventory_detail": "Previous order ended. Available for buyers.",
                "seller_next_action": "manage_listing",
            }
        return {
            **base,
            "seller_inventory_status": listing.status,
            "seller_inventory_label": listing.status.replace("_", " ").title(),
            "seller_inventory_detail": "Order ended.",
            "seller_next_action": "open_order",
        }
    return {
        **base,
        "seller_inventory_status": txn.status,
        "seller_inventory_label": txn.status.replace("_", " ").title(),
        "seller_inventory_detail": "Open the order for details.",
        "seller_next_action": "open_order",
    }


_SELLER_INVENTORY_TRANSACTION_STATUSES = (
    "payment_pending",
    "payment_capture_uncertain",
    "payment_captured",
    "at_hub",
    "delivery_in_progress",
    "delivered",
    "completed",
    "auto_completed",
    "cancelled",
    "refunded",
    "pickup_rejected",
)


async def _seller_inventory_transactions_by_listing(
    db: DBSession,
    seller_id: UUID,
    listing_ids: list[UUID],
) -> dict[UUID, Transaction]:
    if not listing_ids:
        return {}
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.seller_id == seller_id,
            Transaction.listing_id.in_(listing_ids),
            Transaction.status.in_(_SELLER_INVENTORY_TRANSACTION_STATUSES),
        )
        .order_by(Transaction.created_at.desc())
    )
    by_listing: dict[UUID, Transaction] = {}
    for txn in result.scalars().all():
        by_listing.setdefault(txn.listing_id, txn)
    return by_listing


def _fmt_my(listing: Listing, active_transaction: Transaction | None = None) -> dict:
    """My listings — all statuses including drafts."""
    card_images = _card_image_urls(listing)
    data = {
        "id": str(listing.id),
        "title": listing.title,
        "price": str(listing.price),
        "condition": listing.condition,
        "status": listing.status,
        "moderation_status": listing.moderation_status,
        "city": listing.city,
        "category_id": str(listing.category_id),
        "category_slug": _category_slug(listing),
        "image_urls": card_images,
        "thumbnail_url": card_images[0] if card_images else None,
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
        "age_suitability": listing.age_suitability,
        "hygiene_status": listing.hygiene_status,
        "accessories": listing.accessories,
        "warranty_info": listing.warranty_info,
        "warranty_status": listing.warranty_info,
        "battery_health": listing.battery_health,
        "has_box": getattr(listing, "has_box", None),
        "has_bill": getattr(listing, "has_bill", None),
        "has_charger": getattr(listing, "has_charger", None),
        "has_earphones": getattr(listing, "has_earphones", None),
        "water_damage_history": getattr(listing, "water_damage_history", None),
        "seller_functional_attestation": getattr(listing, "seller_functional_attestation", None),
        "listing_source": listing.listing_source,
        "reviewed_by": listing.reviewed_by,
        "created_at": _iso_or_none(getattr(listing, "created_at", None)),
        "published_at": _iso_or_none(getattr(listing, "published_at", None)),
        "listing_state": getattr(listing, "listing_state", None),
        "verification_status": getattr(listing, "verification_status", None),
        "imei_verified": getattr(listing, "verification_status", None) == "verified",
        "video_url": getattr(listing, "video_url", None),
        # Concierge Phase 4 timeline grouping pointer.
        "created_via_fe_visit_id": (
            str(listing.created_via_fe_visit_id)
            if listing.created_via_fe_visit_id
            else (str(listing.fe_visit_id) if listing.fe_visit_id else None)
        ),
    }
    data.update(_seller_inventory_from_transaction(listing, active_transaction))
    return data


# ── Helper: get seller rating + deal count ─────────────────────────────────────

async def _seller_stats(db: DBSession, seller_id: UUID) -> tuple[float | None, int]:
    ratings_result = await db.execute(
        select(func.avg(Rating.stars)).where(Rating.ratee_id == seller_id)
    )
    avg = ratings_result.scalar()

    deals_result = await db.execute(
        select(func.count(Transaction.id)).where(
            Transaction.seller_id == seller_id,
            Transaction.status.in_(["completed", "auto_completed"]),
        )
    )
    deal_count = deals_result.scalar() or 0
    return float(avg) if avg is not None else None, int(deal_count)


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
    query = select(Listing).options(selectinload(Listing.category)).where(Listing.status == "active")
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
        Listing.seller_kyc_verified_at_listing_time.desc(),  # Sprint 6a: verified sellers rank higher
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
        "listings": [
            _fmt_card(l, seller_verified=_seller_verified(l, sellers.get(l.seller_id)))
            for l in listings
        ],
        "count": len(listings),
        "offset": offset,
        "limit": limit,
    }


@router.get("/me")
async def seller_dashboard(current_user: VerifiedUser, db: DBSession):
    listings_result = await db.execute(
        select(Listing).options(selectinload(Listing.category)).where(Listing.seller_id == current_user.user_id)
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
            or_(
                Transaction.status.in_(["completed", "auto_completed"]),
                Transaction.payout_flagged_at.is_not(None),
            ),
        )
    )
    seller_txns = txn_result.scalars().all()
    completed_txns = [t for t in seller_txns if t.status in ("completed", "auto_completed")]

    ratings_result = await db.execute(select(Rating).where(Rating.ratee_id == current_user.user_id))
    ratings = ratings_result.scalars().all()

    total_earnings = sum(float(t.net_payout or 0) for t in completed_txns)
    payout_pending = sum(
        float(t.net_payout or 0) for t in seller_txns
        if t.payout_flagged_at and not t.payout_released_at
    )
    avg_rating = round(sum(r.stars for r in ratings) / len(ratings), 1) if ratings else None
    txn_by_listing = await _seller_inventory_transactions_by_listing(
        db,
        current_user.user_id,
        [l.id for l in listings],
    )
    status_counts = {}
    inventory_status_counts = {}
    for l in listings:
        status_counts[l.status] = status_counts.get(l.status, 0) + 1
        inventory_status = _seller_inventory_from_transaction(
            l,
            txn_by_listing.get(l.id),
        )["seller_inventory_status"]
        inventory_status_counts[inventory_status] = inventory_status_counts.get(inventory_status, 0) + 1

    return {
        "seller_id": str(current_user.user_id),
        "stats": {
            "total_listings": len(listings),
            "listings_by_status": status_counts,
            "total_views": sum(l.view_count for l in listings),
            "inventory_by_status": inventory_status_counts,
            "pending_offers": len(pending_offers),
            "completed_deals": len(completed_txns),
            "total_earnings": total_earnings,
            "payout_pending": payout_pending,
            "avg_rating": avg_rating,
            "ratings_count": len(ratings),
        },
        "listings": [_fmt_my(l, txn_by_listing.get(l.id)) for l in listings],
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
    query = select(Listing).options(selectinload(Listing.category)).where(Listing.seller_id == current_user.user_id)
    if status_filter:
        query = query.where(Listing.status == status_filter)
    result = await db.execute(query.order_by(Listing.created_at.desc()))
    listings = result.scalars().all()
    txn_by_listing = await _seller_inventory_transactions_by_listing(
        db,
        current_user.user_id,
        [l.id for l in listings],
    )
    return {
        "listings": [_fmt_my(l, txn_by_listing.get(l.id)) for l in listings],
        "count": len(listings),
    }


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_by_user("listing_create", LISTING_CREATE_PER_USER))],
)
async def create_listing(body: CreateListingRequest, current_user: BasicUser, db: DBSession):
    result = await db.execute(select(Category).where(Category.id == body.category_id))
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=400, detail={"error": "CATEGORY_NOT_FOUND"})
    category_family, category_specifics, kids_checklist = _clean_manual_category_specifics(category.slug, body)
    category_rejection = _manual_category_specifics_rejection(
        category_slug=category.slug,
        family=category_family,
        specifics=category_specifics,
        kids_checklist=kids_checklist,
        body=body,
    )
    if category_rejection:
        raise HTTPException(status_code=400, detail=category_rejection)
    normalized_imei = body.imei.strip() if body.imei else None
    imei_verification_status = None
    if category.imei_required and not normalized_imei:
        raise HTTPException(status_code=400, detail={
            "error": "IMEI_REQUIRED",
            "message": f"IMEI is required for {category.name} listings.",
        })
    if normalized_imei:
        if not normalized_imei.isdigit() or len(normalized_imei) != 15:
            raise HTTPException(status_code=400, detail={
                "error": "IMEI_INVALID",
                "message": "IMEI must be exactly 15 digits.",
            })
        if not ceir_client.luhn_valid(normalized_imei):
            raise HTTPException(status_code=400, detail={
                "error": "IMEI_LUHN_FAILED",
                "message": "IMEI checksum failed. Please recheck the digits on the device or box.",
            })
        dup = await db.execute(
            select(Listing.id)
            .where(
                or_(
                    Listing.imei_1 == normalized_imei,
                    Listing.imei_2 == normalized_imei,
                    Listing.imei_hash == hash_imei(normalized_imei),
                ),
                Listing.status.in_(_IMEI_LOCK_STATUSES),
            )
            .limit(1)
        )
        if dup.scalar() is not None:
            raise HTTPException(status_code=409, detail={
                "error": "IMEI_ALREADY_LISTED",
                "imei": normalized_imei,
                "message": "This IMEI is already on an active Owmee listing.",
            })
        ceir = await ceir_client.check(normalized_imei)
        if ceir.get("status") == "blacklisted":
            raise HTTPException(status_code=400, detail={"error": "IMEI_BLACKLISTED"})
        imei_verification_status = "verified" if ceir.get("status") == "clean" else "pending"

    # Sprint trust pillar: enforce hyperlocal pilot zones. Without lat/lng
    # we can't route an FE; without the address being inside a zone, FE
    # economics break. Block at create time with a friendly out-of-service
    # message rather than silently degrade later.
    from app.core.zones import is_in_service_area, out_of_service_message
    if not is_in_service_area(body.lat, body.lng):
        raise HTTPException(status_code=400, detail=out_of_service_message())
    try:
        listing = await create_draft(
            db=db, seller_id=current_user.user_id,
            category_id=body.category_id, title=body.title,
            description=body.description, price=body.price,
            condition=body.condition, city=body.city, state=body.state,
            locality=body.locality, imei=normalized_imei, lat=body.lat, lng=body.lng,
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
        if normalized_imei:
            listing.imei_1 = normalized_imei
            listing.verification_status = imei_verification_status
        # Sprint 4 / Pass 3
        listing.kids_safety_checklist = kids_checklist
        # P1 (2026-05-03) — listing-quality floor
        listing.has_box = body.has_box
        listing.has_bill = body.has_bill
        listing.has_charger = body.has_charger
        listing.has_earphones = body.has_earphones
        listing.min_acceptable_price = body.min_acceptable_price
        listing.water_damage_history = body.water_damage_history
        listing.seller_functional_attestation = body.seller_functional_attestation
        listing.seller_review_snapshot = {
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
            "source": "manual_listing",
            "seller_confirmed": {
                "category_slug": category.slug,
                "category_family": category_family,
                "category_specifics": category_specifics,
                "title": body.title,
                "condition": body.condition,
                "price": float(body.price),
                "brand": body.brand,
                "model": body.model,
                "age_suitability": body.age_suitability,
                "hygiene_status": body.hygiene_status,
                "kids_safety_checklist": kids_checklist,
                "has_box": body.has_box,
                "has_bill": body.has_bill,
                "has_charger": body.has_charger,
                "has_earphones": body.has_earphones,
                "water_damage_history": body.water_damage_history,
                "seller_functional_attestation": body.seller_functional_attestation,
            },
        }
        # Sprint 6a: snapshot seller KYC state at listing creation
        listing.seller_kyc_verified_at_listing_time = (
            getattr(current_user, "kyc_status", None) == "verified"
        )
        # Sprint 7 / Phase 1: snapshot seller's community_id onto the listing
        # at create time. Denormalizes for fast feed filtering and locks the
        # listing's community even if the seller later changes communities.
        seller_res = await db.execute(select(User).where(User.id == current_user.user_id))
        seller_user = seller_res.scalar_one_or_none()
        if seller_user and seller_user.community_id:
            listing.community_id = seller_user.community_id
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
    processed = process_listing_image(body.r2_key)
    display_key = processed.display_key or body.r2_key
    image.r2_key_medium = processed.display_key
    image.r2_key_thumb = processed.thumbnail_key

    current_urls = listing.image_urls or []
    if display_key not in current_urls:
        listing.image_urls = current_urls + [display_key]

    # Synchronous catalog polish at upload-confirm time. It adds a little
    # latency once, but every feed/detail view gets denoised WebP variants.
    if processed.thumbnail_key and (body.is_primary or not listing.thumbnail_url):
        listing.thumbnail_url = processed.thumbnail_key
    elif body.is_primary:
        listing.thumbnail_url = display_key

    await db.commit()
    return {"image_id": str(image.id), "r2_key": body.r2_key,
            "display_key": processed.display_key,
            "thumbnail_key": processed.thumbnail_key,
            "public_url": public_url(body.r2_key), "moderation_status": "pending"}


@router.post("/{listing_id}/publish")
async def publish(listing_id: UUID, current_user: BasicUser, db: DBSession):
    # Sprint 6a — KYC is the badge, not the gate. publish was missed in the
    # initial pass and kept on VerifiedUser, which paired with creation
    # being BasicUser-gated meant unverified sellers could create drafts
    # but could not actually publish them.
    draft_result = await db.execute(
        select(Listing)
        .options(selectinload(Listing.category))
        .where(Listing.id == listing_id, Listing.seller_id == current_user.user_id)
    )
    draft = draft_result.scalar_one_or_none()
    if draft is not None and draft.status == "draft":
        category_slug = draft.category.slug if draft.category else None
        policy = await evaluate_user_action(
            db,
            user_id=current_user.user_id,
            action=ACTION_PUBLISH_LISTING,
            context={"price": draft.price, "category_slug": category_slug},
        )
        if not policy.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=policy.to_error_detail(),
            )

    try:
        listing = await publish_listing(db, listing_id, current_user.user_id)
        await db.commit()
    except ValueError as e:
        code = str(e)
        if code.startswith("INVALID_STATUS:"):
            raise HTTPException(status_code=400, detail={"error": "INVALID_STATUS"})
        if code.startswith("MIN_PHOTOS_REQUIRED:"):
            parts = code.split(":")
            have = int(parts[1])
            raise HTTPException(status_code=400, detail=_min_photo_detail(have))
        if code == "NO_IMAGES":
            raise HTTPException(status_code=400, detail=_min_photo_detail(0))
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
    community_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    query = select(Listing).options(selectinload(Listing.category)).where(Listing.status == "active")
    # Sprint 7 / Phase 1: community-scoped browse
    if current_user and community_only:
        cu_res = await db.execute(select(User).where(User.id == current_user.user_id))
        cu = cu_res.scalar_one_or_none()
        if cu and cu.community_id:
            query = query.where(Listing.community_id == cu.community_id)
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
        "listings": [
            _fmt_card(l, seller_verified=_seller_verified(l, sellers.get(l.seller_id)))
            for l in listings
        ],
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

    # Sprint 6a: batch-fetch sellers so the badge actually renders here too.
    seller_ids = list({l.seller_id for l in listings})
    sellers: dict = {}
    if seller_ids:
        sr = await db.execute(select(UserModel).where(UserModel.id.in_(seller_ids)))
        for s in sr.scalars().all():
            sellers[s.id] = s

    return {
        "since": last_seen.isoformat(),
        "count": len(listings),
        "listings": [
            _fmt_card(l, seller_verified=_seller_verified(l, sellers.get(l.seller_id)))
            for l in listings
        ],
        "label": f"{len(listings)} new listing{'s' if len(listings) != 1 else ''} since your last visit" if listings else "You're all caught up",
    }



# ── Concierge Phase 3: expert pricing panel ─────────────────────────────────
#
# REGISTERED BEFORE /{listing_id} so FastAPI's path matcher doesn't
# shadow this route. Adding new static endpoints under /v1/listings/
# requires the same precaution.

from sqlalchemy import text  # noqa: E402
from app.core.fe_dependencies import FEUser  # noqa: E402


class PriceSuggestionResponse(BaseModel):
    """Master spec section 6.6.

    Progressive filter widening: try exact (category + brand + model +
    condition) first, then drop condition, then drop model. If even the
    loosest match returns < 5 rows, all price fields come back null and
    the FE app shows "No similar items in last 60 days. Use your
    judgment." instead of the panel.
    """
    match_count: int
    match_quality: str  # exact | category_brand_model | category_brand_only | no_match
    p25: Optional[int] = None
    median: Optional[int] = None
    p75: Optional[int] = None
    avg_days_to_sell: Optional[float] = None
    suggested: Optional[int] = None
    faster_sell_price: Optional[int] = None
    premium_price: Optional[int] = None


_PRICE_QUERY = """
    WITH matches AS (
        SELECT
            t.gross_amount - COALESCE(t.delivery_fee, 0) AS sale_price,
            t.completed_at,
            l.published_at
        FROM transactions t
        JOIN listings l ON l.id = t.listing_id
        WHERE l.category_id = :category_id
          AND l.brand ILIKE :brand_pattern
          {extra}
          AND t.status = 'completed'
          AND t.completed_at IS NOT NULL
          AND t.completed_at > NOW() - INTERVAL '60 days'
        LIMIT 100
    )
    SELECT
        count(*) AS match_count,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY sale_price) AS p25,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY sale_price) AS median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY sale_price) AS p75,
        AVG(EXTRACT(EPOCH FROM (completed_at - published_at)) / 86400.0) AS avg_days
    FROM matches
"""


@router.get("/price-suggestion", response_model=PriceSuggestionResponse)
async def price_suggestion(
    db: DBSession,
    current_user: FEUser,
    category_id: UUID = Query(...),
    brand: str = Query(..., min_length=1),
    model: Optional[str] = Query(None),
    condition: Optional[str] = Query(None),
):
    """Specialist pricing panel data — master spec section 6.3.

    FE-only access (specialists running the visit). Each call tries
    increasingly-loose filters until match_count >= 5; if even the
    loosest filter returns < 5, response carries match_count=0 and the
    UI hides the panel.

    The reported sale price is gross_amount minus delivery_fee, i.e.
    what the seller-comparable item actually went for.
    """
    base_params = {
        "category_id": str(category_id),
        "brand_pattern": f"%{brand}%",
    }

    filters: list[tuple[str, str, dict]] = []
    if model and condition:
        filters.append((
            "AND l.model ILIKE :model_pattern AND l.condition = :condition",
            "exact",
            {**base_params, "model_pattern": f"%{model}%", "condition": condition},
        ))
    if model:
        filters.append((
            "AND l.model ILIKE :model_pattern",
            "category_brand_model",
            {**base_params, "model_pattern": f"%{model}%"},
        ))
    filters.append(("", "category_brand_only", base_params))

    for extra_sql, quality, params in filters:
        sql = _PRICE_QUERY.format(extra=extra_sql)
        res = await db.execute(text(sql), params)
        row = res.first()
        if row is None or row.match_count is None:
            continue
        if int(row.match_count) >= 5:
            p25 = int(row.p25)
            median = int(row.median)
            p75 = int(row.p75)
            return PriceSuggestionResponse(
                match_count=int(row.match_count),
                match_quality=quality,
                p25=p25,
                median=median,
                p75=p75,
                avg_days_to_sell=float(row.avg_days) if row.avg_days else None,
                suggested=median,
                faster_sell_price=int(round(p25 + (median - p25) * 0.5)),
                premium_price=int(round(median + (p75 - median) * 0.5)),
            )

    return PriceSuggestionResponse(
        match_count=0,
        match_quality="no_match",
    )


@router.get("/{listing_id}")
async def get_listing(listing_id: UUID, db: DBSession, current_user: OptionalUser = None):
    result = await db.execute(
        select(Listing).options(selectinload(Listing.category)).where(Listing.id == listing_id)
    )
    listing = result.scalar_one_or_none()
    if not listing or not _can_view_listing_detail(listing, current_user):
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


# Structured reason set captured at soft-delete time. Drives the
# product-analytics dashboard ("X% of listings removed because no_buyers")
# without leaking PII into free-text. UI offers these as chips; "other"
# is the catch-all.
_VALID_DELETION_REASONS = {
    "sold_elsewhere",
    "changed_mind",
    "wrong_price",
    "no_buyers",
    "item_damaged",
    "other",
}


class DeleteListingRequest(BaseModel):
    """Optional body — old clients that send DELETE without a body still
    work; the new mobile UI sends a reason for analytics."""
    reason: Optional[str] = None
    note: Optional[str] = Field(None, max_length=500)


@router.delete("/{listing_id}", status_code=status.HTTP_200_OK)
async def delete_listing(
    listing_id: UUID,
    current_user: BasicUser,
    db: DBSession,
    body: DeleteListingRequest | None = None,
):
    """Seller soft-deletes their own listing.

    Cascade rules — all idempotent so a retry never errors:
      1. Active offers (pending / countered) auto-decline with
         reason 'listing_withdrawn' so buyers see "seller withdrew"
         instead of a silent disappearance.
      2. Any concierge FE visit linked to this listing that's still
         in `requested` or `scheduled` is auto-cancelled. Visits
         already `in_progress` block the delete (see hard-block
         below) — the FE is at the door, the seller can't pull the
         rug.
      3. Wishlists (FK ondelete=CASCADE) and listing_images (cascade
         all, delete-orphan) are handled at the DB layer for free.

    Hard blocks (return 400 CANNOT_DELETE):
      - status in {reserved, sold}: a transaction is in flight,
        deleting would orphan a buyer's funds. Seller must wait or
        cancel via the order flow.
      - any FE visit linked to this listing with status='in_progress'.

    Idempotency: status='removed' listings return 200 with an empty
    cascade summary so the second tap from a flaky network doesn't
    dialog "already gone".
    """
    result = await db.execute(select(Listing).where(
        Listing.id == listing_id, Listing.seller_id == current_user.user_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})

    # Idempotency: already removed → no-op success.
    if listing.status == "removed":
        return {
            "listing_id": str(listing.id),
            "status": "removed",
            "offers_cancelled": 0,
            "visits_cancelled": 0,
            "message": "Listing was already removed.",
        }

    if listing.status in ("reserved", "sold"):
        raise HTTPException(status_code=400, detail={
            "error": "CANNOT_DELETE",
            "message": "An order is already in progress for this listing. "
                       "Cancel the order from your sales tab first.",
        })

    # Validate reason (optional — old client sends nothing, accepted).
    reason = (body.reason if body else None)
    if reason and reason not in _VALID_DELETION_REASONS:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_REASON",
            "valid": sorted(_VALID_DELETION_REASONS),
        })

    # Block delete if a concierge FE visit for this listing is in_progress.
    # SET NULL fk + ondelete on listings.fe_visit_id means the link
    # survives even if the listing is removed; we explicitly check status
    # for the in-flight case.
    from sqlalchemy import text as _sql
    in_progress = await db.execute(
        _sql(
            "SELECT id FROM fe_visits WHERE listing_id = :lid "
            "AND status = 'in_progress' LIMIT 1"
        ),
        {"lid": listing_id},
    )
    if in_progress.first() is not None:
        raise HTTPException(status_code=400, detail={
            "error": "VISIT_IN_PROGRESS",
            "message": "Your concierge specialist is at the door for this "
                       "item. Please complete or cancel that visit first.",
        })

    # ── Cascade 1: auto-decline open offers ───────────────────────────────
    open_offers_q = await db.execute(
        select(Offer).where(
            Offer.listing_id == listing_id,
            Offer.status.in_(["pending", "countered"]),
        )
    )
    open_offers = open_offers_q.scalars().all()
    from app.modules.offers.service import _notify
    for off in open_offers:
        off.status = "cancelled"
        off.reject_reason = "listing_withdrawn"
        try:
            await _notify(
                db, off.buyer_id, "listing_withdrawn",
                "Item no longer available",
                f"'{listing.title[:40]}' was removed by the seller. "
                f"Browse similar listings.",
                "listing", str(listing_id),
            )
        except Exception:
            pass

    # ── Cascade 2: auto-cancel pending/scheduled FE visits ───────────────
    pending_visits = await db.execute(
        _sql(
            "SELECT id, fe_id, status FROM fe_visits "
            "WHERE listing_id = :lid AND status IN ('requested', 'scheduled')"
        ),
        {"lid": listing_id},
    )
    visit_rows = list(pending_visits.fetchall())
    for v in visit_rows:
        await db.execute(
            _sql(
                "UPDATE fe_visits SET status = 'cancelled', "
                "outcome_reason = :r, completed_at = NOW(), "
                "cancellation_reason = 'no_longer_selling' "
                "WHERE id = :id"
            ),
            {"r": "listing_withdrawn", "id": v.id},
        )

    # ── Soft-delete the listing itself ───────────────────────────────────
    listing.status = "removed"
    # Use raw SQL to set the new columns so the model attribute presence
    # isn't a hard requirement until the migration is applied.
    from datetime import datetime as _dt, timezone as _tz
    await db.execute(
        _sql(
            "UPDATE listings SET deletion_reason = :r, deleted_at = :t "
            "WHERE id = :id"
        ),
        {"r": reason, "t": _dt.now(_tz.utc), "id": listing_id},
    )

    await db.commit()
    logger.info(
        "listing.deleted",
        listing_id=str(listing_id),
        seller_id=str(current_user.user_id),
        reason=reason,
        offers_cancelled=len(open_offers),
        visits_cancelled=len(visit_rows),
    )
    return {
        "listing_id": str(listing.id),
        "status": "removed",
        "offers_cancelled": len(open_offers),
        "visits_cancelled": len(visit_rows),
        "message": "Listing removed.",
    }


# Concierge Phase 3 endpoints have been moved above /{listing_id} so
# FastAPI's path matcher doesn't shadow them. See the price_suggestion
# route declared earlier in this file.
