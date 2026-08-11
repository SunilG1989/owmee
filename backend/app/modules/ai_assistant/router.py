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
from app.core.settings import settings
from app.core.storage import (
    generate_presigned_download_url,
    generate_presigned_upload_url,
    process_listing_image_bytes,
    thumbnail_key_for_display_key,
)
from app.modules.ai_assistant import (
    ceir_client,
    draft_contracts,
    provider as ai_provider,
    price_estimator,
)
from app.modules.ai_assistant.category_taxonomy import (
    CATEGORY_ALIASES,
    IDENTIFIER_CATEGORIES,
    canonical_category_slug,
    category_family_for,
    category_token,
    clean_category_specifics,
    has_educational_book_detail,
    has_issue_disclosure_detail,
    is_generic_listing_title,
    is_meaningful_other_detail,
    required_category_specific_fields,
    requires_appliance_pickup_status,
    requires_book_set_status,
    requires_educational_book_details,
    requires_issue_disclosure_detail,
    requires_powered_toy_status,
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
    DraftPriceRefreshRequest,
    EditListingRequest,
    EditListingResponse,
    ExtractIMEIResponse,
    RegenerateDescriptionResponse,
    SellerInfoNeededResponse,
    SellerInfoRequest,
)
from app.modules.listings.service import MIN_PHOTOS_REQUIRED
from app.modules.media.image_cleanup import (
    clean_hero_background,
    move_hero_first,
    select_hero_image_index,
)
from app.modules.media.hero_cleanup_jobs import enqueue_listing_hero_cleanup
from app.modules.ai_assistant.draft_analysis_jobs import enqueue_ai_draft_analysis

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/listings", tags=["ai-assistant"])

VISION_TIMEOUT_SECONDS = 45
HERO_CLEANUP_TIMEOUT_SECONDS = 18
PRICE_TIMEOUT_SECONDS = 25
MAX_ANALYSIS_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_ANALYSIS_IMAGE_DIMENSION = 1280
ANALYSIS_IMAGE_JPEG_QUALITY = 82
AI_DRAFT_DISPLAY_DIMENSION = 1280
AI_DRAFT_THUMBNAIL_DIMENSION = 720
AI_DRAFT_IMAGE_IO_CONCURRENCY = 3


# ── Helpers ───────────────────────────────────────────────────────────────


_DRAFT_REJECT_FLAGS = {
    "no_product",
    "blurry",
    "multiple_items",
    "screenshot_only",
    "stock_or_catalog_suspected",
}

_PUBLISH_BLOCK_FLAGS = _DRAFT_REJECT_FLAGS | {
    "nsfw",
    "personal_info",
    "packaging_only",
}

_VALID_SCREEN_CONDITIONS = {"flawless", "minor_scratches", "cracked"}
_VALID_BODY_CONDITIONS = {"flawless", "minor_dents", "major_damage"}
_PRICE_REFRESH_MRP_SOURCES = {"visible_mrp", "receipt_or_bill", "seller_entered"}


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


def _canonical_category_slug(slug: str | None, *, fallback_empty_to_others: bool = True) -> str | None:
    return canonical_category_slug(slug, fallback_empty_to_others=fallback_empty_to_others)


def _with_canonical_category(detected):
    raw = detected.category_slug
    canonical = _canonical_category_slug(raw, fallback_empty_to_others=False)

    if not canonical:
        return detected.model_copy(update={
            "raw_category_slug": raw,
            "category_resolution": "unresolved",
        })

    normalized = (raw or "").strip().lower().replace("_", "-")
    token = category_token(raw)
    if canonical == normalized:
        resolution = "canonical"
    elif token in CATEGORY_ALIASES:
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

    category_family = category_family_for(
        canonical,
        detected_item_type=detected.detected_item_type,
        title=detected.title_suggestion,
        model=detected.model,
    )

    return detected.model_copy(update={
        "category_slug": canonical,
        "raw_category_slug": raw if raw != canonical else None,
        "category_resolution": resolution,
        "category_rationale": rationale,
        "category_family": category_family,
        "category_specifics": clean_category_specifics(category_family, detected.category_specifics),
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


def _publish_rejection_detail(draft_ai_response: dict) -> dict | None:
    """Hard gate unsafe/unusable AI drafts at publish time.

    Draft analysis already rejects the clearest bad inputs, but publish is the
    final trust boundary. This catches older drafts, async-worker drift, and
    manual_review_required cases where the LLM explicitly asked for retake.
    """
    flags = {
        str(flag).strip().lower()
        for flag in (draft_ai_response.get("flags") or [])
        if str(flag).strip()
    }
    blocking_reasons = {
        str(reason).strip().lower()
        for reason in (draft_ai_response.get("blocking_reasons") or [])
        if str(reason).strip()
    }
    image_quality = draft_ai_response.get("image_set_quality") or {}
    if isinstance(image_quality, dict):
        if image_quality.get("has_private_info") is True:
            flags.add("personal_info")
        if image_quality.get("is_stock_or_catalog_image_suspected") is True:
            flags.add("stock_or_catalog_suspected")
        quality = str(image_quality.get("overall_photo_quality") or "").lower()
        if quality == "unusable":
            flags.add("blurry")

    reject_flags = sorted((flags | blocking_reasons).intersection(_PUBLISH_BLOCK_FLAGS))
    if not reject_flags:
        return None

    if {"personal_info", "nsfw"}.intersection(reject_flags):
        message = "Remove private or unsafe content and upload clean product photos before listing."
    elif "multiple_items" in reject_flags:
        message = "List one product at a time. Retake photos with only the item being sold."
    elif "packaging_only" in reject_flags:
        message = "Add a clear photo of the actual item. Packaging alone is not enough to publish."
    elif {"screenshot_only", "stock_or_catalog_suspected"}.intersection(reject_flags):
        message = "Use original photos of the item in your possession, not catalogue images or screenshots."
    else:
        message = "Retake clearer product photos before publishing this listing."

    return {"error": "DRAFT_PHOTOS_BLOCKED", "flags": reject_flags, "message": message}


def _publish_detail_rejection(category_slug: str, payload: CreateFromDraftRequest) -> dict | None:
    """Require enough seller-confirmed structure for launch-risk categories."""
    if is_generic_listing_title(payload.title):
        return {
            "error": "TITLE_DETAILS_REQUIRED",
            "fields": ["title"],
            "message": "Add a specific product title before publishing.",
        }

    if category_slug != "others":
        return None

    if not is_meaningful_other_detail(payload.title):
        return {
            "error": "OTHER_DETAILS_REQUIRED",
            "fields": ["title"],
            "message": "Add a specific title for this Other category listing.",
        }

    if not is_meaningful_other_detail(payload.model):
        return {
            "error": "OTHER_DETAILS_REQUIRED",
            "fields": ["model"],
            "message": "Add a concrete product type or product name before publishing an Other category listing.",
        }

    return None


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


def _with_seeded_category_specifics(
    *,
    category_family: str,
    payload: CreateFromDraftRequest,
    draft_ai_response: dict,
) -> dict:
    # Publish uses seller-confirmed fields only. AI output can prefill the UI,
    # but it must not silently satisfy buyer-critical safety/completeness gates.
    raw_specifics = payload.category_specifics if isinstance(payload.category_specifics, dict) else {}
    specifics = clean_category_specifics(category_family, raw_specifics)

    if (
        category_family == "toy"
        and not _specific_present(specifics.get("toy_type"))
        and payload.model
        and not is_generic_listing_title(payload.model)
    ):
        specifics["toy_type"] = payload.model
    if (
        category_family == "book"
        and not _specific_present(specifics.get("book_type"))
        and payload.model
        and not is_generic_listing_title(payload.model)
    ):
        specifics["book_type"] = payload.model
    if (
        category_family == "appliance"
        and not _specific_present(specifics.get("appliance_type"))
        and payload.model
        and not is_generic_listing_title(payload.model)
    ):
        specifics["appliance_type"] = payload.model

    return specifics


def _publish_category_specifics_rejection(
    *,
    category_slug: str,
    category_family: str,
    category_specifics: dict,
    kids_safety_checklist: dict | None,
    description: str | None,
    payload: CreateFromDraftRequest,
) -> dict | None:
    if category_family not in {"toy", "book", "appliance"}:
        return None

    effective_specifics = dict(category_specifics or {})
    if (
        category_family == "toy"
        and not _specific_present(effective_specifics.get("toy_type"))
        and payload.model
        and not is_generic_listing_title(payload.model)
    ):
        effective_specifics["toy_type"] = payload.model
    if (
        category_family == "book"
        and not _specific_present(effective_specifics.get("book_type"))
        and payload.model
        and not is_generic_listing_title(payload.model)
    ):
        effective_specifics["book_type"] = payload.model
    if (
        category_family == "appliance"
        and not _specific_present(effective_specifics.get("appliance_type"))
        and payload.model
        and not is_generic_listing_title(payload.model)
    ):
        effective_specifics["appliance_type"] = payload.model

    missing: list[str] = []
    for field in required_category_specific_fields(category_family):
        if not _specific_present(effective_specifics.get(field)):
            missing.append(field)

    if category_family == "toy":
        if is_generic_listing_title(effective_specifics.get("toy_type")):
            missing.append("toy_type")
        if not _specific_present(payload.age_suitability):
            missing.append("age_suitability")
        if not _specific_present(payload.hygiene_status):
            missing.append("hygiene_status")
        if requires_powered_toy_status(payload.model, payload.title) and not (
            _specific_present(category_specifics.get("working_status"))
            or _specific_present(category_specifics.get("battery_status"))
        ):
            missing.append("battery_or_working_status")
        if category_slug == "kids-utility":
            required_checklist = ("no_small_parts", "no_loose_batteries", "no_sharp_edges")
            if not all(key in (kids_safety_checklist or {}) for key in required_checklist):
                missing.append("kids_safety_checklist")

    if category_family == "book" and is_generic_listing_title(effective_specifics.get("book_type")):
        missing.append("book_type")

    if category_family == "book" and requires_book_set_status(payload.model, payload.title):
        if not _specific_present(effective_specifics.get("set_status")):
            missing.append("set_status")
    if category_family == "book" and requires_educational_book_details(payload.model, payload.title):
        if not has_educational_book_detail(effective_specifics):
            missing.append("class_board_edition")

    if category_family == "appliance":
        if (
            not _specific_present(effective_specifics.get("appliance_type"))
            or is_generic_listing_title(effective_specifics.get("appliance_type"))
        ):
            missing.append("appliance_type")
        if requires_appliance_pickup_status(payload.model, payload.title):
            if not _specific_present(effective_specifics.get("pickup_complexity")):
                missing.append("pickup_complexity")
            if not _specific_present(effective_specifics.get("installation_status")):
                missing.append("installation_status")
    if (
        requires_issue_disclosure_detail(category_family, effective_specifics)
        and not has_issue_disclosure_detail(description)
    ):
        missing.append("issue_disclosure")

    deduped = list(dict.fromkeys(missing))
    if not deduped:
        return None

    return {
        "error": "CATEGORY_REQUIREMENTS_REQUIRED",
        "category_family": category_family,
        "missing_fields": deduped,
        "message": "Complete category-specific buyer details before publishing.",
    }


def _clean_condition_choice(value: str | None, allowed: set[str]) -> str | None:
    cleaned = (value or "").strip().lower()
    return cleaned if cleaned in allowed else None


def _clean_defects(value) -> list[str] | None:
    if not isinstance(value, list):
        return None
    seen: set[str] = set()
    defects: list[str] = []
    for item in value:
        cleaned = " ".join(str(item or "").split())[:80]
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        defects.append(cleaned)
        if len(defects) >= 12:
            break
    return defects


def _clean_kids_safety_checklist(value) -> dict | None:
    if not isinstance(value, dict):
        return None
    allowed = {
        "cleaned",
        "no_small_parts",
        "no_loose_batteries",
        "no_sharp_edges",
        "original_packaging",
        "working_condition",
        "no_recalled_model",
        "age_label_correct",
    }
    cleaned = {key: bool(value[key]) for key in allowed if key in value and isinstance(value[key], bool)}
    return cleaned or None


def _final_photo_keys(
    draft_photo_keys: list[str],
    *,
    hero_image_index: int | None,
    removed_photo_indices: list[int] | None,
) -> list[str]:
    removed = {
        int(idx)
        for idx in (removed_photo_indices or [])
        if isinstance(idx, int) and idx >= 0
    }
    indexed = [(idx, key) for idx, key in enumerate(draft_photo_keys or []) if idx not in removed]
    if not indexed:
        return []
    if hero_image_index is not None:
        for pos, (original_idx, key) in enumerate(indexed):
            if original_idx == hero_image_index:
                indexed.pop(pos)
                indexed.insert(0, (original_idx, key))
                break
    return [key for _, key in indexed]


def _seller_review_snapshot(
    *,
    payload: CreateFromDraftRequest,
    draft_ai_response: dict,
    photo_keys: list[str],
    final_fields: dict,
    original_price: float | None,
) -> dict:
    return {
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
        "ai_draft_id": str(payload.draft_id),
        "photo_count": len(photo_keys),
        "hero_image_index": payload.hero_image_index,
        "removed_photo_indices": payload.removed_photo_indices or [],
        "ai_detected": {
            "category_slug": draft_ai_response.get("category_slug"),
            "category_family": draft_ai_response.get("category_family"),
            "category_specifics": draft_ai_response.get("category_specifics") or {},
            "brand": draft_ai_response.get("brand"),
            "model": draft_ai_response.get("model"),
            "condition_guess": draft_ai_response.get("condition_guess"),
            "screen_condition": draft_ai_response.get("screen_condition"),
            "body_condition": draft_ai_response.get("body_condition"),
            "defects": draft_ai_response.get("defects") or [],
            "battery_health": draft_ai_response.get("battery_health"),
            "suggested_price_inr": draft_ai_response.get("suggested_price_inr"),
            "mrp_inr": draft_ai_response.get("mrp_inr"),
            "mrp_source": draft_ai_response.get("mrp_source"),
            "mrp_confidence": draft_ai_response.get("mrp_confidence"),
            "price_source": draft_ai_response.get("_owmee_price_source"),
            "field_evidence": draft_ai_response.get("field_evidence") or {},
            "field_confidence": draft_ai_response.get("field_confidence") or {},
            "flags": draft_ai_response.get("flags") or [],
            "blocking_reasons": draft_ai_response.get("blocking_reasons") or [],
        },
        "seller_confirmed": {
            **final_fields,
            "price": payload.price,
            "original_price": original_price,
            "seller_entered_original_price": payload.original_price,
            "mrp_source": payload.mrp_source,
            "mrp_confidence": payload.mrp_confidence,
            "seller_mrp_confirmed": bool(payload.seller_mrp_confirmed),
        },
    }


def _seller_review_snapshot_after_edit(raw_snapshot: dict | None, updates: dict) -> dict | None:
    if not isinstance(raw_snapshot, dict):
        return None
    confirmed = raw_snapshot.get("seller_confirmed")
    if not isinstance(confirmed, dict):
        return None

    next_snapshot = dict(raw_snapshot)
    next_confirmed = dict(confirmed)
    for key, value in updates.items():
        snapshot_key = "warranty_status" if key == "warranty_info" else key
        next_confirmed[snapshot_key] = float(value) if key == "price" and value is not None else value

    next_snapshot["seller_confirmed"] = next_confirmed
    next_snapshot["last_edited_at"] = datetime.now(timezone.utc).isoformat()
    return next_snapshot


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
    semaphore = asyncio.Semaphore(AI_DRAFT_IMAGE_IO_CONCURRENCY)

    async def _store_one(idx: int, image_bytes: bytes, content_type: str) -> tuple[str, str]:
        async with semaphore:
            return await _store_draft_photo(
                image_bytes=image_bytes,
                content_type=content_type,
                user_id=user_id,
                draft_id=draft_id,
                index=idx,
            )

    stored = await asyncio.gather(*[
        _store_one(idx, image_bytes, content_type)
        for idx, (image_bytes, content_type) in enumerate(image_pairs)
    ])
    photo_urls = [photo_url for photo_url, _ in stored]
    original_keys = [key for _, key in stored]
    return photo_urls, original_keys


async def _prepare_uploaded_analysis_images(images: list[UploadFile]) -> list[tuple[bytes, str]]:
    semaphore = asyncio.Semaphore(AI_DRAFT_IMAGE_IO_CONCURRENCY)

    async def _prepare_one(img: UploadFile) -> tuple[bytes, str] | None:
        async with semaphore:
            b = await img.read()
            if not b:
                return None
            if len(b) > MAX_ANALYSIS_UPLOAD_BYTES:
                raise HTTPException(status_code=400, detail="IMAGE_TOO_LARGE")
            prepared = await asyncio.to_thread(
                _prepare_analysis_image_bytes,
                b,
                img.content_type or "image/jpeg",
            )
            del b
            return prepared

    prepared = await asyncio.gather(*[_prepare_one(img) for img in images])
    return [pair for pair in prepared if pair is not None]


async def _timed_step(timings: dict[str, int], key: str, coro):
    started = perf_counter()
    try:
        return await coro
    finally:
        timings[key] = _ms_since(started)


def _latest_metric(metrics: list[dict] | None, operation: str | None = None) -> dict:
    for metric in reversed(metrics or []):
        if operation is None or metric.get("operation") == operation:
            return metric
    return {}


def _metric_payload(metric: dict | None) -> dict:
    if not metric:
        return {}
    keys = (
        "operation",
        "analysis_mode",
        "prompt_version",
        "fallback_from_operation",
        "fallback_reasons",
        "fast_quality_reasons",
        "fast_provider_metrics",
        "full_fallback_provider_metrics",
        "shadow_comparison",
        "shadow_provider_metrics",
        "provider",
        "model",
        "status",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "cached_tokens",
        "thoughts_tokens",
        "image_count",
        "bytes_total",
        "media_resolution",
        "error",
    )
    return {key: metric.get(key) for key in keys if metric.get(key) is not None}


def _vision_operation(mode: str) -> str:
    return "vision_full" if mode == "full" else "vision_fast"


def _vision_analysis_mode(metric: dict | None) -> str:
    return str((metric or {}).get("analysis_mode") or "fast_draft")


def _vision_prompt_version(metric: dict | None) -> str:
    return str((metric or {}).get("prompt_version") or "vision_fast_v1")


def _vision_media_resolution(metric: dict | None) -> str | None:
    if (metric or {}).get("media_resolution"):
        return (metric or {}).get("media_resolution")
    operation = (metric or {}).get("operation")
    analysis_mode = str((metric or {}).get("analysis_mode") or "")
    if operation == "vision_fast" or analysis_mode.startswith("fast"):
        return "low"
    return None


def _vision_contract_fast_path(metric: dict | None) -> bool:
    return str((metric or {}).get("analysis_mode") or "").startswith("fast")


def _blocking_photo_flags(detected: AIDetected) -> set[str]:
    flags = {str(flag).strip().lower() for flag in (detected.flags or []) if str(flag).strip()}
    quality = detected.image_set_quality or {}
    if isinstance(quality, dict):
        if quality.get("has_private_info") is True:
            flags.add("personal_info")
        if quality.get("is_stock_or_catalog_image_suspected") is True:
            flags.add("stock_or_catalog_suspected")
        if str(quality.get("overall_photo_quality") or "").lower() == "unusable":
            flags.add("blurry")
    return flags.intersection({
        "nsfw",
        "personal_info",
        "multiple_items",
        "no_product",
        "blurry",
        "packaging_only",
        "screenshot_only",
        "stock_or_catalog_suspected",
    })


def _fast_quality_reasons(detected: AIDetected) -> list[str]:
    if _blocking_photo_flags(detected):
        return []
    reasons: list[str] = []
    ai_failures = [
        str(flag).split(":", 1)[1]
        for flag in (detected.flags or [])
        if str(flag).startswith("ai_failed:")
    ]
    if ai_failures:
        if any(reason in {"parse_failed", "empty_response"} for reason in ai_failures):
            reasons.append("fast_ai_failed")
        return reasons
    if not detected.category_slug:
        reasons.append("missing_category")
    elif (detected.category_confidence or 0.0) < settings.ai_draft_fast_min_category_confidence:
        reasons.append("low_category_confidence")
    if not is_meaningful_other_detail(detected.title_suggestion):
        reasons.append("missing_title")
    if detected.manual_review_required and not _blocking_photo_flags(detected):
        reasons.append("manual_review_required")
    seen: set[str] = set()
    deduped: list[str] = []
    for reason in reasons:
        if reason in seen:
            continue
        seen.add(reason)
        deduped.append(reason)
    return deduped


def _fast_full_fallback_reasons(detected: AIDetected) -> list[str]:
    if not settings.ai_draft_full_fallback_enabled:
        return []
    return _fast_quality_reasons(detected)


def _can_run_shadow_full_analysis(detected: AIDetected) -> bool:
    if _blocking_photo_flags(detected):
        return False
    if detected.manual_review_required:
        return False
    if any(str(flag).startswith("ai_failed:") for flag in (detected.flags or [])):
        return False
    return bool(detected.category_slug)


def _mark_fast_quality_review_required(detected: AIDetected, reasons: list[str]) -> AIDetected:
    if not reasons:
        return detected
    flags = list(detected.flags or [])
    for reason in reasons:
        flag = f"fast_quality:{reason}"
        if flag not in flags:
            flags.append(flag)
    edit_fields = list(detected.seller_edit_fields or [])
    for field in ("category_slug", "title_suggestion", "brand", "model", "condition_guess"):
        if field not in edit_fields:
            edit_fields.append(field)
    return detected.model_copy(
        update={
            "flags": flags,
            "manual_review_required": True,
            "auto_publish_candidate": False,
            "seller_edit_fields": edit_fields,
        },
    )


def _shadow_comparison(primary: AIDetected, shadow: AIDetected) -> dict:
    return {
        "category_match": primary.category_slug == shadow.category_slug,
        "primary_category_slug": primary.category_slug,
        "shadow_category_slug": shadow.category_slug,
        "primary_category_confidence": primary.category_confidence,
        "shadow_category_confidence": shadow.category_confidence,
        "brand_match": (primary.brand or "").strip().lower() == (shadow.brand or "").strip().lower(),
        "model_match": (primary.model or "").strip().lower() == (shadow.model or "").strip().lower(),
        "condition_match": primary.condition_guess == shadow.condition_guess,
        "hero_match": primary.hero_image_index == shadow.hero_image_index,
        "primary_flags": list(primary.flags or []),
        "shadow_flags": list(shadow.flags or []),
    }


def _artifact_latency(fallback_ms: int | None, metric: dict | None) -> int | None:
    value = (metric or {}).get("latency_ms")
    if value is None:
        return fallback_ms
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback_ms


def _artifact_token(metric: dict | None, key: str) -> int | None:
    value = (metric or {}).get(key)
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def _detect_from_images_once(image_pairs: list[tuple[bytes, str]], *, mode: str) -> AIDetected:
    try:
        detector = ai_provider.detect_from_images if mode == "full" else ai_provider.detect_fast_from_images
        return await asyncio.wait_for(
            detector(image_pairs),
            timeout=VISION_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning(
            "ai_assistant.vision_timeout",
            extra={
                "timeout_seconds": VISION_TIMEOUT_SECONDS,
                "image_count": len(image_pairs),
                "mode": mode,
            },
        )
        return AIDetected(flags=["ai_failed:vision_timeout"])
    except Exception as e:
        log.warning(
            "ai_assistant.vision_unhandled_error",
            extra={"error": f"{type(e).__name__}: {str(e)[:240]}", "mode": mode},
        )
        return AIDetected(flags=["ai_failed:vision_error"])


async def _detect_from_images_bounded(image_pairs: list[tuple[bytes, str]]) -> AIDetected:
    mode = "fast" if settings.ai_draft_fast_path_enabled else "full"
    return await _detect_from_images_once(image_pairs, mode=mode)


async def _detect_from_images_bounded_with_metrics(image_pairs: list[tuple[bytes, str]]) -> tuple[AIDetected, dict]:
    mode = "fast" if settings.ai_draft_fast_path_enabled else "full"
    ai_provider.reset_call_metrics()
    detected = await _detect_from_images_once(image_pairs, mode=mode)
    metric = _latest_metric(ai_provider.consume_call_metrics(_vision_operation(mode)), _vision_operation(mode))
    metric = {
        **metric,
        "analysis_mode": "fast_draft" if mode == "fast" else "full_draft",
        "prompt_version": "vision_fast_v1" if mode == "fast" else "vision_full_v2",
    }

    fast_quality_reasons = _fast_quality_reasons(detected) if mode == "fast" else []
    fallback_reasons = _fast_full_fallback_reasons(detected) if mode == "fast" else []
    if fallback_reasons:
        ai_provider.reset_call_metrics()
        full_detected = await _detect_from_images_once(image_pairs, mode="full")
        full_metric = _latest_metric(ai_provider.consume_call_metrics("vision_full"), "vision_full")
        if not any(str(flag).startswith("ai_failed:") for flag in (full_detected.flags or [])):
            metric = {
                **full_metric,
                "analysis_mode": "full_fallback_from_fast",
                "prompt_version": "vision_full_v2",
                "fallback_from_operation": "vision_fast",
                "fallback_reasons": fallback_reasons,
                "fast_provider_metrics": _metric_payload(metric),
            }
            detected = full_detected
        else:
            detected = _mark_fast_quality_review_required(detected, fallback_reasons)
            metric = {
                **metric,
                "analysis_mode": "fast_draft_full_fallback_failed",
                "fallback_reasons": fallback_reasons,
                "full_fallback_provider_metrics": _metric_payload(full_metric),
            }
    elif mode == "fast" and fast_quality_reasons:
        detected = _mark_fast_quality_review_required(detected, fast_quality_reasons)
        metric = {
            **metric,
            "analysis_mode": "fast_draft_review_required",
            "fast_quality_reasons": fast_quality_reasons,
        }
    elif (
        mode == "fast"
        and settings.ai_draft_shadow_full_analysis_enabled
        and _can_run_shadow_full_analysis(detected)
    ):
        ai_provider.reset_call_metrics()
        shadow_detected = await _detect_from_images_once(image_pairs, mode="full")
        shadow_metric = _latest_metric(ai_provider.consume_call_metrics("vision_full"), "vision_full")
        metric = {
            **metric,
            "shadow_comparison": _shadow_comparison(detected, shadow_detected),
            "shadow_provider_metrics": _metric_payload({
                **shadow_metric,
                "analysis_mode": "shadow_full_from_fast",
                "prompt_version": "vision_full_v2",
            }),
        }

    return detected, metric


async def _detect_from_image_bounded(image_bytes: bytes, content_type: str) -> AIDetected:
    return await _detect_from_images_bounded([(image_bytes, content_type)])


async def _detect_from_image_bounded_with_metrics(image_bytes: bytes, content_type: str) -> tuple[AIDetected, dict]:
    return await _detect_from_images_bounded_with_metrics([(image_bytes, content_type)])


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


async def _estimate_price_bounded_with_metrics(coro) -> tuple[dict, dict]:
    ai_provider.reset_call_metrics()
    price_result = await _estimate_price_bounded(coro)
    return price_result, _latest_metric(ai_provider.consume_call_metrics("price_text"), "price_text")


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


def _hero_reordered_first(detected: AIDetected) -> AIDetected:
    """Call after move_hero_first(): the hero photo now lives at index 0 of
    the stored photo_urls, so the persisted hero_image_index (and the hero
    cleanup selected_index) must say 0 too. Persisting the pre-reorder index
    makes the client preselect the wrong photo and publish reorder again —
    the listing ships with the wrong hero."""
    image_quality = dict(detected.image_set_quality or {})
    cleanup = image_quality.get("hero_image_cleanup")
    if isinstance(cleanup, dict) and cleanup.get("selected_index") not in (None, 0):
        cleanup = dict(cleanup)
        cleanup["selected_index"] = 0
        image_quality["hero_image_cleanup"] = cleanup
    return detected.model_copy(
        update={"hero_image_index": 0, "image_set_quality": image_quality}
    )


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


def _draft_ai_response_json(
    detected: AIDetected,
    price_result: dict | None = None,
    *,
    contract: dict | None = None,
) -> str:
    payload = detected.model_dump()
    if price_result:
        payload["_owmee_price_source"] = price_result.get("source") or "none"
        if price_result.get("reasoning"):
            payload["_owmee_price_reasoning"] = str(price_result["reasoning"])[:240]
    payload["_owmee_contract"] = contract or draft_contracts.build_draft_contract(detected, price_result)
    return json.dumps(payload)


def _pricing_artifact_provider(price_result: dict | None) -> str:
    return "gemini" if (price_result or {}).get("source") == "ai" else "owmee"


def _pricing_artifact_model(price_result: dict | None) -> str | None:
    return ai_provider.current_text_model() if (price_result or {}).get("source") == "ai" else None


def _round_resale_price(value: float) -> float:
    if value < 500:
        return float(round(value / 10) * 10)
    if value < 5000:
        return float(round(value / 50) * 50)
    return float(round(value / 100) * 100)


def _mrp_anchor_price_result(detected: AIDetected, existing: dict | None = None) -> dict | None:
    """Conservative resale price from validated MRP when other pricing is absent.

    This is intentionally a fallback. Comparables, vision price, and text AI
    can use richer context. MRP alone is only allowed to rescue otherwise-null
    pricing when Gemini already returned a post-processed MRP and enough visible
    condition signal to avoid a fake discount.
    """
    mrp = detected.mrp_inr
    if not mrp or mrp <= 0:
        return None
    source = (detected.mrp_source or "").strip().lower()
    if source not in {"visible_mrp", "receipt_or_bill", "seller_entered"}:
        return None
    flags = set(detected.flags or [])
    if flags.intersection({"multiple_items", "no_product", "blurry", "screenshot_only", "stock_or_catalog_suspected"}):
        return None
    condition = (detected.condition_guess or "").strip().lower()
    if condition not in {"like_new", "good", "fair"}:
        return None

    factor = {"like_new": 0.62, "good": 0.50, "fair": 0.35}[condition]
    if detected.purchase_year:
        age = max(0, datetime.now(timezone.utc).year - int(detected.purchase_year))
        if age <= 1:
            factor += 0.08
        elif age >= 4:
            factor -= 0.08
    if detected.defects:
        factor -= min(0.10, 0.03 * len(detected.defects))
    factor = max(0.25, min(0.70, factor))

    price = _round_resale_price(float(mrp) * factor)
    if not price_estimator._sanity_check(price, detected.category_slug):  # noqa: SLF001 - shared guardrail
        return None
    if price >= float(mrp):
        return None

    return {
        "price": price,
        "source": "mrp_anchor",
        "reasoning": "Conservative resale estimate from validated MRP and visible condition.",
        "comparables": (existing or {}).get("comparables", []),
        "comparables_count": (existing or {}).get("comparables_count", 0),
    }


def _apply_price_fallbacks(price_result: dict, detected: AIDetected, *, prefer_vision: bool = True) -> dict:
    if prefer_vision and price_result["source"] in ("none", "ai") and detected.suggested_price_inr:
        return {
            "price": float(detected.suggested_price_inr),
            "source": "vision",
            "reasoning": detected.price_reasoning or "Inferred from photos",
            "comparables": price_result.get("comparables", []),
            "comparables_count": price_result.get("comparables_count", 0),
        }
    if price_result["source"] == "none":
        mrp_anchor = _mrp_anchor_price_result(detected, price_result)
        if mrp_anchor:
            return mrp_anchor
    if not prefer_vision and price_result["source"] == "none" and detected.suggested_price_inr:
        return {
            "price": float(detected.suggested_price_inr),
            "source": "vision",
            "reasoning": detected.price_reasoning or "Inferred from photos",
            "comparables": price_result.get("comparables", []),
            "comparables_count": price_result.get("comparables_count", 0),
        }
    return price_result


def _safe_text(value: str | None, *, max_len: int = 120) -> str | None:
    cleaned = (value or "").replace("\x00", "").strip()
    cleaned = " ".join(cleaned.split())
    return cleaned[:max_len] if cleaned else None


def _safe_defects(values: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        cleaned = _safe_text(value, max_len=80)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= 12:
            break
    return out


def _merge_mrp_from_price_result(detected: AIDetected, price_result: dict) -> AIDetected:
    """Carry only directly evidenced MRP back into the draft when vision had none."""
    if detected.mrp_inr:
        return detected
    mrp = price_result.get("mrp_inr")
    if not mrp:
        return detected
    try:
        mrp_value = int(float(mrp))
    except (TypeError, ValueError):
        return detected
    if mrp_value <= 0:
        return detected
    result_price = price_result.get("price")
    if result_price is not None and mrp_value <= float(result_price):
        return detected
    source = _safe_text(price_result.get("mrp_source"), max_len=40)
    if source not in {"visible_mrp", "receipt_or_bill", "seller_entered"}:
        return detected
    confidence = price_result.get("mrp_confidence")
    try:
        mrp_confidence = max(0.0, min(1.0, float(confidence or 0.0)))
    except (TypeError, ValueError):
        mrp_confidence = 0.0
    return detected.model_copy(update={
        "mrp_inr": mrp_value,
        "mrp_source": source,
        "mrp_confidence": mrp_confidence,
        "mrp_reasoning": _safe_text(price_result.get("mrp_reasoning"), max_len=200),
    })


def _draft_with_seller_price_inputs(detected: AIDetected, payload: DraftPriceRefreshRequest) -> AIDetected:
    """Overlay seller-confirmed review fields before recomputing price."""
    updates: dict = {}
    category = _canonical_category_slug(payload.category_slug, fallback_empty_to_others=False)
    if category:
        updates["category_slug"] = category
    family = category_family_for(
        category or detected.category_slug,
        detected_item_type=payload.detected_item_type or detected.detected_item_type,
        title=detected.title_suggestion,
        model=payload.model or detected.model,
    )
    updates["category_family"] = family
    raw_specifics = payload.category_specifics if isinstance(payload.category_specifics, dict) else detected.category_specifics
    updates["category_specifics"] = clean_category_specifics(family, raw_specifics)
    for field in ("brand", "model", "storage", "ram", "processor", "screen_size", "detected_item_type"):
        value = _safe_text(getattr(payload, field), max_len=120)
        if value:
            updates[field] = value
    if payload.condition in {"like_new", "good", "fair"}:
        updates["condition_guess"] = payload.condition
    if payload.purchase_year:
        updates["purchase_year"] = payload.purchase_year
    if payload.screen_condition in _VALID_SCREEN_CONDITIONS:
        updates["screen_condition"] = payload.screen_condition
    if payload.body_condition in _VALID_BODY_CONDITIONS:
        updates["body_condition"] = payload.body_condition
    if payload.defects is not None:
        updates["defects"] = _safe_defects(payload.defects)

    mrp_source = _safe_text(payload.mrp_source, max_len=40)
    if payload.original_price and mrp_source in _PRICE_REFRESH_MRP_SOURCES:
        updates["mrp_inr"] = int(round(float(payload.original_price)))
        updates["mrp_source"] = mrp_source
        updates["mrp_confidence"] = float(payload.mrp_confidence if payload.mrp_confidence is not None else 0.8)
        updates["mrp_reasoning"] = (
            "Seller confirmed MRP during listing review."
            if mrp_source == "seller_entered"
            else detected.mrp_reasoning
        )
    return detected.model_copy(update=updates)


def _clean_original_price_for_listing(
    *,
    asking_price: float,
    payload_original_price: float | None,
    seller_mrp_confirmed: bool | None,
    mrp_source: str | None,
) -> float | None:
    """Choose the MRP/original price to save on a published AI listing.

    Buyer-facing discount must be seller-reviewed. We intentionally do not
    persist an AI draft MRP fallback here; latest mobile sends `original_price`
    only after the seller confirms the MRP and source in the review flow.
    """
    source = (mrp_source or "").strip().lower()
    if not seller_mrp_confirmed or source not in {"visible_mrp", "receipt_or_bill", "seller_entered"}:
        return None
    raw_value = payload_original_price
    if raw_value is None:
        return None
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return None

    if value <= 0 or value > 10_000_000:
        return None
    if value <= float(asking_price):
        return None
    return round(value, 2)


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
    detected, vision_metric = await _detect_from_image_bounded_with_metrics(image_bytes, content_type)
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
    price_result, price_metric = await _estimate_price_bounded_with_metrics(
        price_estimator.estimate_price(
            db,
            brand=detected.brand,
            model=detected.model,
            storage=detected.storage,
            condition=detected.condition_guess or "good",
            state=user_state,
            category_slug=detected.category_slug,
            detected_item_type=detected.detected_item_type,
            allow_ai_fallback=False,
        )
    )
    timings["price_ms"] = _ms_since(step_started)

    # If comparables did not yield a price, prefer vision's photo-aware price;
    # if vision also withheld a price, a validated MRP can still provide a
    # conservative resale anchor instead of returning a fake-looking zero.
    price_result = _apply_price_fallbacks(price_result, detected)
    if price_result["source"] == "none":
        fallback_reason = price_result.get("reasoning")
    draft_contract = draft_contracts.build_draft_contract(
        detected,
        price_result,
        fast_path=_vision_contract_fast_path(vision_metric),
    )
    contract_statuses = draft_contract["statuses"]
    await draft_contracts.upsert_category_field_definitions(db, detected.category_slug)

    # Persist the draft. ai_response is JSONB; pass JSON string and CAST.
    step_started = perf_counter()
    await db.execute(
        text("""
            INSERT INTO listing_drafts (
                id, user_id, photo_urls, ai_response, suggested_price,
                comparables_count, ai_model, status,
                category_slug, category_schema_version, draft_revision,
                image_set_hash, safety_status, core_analysis_status,
                category_enrichment_status, pricing_status, copy_status,
                seller_review_status, publish_blockers, required_actions
            )
            VALUES (
                :id, :uid, :photo_urls, CAST(:ai_response AS JSONB),
                :price, :ccount, :model, 'open',
                :category_slug, :category_schema_version, 1,
                :image_set_hash, :safety_status, :core_analysis_status,
                :category_enrichment_status, :pricing_status, :copy_status,
                :seller_review_status, CAST(:publish_blockers AS JSONB),
                CAST(:required_actions AS JSONB)
            )
        """).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString))),
        {
            "id": draft_id,
            "uid": user.user_id,
            "photo_urls": [photo_url],
            "ai_response": _draft_ai_response_json(detected, price_result, contract=draft_contract),
            "price": price_result.get("price"),
            "ccount": price_result.get("comparables_count", 0),
            "model": ai_provider.current_vision_model(),
            "category_slug": draft_contract["category_slug"],
            "category_schema_version": draft_contract["category_schema_version"],
            "image_set_hash": draft_contracts.image_set_hash_from_pairs([(image_bytes, content_type)]),
            "safety_status": contract_statuses["safety_status"],
            "core_analysis_status": contract_statuses["core_analysis_status"],
            "category_enrichment_status": contract_statuses["category_enrichment_status"],
            "pricing_status": contract_statuses["pricing_status"],
            "copy_status": contract_statuses["copy_status"],
            "seller_review_status": contract_statuses["seller_review_status"],
            "publish_blockers": json.dumps(draft_contract["publish_blockers"]),
            "required_actions": json.dumps(draft_contract["required_actions"]),
        },
    )
    await draft_contracts.record_draft_images(
        db,
        draft_id=draft_id,
        display_keys=[photo_url],
        image_pairs=[(image_bytes, content_type)],
    )
    vision_artifact_id = await draft_contracts.record_analysis_artifact(
        db,
        draft_id=draft_id,
        stage=draft_contracts.STAGE_VISION_CORE,
        status=contract_statuses["core_analysis_status"],
        input_payload={
            "analysis_mode": _vision_analysis_mode(vision_metric),
            "image_count": 1,
            "bytes_total": len(image_bytes),
            "media_resolution": _vision_media_resolution(vision_metric),
            "provider_metrics": _metric_payload(vision_metric),
        },
        output_payload=detected.model_dump(),
        model=ai_provider.current_vision_model(),
        prompt_version=_vision_prompt_version(vision_metric),
        latency_ms=_artifact_latency(timings.get("vision_ms"), vision_metric),
        input_tokens=_artifact_token(vision_metric, "input_tokens"),
        output_tokens=_artifact_token(vision_metric, "output_tokens"),
        cached_tokens=_artifact_token(vision_metric, "cached_tokens"),
        error_code=fallback_reason if ai_failed else None,
    )
    await draft_contracts.record_ai_field_values(
        db,
        draft_id=draft_id,
        detected=detected,
        artifact_id=vision_artifact_id,
    )
    pricing_artifact_id = await draft_contracts.record_analysis_artifact(
        db,
        draft_id=draft_id,
        stage=draft_contracts.STAGE_PRICING,
        status=contract_statuses["pricing_status"],
        input_payload={
            "category_slug": detected.category_slug,
            "brand": detected.brand,
            "model": detected.model,
            "storage": detected.storage,
            "condition": detected.condition_guess or "good",
            "state": user_state,
            "provider_metrics": _metric_payload(price_metric),
        },
        output_payload=price_result,
        provider=_pricing_artifact_provider(price_result),
        model=_pricing_artifact_model(price_result),
        latency_ms=_artifact_latency(timings.get("price_ms"), price_metric),
        input_tokens=_artifact_token(price_metric, "input_tokens"),
        output_tokens=_artifact_token(price_metric, "output_tokens"),
        cached_tokens=_artifact_token(price_metric, "cached_tokens"),
    )
    await draft_contracts.record_pricing_field_values(
        db,
        draft_id=draft_id,
        price_result=price_result,
        artifact_id=pricing_artifact_id,
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
        photo_urls=[_client_photo_url(photo_url)] if photo_url else [],
        detected=detected,
        suggested_price=price_result.get("price"),
        price_source=price_result["source"],
        comparables=price_result.get("comparables", []),
        expires_at=expires_at,
        needs_identifier=_category_needs_identifier(detected.category_slug),
        fallback_reason=fallback_reason,
        analysis_contract=draft_contract,
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
    content_types: list[str] = []
    expires_in = 300

    for idx, image in enumerate(payload.images):
        content_type = _safe_upload_content_type(image.content_type)
        key = _draft_photo_object_key(user.user_id, draft_id, idx, _image_extension(content_type))
        upload_url = generate_presigned_upload_url(key, content_type=content_type, expires_in=expires_in)
        photo_keys.append(key)
        content_types.append(content_type)
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
                id, user_id, photo_urls, ai_response, status,
                category_schema_version, draft_revision, image_set_hash,
                safety_status, core_analysis_status, category_enrichment_status,
                pricing_status, copy_status, seller_review_status,
                publish_blockers, required_actions
            )
            VALUES (
                :id, :uid, :photo_urls, CAST(:ai_response AS JSONB), 'uploading',
                :category_schema_version, 1, :image_set_hash,
                'pending', 'pending', 'pending',
                'pending', 'pending', 'pending',
                '[]'::jsonb, CAST(:required_actions AS JSONB)
            )
        """).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString))),
        {
            "id": draft_id,
            "uid": user.user_id,
            "photo_urls": photo_keys,
            "ai_response": json.dumps({"async_status": "uploading"}),
            "category_schema_version": draft_contracts.CATEGORY_SCHEMA_VERSION,
            "image_set_hash": draft_contracts.image_set_hash_from_keys(photo_keys),
            "required_actions": json.dumps(["upload_photos", "start_analysis"]),
        },
    )
    await draft_contracts.record_draft_image_placeholders(
        db,
        draft_id=draft_id,
        photo_keys=photo_keys,
        content_types=content_types,
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
                ai_response = CAST(:ai_response AS JSONB),
                core_analysis_status = 'processing',
                safety_status = 'pending',
                category_enrichment_status = 'pending',
                pricing_status = 'pending',
                copy_status = 'pending',
                required_actions = CAST(:required_actions AS JSONB)
            WHERE id = :id
        """),
        {
            "id": draft_id,
            "ai_response": json.dumps({"async_status": "processing"}),
            "required_actions": json.dumps(["wait_for_analysis"]),
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
                       comparables_count, status, expires_at,
                       category_slug, category_schema_version, draft_revision
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
        price_source = raw_ai.get("_owmee_price_source")
        if not price_source:
            price_source = "vision" if row["suggested_price"] is not None else "none"
        photo_urls = list(row["photo_urls"] or [])
        fallback_reason = next(
            (f.split(":", 1)[1] for f in detected.flags if f.startswith("ai_failed:")),
            None,
        )
        draft = DraftFromImageResponse(
            draft_id=draft_id,
            photo_url=_client_photo_url(photo_urls[0] if photo_urls else None),
            photo_urls=[_client_photo_url(key) for key in photo_urls if key],
            detected=detected,
            suggested_price=float(row["suggested_price"]) if row["suggested_price"] is not None else None,
            price_source=price_source,
            comparables=[],
            expires_at=row["expires_at"] or datetime.now(timezone.utc),
            needs_identifier=_category_needs_identifier(detected.category_slug),
            fallback_reason=fallback_reason,
            analysis_contract=raw_ai.get("_owmee_contract") or {},
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


@router.post("/draft/{draft_id}/price-suggestion", response_model=DraftFromImageResponse)
async def refresh_ai_draft_price(
    draft_id: UUID,
    payload: DraftPriceRefreshRequest,
    user: AuthUser,
    db: DBSession,
):
    """Recompute MRP + asking-price guidance from seller-confirmed details."""
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
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={"error": "DRAFT_EXPIRED", "message": "This draft expired. Please analyse the photos again."},
        )
    if row["status"] != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "DRAFT_NOT_READY", "message": "Photo analysis is still running. Please wait a moment."},
        )

    raw_ai = row["ai_response"] if isinstance(row["ai_response"], dict) else {}
    old_category_slug = row.get("category_slug") or raw_ai.get("category_slug")
    prior_schema_version = row.get("category_schema_version") or draft_contracts.CATEGORY_SCHEMA_VERSION
    detected = _draft_with_seller_price_inputs(AIDetected(**raw_ai), payload)
    detected = _with_canonical_category(detected)
    category_reconciliation = await draft_contracts.record_category_change_if_needed(
        db,
        draft_id=draft_id,
        old_category=old_category_slug,
        new_category=detected.category_slug,
        changed_by="seller",
        prior_schema_version=prior_schema_version,
    )

    rejection = _publish_rejection_detail(detected.model_dump())
    fallback_reason = None
    price_metric: dict = {}
    if rejection:
        price_result = {
            "price": None,
            "source": "none",
            "reasoning": rejection.get("message") or "Photo review required before pricing.",
            "comparables": [],
            "comparables_count": 0,
        }
        fallback_reason = price_result["reasoning"]
    else:
        from app.modules.identity_auth.user_location import get_user_location
        _, _, _, user_state = await get_user_location(db, user.user_id)
        price_result, price_metric = await _estimate_price_bounded_with_metrics(
            price_estimator.estimate_price(
                db,
                brand=detected.brand,
                model=detected.model,
                storage=detected.storage,
                condition=detected.condition_guess or "good",
                state=user_state,
                category_slug=detected.category_slug,
                detected_item_type=detected.detected_item_type,
                allow_ai_fallback=True,
            )
        )
        detected = _merge_mrp_from_price_result(detected, price_result)
        price_result = _apply_price_fallbacks(price_result, detected, prefer_vision=False)
        if price_result["source"] == "none":
            fallback_reason = price_result.get("reasoning")
    draft_contract = draft_contracts.build_draft_contract(
        detected,
        price_result,
        stale_fields=category_reconciliation.get("stale_fields") or [],
    )
    contract_statuses = draft_contract["statuses"]
    await draft_contracts.upsert_category_field_definitions(db, detected.category_slug)

    await db.execute(
        text("""
            UPDATE listing_drafts
            SET ai_response = CAST(:ai_response AS JSONB),
                suggested_price = :price,
                comparables_count = :ccount,
                category_slug = :category_slug,
                category_schema_version = :category_schema_version,
                draft_revision = draft_revision + :revision_delta,
                safety_status = :safety_status,
                core_analysis_status = :core_analysis_status,
                category_enrichment_status = :category_enrichment_status,
                pricing_status = :pricing_status,
                copy_status = :copy_status,
                seller_review_status = :seller_review_status,
                publish_blockers = CAST(:publish_blockers AS JSONB),
                required_actions = CAST(:required_actions AS JSONB)
            WHERE id = :id
        """),
        {
            "id": draft_id,
            "ai_response": _draft_ai_response_json(detected, price_result, contract=draft_contract),
            "price": price_result.get("price"),
            "ccount": price_result.get("comparables_count", 0),
            "category_slug": draft_contract["category_slug"],
            "category_schema_version": draft_contract["category_schema_version"],
            "revision_delta": 1 if category_reconciliation.get("category_changed") else 0,
            "safety_status": contract_statuses["safety_status"],
            "core_analysis_status": contract_statuses["core_analysis_status"],
            "category_enrichment_status": contract_statuses["category_enrichment_status"],
            "pricing_status": contract_statuses["pricing_status"],
            "copy_status": contract_statuses["copy_status"],
            "seller_review_status": contract_statuses["seller_review_status"],
            "publish_blockers": json.dumps(draft_contract["publish_blockers"]),
            "required_actions": json.dumps(draft_contract["required_actions"]),
        },
    )
    pricing_artifact_id = await draft_contracts.record_analysis_artifact(
        db,
        draft_id=draft_id,
        stage=draft_contracts.STAGE_PRICING,
        status=contract_statuses["pricing_status"],
        input_payload={
            **payload.model_dump(exclude_none=True),
            "provider_metrics": _metric_payload(price_metric),
        },
        output_payload=price_result,
        provider=_pricing_artifact_provider(price_result),
        model=_pricing_artifact_model(price_result),
        latency_ms=_artifact_latency(None, price_metric),
        input_tokens=_artifact_token(price_metric, "input_tokens"),
        output_tokens=_artifact_token(price_metric, "output_tokens"),
        cached_tokens=_artifact_token(price_metric, "cached_tokens"),
    )
    await draft_contracts.record_ai_field_values(
        db,
        draft_id=draft_id,
        detected=detected,
        artifact_id=pricing_artifact_id,
    )
    await draft_contracts.record_pricing_field_values(
        db,
        draft_id=draft_id,
        price_result=price_result,
        artifact_id=pricing_artifact_id,
    )
    await draft_contracts.record_seller_field_confirmations(
        db,
        draft_id=draft_id,
        fields=payload.model_dump(exclude_none=True),
    )
    await db.commit()

    photo_urls = list(row["photo_urls"] or [])
    log.info(
        "ai_assistant.draft_price_refreshed",
        extra={
            "draft_id": str(draft_id),
            "category_slug": detected.category_slug,
            "price_source": price_result.get("source"),
            "has_mrp": bool(detected.mrp_inr),
        },
    )
    return DraftFromImageResponse(
        draft_id=draft_id,
        photo_url=_client_photo_url(photo_urls[0] if photo_urls else None),
        photo_urls=[_client_photo_url(key) for key in photo_urls if key],
        detected=detected,
        suggested_price=price_result.get("price"),
        price_source=price_result.get("source") or "none",
        comparables=price_result.get("comparables", []),
        expires_at=row["expires_at"] or datetime.now(timezone.utc),
        needs_identifier=_category_needs_identifier(detected.category_slug),
        fallback_reason=fallback_reason,
        analysis_contract=draft_contract,
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
            SELECT user_id, photo_urls, expires_at, status, ai_response
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
    seller_kyc_row = await db.execute(
        text("SELECT kyc_status FROM users WHERE id = :uid"),
        {"uid": user.user_id},
    )
    seller_kyc_verified_at_listing_time = seller_kyc_row.scalar() == "verified"

    # Sprint trust pillar: hyperlocal-pilot geo-fence. Same gate as the
    # non-AI listing path — mirrored here so the AI flow can't bypass.
    from app.core.zones import is_in_service_area, out_of_service_message
    if not is_in_service_area(seller_lat, seller_lng):
        raise HTTPException(status_code=400, detail=out_of_service_message())

    draft_ai_response = rec.ai_response if isinstance(rec.ai_response, dict) else {}
    publish_rejection = _publish_rejection_detail(draft_ai_response)
    if publish_rejection:
        raise HTTPException(status_code=400, detail=publish_rejection)
    detail_rejection = _publish_detail_rejection(category_slug, payload)
    if detail_rejection:
        raise HTTPException(status_code=400, detail=detail_rejection)
    category_family = category_family_for(
        category_slug,
        detected_item_type=payload.model or draft_ai_response.get("detected_item_type"),
        title=payload.title or draft_ai_response.get("title_suggestion"),
        model=payload.model or draft_ai_response.get("model"),
    )

    # Start from the draft's canonical photo keys. The review screen can remove
    # accidental/bad photos and choose a hero by original index; extra images
    # from older clients are appended after that.
    photo_urls = _final_photo_keys(
        list(rec.photo_urls or []),
        hero_image_index=payload.hero_image_index,
        removed_photo_indices=payload.removed_photo_indices,
    )
    if payload.image_urls:
        for u in payload.image_urls:
            if u not in photo_urls:
                photo_urls.append(u)
    if len(photo_urls) < MIN_PHOTOS_REQUIRED:
        raise HTTPException(status_code=400, detail=_min_photo_detail(len(photo_urls)))

    original_price = _clean_original_price_for_listing(
        asking_price=payload.price,
        payload_original_price=payload.original_price,
        seller_mrp_confirmed=payload.seller_mrp_confirmed,
        mrp_source=payload.mrp_source,
    )
    screen_condition = _clean_condition_choice(
        payload.screen_condition or draft_ai_response.get("screen_condition"),
        _VALID_SCREEN_CONDITIONS,
    )
    body_condition = _clean_condition_choice(
        payload.body_condition or draft_ai_response.get("body_condition"),
        _VALID_BODY_CONDITIONS,
    )
    defects = _clean_defects(payload.defects)
    if defects is None:
        defects = _clean_defects(draft_ai_response.get("defects")) or []
    battery_health = payload.battery_health
    if battery_health is None:
        try:
            raw_battery = draft_ai_response.get("battery_health")
            battery_health = int(raw_battery) if raw_battery is not None else None
            if battery_health is not None and not (0 <= battery_health <= 100):
                battery_health = None
        except (TypeError, ValueError):
            battery_health = None
    kids_safety_checklist = _clean_kids_safety_checklist(payload.kids_safety_checklist)
    category_specifics = _with_seeded_category_specifics(
        category_family=category_family,
        payload=payload,
        draft_ai_response=draft_ai_response,
    )
    category_specific_rejection = _publish_category_specifics_rejection(
        category_slug=category_slug,
        category_family=category_family,
        category_specifics=category_specifics,
        kids_safety_checklist=kids_safety_checklist,
        description=payload.description,
        payload=payload,
    )
    if category_specific_rejection:
        raise HTTPException(status_code=400, detail=category_specific_rejection)
    final_review_fields = {
        "category_slug": category_slug,
        "category_family": category_family,
        "category_specifics": category_specifics,
        "title": payload.title,
        "condition": payload.condition,
        "brand": payload.brand,
        "model": payload.model,
        "storage": payload.storage,
        "ram": payload.ram,
        "processor": payload.processor,
        "screen_size": payload.screen_size,
        "color": payload.color,
        "purchase_year": payload.purchase_year,
        "screen_condition": screen_condition,
        "body_condition": body_condition,
        "defects": defects,
        "battery_health": battery_health,
        "accessories": payload.accessories,
        "warranty_status": payload.warranty_status,
        "age_suitability": payload.age_suitability,
        "hygiene_status": payload.hygiene_status,
        "has_box": payload.has_box,
        "has_bill": payload.has_bill,
        "has_charger": payload.has_charger,
        "has_earphones": payload.has_earphones,
        "water_damage_history": payload.water_damage_history,
        "seller_functional_attestation": payload.seller_functional_attestation,
        "kids_safety_checklist": kids_safety_checklist,
    }
    seller_review_snapshot = _seller_review_snapshot(
        payload=payload,
        draft_ai_response=draft_ai_response,
        photo_keys=photo_urls,
        final_fields=final_review_fields,
        original_price=original_price,
    )
    listing_id = uuid4()

    # bindparam declares image_urls as TEXT[] so asyncpg sends a real
    # Postgres array (avoids string-literal escaping issues with URLs).
    insert_sql = text("""
        INSERT INTO listings (
            id, seller_id, category_id, title, description, price, condition,
            status, moderation_status, image_urls, thumbnail_url,
            brand, model, storage, ram, processor, screen_size, color,
            purchase_year, screen_condition, body_condition, defects,
            battery_health, accessories, warranty_info,
            age_suitability, hygiene_status,
            has_box, has_bill, has_charger, has_earphones,
            water_damage_history, seller_functional_attestation,
            kids_safety_checklist, serial_number, original_price,
            imei_1, imei_2, listing_state, verification_status, video_url,
            ai_draft_id, city, state, listing_source, reviewed_by,
            seller_kyc_verified_at_listing_time, seller_review_snapshot, published_at
        )
        VALUES (
            :id, :seller_id, :category_id, :title, :description, :price, :condition,
            'active', 'pending', :image_urls, :thumb,
            :brand, :model, :storage, :ram, :processor, :screen_size, :color,
            :purchase_year, :screen_condition, :body_condition, CAST(:defects AS JSONB),
            :battery_health, :accessories, :warranty_info,
            :age_suitability, :hygiene_status,
            :has_box, :has_bill, :has_charger, :has_earphones,
            :water_damage_history, :seller_functional_attestation,
            CAST(:kids_safety_checklist AS JSONB), :serial, :original_price,
            :imei_1, :imei_2, 'pending_buyer', :verif, :video,
            :draft_id, :city, :state, 'self_prep', 'none',
            :seller_kyc_verified_at_listing_time, CAST(:seller_review_snapshot AS JSONB), NOW()
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
            "screen_condition": screen_condition,
            "body_condition": body_condition,
            "defects": json.dumps(defects),
            "battery_health": battery_health,
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
            "kids_safety_checklist": json.dumps(kids_safety_checklist) if kids_safety_checklist else None,
            "serial": serial_number,
            "original_price": original_price,
            "imei_1": payload.imei_1,
            "imei_2": payload.imei_2,
            "verif": verification_status,
            "video": payload.video_url,
            "draft_id": payload.draft_id,
            "city": seller_city,
            "state": seller_state,
            "seller_kyc_verified_at_listing_time": seller_kyc_verified_at_listing_time,
            "seller_review_snapshot": json.dumps(seller_review_snapshot),
        },
    )

    # Geo as a separate UPDATE (avoids parameter conflicts in INSERT)
    if seller_lat is not None and seller_lng is not None:
        await db.execute(
            text("UPDATE listings SET geo_point = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) WHERE id = :id"),
            {"lat": seller_lat, "lng": seller_lng, "id": listing_id},
        )

    # Mark the draft consumed
    await draft_contracts.record_seller_field_confirmations(
        db,
        draft_id=payload.draft_id,
        fields={
            **final_review_fields,
            "price": payload.price,
            "original_price": original_price,
            "imei_1": payload.imei_1,
            "imei_2": payload.imei_2,
            "serial_number": serial_number,
        },
    )
    await draft_contracts.record_analysis_artifact(
        db,
        draft_id=payload.draft_id,
        stage=draft_contracts.STAGE_SELLER_CONFIRMATION,
        status="success",
        input_payload={
            "category_slug": category_slug,
            "photo_count": len(photo_urls),
            "listing_id": str(listing_id),
        },
        output_payload=seller_review_snapshot,
        provider="owmee",
        model=None,
    )
    await db.execute(
        text("""
            UPDATE listing_drafts
            SET status = 'consumed',
                seller_review_status = 'confirmed',
                required_actions = '[]'::jsonb
            WHERE id = :id
        """),
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
        original_price=original_price,
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
            SELECT seller_id, listing_state, status, seller_review_snapshot
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
        "screen_condition": payload.screen_condition,
        "body_condition": payload.body_condition,
        "defects": payload.defects,
        "has_box": payload.has_box,
        "has_bill": payload.has_bill,
        "has_charger": payload.has_charger,
        "has_earphones": payload.has_earphones,
        "water_damage_history": payload.water_damage_history,
        "seller_functional_attestation": payload.seller_functional_attestation,
    }
    updates = {k: v for k, v in field_map.items() if v is not None}

    if not updates:
        return EditListingResponse(
            listing_id=listing_id,
            updated_fields=[],
            listing_state=listing_state,
        )

    set_parts: list[str] = []
    params: dict = {"id": listing_id}
    for key, value in updates.items():
        if key == "defects":
            set_parts.append("defects = CAST(:defects AS JSONB)")
            params["defects"] = json.dumps(value)
            continue
        set_parts.append(f"{key} = :{key}")
        params[key] = value
    next_snapshot = _seller_review_snapshot_after_edit(rec.seller_review_snapshot, updates)
    if next_snapshot is not None:
        set_parts.append("seller_review_snapshot = CAST(:seller_review_snapshot AS JSONB)")
        params["seller_review_snapshot"] = json.dumps(next_snapshot)
    set_clause = ", ".join(set_parts)
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

    # Read + normalize uploaded files with bounded parallelism. The limit keeps
    # peak memory stable while removing the avoidable per-photo serial wait.
    image_pairs = await _prepare_uploaded_analysis_images(images)
    timings["read_ms"] = _ms_since(step_started)

    if not image_pairs:
        raise HTTPException(status_code=400, detail="EMPTY_IMAGES")

    draft_id = uuid4()

    # Store photos before vision. This avoids running Pillow/WebP processing
    # and Gemini multipart assembly at the same time, which can exceed memory
    # on small production instances when several users list in parallel.
    from app.modules.identity_auth.user_location import get_user_location

    location_task = _timed_step(timings, "location_ms", get_user_location(db, user.user_id))
    photo_urls, original_keys = await _timed_step(
        timings,
        "store_ms",
        _store_draft_photos(image_pairs, user_id=user.user_id, draft_id=draft_id),
    )
    (detected, vision_metric), (_lat, _lng, _city, user_state) = await asyncio.gather(
        _timed_step(timings, "vision_ms", _detect_from_images_bounded_with_metrics(image_pairs)),
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

    async def price_step() -> tuple[dict, dict]:
        return await _estimate_price_bounded_with_metrics(
            price_estimator.estimate_price(
                db,
                brand=detected.brand,
                model=detected.model,
                storage=detected.storage,
                condition=detected.condition_guess or "good",
                state=user_state,
                category_slug=detected.category_slug,
                detected_item_type=detected.detected_item_type,
                allow_ai_fallback=False,
            )
        )

    price_result, price_metric = await _timed_step(timings, "price_ms", price_step())

    stored_photo_urls = list(photo_urls)
    photo_urls = move_hero_first(photo_urls, hero_index)
    detected = _hero_reordered_first(detected)

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

    price_result = _apply_price_fallbacks(price_result, detected)
    if price_result["source"] == "none" and fallback_reason is None:
        fallback_reason = price_result.get("reasoning")
    draft_contract = draft_contracts.build_draft_contract(
        detected,
        price_result,
        fast_path=_vision_contract_fast_path(vision_metric),
    )
    contract_statuses = draft_contract["statuses"]
    await draft_contracts.upsert_category_field_definitions(db, detected.category_slug)

    # Persist draft
    step_started = perf_counter()
    await db.execute(
        text("""
            INSERT INTO listing_drafts (
                id, user_id, photo_urls, ai_response, suggested_price,
                comparables_count, ai_model, status,
                category_slug, category_schema_version, draft_revision,
                image_set_hash, safety_status, core_analysis_status,
                category_enrichment_status, pricing_status, copy_status,
                seller_review_status, publish_blockers, required_actions
            )
            VALUES (
                :id, :uid, :photo_urls, CAST(:ai_response AS JSONB),
                :price, :ccount, :model, 'open',
                :category_slug, :category_schema_version, 1,
                :image_set_hash, :safety_status, :core_analysis_status,
                :category_enrichment_status, :pricing_status, :copy_status,
                :seller_review_status, CAST(:publish_blockers AS JSONB),
                CAST(:required_actions AS JSONB)
            )
        """).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString))),
        {
            "id": draft_id,
            "uid": user.user_id,
            "photo_urls": photo_urls,
            "ai_response": _draft_ai_response_json(detected, price_result, contract=draft_contract),
            "price": price_result.get("price"),
            "ccount": price_result.get("comparables_count", 0),
            "model": ai_provider.current_vision_model(),
            "category_slug": draft_contract["category_slug"],
            "category_schema_version": draft_contract["category_schema_version"],
            "image_set_hash": draft_contracts.image_set_hash_from_pairs(image_pairs),
            "safety_status": contract_statuses["safety_status"],
            "core_analysis_status": contract_statuses["core_analysis_status"],
            "category_enrichment_status": contract_statuses["category_enrichment_status"],
            "pricing_status": contract_statuses["pricing_status"],
            "copy_status": contract_statuses["copy_status"],
            "seller_review_status": contract_statuses["seller_review_status"],
            "publish_blockers": json.dumps(draft_contract["publish_blockers"]),
            "required_actions": json.dumps(draft_contract["required_actions"]),
        },
    )
    await draft_contracts.record_draft_images(
        db,
        draft_id=draft_id,
        display_keys=stored_photo_urls,
        image_pairs=image_pairs,
        original_keys=original_keys,
    )
    vision_artifact_id = await draft_contracts.record_analysis_artifact(
        db,
        draft_id=draft_id,
        stage=draft_contracts.STAGE_VISION_CORE,
        status=contract_statuses["core_analysis_status"],
        input_payload={
            "analysis_mode": _vision_analysis_mode(vision_metric),
            "image_count": len(image_pairs),
            "bytes_total": sum(len(b) for b, _ in image_pairs),
            "media_resolution": _vision_media_resolution(vision_metric),
            "provider_metrics": _metric_payload(vision_metric),
        },
        output_payload=detected.model_dump(),
        model=ai_provider.current_vision_model(),
        prompt_version=_vision_prompt_version(vision_metric),
        latency_ms=_artifact_latency(timings.get("vision_ms"), vision_metric),
        input_tokens=_artifact_token(vision_metric, "input_tokens"),
        output_tokens=_artifact_token(vision_metric, "output_tokens"),
        cached_tokens=_artifact_token(vision_metric, "cached_tokens"),
        error_code=fallback_reason if ai_failed else None,
    )
    await draft_contracts.record_ai_field_values(
        db,
        draft_id=draft_id,
        detected=detected,
        artifact_id=vision_artifact_id,
    )
    pricing_artifact_id = await draft_contracts.record_analysis_artifact(
        db,
        draft_id=draft_id,
        stage=draft_contracts.STAGE_PRICING,
        status=contract_statuses["pricing_status"],
        input_payload={
            "category_slug": detected.category_slug,
            "brand": detected.brand,
            "model": detected.model,
            "storage": detected.storage,
            "condition": detected.condition_guess or "good",
            "state": user_state,
            "provider_metrics": _metric_payload(price_metric),
        },
        output_payload=price_result,
        provider=_pricing_artifact_provider(price_result),
        model=_pricing_artifact_model(price_result),
        latency_ms=_artifact_latency(timings.get("price_ms"), price_metric),
        input_tokens=_artifact_token(price_metric, "input_tokens"),
        output_tokens=_artifact_token(price_metric, "output_tokens"),
        cached_tokens=_artifact_token(price_metric, "cached_tokens"),
    )
    await draft_contracts.record_pricing_field_values(
        db,
        draft_id=draft_id,
        price_result=price_result,
        artifact_id=pricing_artifact_id,
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
        photo_urls=[_client_photo_url(key) for key in photo_urls if key],
        detected=detected,
        suggested_price=price_result.get("price"),
        price_source=price_result["source"],
        comparables=price_result.get("comparables", []),
        expires_at=expires_at,
        needs_identifier=_category_needs_identifier(detected.category_slug),
        fallback_reason=fallback_reason,
        analysis_contract=draft_contract,
    )

# ── End Sprint 8 Phase 2.1 multi-image block ─────────────────────────────  # SPRINT8_PHASE2_GEMINI_V2
