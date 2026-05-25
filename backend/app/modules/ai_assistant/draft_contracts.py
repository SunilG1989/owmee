"""AI draft contract and artifact persistence helpers.

The listing flow still returns the legacy ``ai_response`` summary for mobile
compatibility, but durable AI work now has its own contract:

- category schemas define which fields matter for the current category
- AI artifacts record stage/model/schema/timing/output lineage
- field values keep source/evidence/confidence separate from seller-confirmed
  listing data
- category changes invalidate stale category-specific fields explicitly
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from io import BytesIO
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.types import String as SAString

from app.modules.ai_assistant.category_taxonomy import (
    CATEGORY_SLUGS,
    IDENTIFIER_CATEGORIES,
    canonical_category_slug,
    is_meaningful_other_detail,
)
from app.modules.ai_assistant.schemas import AIDetected


AI_DRAFT_CONTRACT_SCHEMA_VERSION = 1
CATEGORY_SCHEMA_VERSION = 1

STAGE_PHOTO_PREFLIGHT = "photo_preflight_v1"
STAGE_VISION_CORE = "vision_core_v1"
STAGE_CATEGORY_ENRICHMENT = "category_enrichment_v1"
STAGE_PRICING = "pricing_v1"
STAGE_COPY = "copy_v1"
STAGE_SELLER_CONFIRMATION = "seller_confirmation_v1"

_BLOCKING_PHOTO_FLAGS = {
    "nsfw",
    "personal_info",
    "multiple_items",
    "no_product",
    "blurry",
    "packaging_only",
    "screenshot_only",
    "stock_or_catalog_suspected",
}


@dataclass(frozen=True)
class CategoryFieldDefinition:
    field_key: str
    field_type: str = "text"
    required_for_publish: bool = False
    required_for_pricing: bool = False
    affects_price: bool = False
    affects_title: bool = False
    affects_description: bool = False
    requires_direct_visible_evidence: bool = False
    seller_confirmation_required: bool = True
    clear_when_category_changes: bool = True


_COMMON_FIELDS = (
    CategoryFieldDefinition("category_slug", required_for_publish=True, affects_title=True, clear_when_category_changes=False),
    CategoryFieldDefinition("detected_item_type", affects_title=True, affects_description=True),
    CategoryFieldDefinition("brand", affects_price=True, affects_title=True, affects_description=True),
    CategoryFieldDefinition("model", affects_price=True, affects_title=True, affects_description=True),
    CategoryFieldDefinition("condition_guess", required_for_publish=True, required_for_pricing=True, affects_price=True),
    CategoryFieldDefinition("defects", field_type="list", affects_price=True, affects_description=True),
    CategoryFieldDefinition("color", affects_title=True),
    CategoryFieldDefinition("accessories", affects_price=True, affects_description=True, requires_direct_visible_evidence=True),
    CategoryFieldDefinition("warranty_status", affects_price=True, affects_description=True, requires_direct_visible_evidence=True),
    CategoryFieldDefinition("title_suggestion", affects_title=True),
    CategoryFieldDefinition("description_suggestion", affects_description=True),
    CategoryFieldDefinition("suggested_price_inr", field_type="money", affects_price=True),
    CategoryFieldDefinition("mrp_inr", field_type="money", affects_price=True),
)

_CATEGORY_FIELDS: dict[str, tuple[CategoryFieldDefinition, ...]] = {
    "smartphones": (
        CategoryFieldDefinition("brand", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("model", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("storage", required_for_pricing=False, affects_price=True, affects_title=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("screen_condition", required_for_publish=True, required_for_pricing=True, affects_price=True),
        CategoryFieldDefinition("body_condition", required_for_publish=True, required_for_pricing=True, affects_price=True),
        CategoryFieldDefinition("battery_health", field_type="number", affects_price=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("imei_1", required_for_publish=True, clear_when_category_changes=True),
        CategoryFieldDefinition("seller_functional_attestation", field_type="boolean", required_for_publish=True, affects_description=True),
    ),
    "laptops": (
        CategoryFieldDefinition("brand", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("model", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("storage", affects_price=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("ram", affects_price=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("processor", affects_price=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("screen_size", affects_price=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("screen_condition", required_for_publish=True, required_for_pricing=True, affects_price=True),
        CategoryFieldDefinition("body_condition", required_for_publish=True, required_for_pricing=True, affects_price=True),
        CategoryFieldDefinition("serial_number", required_for_publish=True, clear_when_category_changes=True),
        CategoryFieldDefinition("seller_functional_attestation", field_type="boolean", required_for_publish=True, affects_description=True),
    ),
    "tablets": (
        CategoryFieldDefinition("brand", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("model", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("storage", affects_price=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("screen_size", affects_price=True, requires_direct_visible_evidence=True),
        CategoryFieldDefinition("screen_condition", required_for_publish=True, required_for_pricing=True, affects_price=True),
        CategoryFieldDefinition("body_condition", required_for_publish=True, required_for_pricing=True, affects_price=True),
        CategoryFieldDefinition("serial_number", required_for_publish=True, clear_when_category_changes=True),
        CategoryFieldDefinition("seller_functional_attestation", field_type="boolean", required_for_publish=True, affects_description=True),
    ),
    "small-appliances": (
        CategoryFieldDefinition("brand", affects_price=True, affects_title=True),
        CategoryFieldDefinition("model", affects_price=True, affects_title=True),
        CategoryFieldDefinition("detected_item_type", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("has_bill", field_type="boolean", affects_price=True),
        CategoryFieldDefinition("has_box", field_type="boolean", affects_price=True),
        CategoryFieldDefinition("seller_functional_attestation", field_type="boolean", required_for_publish=True, affects_description=True),
    ),
    "kids-utility": (
        CategoryFieldDefinition("detected_item_type", required_for_publish=True, required_for_pricing=True, affects_price=True, affects_title=True),
        CategoryFieldDefinition("age_suitability", affects_title=True, affects_description=True),
        CategoryFieldDefinition("hygiene_status", required_for_publish=True, affects_description=True),
        CategoryFieldDefinition("kids_safety_checklist", field_type="object", required_for_publish=True, affects_description=True),
    ),
    "others": (
        CategoryFieldDefinition("title", required_for_publish=True, affects_title=True),
        CategoryFieldDefinition("model", required_for_publish=True, affects_price=True, affects_title=True, affects_description=True),
        CategoryFieldDefinition("detected_item_type", required_for_publish=True, affects_price=True, affects_title=True, affects_description=True),
    ),
}

_PRICE_AND_COPY_FIELDS = {
    "suggested_price_inr",
    "price_confidence",
    "price_reasoning",
    "mrp_inr",
    "mrp_confidence",
    "mrp_source",
    "mrp_reasoning",
    "title_suggestion",
    "description_suggestion",
}

_AI_FIELD_KEYS = (
    "category_slug",
    "raw_category_slug",
    "category_confidence",
    "category_rationale",
    "detected_item_type",
    "brand",
    "model",
    "storage",
    "ram",
    "processor",
    "screen_size",
    "color",
    "purchase_year",
    "condition_guess",
    "screen_condition",
    "body_condition",
    "defects",
    "battery_health",
    "accessories",
    "warranty_status",
    "suggested_price_inr",
    "price_confidence",
    "price_reasoning",
    "mrp_inr",
    "mrp_confidence",
    "mrp_source",
    "mrp_reasoning",
    "title_suggestion",
    "description_suggestion",
)


def _json(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def category_schema_version(category_slug: str | None) -> int:
    return CATEGORY_SCHEMA_VERSION if canonical_category_slug(category_slug) in CATEGORY_SLUGS else CATEGORY_SCHEMA_VERSION


def field_definitions_for_category(category_slug: str | None) -> list[CategoryFieldDefinition]:
    canonical = canonical_category_slug(category_slug)
    merged: dict[str, CategoryFieldDefinition] = {field.field_key: field for field in _COMMON_FIELDS}
    for field in _CATEGORY_FIELDS.get(canonical or "others", ()):
        merged[field.field_key] = field
    return list(merged.values())


def field_contract_payload(category_slug: str | None) -> list[dict[str, Any]]:
    return [asdict(field) for field in field_definitions_for_category(category_slug)]


async def upsert_category_field_definitions(db, category_slug: str | None) -> None:
    canonical = canonical_category_slug(category_slug)
    for field in field_definitions_for_category(canonical):
        payload = asdict(field)
        await db.execute(
            text("""
                INSERT INTO category_field_definitions (
                    id, category_slug, schema_version, field_key, field_type,
                    required_for_publish, required_for_pricing, affects_price,
                    affects_title, affects_description, requires_direct_visible_evidence,
                    seller_confirmation_required, clear_when_category_changes
                )
                VALUES (
                    :id, :category_slug, :schema_version, :field_key, :field_type,
                    :required_for_publish, :required_for_pricing, :affects_price,
                    :affects_title, :affects_description, :requires_direct_visible_evidence,
                    :seller_confirmation_required, :clear_when_category_changes
                )
                ON CONFLICT (category_slug, schema_version, field_key) DO UPDATE SET
                    field_type = EXCLUDED.field_type,
                    required_for_publish = EXCLUDED.required_for_publish,
                    required_for_pricing = EXCLUDED.required_for_pricing,
                    affects_price = EXCLUDED.affects_price,
                    affects_title = EXCLUDED.affects_title,
                    affects_description = EXCLUDED.affects_description,
                    requires_direct_visible_evidence = EXCLUDED.requires_direct_visible_evidence,
                    seller_confirmation_required = EXCLUDED.seller_confirmation_required,
                    clear_when_category_changes = EXCLUDED.clear_when_category_changes
            """),
            {
                "id": uuid4(),
                "category_slug": canonical,
                "schema_version": CATEGORY_SCHEMA_VERSION,
                **payload,
            },
        )


def publish_blockers_for_detected(detected: AIDetected) -> list[str]:
    flags = {
        str(flag).strip().lower()
        for flag in (detected.flags or [])
        if str(flag).strip()
    }
    quality = detected.image_set_quality or {}
    if isinstance(quality, dict):
        if quality.get("has_private_info") is True:
            flags.add("personal_info")
        if quality.get("is_stock_or_catalog_image_suspected") is True:
            flags.add("stock_or_catalog_suspected")
        if str(quality.get("overall_photo_quality") or "").lower() == "unusable":
            flags.add("blurry")
    return sorted(flags.intersection(_BLOCKING_PHOTO_FLAGS))


def required_actions_for_detected(detected: AIDetected, price_result: dict | None = None) -> list[str]:
    actions: list[str] = []
    blockers = publish_blockers_for_detected(detected)
    if blockers:
        actions.append("retake_product_photos")
    if detected.manual_review_required or any(str(flag).startswith("fast_quality:") for flag in (detected.flags or [])):
        actions.append("review_ai_suggestions")

    category = canonical_category_slug(detected.category_slug, fallback_empty_to_others=False)
    if not category:
        actions.append("select_category")
    elif category == "others":
        if not is_meaningful_other_detail(detected.title_suggestion):
            actions.append("add_specific_title")
        if not is_meaningful_other_detail(detected.model) and not is_meaningful_other_detail(detected.detected_item_type):
            actions.append("add_specific_item_type")
    else:
        for field in field_definitions_for_category(category):
            if not field.required_for_publish:
                continue
            if field.field_key in {"imei_1", "serial_number", "title", "price", "seller_functional_attestation", "kids_safety_checklist", "hygiene_status"}:
                actions.append(f"confirm_{field.field_key}")
                continue
            value = getattr(detected, field.field_key, None)
            if value in (None, "", []):
                actions.append(f"confirm_{field.field_key}")

    if category in IDENTIFIER_CATEGORIES:
        actions.append("capture_identifier")

    if not price_result or price_result.get("price") is None:
        actions.append("set_price")

    seen: set[str] = set()
    deduped: list[str] = []
    for action in actions:
        if action in seen:
            continue
        seen.add(action)
        deduped.append(action)
    return deduped


def build_draft_contract(
    detected: AIDetected,
    price_result: dict | None = None,
    *,
    stale_fields: list[str] | None = None,
    fast_path: bool = False,
) -> dict[str, Any]:
    category = canonical_category_slug(detected.category_slug)
    blockers = publish_blockers_for_detected(detected)
    ai_failed = any(str(flag).startswith("ai_failed:") for flag in (detected.flags or []))
    price_source = (price_result or {}).get("source") or "none"
    has_copy = bool(detected.title_suggestion or detected.description_suggestion)
    category_enrichment_status = "pending" if fast_path and category else ("success" if category else "pending")
    copy_status = "pending" if fast_path else ("success" if has_copy else "pending")

    return {
        "schema_version": AI_DRAFT_CONTRACT_SCHEMA_VERSION,
        "category_schema_version": category_schema_version(category),
        "category_slug": category,
        "required_actions": required_actions_for_detected(detected, price_result),
        "publish_blockers": blockers,
        "stale_fields": sorted(stale_fields or []),
        "field_contract": field_contract_payload(category),
        "statuses": {
            "safety_status": "blocked" if blockers else ("unknown" if ai_failed else "passed"),
            "core_analysis_status": "failed" if ai_failed else "success",
            "category_enrichment_status": category_enrichment_status,
            "pricing_status": "success" if price_source != "none" and (price_result or {}).get("price") is not None else "needs_seller",
            "copy_status": copy_status,
            "seller_review_status": "pending",
        },
    }


def image_metadata(image_bytes: bytes | None, content_type: str | None = None) -> dict[str, Any]:
    width = None
    height = None
    if image_bytes:
        try:
            from PIL import Image  # type: ignore

            img = Image.open(BytesIO(image_bytes))
            width, height = img.size
        except Exception:
            width = None
            height = None
    digest = hashlib.sha256(image_bytes or b"").hexdigest() if image_bytes is not None else None
    return {
        "sha256_hash": digest,
        "width": width,
        "height": height,
        "byte_size": len(image_bytes) if image_bytes is not None else None,
        "mime_type": content_type,
    }


def image_set_hash_from_pairs(image_pairs: list[tuple[bytes, str]]) -> str:
    hasher = hashlib.sha256()
    for image_bytes, content_type in image_pairs:
        hasher.update(hashlib.sha256(image_bytes).digest())
        hasher.update(b":")
        hasher.update((content_type or "").encode("utf-8"))
        hasher.update(b"|")
    return hasher.hexdigest()


def image_set_hash_from_keys(keys: list[str]) -> str:
    joined = "|".join(str(key) for key in keys)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


async def record_draft_images(
    db,
    *,
    draft_id: UUID,
    display_keys: list[str],
    image_pairs: list[tuple[bytes, str]] | None = None,
    original_keys: list[str] | None = None,
) -> None:
    for idx, display_key in enumerate(display_keys):
        image_bytes = image_pairs[idx][0] if image_pairs and idx < len(image_pairs) else None
        content_type = image_pairs[idx][1] if image_pairs and idx < len(image_pairs) else None
        meta = image_metadata(image_bytes, content_type)
        original_key = original_keys[idx] if original_keys and idx < len(original_keys) else display_key
        await db.execute(
            text("""
                INSERT INTO ai_draft_images (
                    id, draft_id, image_index, original_key, display_key, mime_type,
                    sha256_hash, width, height, byte_size
                )
                VALUES (
                    :id, :draft_id, :image_index, :original_key, :display_key, :mime_type,
                    :sha256_hash, :width, :height, :byte_size
                )
                ON CONFLICT (draft_id, image_index) DO UPDATE SET
                    original_key = EXCLUDED.original_key,
                    display_key = EXCLUDED.display_key,
                    mime_type = EXCLUDED.mime_type,
                    sha256_hash = EXCLUDED.sha256_hash,
                    width = EXCLUDED.width,
                    height = EXCLUDED.height,
                    byte_size = EXCLUDED.byte_size,
                    updated_at = NOW()
            """),
            {
                "id": uuid4(),
                "draft_id": draft_id,
                "image_index": idx,
                "original_key": original_key,
                "display_key": display_key,
                **meta,
            },
        )


async def record_draft_image_placeholders(
    db,
    *,
    draft_id: UUID,
    photo_keys: list[str],
    content_types: list[str] | None = None,
) -> None:
    for idx, key in enumerate(photo_keys):
        await db.execute(
            text("""
                INSERT INTO ai_draft_images (
                    id, draft_id, image_index, original_key, display_key, mime_type
                )
                VALUES (
                    :id, :draft_id, :image_index, :original_key, :display_key, :mime_type
                )
                ON CONFLICT (draft_id, image_index) DO UPDATE SET
                    original_key = EXCLUDED.original_key,
                    display_key = EXCLUDED.display_key,
                    mime_type = EXCLUDED.mime_type,
                    updated_at = NOW()
            """),
            {
                "id": uuid4(),
                "draft_id": draft_id,
                "image_index": idx,
                "original_key": key,
                "display_key": key,
                "mime_type": (content_types or [None])[idx] if content_types and idx < len(content_types) else None,
            },
        )


async def record_analysis_artifact(
    db,
    *,
    draft_id: UUID,
    stage: str,
    status: str,
    input_payload: dict[str, Any] | None = None,
    output_payload: dict[str, Any] | None = None,
    model: str | None = None,
    provider: str | None = "gemini",
    prompt_version: str | None = None,
    schema_version: int = AI_DRAFT_CONTRACT_SCHEMA_VERSION,
    category_schema_version_value: int = CATEGORY_SCHEMA_VERSION,
    latency_ms: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cached_tokens: int | None = None,
    retry_count: int = 0,
    error_code: str | None = None,
    error_message: str | None = None,
) -> UUID:
    artifact_id = uuid4()
    await db.execute(
        text("""
            INSERT INTO ai_analysis_artifacts (
                id, draft_id, stage, status, input_json, output_json,
                provider, model, prompt_version, schema_version,
                category_schema_version, latency_ms, input_tokens,
                output_tokens, cached_tokens, retry_count, error_code, error_message
            )
            VALUES (
                :id, :draft_id, :stage, :status, CAST(:input_json AS JSONB), CAST(:output_json AS JSONB),
                :provider, :model, :prompt_version, :schema_version,
                :category_schema_version, :latency_ms, :input_tokens,
                :output_tokens, :cached_tokens, :retry_count, :error_code, :error_message
            )
        """),
        {
            "id": artifact_id,
            "draft_id": draft_id,
            "stage": stage,
            "status": status,
            "input_json": _json(input_payload or {}),
            "output_json": _json(output_payload or {}),
            "provider": provider,
            "model": model,
            "prompt_version": prompt_version,
            "schema_version": schema_version,
            "category_schema_version": category_schema_version_value,
            "latency_ms": latency_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cached_tokens": cached_tokens,
            "retry_count": retry_count,
            "error_code": error_code,
            "error_message": error_message[:500] if error_message else None,
        },
    )
    return artifact_id


async def record_ai_field_values(
    db,
    *,
    draft_id: UUID,
    detected: AIDetected,
    artifact_id: UUID,
    source: str = "ai",
) -> None:
    field_evidence = detected.field_evidence or {}
    field_confidence = detected.field_confidence or {}
    for field_key in _AI_FIELD_KEYS:
        value = getattr(detected, field_key, None)
        if value is None or value == "":
            continue
        confidence = field_confidence.get(field_key)
        if confidence is None and field_key == "category_slug":
            confidence = detected.category_confidence
        if confidence is None and field_key in {"suggested_price_inr", "price_reasoning"}:
            confidence = detected.price_confidence
        if confidence is None and field_key in {"mrp_inr", "mrp_reasoning", "mrp_source"}:
            confidence = detected.mrp_confidence
        await _upsert_field_value(
            db,
            draft_id=draft_id,
            field_key=field_key,
            value=value,
            source=source,
            confidence=confidence,
            evidence=field_evidence.get(field_key),
            artifact_id=artifact_id,
            confirmed_by_seller=False,
        )


def _price_json_value(value: Any) -> int | float | None:
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(price) or price <= 0:
        return None
    rounded = round(price, 2)
    return int(rounded) if rounded.is_integer() else rounded


async def record_pricing_field_values(
    db,
    *,
    draft_id: UUID,
    price_result: dict[str, Any] | None,
    artifact_id: UUID,
) -> None:
    result = price_result or {}
    source = str(result.get("source") or "pricing")[:80]
    price = _price_json_value(result.get("price"))
    if price is not None:
        await _upsert_field_value(
            db,
            draft_id=draft_id,
            field_key="suggested_price_inr",
            value=price,
            source="pricing",
            confidence=None,
            evidence=source,
            artifact_id=artifact_id,
            confirmed_by_seller=False,
        )
    reasoning = str(result.get("reasoning") or "").strip()
    if reasoning:
        await _upsert_field_value(
            db,
            draft_id=draft_id,
            field_key="price_reasoning",
            value=reasoning[:500],
            source="pricing",
            confidence=None,
            evidence=source,
            artifact_id=artifact_id,
            confirmed_by_seller=False,
        )


async def record_seller_field_confirmations(
    db,
    *,
    draft_id: UUID,
    fields: dict[str, Any],
) -> None:
    for field_key, value in fields.items():
        if value is None or value == "":
            continue
        await _upsert_field_value(
            db,
            draft_id=draft_id,
            field_key=field_key,
            value=value,
            source="seller",
            confidence=1.0,
            evidence="seller_entered",
            artifact_id=None,
            confirmed_by_seller=True,
        )


async def _upsert_field_value(
    db,
    *,
    draft_id: UUID,
    field_key: str,
    value: Any,
    source: str,
    confidence: float | None,
    evidence: str | None,
    artifact_id: UUID | None,
    confirmed_by_seller: bool,
) -> None:
    await db.execute(
        text("""
            INSERT INTO draft_field_values (
                id, draft_id, field_key, value, source, confidence, evidence,
                artifact_id, confirmed_by_seller, confirmed_at, is_stale, stale_reason
            )
            VALUES (
                :id, :draft_id, :field_key, CAST(:value AS JSONB), :source, :confidence, :evidence,
                :artifact_id, :confirmed_by_seller,
                CASE WHEN :confirmed_by_seller THEN NOW() ELSE NULL END,
                false, NULL
            )
            ON CONFLICT (draft_id, field_key) DO UPDATE SET
                value = CASE
                    WHEN draft_field_values.confirmed_by_seller AND EXCLUDED.source <> 'seller'
                        THEN draft_field_values.value
                    ELSE EXCLUDED.value
                END,
                source = CASE
                    WHEN draft_field_values.confirmed_by_seller AND EXCLUDED.source <> 'seller'
                        THEN draft_field_values.source
                    ELSE EXCLUDED.source
                END,
                confidence = CASE
                    WHEN draft_field_values.confirmed_by_seller AND EXCLUDED.source <> 'seller'
                        THEN draft_field_values.confidence
                    ELSE EXCLUDED.confidence
                END,
                evidence = CASE
                    WHEN draft_field_values.confirmed_by_seller AND EXCLUDED.source <> 'seller'
                        THEN draft_field_values.evidence
                    ELSE EXCLUDED.evidence
                END,
                artifact_id = CASE
                    WHEN draft_field_values.confirmed_by_seller AND EXCLUDED.source <> 'seller'
                        THEN draft_field_values.artifact_id
                    ELSE EXCLUDED.artifact_id
                END,
                confirmed_by_seller = draft_field_values.confirmed_by_seller OR EXCLUDED.confirmed_by_seller,
                confirmed_at = CASE
                    WHEN EXCLUDED.confirmed_by_seller THEN EXCLUDED.confirmed_at
                    ELSE draft_field_values.confirmed_at
                END,
                is_stale = CASE
                    WHEN draft_field_values.confirmed_by_seller AND EXCLUDED.source <> 'seller'
                        THEN draft_field_values.is_stale
                    ELSE false
                END,
                stale_reason = CASE
                    WHEN draft_field_values.confirmed_by_seller AND EXCLUDED.source <> 'seller'
                        THEN draft_field_values.stale_reason
                    ELSE NULL
                END,
                updated_at = NOW()
        """),
        {
            "id": uuid4(),
            "draft_id": draft_id,
            "field_key": field_key,
            "value": _json(value),
            "source": source,
            "confidence": confidence,
            "evidence": evidence,
            "artifact_id": artifact_id,
            "confirmed_by_seller": confirmed_by_seller,
        },
    )


def category_change_reconciliation(old_category: str | None, new_category: str | None) -> dict[str, Any]:
    old_canonical = canonical_category_slug(old_category, fallback_empty_to_others=False)
    new_canonical = canonical_category_slug(new_category, fallback_empty_to_others=False)
    if old_canonical == new_canonical:
        return {
            "category_changed": False,
            "old_category_slug": old_canonical,
            "new_category_slug": new_canonical,
            "stale_fields": [],
            "preserved_fields": [],
            "rerun_stages": [],
        }

    old_fields = {field.field_key for field in field_definitions_for_category(old_canonical)}
    new_fields = {field.field_key for field in field_definitions_for_category(new_canonical)}
    category_specific_stale = {
        field.field_key
        for field in field_definitions_for_category(old_canonical)
        if field.clear_when_category_changes and field.field_key not in new_fields
    }
    stale_fields = sorted(category_specific_stale | _PRICE_AND_COPY_FIELDS)
    return {
        "category_changed": True,
        "old_category_slug": old_canonical,
        "new_category_slug": new_canonical,
        "stale_fields": stale_fields,
        "preserved_fields": sorted(old_fields.intersection(new_fields)),
        "rerun_stages": [STAGE_CATEGORY_ENRICHMENT, STAGE_PRICING, STAGE_COPY],
    }


async def record_category_change_if_needed(
    db,
    *,
    draft_id: UUID,
    old_category: str | None,
    new_category: str | None,
    changed_by: str,
    prior_schema_version: int | None = None,
) -> dict[str, Any]:
    reconciliation = category_change_reconciliation(old_category, new_category)
    if not reconciliation["category_changed"]:
        return reconciliation

    stale_fields = reconciliation["stale_fields"]
    await db.execute(
        text("""
            INSERT INTO draft_category_change_events (
                id, draft_id, old_category_slug, new_category_slug, changed_by,
                previous_schema_version, new_schema_version,
                invalidated_fields, preserved_fields
            )
            VALUES (
                :id, :draft_id, :old_category_slug, :new_category_slug, :changed_by,
                :previous_schema_version, :new_schema_version,
                CAST(:invalidated_fields AS JSONB), CAST(:preserved_fields AS JSONB)
            )
        """),
        {
            "id": uuid4(),
            "draft_id": draft_id,
            "old_category_slug": reconciliation["old_category_slug"],
            "new_category_slug": reconciliation["new_category_slug"],
            "changed_by": changed_by,
            "previous_schema_version": prior_schema_version or CATEGORY_SCHEMA_VERSION,
            "new_schema_version": CATEGORY_SCHEMA_VERSION,
            "invalidated_fields": _json(stale_fields),
            "preserved_fields": _json(reconciliation["preserved_fields"]),
        },
    )
    if stale_fields:
        await db.execute(
            text("""
                UPDATE draft_field_values
                SET is_stale = true,
                    stale_reason = 'category_changed',
                    updated_at = NOW()
                WHERE draft_id = :draft_id
                  AND field_key = ANY(:field_keys)
                  AND source <> 'seller'
            """).bindparams(bindparam("field_keys", type_=PGARRAY(SAString))),
            {"draft_id": draft_id, "field_keys": stale_fields},
        )
    return reconciliation
