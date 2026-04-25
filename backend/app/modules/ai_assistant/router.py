"""AI-Assisted Listing router — Sprint 8 Phase 2.

Seven endpoints power the photo-first flow:
    POST   /v1/listings/draft/from-image
    POST   /v1/listings/draft/{draft_id}/extract-imei
    POST   /v1/listings/from-draft
    POST   /v1/listings/{id}/seller-info
    GET    /v1/listings/{id}/seller-info-needed
    PATCH  /v1/listings/{id}/ai
    POST   /v1/listings/{id}/regenerate-description

Notes:
    - All endpoints require basic phone-OTP auth (AuthUser). KYC is enforced
      later, at payout.
    - The router is mounted under `/v1` so the `prefix` lives on each route.
    - Raw SQL via `text()` is used wherever Phase 2 columns are touched
      (verification_status, imei_1/2, listing_state, video_url, ai_draft_id),
      because the SQLAlchemy Listing model declares them only optionally
      depending on Phase 2 mobile rebuild ordering.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.types import String as SAString

from app.core.dependencies import AuthUser, DBSession
from app.core.storage import (
    generate_presigned_download_url,
    upload_bytes,
)
from app.modules.ai_assistant import (
    ceir_client,
    claude_client,
    price_estimator,
)
from app.modules.ai_assistant.schemas import (
    CreateFromDraftRequest,
    CreateFromDraftResponse,
    DraftFromImageResponse,
    EditListingRequest,
    EditListingResponse,
    ExtractIMEIResponse,
    RegenerateDescriptionResponse,
    SellerInfoNeededResponse,
    SellerInfoRequest,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/listings", tags=["ai-assistant"])


# ── Helpers ───────────────────────────────────────────────────────────────


# Categories that need an identifier (smartphones, laptops/tablets).
IDENTIFIER_CATEGORIES = {"smartphones", "laptops", "tablets"}

# Listing states that allow seller edits.
EDITABLE_STATES = {"draft_ai", "pending_buyer"}

# State at which video CTA appears.
VIDEO_PRICE_THRESHOLD = 5000


def _photo_object_key(user_id: UUID, draft_id: UUID, ext: str = "jpg") -> str:
    return f"ai-drafts/{user_id}/{draft_id}.{ext}"


async def _store_photo(image_bytes: bytes, content_type: str, user_id: UUID, draft_id: UUID) -> str:
    """Upload photo bytes via the existing storage helpers and return a URL.

    Uses upload_bytes() for the server-side write and generate_presigned_download_url()
    for a phone-reachable read URL. If storage is misconfigured we fall back
    to a sentinel string so the AI flow can still complete (photos can be
    re-uploaded by the mobile client via the existing image pipeline).
    """
    ext = "jpg"
    if content_type == "image/png":
        ext = "png"
    elif content_type == "image/webp":
        ext = "webp"

    key = _photo_object_key(user_id, draft_id, ext)

    try:
        upload_bytes(image_bytes, key, content_type=content_type)
    except Exception as e:
        log.warning("ai_assistant.photo_upload_failed", extra={"error": str(e), "key": key})
        return f"r2://{key}"

    try:
        return generate_presigned_download_url(key, expires_in=60 * 60 * 24 * 7)
    except Exception as e:
        log.warning("ai_assistant.presign_failed", extra={"error": str(e), "key": key})
        return f"r2://{key}"


def _category_needs_identifier(slug: str | None) -> bool:
    if not slug:
        return False
    return slug.lower() in IDENTIFIER_CATEGORIES


# ── 1. POST /v1/listings/draft/from-image ─────────────────────────────────


@router.post("/draft/from-image", response_model=DraftFromImageResponse)
async def draft_from_image(
    user: AuthUser,
    db: DBSession,
    image: UploadFile = File(...),
):
    """Multipart upload of a single photo. Runs Claude vision, computes
    a price suggestion, and stores a draft for 24 hours.

    The mobile client follows up with `POST /v1/listings/from-draft` once
    the seller confirms.
    """
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="EMPTY_IMAGE")
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="IMAGE_TOO_LARGE")

    content_type = image.content_type or "image/jpeg"
    draft_id = uuid4()

    # Store photo first (so the URL is valid for the response)
    photo_url = await _store_photo(image_bytes, content_type, user.user_id, draft_id)

    # Vision detection
    detected = await claude_client.detect_from_image(image_bytes, content_type)

    # Hard reject NSFW / personal info — don't even create the draft
    if "nsfw" in detected.flags or "personal_info" in detected.flags:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "PHOTO_REJECTED", "flags": detected.flags},
        )

    # Lookup user's state for region-aware comparables
    state_row = await db.execute(
        text("SELECT COALESCE(state, address_state, 'Karnataka') FROM users WHERE id = :uid"),
        {"uid": user.user_id},
    )
    s = state_row.scalar()
    user_state = s if s else "Karnataka"

    # Price estimate (best-effort — empty result is fine)
    fallback_reason = None
    price_result = await price_estimator.estimate_price(
        db,
        brand=detected.brand,
        model=detected.model,
        storage=detected.storage,
        condition=detected.condition_guess or "good",
        state=user_state,
        category_slug=detected.category_slug,
    )

    if price_result["source"] == "none":
        fallback_reason = price_result.get("reasoning")

    # Persist the draft. ai_response is JSONB; pass JSON string and CAST.
    await db.execute(
        text("""
            INSERT INTO listing_drafts (
                id, user_id, photo_urls, ai_response, suggested_price,
                comparables_count, ai_model, status
            )
            VALUES (
                :id, :uid, :photo_urls, CAST(:ai_response AS JSONB),
                :price, :ccount, :model, 'open'
            )
        """).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString))),
        {
            "id": draft_id,
            "uid": user.user_id,
            "photo_urls": [photo_url],
            "ai_response": detected.model_dump_json(),
            "price": price_result.get("price"),
            "ccount": price_result.get("comparables_count", 0),
            "model": "claude-vision",
        },
    )
    await db.commit()

    # Pull the row back for the response (specifically expires_at)
    drow = await db.execute(
        text("SELECT expires_at FROM listing_drafts WHERE id = :id"),
        {"id": draft_id},
    )
    expires_at = drow.scalar() or datetime.now(timezone.utc)

    return DraftFromImageResponse(
        draft_id=draft_id,
        photo_url=photo_url,
        detected=detected,
        suggested_price=price_result.get("price"),
        price_source=price_result["source"],
        comparables=price_result.get("comparables", []),
        expires_at=expires_at,
        needs_identifier=_category_needs_identifier(detected.category_slug),
        fallback_reason=fallback_reason,
    )


# ── 2. POST /v1/listings/draft/{draft_id}/extract-imei ────────────────────


@router.post("/draft/{draft_id}/extract-imei", response_model=ExtractIMEIResponse)
async def extract_imei(
    draft_id: UUID,
    user: AuthUser,
    db: DBSession,
    image: UploadFile = File(...),
):
    """Photo of an IMEI sticker → OCR + Luhn + CEIR check.

    The mobile client passes this draft through 1-2 attempts; if both
    fail it forces manual entry (suggest_manual=True returned).
    """
    # Verify draft ownership
    drow = await db.execute(
        text("SELECT user_id FROM listing_drafts WHERE id = :id"),
        {"id": draft_id},
    )
    owner = drow.scalar()
    if owner is None:
        raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND")
    if str(owner) != str(user.user_id):
        raise HTTPException(status_code=403, detail="DRAFT_NOT_OWNED")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="EMPTY_IMAGE")

    content_type = image.content_type or "image/jpeg"
    ocr = await claude_client.extract_imei(image_bytes, content_type)

    imei = ocr.get("imei")
    confidence = float(ocr.get("confidence") or 0.0)
    luhn_ok = ceir_client.luhn_valid(imei) if imei else False

    ceir_status = None
    if luhn_ok:
        ceir = await ceir_client.check(imei)
        ceir_status = ceir.get("status")
        if ceir_status == "blacklisted":
            raise HTTPException(
                status_code=400,
                detail={"error": "IMEI_BLACKLISTED", "imei": imei},
            )

    # Suggest manual after low-confidence or invalid Luhn
    suggest_manual = (not imei) or (confidence < 0.8) or (not luhn_ok)

    return ExtractIMEIResponse(
        imei=imei if luhn_ok else None,
        confidence=confidence,
        luhn_valid=luhn_ok,
        ceir_status=ceir_status,
        extracted_text=ocr.get("extracted_text"),
        suggest_manual=suggest_manual,
    )


# ── 3. POST /v1/listings/from-draft ───────────────────────────────────────


@router.post("/from-draft", response_model=CreateFromDraftResponse, status_code=201)
async def create_from_draft(
    payload: CreateFromDraftRequest,
    user: AuthUser,
    db: DBSession,
):
    """Convert a draft + final fields into a real listing in `pending_buyer`."""

    # Verify draft ownership and freshness
    drow = await db.execute(
        text("""
            SELECT user_id, photo_urls, expires_at, status
            FROM listing_drafts
            WHERE id = :id
        """),
        {"id": payload.draft_id},
    )
    rec = drow.first()
    if not rec:
        raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND")
    if str(rec.user_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="DRAFT_NOT_OWNED")
    if rec.expires_at and rec.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="DRAFT_EXPIRED")
    if rec.status != "open":
        raise HTTPException(status_code=400, detail="DRAFT_ALREADY_CONSUMED")

    # IMEI requirement check for smartphones
    if payload.category_slug.lower() == "smartphones" and not payload.imei_1:
        raise HTTPException(status_code=400, detail="IMEI_REQUIRED_FOR_SMARTPHONES")

    # Validate IMEI(s) if present — defence in depth
    for imei in (payload.imei_1, payload.imei_2):
        if imei and not ceir_client.luhn_valid(imei):
            raise HTTPException(
                status_code=400,
                detail={"error": "IMEI_LUHN_FAILED", "imei": imei},
            )

    # Resolve category_id from slug
    cat_row = await db.execute(
        text("SELECT id FROM categories WHERE slug = :slug AND is_active = true"),
        {"slug": payload.category_slug},
    )
    category_id = cat_row.scalar()
    if not category_id:
        raise HTTPException(status_code=400, detail={"error": "UNKNOWN_CATEGORY", "slug": payload.category_slug})

    # CEIR check (mock) for smartphone IMEIs
    verification_status = "pending"
    if payload.category_slug.lower() == "smartphones" and payload.imei_1:
        ceir = await ceir_client.check(payload.imei_1)
        if ceir["status"] == "clean":
            verification_status = "verified"
        elif ceir["status"] == "blacklisted":
            raise HTTPException(status_code=400, detail={"error": "IMEI_BLACKLISTED"})
        else:
            verification_status = "pending"

    # Pull seller's location for the listing's geo fields (best-effort)
    loc_row = await db.execute(
        text("SELECT lat, lng, city, state FROM users WHERE id = :uid"),
        {"uid": user.user_id},
    )
    loc = loc_row.first()
    seller_lat = loc.lat if loc else None
    seller_lng = loc.lng if loc else None
    seller_city = loc.city if loc else None
    seller_state = loc.state if loc else None

    # Combine draft photo URLs with any extra image URLs from the mobile client
    photo_urls = list(rec.photo_urls or [])
    if payload.image_urls:
        for u in payload.image_urls:
            if u not in photo_urls:
                photo_urls.append(u)

    listing_id = uuid4()

    # bindparam declares image_urls as TEXT[] so asyncpg sends a real
    # Postgres array (avoids string-literal escaping issues with URLs).
    insert_sql = text("""
        INSERT INTO listings (
            id, seller_id, category_id, title, description, price, condition,
            status, moderation_status, image_urls, thumbnail_url,
            brand, model, storage, color, serial_number,
            imei_1, imei_2, listing_state, verification_status, video_url,
            ai_draft_id, city, state, listing_source, reviewed_by,
            published_at
        )
        VALUES (
            :id, :seller_id, :category_id, :title, :description, :price, :condition,
            'active', 'pending', :image_urls, :thumb,
            :brand, :model, :storage, :color, :serial,
            :imei_1, :imei_2, 'pending_buyer', :verif, :video,
            :draft_id, :city, :state, 'self_prep', 'none',
            NOW()
        )
    """).bindparams(bindparam("image_urls", type_=PGARRAY(SAString)))

    await db.execute(
        insert_sql,
        {
            "id": listing_id,
            "seller_id": user.user_id,
            "category_id": category_id,
            "title": payload.title,
            "description": payload.description or "",
            "price": payload.price,
            "condition": payload.condition,
            "image_urls": photo_urls,
            "thumb": photo_urls[0] if photo_urls else None,
            "brand": payload.brand,
            "model": payload.model,
            "storage": payload.storage,
            "color": payload.color,
            "serial": payload.serial_number,
            "imei_1": payload.imei_1,
            "imei_2": payload.imei_2,
            "verif": verification_status,
            "video": payload.video_url,
            "draft_id": payload.draft_id,
            "city": seller_city,
            "state": seller_state,
        },
    )

    # Geo as a separate UPDATE (avoids parameter conflicts in INSERT)
    if seller_lat is not None and seller_lng is not None:
        await db.execute(
            text("UPDATE listings SET geo_point = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) WHERE id = :id"),
            {"lat": seller_lat, "lng": seller_lng, "id": listing_id},
        )

    # Mark the draft consumed
    await db.execute(
        text("UPDATE listing_drafts SET status = 'consumed' WHERE id = :id"),
        {"id": payload.draft_id},
    )

    await db.commit()

    return CreateFromDraftResponse(
        listing_id=listing_id,
        listing_state="pending_buyer",
        status="active",
        title=payload.title,
        price=payload.price,
    )


# ── 4. GET /v1/listings/{id}/seller-info-needed ───────────────────────────


@router.get("/{listing_id}/seller-info-needed", response_model=SellerInfoNeededResponse)
async def seller_info_needed(
    listing_id: UUID,
    user: AuthUser,
    db: DBSession,
):
    """Returns what info the seller still owes us, given the listing state.

    Address + accessories: required at buyer_committed.
    KYC: required before payout_eligible.
    """
    row = await db.execute(
        text("""
            SELECT
                l.seller_id,
                l.listing_state,
                l.accessories,
                u.address_full,
                u.kyc_status
            FROM listings l
            JOIN users u ON u.id = l.seller_id
            WHERE l.id = :id
        """),
        {"id": listing_id},
    )
    rec = row.first()
    if not rec:
        raise HTTPException(status_code=404, detail="LISTING_NOT_FOUND")
    if str(rec.seller_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="NOT_SELLER")

    state = rec.listing_state or "pending_buyer"

    return SellerInfoNeededResponse(
        pickup_address_needed=(state in ("buyer_committed", "pickup_scheduled")) and not rec.address_full,
        accessories_needed=(state in ("buyer_committed", "pickup_scheduled")) and not rec.accessories,
        payout_kyc_needed=(state in ("payout_eligible",)) and rec.kyc_status != "verified",
        listing_state=state,
    )


# ── 5. POST /v1/listings/{id}/seller-info ─────────────────────────────────


@router.post("/{listing_id}/seller-info", status_code=200)
async def update_seller_info(
    listing_id: UUID,
    payload: SellerInfoRequest,
    user: AuthUser,
    db: DBSession,
):
    """Progressive collection: pickup address, accessories list."""
    # Verify ownership
    own = await db.execute(
        text("SELECT seller_id, listing_state FROM listings WHERE id = :id"),
        {"id": listing_id},
    )
    rec = own.first()
    if not rec:
        raise HTTPException(status_code=404, detail="LISTING_NOT_FOUND")
    if str(rec.seller_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="NOT_SELLER")

    updates = []
    params: dict = {"id": listing_id}

    if payload.accessories is not None:
        updates.append("accessories = :accessories")
        params["accessories"] = payload.accessories

    if updates:
        await db.execute(
            text(f"UPDATE listings SET {', '.join(updates)} WHERE id = :id"),
            params,
        )

    # Address + pincode go on the user record (one address per user for MVP)
    user_updates = []
    user_params: dict = {"uid": user.user_id}

    if payload.pickup_address is not None:
        user_updates.append("address_full = :addr")
        user_params["addr"] = payload.pickup_address

    if payload.pickup_pincode is not None:
        user_updates.append("pincode = :pin")
        user_params["pin"] = payload.pickup_pincode

    if user_updates:
        await db.execute(
            text(f"UPDATE users SET {', '.join(user_updates)} WHERE id = :uid"),
            user_params,
        )

    await db.commit()
    return {"status": "ok", "listing_id": str(listing_id)}


# ── 6. PATCH /v1/listings/{id}/ai ─────────────────────────────────────────


@router.patch("/{listing_id}/ai", response_model=EditListingResponse)
async def edit_listing(
    listing_id: UUID,
    payload: EditListingRequest,
    user: AuthUser,
    db: DBSession,
):
    """Post-publish edit. State-locked: only editable when listing_state
    is in EDITABLE_STATES. Returns 200 with locked_reason if not editable.
    """
    row = await db.execute(
        text("""
            SELECT seller_id, listing_state, status
            FROM listings WHERE id = :id
        """),
        {"id": listing_id},
    )
    rec = row.first()
    if not rec:
        raise HTTPException(status_code=404, detail="LISTING_NOT_FOUND")
    if str(rec.seller_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="NOT_SELLER")

    listing_state = rec.listing_state or "pending_buyer"
    # `pending_buyer` is treated as the default editable state for legacy
    # listings that pre-date Phase 2.
    if listing_state not in EDITABLE_STATES:
        return EditListingResponse(
            listing_id=listing_id,
            updated_fields=[],
            listing_state=listing_state,
            locked_reason=f"Listing is in state '{listing_state}' — fields cannot be edited.",
        )

    field_map = {
        "title": payload.title,
        "description": payload.description,
        "price": payload.price,
        "condition": payload.condition,
        "brand": payload.brand,
        "model": payload.model,
        "storage": payload.storage,
        "color": payload.color,
        "accessories": payload.accessories,
    }
    updates = {k: v for k, v in field_map.items() if v is not None}

    if not updates:
        return EditListingResponse(
            listing_id=listing_id,
            updated_fields=[],
            listing_state=listing_state,
        )

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    params = {**updates, "id": listing_id}
    await db.execute(text(f"UPDATE listings SET {set_clause} WHERE id = :id"), params)
    await db.commit()

    return EditListingResponse(
        listing_id=listing_id,
        updated_fields=list(updates.keys()),
        listing_state=listing_state,
    )


# ── 7. POST /v1/listings/{id}/regenerate-description ──────────────────────


@router.post("/{listing_id}/regenerate-description", response_model=RegenerateDescriptionResponse)
async def regenerate_description(
    listing_id: UUID,
    user: AuthUser,
    db: DBSession,
):
    """Re-run Claude haiku on current fields to regenerate the description."""
    row = await db.execute(
        text("""
            SELECT seller_id, brand, model, storage, color, condition,
                   accessories, title
            FROM listings WHERE id = :id
        """),
        {"id": listing_id},
    )
    rec = row.first()
    if not rec:
        raise HTTPException(status_code=404, detail="LISTING_NOT_FOUND")
    if str(rec.seller_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="NOT_SELLER")

    fields = {
        "title": rec.title,
        "brand": rec.brand,
        "model": rec.model,
        "storage": rec.storage,
        "color": rec.color,
        "condition": rec.condition,
        "accessories": rec.accessories,
    }

    description = await claude_client.regenerate_description(fields)

    await db.execute(
        text("UPDATE listings SET description = :d WHERE id = :id"),
        {"d": description, "id": listing_id},
    )
    await db.commit()

    return RegenerateDescriptionResponse(
        description=description,
        ai_model="claude-haiku",
    )


# ── Sprint 8 Phase 2.1: multi-image vision ────────────────────────────────  # SPRINT8_PHASE2_GEMINI_V2
#
# /draft/from-images (plural). Min 1, max 6 images per request. Sends all
# images in ONE Gemini call so the model sees the product from every angle
# at once.

from typing import List


@router.post("/draft/from-images", response_model=DraftFromImageResponse)
async def draft_from_images(
    user: AuthUser,
    db: DBSession,
    images: List[UploadFile] = File(...),
):
    """Multipart upload of 1-6 photos. Runs one Gemini vision call across
    all images, computes a price, and stores a draft for 24 hours.

    The mobile client should send between 4 and 6 photos for best results,
    but the endpoint accepts 1-6 to keep the API simple.
    """
    if not images:
        raise HTTPException(status_code=400, detail="NO_IMAGES")
    if len(images) > 6:
        raise HTTPException(status_code=400, detail="TOO_MANY_IMAGES")

    # Read every uploaded file
    image_pairs: list[tuple[bytes, str]] = []
    for img in images:
        b = await img.read()
        if not b:
            continue
        if len(b) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="IMAGE_TOO_LARGE")
        image_pairs.append((b, img.content_type or "image/jpeg"))

    if not image_pairs:
        raise HTTPException(status_code=400, detail="EMPTY_IMAGES")

    draft_id = uuid4()

    # Store every photo and collect URLs
    photo_urls: list[str] = []
    for idx, (image_bytes, content_type) in enumerate(image_pairs):
        # We use the draft_id + index in the key so all photos for a draft
        # share a logical prefix. _store_photo's signature uses just draft_id;
        # we adapt the key inline here.
        ext = "jpg"
        if content_type == "image/png":
            ext = "png"
        elif content_type == "image/webp":
            ext = "webp"
        key = f"ai-drafts/{user.user_id}/{draft_id}_{idx}.{ext}"
        from app.core.storage import upload_bytes, generate_presigned_download_url
        try:
            upload_bytes(image_bytes, key, content_type=content_type)
            url = generate_presigned_download_url(key, expires_in=60 * 60 * 24 * 7)
            photo_urls.append(url)
        except Exception as e:
            log.warning("ai_assistant.photo_upload_failed", extra={"error": str(e), "key": key})
            photo_urls.append(f"r2://{key}")

    # ONE multi-image vision call — see all angles at once
    detected = await claude_client.detect_from_images(image_pairs)

    # Hard reject NSFW / personal info
    if "nsfw" in detected.flags or "personal_info" in detected.flags:
        raise HTTPException(
            status_code=400,
            detail={"error": "PHOTO_REJECTED", "flags": detected.flags},
        )

    # Note: ai_failed:* flags are NOT a hard reject. The seller can still
    # complete the listing manually. The mobile UI uses this flag to show
    # a "couldn't analyse" banner.
    ai_failed = any(f.startswith("ai_failed:") for f in detected.flags)
    fallback_reason = None
    if ai_failed:
        fallback_reason = next(
            (f.split(":", 1)[1] for f in detected.flags if f.startswith("ai_failed:")),
            "unknown",
        )

    # Lookup user state for region-aware comparables
    state_row = await db.execute(
        text("SELECT COALESCE(state, address_state, 'Karnataka') FROM users WHERE id = :uid"),
        {"uid": user.user_id},
    )
    s = state_row.scalar()
    user_state = s if s else "Karnataka"

    # Price estimate (best-effort)
    price_result = await price_estimator.estimate_price(
        db,
        brand=detected.brand,
        model=detected.model,
        storage=detected.storage,
        condition=detected.condition_guess or "good",
        state=user_state,
        category_slug=detected.category_slug,
    )

    if price_result["source"] == "none" and fallback_reason is None:
        fallback_reason = price_result.get("reasoning")

    # Persist draft
    await db.execute(
        text("""
            INSERT INTO listing_drafts (
                id, user_id, photo_urls, ai_response, suggested_price,
                comparables_count, ai_model, status
            )
            VALUES (
                :id, :uid, :photo_urls, CAST(:ai_response AS JSONB),
                :price, :ccount, :model, 'open'
            )
        """).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString))),
        {
            "id": draft_id,
            "uid": user.user_id,
            "photo_urls": photo_urls,
            "ai_response": detected.model_dump_json(),
            "price": price_result.get("price"),
            "ccount": price_result.get("comparables_count", 0),
            "model": "gemini-vision",
        },
    )
    await db.commit()

    drow = await db.execute(
        text("SELECT expires_at FROM listing_drafts WHERE id = :id"),
        {"id": draft_id},
    )
    expires_at = drow.scalar() or datetime.now(timezone.utc)

    return DraftFromImageResponse(
        draft_id=draft_id,
        photo_url=photo_urls[0] if photo_urls else "",
        detected=detected,
        suggested_price=price_result.get("price"),
        price_source=price_result["source"],
        comparables=price_result.get("comparables", []),
        expires_at=expires_at,
        needs_identifier=_category_needs_identifier(detected.category_slug),
        fallback_reason=fallback_reason,
    )

# ── End Sprint 8 Phase 2.1 multi-image block ─────────────────────────────  # SPRINT8_PHASE2_GEMINI_V2

