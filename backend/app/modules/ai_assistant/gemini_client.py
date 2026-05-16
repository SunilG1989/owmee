"""Google Gemini client — Sprint 8 Phase 2.1 (SPRINT8_PHASE2_GEMINI_V2).

Structural rewrite of the v1 swap. Drop-in replacement: same async function
names, same return shapes, but the JSON path is now reliable.

Why v1 was broken (so this doesn't happen again):

  v1 used `response_mime_type='application/json'` plus prompt rules to coax
  Gemini into returning JSON. That worked sometimes. It also burned the
  entire 600-token output budget on internal "thinking" for the 2.5-flash
  model, returning truncated JSON like `{"category_slug": "smartphones",`.
  The router logged `vision_json_parse_failed` and the seller saw an empty
  Everything Screen.

What v2 changes:

  1. response_schema = Pydantic class. Gemini's SDK uses the schema to
     constrain the decoder. Output is guaranteed to satisfy the type, or
     the SDK errors out — no markdown fences, no truncation, no parse step.

  2. thinking_budget = 0. For pure structured extraction (vision detect,
     IMEI OCR, price quote), we don't want internal reasoning eating the
     output budget. Disable it.

  3. max_output_tokens raised to safe ceilings.

  4. Multi-image vision. detect_from_images(list[bytes]) sends every photo
     to one Gemini call as separate Parts. Cheaper than N calls, and
     Gemini sees the product from all angles in one shot.

  5. Better error semantics. When the call fails, we return an AIDetected
     with a `flags=['ai_failed:<reason>']` marker so the router/UI can
     show "AI couldn't read these photos" instead of silently empty fields.

Models (latest Gemini defaults, override via .env):
    Vision:  gemini-3-pro-preview     (best multimodal extraction)
    Text:    gemini-3-flash-preview   (fast, current-generation text)

WARNING: Gemini 3 is currently preview. Pin to a stable 2.5 model
(gemini-2.5-pro / gemini-2.5-flash) if production stability matters
more than the latest model family.

Privacy note: free-tier inputs may be used by Google for training.
Acceptable for prototype; revisit before production with real seller data.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from pydantic import BaseModel, Field

from app.modules.ai_assistant.prompts import (
    PROMPT_VISION_DETECT,
    PROMPT_IMEI_OCR,
    PROMPT_DESCRIPTION_REGEN,
    PROMPT_PRICE_ESTIMATE,
)
from app.modules.ai_assistant.schemas import AIDetected

log = logging.getLogger(__name__)

DEFAULT_GEMINI_VISION_MODEL = "gemini-3-pro-preview"
DEFAULT_GEMINI_TEXT_MODEL = "gemini-3-flash-preview"


# ── Pydantic schemas used as response_schema for Gemini ───────────────────
#
# These mirror the AIDetected/IMEI/Price shapes but are kept LOCAL because:
# (a) Gemini's response_schema only accepts simple types (no Field metadata,
#     no extra default factories beyond plain values), and
# (b) we want to decouple the on-the-wire AI shape from app-internal
#     domain types so we can evolve them separately.


class _ImageSetQuality(BaseModel):
    """Descriptive metadata about the photo set (what's in it / overall
    quality). Blocking signals (nsfw, multiple_items, blurry, ...) live
    in the top-level `flags` list per PROMPT v2's IMAGE SET VALIDITY
    section — this block is purely descriptive context that downstream
    consumers (admin web, mobile review banner) can render without
    string-matching the flags list.
    """
    is_single_sellable_item: bool = False
    has_actual_item_photo: bool = False
    has_box_or_packaging: bool = False
    has_settings_or_spec_screen: bool = False
    has_receipt_or_warranty: bool = False
    has_private_info: bool = False
    is_stock_or_catalog_image_suspected: bool = False
    # good | usable | poor | unusable
    overall_photo_quality: str | None = None


class _FieldConfidence(BaseModel):
    """Per-field confidence (0.0-1.0). Keys mirror the canonical reference
    schema — the post-processor and admin UI rely on these names.
    """
    category_slug: float | None = None
    brand: float | None = None
    model: float | None = None
    storage: float | None = None
    ram: float | None = None
    processor: float | None = None
    condition_guess: float | None = None
    suggested_price_inr: float | None = None


class _FieldEvidence(BaseModel):
    """Per-field evidence level. Each value is one of:
      "direct_visible" | "strong_visual_inference" | "not_evidenced"

    Spec fields (storage/ram/processor/battery_health/purchase_year/
    accessories/warranty_status/screen_size) are post-processor-restricted
    to direct_visible — the schema accepts the wider enum so Gemini can
    self-report not_evidenced, but Rule 3 nulls the value if it isn't
    direct_visible.
    """
    category_slug: str | None = None
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    ram: str | None = None
    processor: str | None = None
    screen_size: str | None = None
    battery_health: str | None = None
    purchase_year: str | None = None
    accessories: str | None = None
    warranty_status: str | None = None
    condition_guess: str | None = None


class _GeminiVisionOut(BaseModel):
    """Schema we ask Gemini to fill. Mirrors AIDetected — every field
    here corresponds to a Listing column we want populated end-to-end
    so the seller doesn't have to type.

    Gemini's response_schema accepts only basic types (no Field metadata,
    no constrained strings). dict / object fields are passed through as
    plain dicts — Gemini fills whatever keys the prompt asks for.
    """
    # Identification
    category_slug: str | None = None  # smartphones | laptops | tablets |
                                      # small-appliances | kids-utility |
                                      # others | None
    category_confidence: float = 0.0
    category_rationale: str | None = None
    detected_item_type: str | None = None
    brand: str | None = None
    model: str | None = None
    # Specs
    storage: str | None = None
    ram: str | None = None
    processor: str | None = None
    screen_size: str | None = None
    # Cosmetic
    color: str | None = None
    purchase_year: int | None = None
    # Condition detail
    condition_guess: str | None = None
    screen_condition: str | None = None
    body_condition: str | None = None
    defects: list[str] = []
    battery_health: int | None = None
    # Extras
    accessories: str | None = None
    warranty_status: str | None = None
    # Pricing — integrated so the model uses the photos when valuing
    suggested_price_inr: int | None = None
    price_confidence: float = 0.0
    price_reasoning: str | None = None
    # Authoring
    title_suggestion: str | None = None
    description_suggestion: str | None = None
    flags: list[str] = []

    # ── PROMPT v2 additions ─────────────────────────────────────────────
    image_set_quality: _ImageSetQuality = _ImageSetQuality()
    hero_image_index: int | None = None
    hero_image_rationale: str | None = None
    manual_review_required: bool = False
    auto_publish_candidate: bool = False
    blocking_reasons: list[str] = []
    extraction_notes: str | None = None
    seller_photo_feedback: list[str] = []
    seller_edit_fields: list[str] = []
    field_confidence: _FieldConfidence = _FieldConfidence()
    field_evidence: _FieldEvidence = _FieldEvidence()


class _GeminiIMEIOut(BaseModel):
    imei: str | None = None
    confidence: float = 0.0
    extracted_text: str = ""


class _GeminiPriceOut(BaseModel):
    price_inr: int = 0
    confidence: float = 0.0
    reasoning: str = ""


# ── Lazy SDK + key resolution ─────────────────────────────────────────────


def _get_api_key() -> str | None:
    try:
        from app.core.settings import settings
        key = (
            getattr(settings, "gemini_api_key", "")
            or getattr(settings, "google_api_key", "")
            or os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", "")
        )
    except Exception:
        key = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")
    return key.strip() or None


def _get_client():
    key = _get_api_key()
    if not key:
        log.warning("ai_assistant.no_api_key")
        return None
    try:
        from google.genai import Client
    except ImportError:
        log.warning("ai_assistant.sdk_missing — pip install google-genai")
        return None
    return Client(api_key=key)


def _get_model(kind: str) -> str:
    try:
        from app.core.settings import settings
        if kind == "vision":
            return (
                getattr(settings, "gemini_vision_model", "")
                or os.environ.get("GEMINI_VISION_MODEL", "")
                or DEFAULT_GEMINI_VISION_MODEL
            )
        return (
            getattr(settings, "gemini_text_model", "")
            or os.environ.get("GEMINI_TEXT_MODEL", "")
            or DEFAULT_GEMINI_TEXT_MODEL
        )
    except Exception:
        return DEFAULT_GEMINI_VISION_MODEL if kind == "vision" else DEFAULT_GEMINI_TEXT_MODEL


def current_vision_model() -> str:
    return _get_model("vision")


def current_text_model() -> str:
    return _get_model("text")


def _thinking_config(types: Any, model: str, kind: str):
    """Use the right thinking control for Gemini 3 vs Gemini 2.5.

    Gemini 3 accepts thinking_level; Gemini 2.5 accepts thinking_budget.
    Keeping this centralized prevents the model upgrade from breaking the
    structured extraction calls.
    """
    if model.startswith("gemini-3"):
        thinking_level = getattr(types, "ThinkingLevel", None)
        if thinking_level is not None:
            level = thinking_level.LOW if kind == "vision" else thinking_level.MINIMAL
            return types.ThinkingConfig(thinking_level=level)
        return types.ThinkingConfig(thinking_budget=-1)
    if model.startswith("gemini-2.5-pro"):
        return types.ThinkingConfig(thinking_budget=-1)
    return types.ThinkingConfig(thinking_budget=0)


def _normalize_media_type(content_type: str) -> str:
    if content_type in ("image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"):
        return content_type
    return "image/jpeg"


def _failed(reason: str) -> AIDetected:
    """Construct an AIDetected that signals failure to the router/UI."""
    return AIDetected(flags=[f"ai_failed:{reason}"])


# ── Vision: detect from one OR many images ───────────────────────────────


async def detect_from_images(
    images: list[tuple[bytes, str]],
) -> AIDetected:
    """Multi-image vision call. The model sees ALL photos at once and
    produces a single combined judgement.

    Args:
        images: list of (image_bytes, content_type) tuples. 1-6 expected.

    Returns:
        AIDetected — populated on success, or with flags=['ai_failed:<r>']
        on failure. Never raises.
    """
    if not images:
        return _failed("no_images")

    client = _get_client()
    if client is None:
        return _failed("no_client")

    from google.genai import types

    parts: list[Any] = []
    text_intro = (
        "These photos show ONE product from multiple angles. "
        "Combine signals from all photos. Be confident. "
        "Photos are provided with zero-based indexes; use those indexes "
        "when setting hero_image_index."
    )
    parts.append(text_intro)
    for idx, (image_bytes, content_type) in enumerate(images):
        parts.append(f"Photo index {idx}:")
        parts.append(
            types.Part.from_bytes(
                data=image_bytes,
                mime_type=_normalize_media_type(content_type),
            )
        )

    model = _get_model("vision")
    config = types.GenerateContentConfig(
        system_instruction=PROMPT_VISION_DETECT,
        response_mime_type="application/json",
        response_schema=_GeminiVisionOut,
        temperature=0.2,
        max_output_tokens=1024,
        thinking_config=_thinking_config(types, model, "vision"),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=model,
            contents=parts,
            config=config,
        )
    except Exception as e:
        log.warning(
            "ai_assistant.vision_api_failed",
            extra={"error": f"{type(e).__name__}: {str(e)[:300]}"},
        )
        return _failed("api_error")

    # SDK populates resp.parsed when response_schema is set.
    parsed = getattr(resp, "parsed", None)
    if parsed is None:
        # Fallback: parse the text as JSON in case the SDK chose not to
        # auto-parse. Some SDK versions only set .parsed for certain models.
        raw = (resp.text or "").strip()
        if not raw:
            log.warning(
                "ai_assistant.vision_empty_response",
                extra={
                    "finish_reason": str(resp.candidates[0].finish_reason)
                    if resp.candidates else "unknown",
                    "thoughts": resp.usage_metadata.thoughts_token_count
                    if resp.usage_metadata else None,
                },
            )
            return _failed("empty_response")
        import json
        try:
            data = json.loads(raw)
            parsed = _GeminiVisionOut(**data)
        except Exception as e:
            log.warning(
                "ai_assistant.vision_parse_failed",
                extra={"error": str(e)[:200], "raw": raw[:300]},
            )
            return _failed("parse_failed")

    # Translate Gemini's output to the AIDetected domain type and apply
    # the post-processing guardrails defined alongside PROMPT v2. The
    # prompt itself instructs Gemini to follow these rules — but Gemini
    # doesn't always comply (especially on price + spec fields), so
    # we enforce them server-side as a hard belt-and-braces.
    detected = _translate_vision_response(parsed)
    return _apply_post_processing_guardrails(detected)


def _translate_vision_response(parsed: "_GeminiVisionOut") -> AIDetected:
    """Map _GeminiVisionOut → AIDetected (1:1 with light defensive
    coercion for fields where Gemini sometimes returns mismatched types).
    """
    flags_in = parsed.flags if isinstance(parsed.flags, list) else []
    defects_in = parsed.defects if isinstance(parsed.defects, list) else []

    # Nested objects may come back as Pydantic models OR plain dicts
    # (depends on SDK version + whether response_schema coercion ran).
    def _to_dict(v: Any) -> dict:
        if v is None:
            return {}
        if isinstance(v, dict):
            return v
        if hasattr(v, "model_dump"):
            return v.model_dump(exclude_none=False)
        return {}

    isq_dict = _to_dict(parsed.image_set_quality)
    fc_dict = _to_dict(parsed.field_confidence)
    fe_dict = _to_dict(parsed.field_evidence)

    return AIDetected(
        category_slug=parsed.category_slug,
        category_confidence=float(parsed.category_confidence or 0.0),
        category_rationale=parsed.category_rationale,
        detected_item_type=parsed.detected_item_type,
        brand=parsed.brand,
        model=parsed.model,
        storage=parsed.storage,
        ram=parsed.ram,
        processor=parsed.processor,
        screen_size=parsed.screen_size,
        color=parsed.color,
        purchase_year=parsed.purchase_year,
        condition_guess=parsed.condition_guess,
        screen_condition=parsed.screen_condition,
        body_condition=parsed.body_condition,
        defects=[str(d)[:120] for d in defects_in][:8],
        battery_health=parsed.battery_health,
        accessories=parsed.accessories,
        warranty_status=parsed.warranty_status,
        suggested_price_inr=int(parsed.suggested_price_inr) if parsed.suggested_price_inr else None,
        price_confidence=float(parsed.price_confidence or 0.0),
        price_reasoning=parsed.price_reasoning,
        title_suggestion=parsed.title_suggestion,
        description_suggestion=parsed.description_suggestion,
        flags=[str(f) for f in flags_in],
        # PROMPT v2 additions
        image_set_quality=isq_dict,
        hero_image_index=parsed.hero_image_index,
        hero_image_rationale=parsed.hero_image_rationale,
        manual_review_required=bool(parsed.manual_review_required),
        auto_publish_candidate=bool(parsed.auto_publish_candidate),
        blocking_reasons=[str(b)[:200] for b in (parsed.blocking_reasons or [])][:8],
        extraction_notes=parsed.extraction_notes,
        seller_photo_feedback=[str(s)[:200] for s in (parsed.seller_photo_feedback or [])][:5],
        seller_edit_fields=[str(s)[:60] for s in (parsed.seller_edit_fields or [])][:12],
        field_confidence=fc_dict,
        field_evidence=fe_dict,
    )


# Spec fields that PROMPT v2 restricts to direct_visible evidence.
# The post-processor nulls these unless field_evidence reports
# direct_visible — protects against Gemini fabricating specs from
# model knowledge.
_SPEC_FIELDS_REQUIRING_DIRECT_VISIBLE = (
    "storage",
    "ram",
    "processor",
    "battery_health",
    "purchase_year",
    "screen_size",
    "accessories",
    "warranty_status",
)

# Flags (from the top-level `flags` list, per PROMPT v2's IMAGE SET
# VALIDITY section) that mean "do not auto-price this listing."
_PRICE_BLOCKING_FLAGS = (
    "multiple_items",
    "no_product",
    "blurry",
    "packaging_only",
    "screenshot_only",
    "stock_or_catalog_suspected",
)

# Substrings in seller_photo_feedback that signal kids-set completeness
# is unclear — we null pricing and force review for kids categories.
_KIDS_COMPLETENESS_HINTS = ("all toy parts", "completeness", "all parts")


def _apply_post_processing_guardrails(detected: AIDetected) -> AIDetected:
    """Server-side enforcement of the rules in PROMPT v2.

    Even when Gemini ignores the prompt's instructions, this function
    reshapes the response so the rest of the app sees a safe payload.
    Blocking signals are read from the top-level `flags` list (where
    PROMPT v2's IMAGE SET VALIDITY section emits them); `image_set_quality`
    is purely descriptive metadata and is NOT a guardrail input.

      1. personal_info / nsfw in flags → null all product/listing/pricing
         fields, mark manual_review_required, drop auto_publish_candidate.
      2. multiple_items / no_product / blurry / packaging_only /
         screenshot_only / stock_or_catalog_suspected in flags → null pricing.
      3. spec fields without direct_visible field_evidence → null.
      4. price_confidence < 0.5 → suggested_price_inr null.
      5. manual_review_required True → auto_publish_candidate False.
      6. kids-utility with completeness-unclear feedback
         → null pricing + force manual review.
    """
    flags = set(detected.flags or [])
    blocking_reasons: list[str] = list(detected.blocking_reasons or [])

    # Rule 1: privacy / safety → nuke every product/listing/pricing field.
    if "personal_info" in flags or "nsfw" in flags:
        reason = "personal_info" if "personal_info" in flags else "nsfw"
        if reason not in blocking_reasons:
            blocking_reasons.append(reason)
        return AIDetected(
            category_slug=None,
            raw_category_slug=detected.raw_category_slug,
            category_resolution=detected.category_resolution,
            category_confidence=0.0,
            category_rationale=detected.category_rationale,
            detected_item_type=None,
            brand=None,
            model=None,
            storage=None,
            ram=None,
            processor=None,
            screen_size=None,
            color=None,
            purchase_year=None,
            condition_guess=None,
            screen_condition=None,
            body_condition=None,
            defects=[],
            battery_health=None,
            accessories=None,
            warranty_status=None,
            suggested_price_inr=None,
            price_confidence=0.0,
            price_reasoning=None,
            title_suggestion=None,
            description_suggestion=None,
            flags=detected.flags,
            image_set_quality=detected.image_set_quality or {},
            manual_review_required=True,
            auto_publish_candidate=False,
            blocking_reasons=blocking_reasons,
            extraction_notes=detected.extraction_notes
            or "Photo flagged as personal_info/nsfw — listing fields cleared by post-processor.",
            seller_photo_feedback=detected.seller_photo_feedback,
            seller_edit_fields=[],
            field_confidence={},
            field_evidence={},
        )

    # Rule 2: flags that block pricing.
    suggested_price_inr = detected.suggested_price_inr
    price_confidence = detected.price_confidence
    price_reasoning = detected.price_reasoning
    for flag in _PRICE_BLOCKING_FLAGS:
        if flag in flags:
            if suggested_price_inr is not None:
                price_reasoning = f"price suppressed by post-processor: flag={flag}"
            suggested_price_inr = None
            price_confidence = 0.0
            if flag not in blocking_reasons:
                blocking_reasons.append(flag)

    # Rule 3: spec fields without direct_visible evidence.
    fe = detected.field_evidence or {}
    forced_specs: dict[str, None] = {}
    for spec_field in _SPEC_FIELDS_REQUIRING_DIRECT_VISIBLE:
        ev = fe.get(spec_field)
        # Apply only when Gemini emitted evidence labels at all (v2 prompt
        # behaviour); otherwise leave legacy compat untouched.
        if fe and getattr(detected, spec_field, None) is not None and ev != "direct_visible":
            forced_specs[spec_field] = None

    # Rule 4: price-confidence floor.
    if (price_confidence or 0.0) < 0.5 and suggested_price_inr is not None:
        suggested_price_inr = None
        if "price_confidence_below_floor" not in blocking_reasons:
            blocking_reasons.append("price_confidence_below_floor")

    # Rule 5: manual_review_required forces auto_publish_candidate False.
    manual_review_required = bool(detected.manual_review_required)
    auto_publish_candidate = bool(detected.auto_publish_candidate)

    # Rule 6: kids-set completeness unclear → block price + force review.
    if detected.category_slug == "kids-utility":
        notes = " ".join(detected.seller_photo_feedback or []).lower()
        if any(hint in notes for hint in _KIDS_COMPLETENESS_HINTS):
            if suggested_price_inr is not None:
                price_reasoning = (
                    "kids set completeness unclear — price suppressed."
                )
            suggested_price_inr = None
            price_confidence = 0.0
            manual_review_required = True
            if "kids_completeness_unclear" not in blocking_reasons:
                blocking_reasons.append("kids_completeness_unclear")

    if manual_review_required:
        auto_publish_candidate = False

    update_kwargs: dict = {
        "suggested_price_inr": suggested_price_inr,
        "price_confidence": price_confidence,
        "price_reasoning": price_reasoning,
        "manual_review_required": manual_review_required,
        "auto_publish_candidate": auto_publish_candidate,
        "blocking_reasons": blocking_reasons,
    }
    update_kwargs.update(forced_specs)
    return detected.model_copy(update=update_kwargs)


# Single-image convenience wrapper — keeps v1 API for backward compatibility.
async def detect_from_image(image_bytes: bytes, content_type: str = "image/jpeg") -> AIDetected:
    return await detect_from_images([(image_bytes, content_type)])


# ── Vision: IMEI OCR ──────────────────────────────────────────────────────


async def extract_imei(image_bytes: bytes, content_type: str = "image/jpeg") -> dict:
    """OCR an IMEI sticker / box / Settings screen.

    Returns:
        {"imei": str|None, "confidence": float, "extracted_text": str}
    """
    client = _get_client()
    if client is None:
        return {"imei": None, "confidence": 0.0, "extracted_text": ""}

    from google.genai import types

    image_part = types.Part.from_bytes(
        data=image_bytes,
        mime_type=_normalize_media_type(content_type),
    )

    model = _get_model("vision")
    config = types.GenerateContentConfig(
        system_instruction=PROMPT_IMEI_OCR,
        response_mime_type="application/json",
        response_schema=_GeminiIMEIOut,
        temperature=0.0,
        max_output_tokens=512,
        thinking_config=_thinking_config(types, model, "vision"),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=model,
            contents=[
                "Read the IMEI from this image. The IMEI is a 15-digit number, "
                "usually labelled 'IMEI', 'IMEI 1', or 'MEID/IMEI'. It may "
                "appear on a sticker on the back of the phone, on the original "
                "box, or on the Settings → About phone screen. If you see two "
                "IMEIs (dual-SIM), return the first one in the imei field.",
                image_part,
            ],
            config=config,
        )
    except Exception as e:
        log.warning(
            "ai_assistant.imei_api_failed",
            extra={"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )
        return {"imei": None, "confidence": 0.0, "extracted_text": ""}

    parsed = getattr(resp, "parsed", None)
    if parsed is None:
        raw = (resp.text or "").strip()
        if not raw:
            log.warning("ai_assistant.imei_empty_response")
            return {"imei": None, "confidence": 0.0, "extracted_text": ""}
        import json
        try:
            data = json.loads(raw)
            parsed = _GeminiIMEIOut(**data)
        except Exception as e:
            log.warning(
                "ai_assistant.imei_parse_failed",
                extra={"error": str(e)[:200], "raw": raw[:300]},
            )
            return {"imei": None, "confidence": 0.0, "extracted_text": ""}

    imei = parsed.imei
    # Gemini sometimes returns "IMEI: 12..." or strips trailing chars.
    # Pull the first 15-digit run from extracted_text as a backup.
    if not imei or not (isinstance(imei, str) and imei.isdigit() and len(imei) == 15):
        import re
        text = (parsed.extracted_text or "") + " " + (imei or "")
        m = re.search(r"\b(\d{15})\b", text)
        if m:
            imei = m.group(1)
            log.info("ai_assistant.imei_extracted_from_text")
        else:
            imei = None

    return {
        "imei": imei,
        "confidence": float(parsed.confidence or 0.0),
        "extracted_text": str(parsed.extracted_text or "")[:500],
    }


# ── Text: description regeneration ────────────────────────────────────────


async def regenerate_description(fields: dict[str, Any]) -> str:
    client = _get_client()
    if client is None:
        bits = [
            fields.get("brand"),
            fields.get("model"),
            fields.get("storage"),
            fields.get("color"),
        ]
        return " ".join([b for b in bits if b]) or "Used item in working condition."

    from google.genai import types

    user_text = "Fields:\n" + "\n".join(
        f"- {k}: {v}" for k, v in fields.items() if v not in (None, "", [])
    )

    model = _get_model("text")
    config = types.GenerateContentConfig(
        system_instruction=PROMPT_DESCRIPTION_REGEN,
        temperature=0.7,
        max_output_tokens=600,
        thinking_config=_thinking_config(types, model, "text"),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=model,
            contents=user_text,
            config=config,
        )
    except Exception as e:
        log.warning(
            "ai_assistant.regen_failed",
            extra={"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )
        return "Used item in working condition."

    return (resp.text or "").strip() or "Used item in working condition."


# ── Text: AI price estimate ──────────────────────────────────────────────


async def estimate_price(
    brand: str | None,
    model: str | None,
    storage: str | None,
    condition: str | None,
    market: str = "India",
) -> dict | None:
    client = _get_client()
    if client is None:
        return None

    from google.genai import types

    user_text = (
        f"Brand: {brand or 'unknown'}\n"
        f"Model: {model or 'unknown'}\n"
        f"Storage: {storage or 'n/a'}\n"
        f"Condition: {condition or 'good'}\n"
        f"Market: {market}\n"
        f"Currency: INR"
    )

    model = _get_model("text")
    config = types.GenerateContentConfig(
        system_instruction=PROMPT_PRICE_ESTIMATE,
        response_mime_type="application/json",
        response_schema=_GeminiPriceOut,
        temperature=0.3,
        max_output_tokens=512,
        thinking_config=_thinking_config(types, model, "text"),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=model,
            contents=user_text,
            config=config,
        )
    except Exception as e:
        log.warning(
            "ai_assistant.price_api_failed",
            extra={"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )
        return None

    parsed = getattr(resp, "parsed", None)
    if parsed is None:
        raw = (resp.text or "").strip()
        if not raw:
            return None
        import json
        try:
            data = json.loads(raw)
            parsed = _GeminiPriceOut(**data)
        except Exception:
            return None

    if parsed.price_inr <= 0:
        return None

    return {
        "price_inr": int(parsed.price_inr),
        "confidence": float(parsed.confidence or 0.0),
        "reasoning": str(parsed.reasoning or "")[:200],
    }
