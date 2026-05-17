"""AI-Assisted Listing router — Sprint 8 Phase 2.

Seven endpoints power the photo-first flow:
    POST   /v1/listings/draft/from-image
    POST   /v1/listings/draft/{draft_id}/extract-identifier
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

import asyncio
import json
import logging
from datetime import datetime, timezone
from io import BytesIO
from time import perf_counter
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.types import String as SAString

from app.core.dependencies import AuthUser, DBSession
from app.core.storage import (
    generate_presigned_download_url,
    generate_presigned_upload_url,
    process_listing_image_bytes,
    thumbnail_key_for_display_key,
)
from app.modules.ai_assistant import (
    ceir_client,
    provider as ai_provider,
    price_estimator,
)
from app.modules.ai_assistant.identifier_extraction import normalize_serial_number
from app.modules.ai_assistant.schemas import (
    AIDetected,
    AIDraftAnalysisStartResponse,
    AIDraftAnalysisStatusResponse,
    AIDraftUploadSessionRequest,
    AIDraftUploadSessionResponse,
    AIDraftUploadSlot,
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
from app.modules.media.image_cleanup import (
    clean_hero_background,
    move_hero_first,
    select_hero_image_index,
)
from app.modules.media.hero_cleanup_jobs import enqueue_listing_hero_cleanup
from app.modules.ai_assistant.draft_analysis_jobs import enqueue_ai_draft_analysis

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/listings", tags=["ai-assistant"])

VISION_TIMEOUT_SECONDS = 32
HERO_CLEANUP_TIMEOUT_SECONDS = 18
PRICE_TIMEOUT_SECONDS = 8
MAX_ANALYSIS_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_ANALYSIS_IMAGE_DIMENSION = 1280
ANALYSIS_IMAGE_JPEG_QUALITY = 82
AI_DRAFT_DISPLAY_DIMENSION = 1280
AI_DRAFT_THUMBNAIL_DIMENSION = 720


# ── Helpers ───────────────────────────────────────────────────────────────


# Categories that need an identifier (smartphones, laptops/tablets).
IDENTIFIER_CATEGORIES = {"smartphones", "laptops", "tablets"}

_CATEGORY_ALIASES = {
    "smartphone": "smartphones",
    "smartphones": "smartphones",
    "phone": "smartphones",
    "phones": "smartphones",
    "mobile": "smartphones",
    "mobiles": "smartphones",
    "mobilephone": "smartphones",
    "mobilephones": "smartphones",
    "cellphone": "smartphones",
    "cellphones": "smartphones",
    "handset": "smartphones",
    "iphone": "smartphones",
    "android": "smartphones",
    "androidphone": "smartphones",
    "laptop": "laptops",
    "laptops": "laptops",
    "notebook": "laptops",
    "notebooks": "laptops",
    "macbook": "laptops",
    "computer": "laptops",
    "computers": "laptops",
    "ultrabook": "laptops",
    "pc": "laptops",
    "tablet": "tablets",
    "tablets": "tablets",
    "ipad": "tablets",
    "ipads": "tablets",
    "tab": "tablets",
    "tabs": "tablets",
    "appliance": "small-appliances",
    "appliances": "small-appliances",
    "smallappliance": "small-appliances",
    "smallappliances": "small-appliances",
    "homeappliance": "small-appliances",
    "homeappliances": "small-appliances",
    "kid": "kids-utility",
    "kids": "kids-utility",
    "toy": "kids-utility",
    "toys": "kids-utility",
    "kidstoys": "kids-utility",
    "kidseducation": "kids-utility",
    "kidslearning": "kids-utility",
    "kidsutility": "kids-utility",
    "baby": "kids-utility",
    "other": "others",
    "others": "others",
    "misc": "others",
    "miscellaneous": "others",
    "general": "others",
    "accessory": "others",
    "accessories": "others",
    "electronics": "others",
    "camera": "others",
    "cameras": "others",
    "headphone": "others",
    "headphones": "others",
    "speaker": "others",
    "speakers": "others",
    "furniture": "others",
    "book": "others",
    "books": "others",
    "fashion": "others",
    "clothes": "others",
    "clothing": "others",
    "shoes": "others",
    "sports": "others",
}

_SUPPORTED_CATEGORY_SLUGS = {
    "smartphones",
    "laptops",
    "tablets",
    "small-appliances",
    "kids-utility",
    "others",
}

_DRAFT_REJECT_FLAGS = {
    "no_product",
    "blurry",
    "multiple_items",
    "screenshot_only",
    "stock_or_catalog_suspected",
}


def _canonical_category_slug(slug: str | None, *, fallback_empty_to_others: bool = True) -> str | None:
    token = "".join(ch for ch in (slug or "").strip().lower() if ch.isalnum())
    if not token:
        return "others" if fallback_empty_to_others else None
    aliased = _CATEGORY_ALIASES.get(token)
    if aliased:
        return aliased
    normalized = (slug or "").strip().lower().replace("_", "-")
    return normalized if normalized in _SUPPORTED_CATEGORY_SLUGS else "others"


def _with_canonical_category(detected):
    raw = detected.category_slug
    canonical = _canonical_category_slug(raw, fallback_empty_to_others=False)

    if not canonical:
        return detected.model_copy(update={
            "raw_category_slug": raw,
            "category_resolution": "unresolved",
        })

    normalized = (raw or "").strip().lower().replace("_", "-")
    token = "".join(ch for ch in (raw or "").strip().lower() if ch.isalnum())
    if canonical == normalized:
        resolution = "canonical"
    elif token in _CATEGORY_ALIASES:
        resolution = "alias"
    else:
        resolution = "fallback_others"

    seller_edit_fields = list(detected.seller_edit_fields or [])
    rationale = detected.category_rationale
    if canonical == "others":
        for field in ("title", "brand", "model"):
            if field not in seller_edit_fields:
                seller_edit_fields.append(field)
        if not rationale:
            rationale = "Product is sellable but outside Owmee's structured launch categories."

    return detected.model_copy(update={
        "category_slug": canonical,
        "raw_category_slug": raw if raw != canonical else None,
        "category_resolution": resolution,
        "category_rationale": rationale,
        "seller_edit_fields": seller_edit_fields,
    })


def _photo_rejection_detail(detected) -> dict | None:
    flags = set(detected.flags or [])
    safety_flags = flags.intersection({"nsfw", "personal_info"})
    unusable_flags = flags.intersection(_DRAFT_REJECT_FLAGS)
    reject_flags = sorted(safety_flags or unusable_flags)
    if not reject_flags:
        return None

    if safety_flags:
        message = "This photo contains private or unsafe content. Please upload a clean product photo."
    elif "multiple_items" in unusable_flags:
        message = "Please list one product at a time with photos of only that item."
    elif "no_product" in unusable_flags:
        message = "We could not find a sellable product in these photos."
    elif "blurry" in unusable_flags:
        message = "The photos are too blurry or dark to create a reliable listing."
    else:
        message = "Please upload original photos of the actual item, not screenshots or catalogue images."

    return {"error": "PHOTO_REJECTED", "flags": reject_flags, "message": message}

# Listing states that allow seller edits.
EDITABLE_STATES = {"draft_ai", "pending_buyer"}

# State at which video CTA appears.
VIDEO_PRICE_THRESHOLD = 5000


def _photo_object_key(user_id: UUID, draft_id: UUID, ext: str = "jpg") -> str:
    return f"ai-drafts/{user_id}/{draft_id}.{ext}"


def _draft_photo_object_key(user_id: UUID, draft_id: UUID, index: int, ext: str = "jpg") -> str:
    return f"ai-drafts/{user_id}/{draft_id}_{index}.{ext}"


def _image_extension(content_type: str | None) -> str:
    if content_type == "image/png":
        return "png"
    if content_type == "image/webp":
        return "webp"
    return "jpg"


def _safe_upload_content_type(content_type: str | None) -> str:
    normalized = (content_type or "image/jpeg").split(";", 1)[0].strip().lower()
    if normalized in {"image/jpeg", "image/jpg"}:
        return "image/jpeg"
    if normalized == "image/png":
        return "image/png"
    if normalized == "image/webp":
        return "image/webp"
    return "image/jpeg"


def _prepare_analysis_image_bytes(raw: bytes, content_type: str) -> tuple[bytes, str]:
    """Bound server-side memory before storage and Gemini vision.

    Mobile already compresses captures, but production cannot trust every
    client/device. Normalising each upload to a 1280px JPEG keeps Pillow,
    R2 upload, and Gemini request memory predictable on small Render instances.
    If Pillow cannot parse a test/edge image, preserve the original bytes and
    let the normal validation/vision path handle it.
    """
    try:
        from PIL import Image, ImageOps  # type: ignore

        img = Image.open(BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.getchannel("A"))
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail(
            (MAX_ANALYSIS_IMAGE_DIMENSION, MAX_ANALYSIS_IMAGE_DIMENSION),
            Image.Resampling.LANCZOS,
        )
        out = BytesIO()
        img.save(
            out,
            format="JPEG",
            quality=ANALYSIS_IMAGE_JPEG_QUALITY,
            optimize=True,
            progressive=False,
        )
        prepared = out.getvalue()
        return prepared or raw, "image/jpeg"
    except Exception:
        return raw, content_type


def _client_photo_url(key: str | None) -> str:
    """Return a short-lived URL for mobile preview while persisting R2 keys."""
    if not key:
        return ""
    if key.startswith(("http://", "https://", "r2://")):
        return key
    try:
        return generate_presigned_download_url(key, expires_in=60 * 60 * 24 * 7)
    except Exception:
        return key


async def _store_photo(image_bytes: bytes, content_type: str, user_id: UUID, draft_id: UUID) -> str:
    """Upload photo bytes via the existing storage helpers and return the
    R2 OBJECT KEY (not a URL).

    History
    -------
    This used to return a presigned download URL. That URL got written
    into `ai_drafts.photo_urls` and then copied verbatim into
    `listings.image_urls`. When the listing was later read back, the
    feed's _img_url helper assumed the value was a key and re-presigned
    it, producing a double-prefixed broken URL like:
       http://host/bucket/http%3A//host/bucket/key%3Fold-presign?new-presign
    Mobile <Image source={{uri}} /> couldn't load any of these and the
    home page showed empty cards. Returning the bare key here lets the
    feed serializer presign cleanly on every read with the right TTL.

    If storage is misconfigured we fall back to a sentinel string so
    the AI flow can still complete (photos can be re-uploaded later
    via the existing image pipeline).
    """
    key = _photo_object_key(user_id, draft_id, _image_extension(content_type))

    try:
        processed = await asyncio.to_thread(
            process_listing_image_bytes,
            image_bytes,
            original_key=key,
            content_type=content_type,
            max_display_dimension=AI_DRAFT_DISPLAY_DIMENSION,
            max_thumbnail_dimension=AI_DRAFT_THUMBNAIL_DIMENSION,
            display_quality=86,
            thumbnail_quality=78,
            polish=False,
        )
    except Exception as e:
        log.warning("ai_assistant.photo_upload_failed", extra={"error": str(e), "key": key})
        return f"r2://{key}"

    return processed.display_key or processed.original_key


async def _store_draft_photo(
    *,
    image_bytes: bytes,
    content_type: str,
    user_id: UUID,
    draft_id: UUID,
    index: int,
) -> tuple[str, str]:
    ext = _image_extension(content_type)
    key = f"ai-drafts/{user_id}/{draft_id}_{index}.{ext}"
    try:
        processed = await asyncio.to_thread(
            process_listing_image_bytes,
            image_bytes,
            original_key=key,
            content_type=content_type,
            max_display_dimension=AI_DRAFT_DISPLAY_DIMENSION,
            max_thumbnail_dimension=AI_DRAFT_THUMBNAIL_DIMENSION,
            display_quality=86,
            thumbnail_quality=78,
            polish=False,
        )
        return processed.display_key or processed.original_key, key
    except Exception as e:
        log.warning("ai_assistant.photo_upload_failed", extra={"error": str(e), "key": key})
        return f"r2://{key}", key


async def _store_draft_photos(
    image_pairs: list[tuple[bytes, str]],
    *,
    user_id: UUID,
    draft_id: UUID,
) -> tuple[list[str], list[str]]:
    stored: list[tuple[str, str]] = []
    for idx, (image_bytes, content_type) in enumerate(image_pairs):
        stored.append(
            await _store_draft_photo(
                image_bytes=image_bytes,
                content_type=content_type,
                user_id=user_id,
                draft_id=draft_id,
                index=idx,
            )
        )
    photo_urls = [photo_url for photo_url, _ in stored]
    original_keys = [key for _, key in stored]
    return photo_urls, original_keys


async def _timed_step(timings: dict[str, int], key: str, coro):
    started = perf_counter()
    try:
        return await coro
    finally:
        timings[key] = _ms_since(started)


async def _detect_from_images_bounded(image_pairs: list[tuple[bytes, str]]) -> AIDetected:
    try:
        return await asyncio.wait_for(
            ai_provider.detect_from_images(image_pairs),
            timeout=VISION_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning(
            "ai_assistant.vision_timeout",
            extra={"timeout_seconds": VISION_TIMEOUT_SECONDS, "image_count": len(image_pairs)},
        )
        return AIDetected(flags=["ai_failed:vision_timeout"])
    except Exception as e:
        log.warning(
            "ai_assistant.vision_unhandled_error",
            extra={"error": f"{type(e).__name__}: {str(e)[:240]}"},
        )
        return AIDetected(flags=["ai_failed:vision_error"])


async def _detect_from_image_bounded(image_bytes: bytes, content_type: str) -> AIDetected:
    try:
        return await asyncio.wait_for(
            ai_provider.detect_from_image(image_bytes, content_type),
            timeout=VISION_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning(
            "ai_assistant.vision_timeout",
            extra={"timeout_seconds": VISION_TIMEOUT_SECONDS, "image_count": 1},
        )
        return AIDetected(flags=["ai_failed:vision_timeout"])
    except Exception as e:
        log.warning(
            "ai_assistant.vision_unhandled_error",
            extra={"error": f"{type(e).__name__}: {str(e)[:240]}"},
        )
        return AIDetected(flags=["ai_failed:vision_error"])


async def _estimate_price_bounded(coro) -> dict:
    try:
        return await asyncio.wait_for(coro, timeout=PRICE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        log.warning(
            "ai_assistant.price_timeout",
            extra={"timeout_seconds": PRICE_TIMEOUT_SECONDS},
        )
        return {
            "price": None,
            "source": "none",
            "reasoning": "Price estimate timed out. Seller can set the price manually.",
            "comparables": [],
            "comparables_count": 0,
        }
    except Exception as e:
        log.warning(
            "ai_assistant.price_unhandled_error",
            extra={"error": f"{type(e).__name__}: {str(e)[:240]}"},
        )
        return {
            "price": None,
            "source": "none",
            "reasoning": "Price estimate failed. Seller can set the price manually.",
            "comparables": [],
            "comparables_count": 0,
        }


def _front_face_hero_override(detected: AIDetected, hero_index: int, image_count: int) -> int:
    if image_count <= 0 or detected.category_slug not in {"smartphones", "tablets"}:
        return hero_index
    image_quality = detected.image_set_quality or {}
    raw = image_quality.get("front_face_image_index")
    try:
        front_index = int(raw)
    except (TypeError, ValueError):
        return hero_index
    if 0 <= front_index < image_count:
        return front_index
    return hero_index


def _mark_hero_cleanup_skipped(detected: AIDetected, *, selected_index: int, reason: str) -> AIDetected:
    image_quality = dict(detected.image_set_quality or {})
    image_quality["hero_image_cleanup"] = {
        "status": "fallback_original",
        "provider": "skipped",
        "model": None,
        "reason": reason,
        "style": None,
        "selected_index": selected_index,
        "requires_retake": False,
    }
    return detected.model_copy(update={"image_set_quality": image_quality})


def _mark_hero_cleanup_deferred(detected: AIDetected, *, selected_index: int) -> AIDetected:
    image_quality = dict(detected.image_set_quality or {})
    image_quality["hero_image_cleanup"] = {
        "status": "queued_after_listing",
        "provider": "owmee-media-worker",
        "model": None,
        "reason": "runs_after_listing_created",
        "style": "owmee_catalog_background",
        "selected_index": selected_index,
        "requires_retake": False,
    }
    return detected.model_copy(update={"image_set_quality": image_quality})


async def _clean_hero_and_mark_detected(
    *,
    detected: AIDetected,
    image_bytes: bytes,
    content_type: str,
    original_key: str,
    selected_index: int,
    fallback_key: str,
) -> tuple[str, AIDetected]:
    try:
        cleanup = await asyncio.wait_for(
            clean_hero_background(
                image_bytes,
                content_type,
                original_key=original_key,
                selected_index=selected_index,
                category_slug=detected.category_slug,
            ),
            timeout=HERO_CLEANUP_TIMEOUT_SECONDS,
        )
        cleaned = cleanup.cleaned
        provider = cleanup.provider
        model = cleanup.model
        reason = cleanup.reason
        style = cleanup.style
        display_key = cleanup.display_key
    except asyncio.TimeoutError:
        log.warning(
            "ai_assistant.hero_cleanup_timeout",
            extra={
                "timeout_seconds": HERO_CLEANUP_TIMEOUT_SECONDS,
                "selected_index": selected_index,
                "category_slug": detected.category_slug,
            },
        )
        cleaned = False
        provider = "timeout"
        model = None
        reason = "cleanup_timeout"
        style = None
        display_key = None
    except Exception as e:
        log.warning(
            "ai_assistant.hero_cleanup_unhandled_error",
            extra={
                "error": f"{type(e).__name__}: {str(e)[:240]}",
                "selected_index": selected_index,
                "category_slug": detected.category_slug,
            },
        )
        cleaned = False
        provider = "error"
        model = None
        reason = "cleanup_error"
        style = None
        display_key = None

    image_quality = dict(detected.image_set_quality or {})
    status = "ready" if cleaned else "fallback_original"
    hero_has_human_artifact = image_quality.get("hero_image_has_human_artifact") is True
    if not cleaned and (
        hero_has_human_artifact
        or (reason or "").startswith(("human_artifact", "product_modified"))
    ):
        status = "needs_retake"
    image_quality["hero_image_cleanup"] = {
        "status": status,
        "provider": provider,
        "model": model,
        "reason": reason,
        "style": style,
        "selected_index": selected_index,
        "requires_retake": status == "needs_retake",
    }
    log.info(
        "ai_assistant.hero_cleanup_result",
        extra={
            "status": status,
            "provider": provider,
            "model": model,
            "reason": reason,
            "style": style,
            "selected_index": selected_index,
            "category_slug": detected.category_slug,
            "cleaned": cleaned,
        },
    )
    updated_detected = detected.model_copy(update={"image_set_quality": image_quality})
    if cleaned and display_key:
        return display_key, updated_detected
    return fallback_key, updated_detected


def _category_needs_identifier(slug: str | None) -> bool:
    canonical = _canonical_category_slug(slug)
    return bool(canonical and canonical in IDENTIFIER_CATEGORIES)


def _ms_since(start: float) -> int:
    return int((perf_counter() - start) * 1000)


# ── 1. POST /v1/listings/draft/from-image ─────────────────────────────────


@router.post("/draft/from-image", response_model=DraftFromImageResponse)
async def draft_from_image(
    user: AuthUser,
    db: DBSession,
    image: UploadFile = File(...),
):
    """Multipart upload of a single photo. Runs AI vision, computes
    a price suggestion, and stores a draft for 24 hours.

    The mobile client follows up with `POST /v1/listings/from-draft` once
    the seller confirms.
    """
    total_started = perf_counter()
    step_started = total_started
    timings: dict[str, int] = {}

    image_bytes = await image.read()
    timings["read_ms"] = _ms_since(step_started)
    if not image_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="EMPTY_IMAGE")
    if len(image_bytes) > MAX_ANALYSIS_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="IMAGE_TOO_LARGE")

    content_type = image.content_type or "image/jpeg"
    image_bytes, content_type = await asyncio.to_thread(
        _prepare_analysis_image_bytes,
        image_bytes,
        content_type,
    )
    draft_id = uuid4()

    # Store photo first (so the URL is valid for the response)
    step_started = perf_counter()
    photo_url = await _store_photo(image_bytes, content_type, user.user_id, draft_id)
    timings["store_ms"] = _ms_since(step_started)

    # Vision detection
    step_started = perf_counter()
    detected = await _detect_from_image_bounded(image_bytes, content_type)
    detected = _with_canonical_category(detected)
    timings["vision_ms"] = _ms_since(step_started)

    # Hard reject unsafe or unusable photos — "Other" is only for visible
    # sellable products outside the launch taxonomy.
    rejection = _photo_rejection_detail(detected)
    if rejection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=rejection,
        )

    ai_failed = any(f.startswith("ai_failed:") for f in detected.flags)
    if ai_failed:
        detected = _mark_hero_cleanup_skipped(detected, selected_index=0, reason="vision_failed")
    else:
        detected = _mark_hero_cleanup_deferred(detected, selected_index=0)
    timings["cleanup_ms"] = 0

    # Lookup user's state for region-aware comparables. Prefer
    # user_addresses (Address PRD), fall back to legacy user columns.
    from app.modules.identity_auth.user_location import get_user_location
    step_started = perf_counter()
    _, _, _, user_state = await get_user_location(db, user.user_id)
    timings["location_ms"] = _ms_since(step_started)

    # Price estimate priority order (best signal first):
    #   1. Comparables (real recent sales in the seller's region) — gold standard
    #   2. Vision-suggested price (model saw the photos + condition + defects)
    #   3. Text-only AI price (degenerate fallback, no photo signal)
    fallback_reason = None
    if ai_failed:
        fallback_reason = next(
            (f.split(":", 1)[1] for f in detected.flags if f.startswith("ai_failed:")),
            "unknown",
        )
    step_started = perf_counter()
    vision_price_available = bool(detected.suggested_price_inr)
    price_result = await _estimate_price_bounded(
        price_estimator.estimate_price(
            db,
            brand=detected.brand,
            model=detected.model,
            storage=detected.storage,
            condition=detected.condition_guess or "good",
            state=user_state,
            category_slug=detected.category_slug,
            allow_ai_fallback=not vision_price_available and not ai_failed,
        )
    )
    timings["price_ms"] = _ms_since(step_started)

    # If comparables didn't yield a price but vision did, use vision's
    # number (it factored in the actual photos, including defects we
    # don't otherwise transmit to the text price estimator).
    if price_result["source"] in ("none", "ai") and detected.suggested_price_inr:
        price_result = {
            "price": float(detected.suggested_price_inr),
            "source": "vision",
            "reasoning": detected.price_reasoning or "Inferred from photos",
            "comparables": price_result.get("comparables", []),
        }
    elif price_result["source"] == "none":
        fallback_reason = price_result.get("reasoning")

    # Persist the draft. ai_response is JSONB; pass JSON string and CAST.
    step_started = perf_counter()
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
            "model": ai_provider.current_vision_model(),
        },
    )
    await db.commit()
    timings["persist_ms"] = _ms_since(step_started)

    # Pull the row back for the response (specifically expires_at)
    drow = await db.execute(
        text("SELECT expires_at FROM listing_drafts WHERE id = :id"),
        {"id": draft_id},
    )
    expires_at = drow.scalar() or datetime.now(timezone.utc)

    log.info(
        "ai_assistant.draft_from_image_timing",
        extra={
            **timings,
            "total_ms": _ms_since(total_started),
            "bytes_total": len(image_bytes),
            "category_slug": detected.category_slug,
            "price_source": price_result["source"],
            "vision_price_available": vision_price_available,
        },
    )

    return DraftFromImageResponse(
        draft_id=draft_id,
        photo_url=_client_photo_url(photo_url),
        detected=detected,
        suggested_price=price_result.get("price"),
        price_source=price_result["source"],
        comparables=price_result.get("comparables", []),
        expires_at=expires_at,
        needs_identifier=_category_needs_identifier(detected.category_slug),
        fallback_reason=fallback_reason,
    )


# ── 2. POST /v1/listings/draft/{draft_id}/extract-identifier ──────────────


@router.post("/draft/uploads/request", response_model=AIDraftUploadSessionResponse)
async def request_ai_draft_uploads(
    payload: AIDraftUploadSessionRequest,
    user: AuthUser,
    db: DBSession,
):
    """Create an async AI draft upload session.

    The API returns short-lived R2 PUT URLs and stores only object keys. Mobile
    uploads bytes directly to R2, then starts the analysis worker job.
    """
    draft_id = uuid4()
    uploads: list[AIDraftUploadSlot] = []
    photo_keys: list[str] = []
    expires_in = 300

    for idx, image in enumerate(payload.images):
        content_type = _safe_upload_content_type(image.content_type)
        key = _draft_photo_object_key(user.user_id, draft_id, idx, _image_extension(content_type))
        upload_url = generate_presigned_upload_url(key, content_type=content_type, expires_in=expires_in)
        photo_keys.append(key)
        uploads.append(
            AIDraftUploadSlot(
                index=idx,
                upload_url=upload_url,
                r2_key=key,
                content_type=content_type,
                expires_in_seconds=expires_in,
            )
        )

    await db.execute(
        text("""
            INSERT INTO listing_drafts (
                id, user_id, photo_urls, ai_response, status
            )
            VALUES (
                :id, :uid, :photo_urls, CAST(:ai_response AS JSONB), 'uploading'
            )
        """).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString))),
        {
            "id": draft_id,
            "uid": user.user_id,
            "photo_urls": photo_keys,
            "ai_response": json.dumps({"async_status": "uploading"}),
        },
    )
    await db.commit()

    drow = await db.execute(
        text("SELECT expires_at FROM listing_drafts WHERE id = :id"),
        {"id": draft_id},
    )
    expires_at = drow.scalar() or datetime.now(timezone.utc)

    return AIDraftUploadSessionResponse(
        draft_id=draft_id,
        uploads=uploads,
        status="uploading",
        expires_at=expires_at,
    )


@router.post("/draft/{draft_id}/analysis/start", response_model=AIDraftAnalysisStartResponse)
async def start_ai_draft_analysis(
    draft_id: UUID,
    user: AuthUser,
    db: DBSession,
):
    row = (
        await db.execute(
            text("""
                SELECT user_id, photo_urls, expires_at, status, ai_response
                FROM listing_drafts
                WHERE id = :id
            """),
            {"id": draft_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND")
    if str(row["user_id"]) != str(user.user_id):
        raise HTTPException(status_code=403, detail="DRAFT_NOT_OWNED")
    if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="DRAFT_EXPIRED")
    if row["status"] == "consumed":
        raise HTTPException(status_code=400, detail="DRAFT_ALREADY_CONSUMED")
    if row["status"] == "open":
        return AIDraftAnalysisStartResponse(draft_id=draft_id, status="ready")
    if row["status"] == "processing":
        return AIDraftAnalysisStartResponse(draft_id=draft_id, status="processing")
    if row["status"] == "failed":
        raw_ai = row["ai_response"] if isinstance(row["ai_response"], dict) else {}
        raise HTTPException(
            status_code=400,
            detail={
                "error": raw_ai.get("error") or "ANALYSIS_FAILED",
                "message": raw_ai.get("message") or "We could not analyse these photos. Please try again.",
            },
        )

    photo_keys = list(row["photo_urls"] or [])
    if not photo_keys:
        raise HTTPException(status_code=400, detail="NO_IMAGES")
    for idx, key in enumerate(photo_keys):
        expected_prefix = f"ai-drafts/{user.user_id}/{draft_id}_{idx}."
        if not str(key).startswith(expected_prefix):
            raise HTTPException(status_code=400, detail="INVALID_DRAFT_IMAGE_KEY")

    queued = await enqueue_ai_draft_analysis(
        draft_id=draft_id,
        user_id=user.user_id,
        photo_keys=photo_keys,
    )
    if not queued:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "ANALYSIS_QUEUE_UNAVAILABLE",
                "message": "Photo analysis is temporarily busy. Please try again in a moment.",
            },
        )

    await db.execute(
        text("""
            UPDATE listing_drafts
            SET status = 'processing',
                ai_response = CAST(:ai_response AS JSONB)
            WHERE id = :id
        """),
        {
            "id": draft_id,
            "ai_response": json.dumps({"async_status": "processing"}),
        },
    )
    await db.commit()
    return AIDraftAnalysisStartResponse(draft_id=draft_id, status="processing")


@router.get("/draft/{draft_id}/analysis/status", response_model=AIDraftAnalysisStatusResponse)
async def get_ai_draft_analysis_status(
    draft_id: UUID,
    user: AuthUser,
    db: DBSession,
):
    row = (
        await db.execute(
            text("""
                SELECT user_id, photo_urls, ai_response, suggested_price,
                       comparables_count, status, expires_at
                FROM listing_drafts
                WHERE id = :id
            """),
            {"id": draft_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND")
    if str(row["user_id"]) != str(user.user_id):
        raise HTTPException(status_code=403, detail="DRAFT_NOT_OWNED")
    if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
        return AIDraftAnalysisStatusResponse(
            draft_id=draft_id,
            status="expired",
            error="DRAFT_EXPIRED",
            message="This draft expired. Please analyse the photos again.",
        )

    status_value = row["status"]
    if status_value == "open":
        raw_ai = row["ai_response"] if isinstance(row["ai_response"], dict) else {}
        detected = AIDetected(**raw_ai)
        photo_urls = list(row["photo_urls"] or [])
        fallback_reason = next(
            (f.split(":", 1)[1] for f in detected.flags if f.startswith("ai_failed:")),
            None,
        )
        draft = DraftFromImageResponse(
            draft_id=draft_id,
            photo_url=_client_photo_url(photo_urls[0] if photo_urls else None),
            detected=detected,
            suggested_price=float(row["suggested_price"]) if row["suggested_price"] is not None else None,
            price_source="vision" if row["suggested_price"] is not None else "none",
            comparables=[],
            expires_at=row["expires_at"] or datetime.now(timezone.utc),
            needs_identifier=_category_needs_identifier(detected.category_slug),
            fallback_reason=fallback_reason,
        )
        return AIDraftAnalysisStatusResponse(draft_id=draft_id, status="ready", draft=draft)

    if status_value == "failed":
        raw_ai = row["ai_response"] if isinstance(row["ai_response"], dict) else {}
        return AIDraftAnalysisStatusResponse(
            draft_id=draft_id,
            status="failed",
            error=raw_ai.get("error") or "ANALYSIS_FAILED",
            message=raw_ai.get("message") or "We could not analyse these photos. Please try again.",
        )

    return AIDraftAnalysisStatusResponse(
        draft_id=draft_id,
        status=status_value or "processing",
        retry_after_seconds=2,
    )


@router.post("/draft/{draft_id}/extract-identifier", response_model=ExtractIMEIResponse)
@router.post("/draft/{draft_id}/extract-imei", response_model=ExtractIMEIResponse)
async def extract_identifier(
    draft_id: UUID,
    user: AuthUser,
    db: DBSession,
    category_slug: str | None = Form(None),
    image: UploadFile = File(...),
):
    """Photo of an identifier label → OCR + category-specific validation.

    Smartphones return IMEI plus Luhn/CEIR status. Laptops/tablets return
    serial number or service tag. The old extract-imei path remains as a
    compatibility alias for already-installed app builds.
    """
    # Verify draft ownership
    drow = await db.execute(
        text("SELECT user_id, ai_response FROM listing_drafts WHERE id = :id"),
        {"id": draft_id},
    )
    draft_row = drow.first()
    if draft_row is None:
        raise HTTPException(status_code=404, detail="DRAFT_NOT_FOUND")
    if str(draft_row.user_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="DRAFT_NOT_OWNED")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="EMPTY_IMAGE")

    draft_ai = draft_row.ai_response if isinstance(draft_row.ai_response, dict) else {}
    draft_category = draft_ai.get("category_slug") if draft_ai else None
    identifier_category = (
        _canonical_category_slug(category_slug, fallback_empty_to_others=False)
        or _canonical_category_slug(draft_category, fallback_empty_to_others=False)
        or "smartphones"
    )

    content_type = image.content_type or "image/jpeg"
    ocr = await ai_provider.extract_identifier(
        image_bytes,
        content_type,
        category_slug=identifier_category,
    )

    imei = ocr.get("imei")
    serial_number = ocr.get("serial_number")
    confidence = float(ocr.get("confidence") or 0.0)
    luhn_ok = ceir_client.luhn_valid(imei) if identifier_category == "smartphones" and imei else False

    ceir_status = None
    if identifier_category == "smartphones" and luhn_ok:
        ceir = await ceir_client.check(imei)
        ceir_status = ceir.get("status")
        if ceir_status == "blacklisted":
            raise HTTPException(
                status_code=400,
                detail={"error": "IMEI_BLACKLISTED", "imei": imei},
            )

    if identifier_category == "smartphones":
        suggest_manual = (not imei) or (confidence < 0.8) or (not luhn_ok)
        identifier_kind = "imei"
        identifier_value = imei
    else:
        suggest_manual = (not serial_number) or (confidence < 0.65)
        identifier_kind = "serial"
        identifier_value = serial_number

    return ExtractIMEIResponse(
        identifier_kind=identifier_kind,
        identifier_value=identifier_value,
        imei=imei,
        serial_number=serial_number,
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

    category_slug = _canonical_category_slug(payload.category_slug)
    if not category_slug:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "UNKNOWN_CATEGORY",
                "slug": payload.category_slug,
                "message": "We couldn't match this category. Please pick Smartphone, Laptop, Tablet, Appliance, Kids utility, or Other.",
            },
        )

    # IMEI requirement check for smartphones
    if category_slug == "smartphones" and not payload.imei_1:
        raise HTTPException(status_code=400, detail="IMEI_REQUIRED_FOR_SMARTPHONES")

    serial_number = normalize_serial_number(payload.serial_number)
    if category_slug in {"laptops", "tablets"} and not serial_number:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "SERIAL_REQUIRED_FOR_DEVICE",
                "message": "Serial number or service tag is required for laptop and tablet listings.",
            },
        )

    # Validate IMEI(s) if present — defence in depth
    for imei in (payload.imei_1, payload.imei_2):
        if imei and not ceir_client.luhn_valid(imei):
            raise HTTPException(
                status_code=400,
                detail={"error": "IMEI_LUHN_FAILED", "imei": imei},
            )

    # Sprint trust pillar: block re-listing of an IMEI that's already on a
    # live listing (active / reserved / sold). The DB has a unique partial
    # index as the backstop, but pre-checking returns a friendlier error.
    for imei in (payload.imei_1, payload.imei_2):
        if not imei:
            continue
        dup = await db.execute(
            text("""
                SELECT id FROM listings
                WHERE (imei_1 = :imei OR imei_2 = :imei)
                  AND status IN ('active','reserved','sold')
                LIMIT 1
            """),
            {"imei": imei},
        )
        if dup.scalar() is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "IMEI_ALREADY_LISTED",
                    "imei": imei,
                    "message": "This IMEI is already on an active Owmee listing.",
                },
            )

    # Resolve category_id from slug
    cat_row = await db.execute(
        text("SELECT id FROM categories WHERE slug = :slug AND is_active = true"),
        {"slug": category_slug},
    )
    category_id = cat_row.scalar()
    if not category_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "UNKNOWN_CATEGORY",
                "slug": payload.category_slug,
                "canonical_slug": category_slug,
                "message": "We couldn't match this category. Please pick Smartphone, Laptop, Tablet, Appliance, Kids utility, or Other.",
            },
        )

    # CEIR check (mock) for smartphone IMEIs
    verification_status = "pending"
    if category_slug == "smartphones" and payload.imei_1:
        ceir = await ceir_client.check(payload.imei_1)
        if ceir["status"] == "clean":
            verification_status = "verified"
        elif ceir["status"] == "blacklisted":
            raise HTTPException(status_code=400, detail={"error": "IMEI_BLACKLISTED"})
        else:
            verification_status = "pending"

    # Pull seller's location for the listing's geo fields. Prefer the
    # default user_addresses row (Address PRD) since legacy user columns
    # are NULL for new-flow users — without this, AI listings get
    # rejected as out-of-zone or saved with empty city/state and never
    # surface in the home feed.
    from app.modules.identity_auth.user_location import get_user_location
    seller_lat, seller_lng, seller_city, seller_state = await get_user_location(db, user.user_id)

    # Sprint trust pillar: hyperlocal-pilot geo-fence. Same gate as the
    # non-AI listing path — mirrored here so the AI flow can't bypass.
    from app.core.zones import is_in_service_area, out_of_service_message
    if not is_in_service_area(seller_lat, seller_lng):
        raise HTTPException(status_code=400, detail=out_of_service_message())

    # Combine draft photo keys with any extra image URLs from the mobile client
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
            brand, model, storage, ram, processor, screen_size, color,
            purchase_year, battery_health, accessories, warranty_info,
            age_suitability, hygiene_status,
            has_box, has_bill, has_charger, has_earphones,
            water_damage_history, seller_functional_attestation,
            serial_number,
            imei_1, imei_2, listing_state, verification_status, video_url,
            ai_draft_id, city, state, listing_source, reviewed_by,
            published_at
        )
        VALUES (
            :id, :seller_id, :category_id, :title, :description, :price, :condition,
            'active', 'pending', :image_urls, :thumb,
            :brand, :model, :storage, :ram, :processor, :screen_size, :color,
            :purchase_year, :battery_health, :accessories, :warranty_info,
            :age_suitability, :hygiene_status,
            :has_box, :has_bill, :has_charger, :has_earphones,
            :water_damage_history, :seller_functional_attestation,
            :serial,
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
            "thumb": (
                (thumbnail_key_for_display_key(photo_urls[0]) or photo_urls[0])
                if photo_urls
                else None
            ),
            "brand": payload.brand,
            "model": payload.model,
            "storage": payload.storage,
            "ram": payload.ram,
            "processor": payload.processor,
            "screen_size": payload.screen_size,
            "color": payload.color,
            "purchase_year": payload.purchase_year,
            "battery_health": payload.battery_health,
            "accessories": payload.accessories,
            "warranty_info": payload.warranty_status,
            "age_suitability": payload.age_suitability,
            "hygiene_status": payload.hygiene_status,
            "has_box": payload.has_box,
            "has_bill": payload.has_bill,
            "has_charger": payload.has_charger,
            "has_earphones": payload.has_earphones,
            "water_damage_history": payload.water_damage_history,
            "seller_functional_attestation": payload.seller_functional_attestation,
            "serial": serial_number,
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

    if photo_urls:
        await enqueue_listing_hero_cleanup(
            listing_id=listing_id,
            hero_key=photo_urls[0],
            category_slug=category_slug,
        )

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
        "ram": payload.ram,
        "processor": payload.processor,
        "screen_size": payload.screen_size,
        "color": payload.color,
        "purchase_year": payload.purchase_year,
        "battery_health": payload.battery_health,
        "accessories": payload.accessories,
        "warranty_info": payload.warranty_status,
        "age_suitability": payload.age_suitability,
        "hygiene_status": payload.hygiene_status,
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
    """Re-run the configured AI provider on current fields to regenerate the description."""
    row = await db.execute(
        text("""
            SELECT seller_id, brand, model, storage, ram, processor,
                   screen_size, color, purchase_year, battery_health,
                   warranty_info, condition, accessories, title
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
        "ram": rec.ram,
        "processor": rec.processor,
        "screen_size": rec.screen_size,
        "color": rec.color,
        "purchase_year": rec.purchase_year,
        "battery_health": rec.battery_health,
        "warranty_info": rec.warranty_info,
        "condition": rec.condition,
        "accessories": rec.accessories,
    }

    description = await ai_provider.regenerate_description(fields)

    await db.execute(
        text("UPDATE listings SET description = :d WHERE id = :id"),
        {"d": description, "id": listing_id},
    )
    await db.commit()

    return RegenerateDescriptionResponse(
        description=description,
        ai_model=ai_provider.current_text_model(),
    )


# ── Sprint 8 Phase 2.1: multi-image vision ────────────────────────────────  # SPRINT8_PHASE2_GEMINI_V2
#
# /draft/from-images (plural). Min 1, max 6 images per request. Sends all
# images in ONE AI-provider call so the model sees the product from every angle
# at once.

from typing import List


@router.post("/draft/from-images", response_model=DraftFromImageResponse)
async def draft_from_images(
    user: AuthUser,
    db: DBSession,
    images: List[UploadFile] = File(...),
):
    """Multipart upload of 1-6 photos. Runs one AI vision call across
    all images, computes a price, and stores a draft for 24 hours.

    The mobile client should send between 3 and 6 photos for best results,
    but the endpoint accepts 1-6 to keep the API simple.
    """
    if not images:
        raise HTTPException(status_code=400, detail="NO_IMAGES")
    if len(images) > 6:
        raise HTTPException(status_code=400, detail="TOO_MANY_IMAGES")

    total_started = perf_counter()
    step_started = total_started
    timings: dict[str, int] = {}

    # Read every uploaded file
    image_pairs: list[tuple[bytes, str]] = []
    for img in images:
        b = await img.read()
        if not b:
            continue
        if len(b) > MAX_ANALYSIS_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="IMAGE_TOO_LARGE")
        prepared = await asyncio.to_thread(
            _prepare_analysis_image_bytes,
            b,
            img.content_type or "image/jpeg",
        )
        image_pairs.append(prepared)
        del b
    timings["read_ms"] = _ms_since(step_started)

    if not image_pairs:
        raise HTTPException(status_code=400, detail="EMPTY_IMAGES")

    draft_id = uuid4()

    # Store photos before vision. This avoids running Pillow/WebP processing
    # and Gemini multipart assembly at the same time, which can exceed memory
    # on small production instances when several users list in parallel.
    from app.modules.identity_auth.user_location import get_user_location

    location_task = _timed_step(timings, "location_ms", get_user_location(db, user.user_id))
    photo_urls, _original_keys_unused = await _timed_step(
        timings,
        "store_ms",
        _store_draft_photos(image_pairs, user_id=user.user_id, draft_id=draft_id),
    )
    detected, (_lat, _lng, _city, user_state) = await asyncio.gather(
        _timed_step(timings, "vision_ms", _detect_from_images_bounded(image_pairs)),
        location_task,
    )
    detected = _with_canonical_category(detected)
    hero_index = select_hero_image_index(detected, len(photo_urls))
    hero_index = _front_face_hero_override(detected, hero_index, len(photo_urls))
    detected = detected.model_copy(update={"hero_image_index": hero_index})

    # Hard reject unsafe or unusable photos — "Other" is only for visible
    # sellable products outside the launch taxonomy.
    rejection = _photo_rejection_detail(detected)
    if rejection:
        raise HTTPException(
            status_code=400,
            detail=rejection,
        )

    vision_price_available = bool(detected.suggested_price_inr)
    analysis_failed = any(f.startswith("ai_failed:") for f in detected.flags)

    if analysis_failed:
        detected = _mark_hero_cleanup_skipped(detected, selected_index=hero_index, reason="vision_failed")
    else:
        detected = _mark_hero_cleanup_deferred(detected, selected_index=hero_index)
    timings["cleanup_ms"] = 0

    async def price_step() -> dict:
        return await _estimate_price_bounded(
            price_estimator.estimate_price(
                db,
                brand=detected.brand,
                model=detected.model,
                storage=detected.storage,
                condition=detected.condition_guess or "good",
                state=user_state,
                category_slug=detected.category_slug,
                allow_ai_fallback=not vision_price_available and not analysis_failed,
            )
        )

    price_result = await _timed_step(timings, "price_ms", price_step())

    photo_urls = move_hero_first(photo_urls, hero_index)

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

    if price_result["source"] in ("none", "ai") and detected.suggested_price_inr:
        price_result = {
            "price": float(detected.suggested_price_inr),
            "source": "vision",
            "reasoning": detected.price_reasoning or "Inferred from photos",
            "comparables": price_result.get("comparables", []),
        }
    elif price_result["source"] == "none" and fallback_reason is None:
        fallback_reason = price_result.get("reasoning")

    # Persist draft
    step_started = perf_counter()
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
            "model": ai_provider.current_vision_model(),
        },
    )
    await db.commit()
    timings["persist_ms"] = _ms_since(step_started)

    drow = await db.execute(
        text("SELECT expires_at FROM listing_drafts WHERE id = :id"),
        {"id": draft_id},
    )
    expires_at = drow.scalar() or datetime.now(timezone.utc)

    log.info(
        "ai_assistant.draft_from_images_timing",
        extra={
            **timings,
            "total_ms": _ms_since(total_started),
            "image_count": len(image_pairs),
            "bytes_total": sum(len(b) for b, _ in image_pairs),
            "hero_index": hero_index,
            "category_slug": detected.category_slug,
            "price_source": price_result["source"],
            "vision_price_available": vision_price_available,
        },
    )

    return DraftFromImageResponse(
        draft_id=draft_id,
        photo_url=_client_photo_url(photo_urls[0] if photo_urls else None),
        detected=detected,
        suggested_price=price_result.get("price"),
        price_source=price_result["source"],
        comparables=price_result.get("comparables", []),
        expires_at=expires_at,
        needs_identifier=_category_needs_identifier(detected.category_slug),
        fallback_reason=fallback_reason,
    )

# ── End Sprint 8 Phase 2.1 multi-image block ─────────────────────────────  # SPRINT8_PHASE2_GEMINI_V2
