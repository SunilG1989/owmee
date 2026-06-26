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

  2. Thinking is minimized/disabled where the model supports it. For Gemini 3
     Flash, the SDK exposes thinking_level=MINIMAL; for Gemini 2.5 Flash,
     thinking_budget=0 disables thinking.

  3. max_output_tokens raised to safe ceilings.

  4. Multi-image vision. detect_from_images(list[bytes]) sends every photo
     to one Gemini call as separate Parts. Cheaper than N calls, and
     Gemini sees the product from all angles in one shot.

  5. Better error semantics. When the call fails, we return an AIDetected
     with a `flags=['ai_failed:<reason>']` marker so the router/UI can
     show "AI couldn't read these photos" instead of silently empty fields.

Models (latest Gemini defaults, override via .env):
    Vision:  gemini-3-flash-preview       (current, low-latency multimodal extraction)
    Text:    gemini-3-flash-preview       (fast, current-generation text)
    Image:   configured separately via GEMINI_IMAGE_MODEL

WARNING: Gemini 3 Preview model IDs can deprecate. Keep normalization below
so stale Render env vars fail forward instead of silently breaking listing AI.

Privacy note: free-tier inputs may be used by Google for training.
Acceptable for prototype; revisit before production with real seller data.
"""
from __future__ import annotations

from contextvars import ContextVar
from io import BytesIO
import logging
import os
from time import perf_counter
from typing import Any

from pydantic import BaseModel

from app.modules.ai_assistant.prompts import (
    PROMPT_VISION_FAST_DETECT,
    PROMPT_VISION_DETECT,
    PROMPT_IMEI_OCR,
    PROMPT_SERIAL_OCR,
    PROMPT_DESCRIPTION_REGEN,
    PROMPT_PRICE_ESTIMATE,
)
from app.modules.ai_assistant.identifier_extraction import (
    extract_imei_candidate,
    extract_serial_candidate,
)
from app.modules.ai_assistant.schemas import AIDetected

log = logging.getLogger(__name__)

DEFAULT_GEMINI_VISION_MODEL = "gemini-3-flash-preview"
DEFAULT_GEMINI_TEXT_MODEL = "gemini-3-flash-preview"
VISION_FAST_MAX_OUTPUT_TOKENS = 2048
VISION_DETECT_MAX_OUTPUT_TOKENS = 8192
PRICE_ESTIMATE_MAX_OUTPUT_TOKENS = 2048

_GEMINI_CALL_METRICS: ContextVar[tuple[dict[str, Any], ...]] = ContextVar(
    "owmee_gemini_call_metrics",
    default=(),
)

_DEPRECATED_MODEL_ALIASES = {
    # Google shut down Gemini 3 Pro Preview on 2026-03-09. Some Render envs
    # may still carry the old value from earlier blueprints.
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
}


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
    # Phone/tablet hero guardrails. The backend uses this to override a
    # back-panel hero when a usable front/screen photo exists.
    front_face_image_index: int | None = None
    front_face_rationale: str | None = None
    hero_image_has_human_artifact: bool = False


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
    mrp_inr: float | None = None


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
    mrp_inr: str | None = None


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
    category_family: str | None = None
    category_specifics: dict[str, Any] = {}
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
    mrp_inr: int | None = None
    mrp_confidence: float = 0.0
    mrp_source: str | None = None
    mrp_reasoning: str | None = None
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


class _GeminiVisionFastOut(BaseModel):
    """Low-latency first-pass schema.

    This intentionally excludes rich description, MRP, full spec enrichment, and
    long evidence narratives. The seller gets an editable draft quickly; deeper
    enrichment can run later without blocking the ready state.
    """
    category_slug: str | None = None
    category_confidence: float = 0.0
    category_rationale: str | None = None
    category_family: str | None = None
    category_specifics: dict[str, Any] = {}
    detected_item_type: str | None = None
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    color: str | None = None
    condition_guess: str | None = None
    screen_condition: str | None = None
    body_condition: str | None = None
    defects: list[str] = []
    suggested_price_inr: int | None = None
    price_confidence: float = 0.0
    price_reasoning: str | None = None
    title_suggestion: str | None = None
    flags: list[str] = []
    image_set_quality: _ImageSetQuality = _ImageSetQuality()
    hero_image_index: int | None = None
    hero_image_rationale: str | None = None
    manual_review_required: bool = False
    auto_publish_candidate: bool = False
    blocking_reasons: list[str] = []
    seller_edit_fields: list[str] = []
    field_confidence: _FieldConfidence = _FieldConfidence()
    field_evidence: _FieldEvidence = _FieldEvidence()


class _GeminiIMEIOut(BaseModel):
    imei: str | None = None
    confidence: float = 0.0
    extracted_text: str = ""


class _GeminiSerialOut(BaseModel):
    serial_number: str | None = None
    confidence: float = 0.0
    extracted_text: str = ""


class _GeminiPriceOut(BaseModel):
    price_inr: int = 0
    confidence: float = 0.0
    reasoning: str = ""
    mrp_inr: int | None = None
    mrp_confidence: float = 0.0
    mrp_source: str | None = None
    mrp_reasoning: str | None = None


_extract_imei_candidate = extract_imei_candidate


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


def _normalize_model_name(model: str, *, kind: str) -> str:
    value = (model or "").strip()
    if not value:
        return DEFAULT_GEMINI_VISION_MODEL if kind == "vision" else DEFAULT_GEMINI_TEXT_MODEL
    return _DEPRECATED_MODEL_ALIASES.get(value, value)


def _get_model(kind: str) -> str:
    try:
        from app.core.settings import settings
        if kind == "vision":
            return _normalize_model_name(
                getattr(settings, "gemini_vision_model", "")
                or os.environ.get("GEMINI_VISION_MODEL", "")
                or DEFAULT_GEMINI_VISION_MODEL,
                kind=kind,
            )
        return _normalize_model_name(
            getattr(settings, "gemini_text_model", "")
            or os.environ.get("GEMINI_TEXT_MODEL", "")
            or DEFAULT_GEMINI_TEXT_MODEL,
            kind=kind,
        )
    except Exception:
        return DEFAULT_GEMINI_VISION_MODEL if kind == "vision" else DEFAULT_GEMINI_TEXT_MODEL


def current_vision_model() -> str:
    return _get_model("vision")


def current_text_model() -> str:
    return _get_model("text")


def reset_call_metrics() -> None:
    _GEMINI_CALL_METRICS.set(())


def consume_call_metrics(operation: str | None = None) -> list[dict[str, Any]]:
    metrics = list(_GEMINI_CALL_METRICS.get())
    if operation is None:
        _GEMINI_CALL_METRICS.set(())
        return metrics

    matched = [metric for metric in metrics if metric.get("operation") == operation]
    remaining = [metric for metric in metrics if metric.get("operation") != operation]
    _GEMINI_CALL_METRICS.set(tuple(remaining))
    return matched


def _record_call_metric(metric: dict[str, Any]) -> None:
    _GEMINI_CALL_METRICS.set((*_GEMINI_CALL_METRICS.get(), metric))


def _thinking_config(types: Any, model: str, kind: str):
    """Use the right thinking control for Gemini 3 vs Gemini 2.5.

    Gemini 3 accepts thinking_level; Gemini 2.5 accepts thinking_budget.
    Keeping this centralized prevents the model upgrade from breaking the
    structured extraction calls.
    """
    if model.startswith("gemini-3"):
        thinking_level = getattr(types, "ThinkingLevel", None)
        if thinking_level is not None:
            level = (
                thinking_level.MINIMAL
                if "flash" in model or kind == "text"
                else thinking_level.LOW
            )
            return types.ThinkingConfig(thinking_level=level)
        return types.ThinkingConfig(thinking_budget=0)
    if model.startswith("gemini-2.5-pro"):
        return types.ThinkingConfig(thinking_budget=-1)
    return types.ThinkingConfig(thinking_budget=0)


def _low_media_resolution(types: Any):
    media_resolution = getattr(types, "MediaResolution", None)
    if media_resolution is None:
        return None
    return getattr(media_resolution, "MEDIA_RESOLUTION_LOW", None)


def _usage_extra(resp: Any) -> dict[str, Any]:
    usage = getattr(resp, "usage_metadata", None)
    if usage is None:
        return {}
    return {
        "input_tokens": getattr(usage, "prompt_token_count", None),
        "output_tokens": getattr(usage, "candidates_token_count", None),
        "total_tokens": getattr(usage, "total_token_count", None),
        "cached_tokens": getattr(usage, "cached_content_token_count", None),
        "thoughts_tokens": getattr(usage, "thoughts_token_count", None),
    }


def _classify_gemini_error(exc: Exception) -> str:
    """Bucket a Gemini SDK exception so quota exhaustion is distinguishable
    from transient/real errors in metrics and logs.

    The free tier is ~20 vision calls/day (see CLAUDE.md). Without this, every
    failure looks identical and operators can't tell "we hit the daily quota"
    (operational, expected; switch model or enable billing) apart from a genuine
    integration bug.
    """
    status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    text = f"{type(exc).__name__} {exc}".lower()
    if (
        status == 429
        or "resource_exhausted" in text
        or "quota" in text
        or "429" in text
        or "rate limit" in text
    ):
        return "quota_exhausted"
    if (
        status in (500, 503)
        or "unavailable" in text
        or "deadline" in text
        or "timeout" in text
    ):
        return "transient"
    return "error"


async def _generate_content_with_metrics(
    client: Any,
    *,
    operation: str,
    model: str,
    contents: Any,
    config: Any,
    image_count: int = 0,
    bytes_total: int = 0,
    media_resolution: str | None = None,
):
    started = perf_counter()
    try:
        resp = await client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )
    except Exception as exc:
        latency_ms = int((perf_counter() - started) * 1000)
        error_kind = _classify_gemini_error(exc)
        metric = {
            "operation": operation,
            "provider": "gemini",
            "model": model,
            "status": "failed",
            "error_kind": error_kind,
            "latency_ms": latency_ms,
            "image_count": image_count,
            "bytes_total": bytes_total,
            "media_resolution": media_resolution,
            "error": f"{type(exc).__name__}: {str(exc)[:240]}",
        }
        _record_call_metric(metric)
        # Quota exhaustion is operational, not a bug — surface it distinctly so
        # dashboards/alerts can route it (switch model or enable billing) rather
        # than drowning it in generic error noise.
        if error_kind == "quota_exhausted":
            log.error("ai_assistant.gemini_quota_exhausted", extra=metric)
        else:
            log.warning("ai_assistant.gemini_call_failed", extra=metric)
        raise

    latency_ms = int((perf_counter() - started) * 1000)
    metric = {
        "operation": operation,
        "provider": "gemini",
        "model": model,
        "status": "success",
        "latency_ms": latency_ms,
        "image_count": image_count,
        "bytes_total": bytes_total,
        "media_resolution": media_resolution,
        **_usage_extra(resp),
    }
    _record_call_metric(metric)
    log.info(
        "ai_assistant.gemini_call_timing",
        extra=metric,
    )
    return resp


def _normalize_media_type(content_type: str) -> str:
    if content_type in ("image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"):
        return content_type
    return "image/jpeg"


def _identifier_ocr_part(types: Any, image_bytes: bytes, content_type: str):
    """Build a deterministic OCR-friendly image part.

    We do not mutate seller photos or stored listing media here. This is only
    the bytes sent to the OCR model: exif-corrected, gently upscaled when the
    source is small, autocontrasted, and sharpened so tiny IMEI/serial labels
    survive mobile camera blur.
    """
    try:
        from PIL import Image, ImageEnhance, ImageFilter, ImageOps  # type: ignore

        image = Image.open(BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image)
        if image.mode != "RGB":
            image = image.convert("RGB")
        max_side = max(image.size)
        if max_side < 2200:
            scale = min(2.0, 2200 / max(1, max_side))
            image = image.resize(
                (round(image.width * scale), round(image.height * scale)),
                Image.Resampling.LANCZOS,
            )
        image = ImageOps.autocontrast(image, cutoff=0.5)
        image = ImageEnhance.Sharpness(image).enhance(1.45)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.0, percent=135, threshold=2))
        out = BytesIO()
        image.save(out, format="JPEG", quality=95, optimize=True)
        return types.Part.from_bytes(data=out.getvalue(), mime_type="image/jpeg")
    except Exception:
        return types.Part.from_bytes(
            data=image_bytes,
            mime_type=_normalize_media_type(content_type),
        )


def _failed(reason: str) -> AIDetected:
    """Construct an AIDetected that signals failure to the router/UI."""
    return AIDetected(flags=[f"ai_failed:{reason}"])


def _vision_parts(
    types: Any,
    images: list[tuple[bytes, str]],
    *,
    media_resolution: Any | None = None,
) -> list[Any]:
    parts: list[Any] = []
    parts.append(
        "These photos show ONE proposed resale product from multiple angles. "
        "Photo indexes are zero-based; use those indexes when setting hero_image_index."
    )
    for idx, (image_bytes, content_type) in enumerate(images):
        part_kwargs = {
            "data": image_bytes,
            "mime_type": _normalize_media_type(content_type),
        }
        if media_resolution is not None:
            part_kwargs["media_resolution"] = media_resolution
        parts.append(f"Photo index {idx}:")
        parts.append(types.Part.from_bytes(**part_kwargs))
    return parts


def _translate_fast_vision_response(parsed: "_GeminiVisionFastOut") -> AIDetected:
    data = parsed.model_dump() if hasattr(parsed, "model_dump") else {}
    data.setdefault("description_suggestion", None)
    data.setdefault("mrp_inr", None)
    data.setdefault("mrp_confidence", 0.0)
    data.setdefault("mrp_source", None)
    data.setdefault("mrp_reasoning", None)
    return _translate_vision_response(_GeminiVisionOut(**data))


# ── Vision: detect from one OR many images ───────────────────────────────


async def detect_fast_from_images(
    images: list[tuple[bytes, str]],
) -> AIDetected:
    """Low-latency first-pass vision call for draft readiness.

    The full detect_from_images path remains available for enrichment, but the
    initial seller wait should only pay for the fields needed to show an editable
    draft safely.
    """
    if not images:
        return _failed("no_images")

    client = _get_client()
    if client is None:
        return _failed("no_client")

    from google.genai import types

    media_resolution = _low_media_resolution(types)
    parts = _vision_parts(types, images, media_resolution=media_resolution)
    media_resolution_name = str(media_resolution.value if hasattr(media_resolution, "value") else media_resolution or "")
    model = _get_model("vision")
    config = types.GenerateContentConfig(
        system_instruction=PROMPT_VISION_FAST_DETECT,
        response_mime_type="application/json",
        response_schema=_GeminiVisionFastOut,
        temperature=0.0,
        max_output_tokens=VISION_FAST_MAX_OUTPUT_TOKENS,
        media_resolution=media_resolution,
        thinking_config=_thinking_config(types, model, "vision"),
    )

    try:
        resp = await _generate_content_with_metrics(
            client,
            operation="vision_fast",
            model=model,
            contents=parts,
            config=config,
            image_count=len(images),
            bytes_total=sum(len(image_bytes) for image_bytes, _ in images),
            media_resolution=media_resolution_name,
        )
    except Exception as e:
        log.warning(
            "ai_assistant.vision_fast_api_failed",
            extra={"error": f"{type(e).__name__}: {str(e)[:300]}"},
        )
        return _failed("api_error")

    parsed = getattr(resp, "parsed", None)
    if parsed is None:
        raw = (resp.text or "").strip()
        if not raw:
            log.warning(
                "ai_assistant.vision_fast_empty_response",
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
            parsed = _GeminiVisionFastOut(**data)
        except Exception as e:
            log.warning(
                "ai_assistant.vision_fast_parse_failed",
                extra={"error": str(e)[:200], "raw": raw[:300]},
            )
            return _failed("parse_failed")

    detected = _translate_fast_vision_response(parsed)
    return _apply_post_processing_guardrails(detected)


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

    parts = _vision_parts(types, images)

    model = _get_model("vision")
    config = types.GenerateContentConfig(
        system_instruction=PROMPT_VISION_DETECT,
        response_mime_type="application/json",
        response_schema=_GeminiVisionOut,
        temperature=0.2,
        max_output_tokens=VISION_DETECT_MAX_OUTPUT_TOKENS,
        thinking_config=_thinking_config(types, model, "vision"),
    )

    try:
        resp = await _generate_content_with_metrics(
            client,
            operation="vision_full",
            model=model,
            contents=parts,
            config=config,
            image_count=len(images),
            bytes_total=sum(len(image_bytes) for image_bytes, _ in images),
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
        category_family=parsed.category_family,
        category_specifics=_to_dict(parsed.category_specifics),
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
        mrp_inr=int(parsed.mrp_inr) if parsed.mrp_inr else None,
        mrp_confidence=float(parsed.mrp_confidence or 0.0),
        mrp_source=parsed.mrp_source,
        mrp_reasoning=parsed.mrp_reasoning,
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

_MRP_BLOCKING_FLAGS = (
    "multiple_items",
    "no_product",
    "blurry",
    "screenshot_only",
    "stock_or_catalog_suspected",
)

_VALID_MRP_SOURCES = {
    "visible_mrp",
    "receipt_or_bill",
    "market_anchor",
}

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
      5. MRP must have a trusted source, enough confidence, and be above
         the resale price before it can power discount display.
      6. manual_review_required True → auto_publish_candidate False.
      7. kids-utility with completeness-unclear feedback
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
            mrp_inr=None,
            mrp_confidence=0.0,
            mrp_source=None,
            mrp_reasoning=None,
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
    fe = detected.field_evidence or {}
    suggested_price_inr = detected.suggested_price_inr
    price_confidence = detected.price_confidence
    price_reasoning = detected.price_reasoning
    mrp_inr = detected.mrp_inr
    mrp_confidence = detected.mrp_confidence
    mrp_source = (detected.mrp_source or "").strip().lower() or None
    mrp_reasoning = detected.mrp_reasoning
    for flag in _PRICE_BLOCKING_FLAGS:
        if flag in flags:
            if suggested_price_inr is not None:
                price_reasoning = f"price suppressed by post-processor: flag={flag}"
            suggested_price_inr = None
            price_confidence = 0.0
            if flag not in blocking_reasons:
                blocking_reasons.append(flag)

    # MRP powers discount display, so it gets its own stricter cleanup.
    if mrp_inr is not None:
        if any(flag in flags for flag in _MRP_BLOCKING_FLAGS):
            mrp_reasoning = "MRP suppressed by post-processor: unusable or non-original photo set."
            mrp_inr = None
            mrp_confidence = 0.0
            mrp_source = None
        elif mrp_inr <= 0 or mrp_source not in _VALID_MRP_SOURCES:
            mrp_reasoning = "MRP suppressed by post-processor: invalid source or value."
            mrp_inr = None
            mrp_confidence = 0.0
            mrp_source = None
        elif (mrp_confidence or 0.0) < 0.55:
            mrp_reasoning = "MRP suppressed by post-processor: confidence below floor."
            mrp_inr = None
            mrp_confidence = 0.0
            mrp_source = None
        elif mrp_source == "market_anchor" and (mrp_confidence or 0.0) < 0.60:
            mrp_reasoning = "MRP suppressed by post-processor: market anchor confidence below floor."
            mrp_inr = None
            mrp_confidence = 0.0
            mrp_source = None
        elif mrp_source in {"visible_mrp", "receipt_or_bill"} and fe.get("mrp_inr") != "direct_visible":
            mrp_reasoning = "MRP suppressed by post-processor: visible price was not directly evidenced."
            mrp_inr = None
            mrp_confidence = 0.0
            mrp_source = None
        elif suggested_price_inr is not None and mrp_inr <= suggested_price_inr:
            mrp_reasoning = "MRP suppressed by post-processor: not above suggested resale price."
            mrp_inr = None
            mrp_confidence = 0.0
            mrp_source = None

    # Rule 3: spec fields without direct_visible evidence.
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
        "mrp_inr": mrp_inr,
        "mrp_confidence": mrp_confidence,
        "mrp_source": mrp_source,
        "mrp_reasoning": mrp_reasoning,
        "manual_review_required": manual_review_required,
        "auto_publish_candidate": auto_publish_candidate,
        "blocking_reasons": blocking_reasons,
    }
    update_kwargs.update(forced_specs)
    return detected.model_copy(update=update_kwargs)


# Single-image convenience wrapper — keeps v1 API for backward compatibility.
async def detect_from_image(image_bytes: bytes, content_type: str = "image/jpeg") -> AIDetected:
    return await detect_from_images([(image_bytes, content_type)])


# ── Vision: device identifier OCR ─────────────────────────────────────────


async def extract_identifier(
    image_bytes: bytes,
    content_type: str = "image/jpeg",
    category_slug: str | None = None,
) -> dict:
    """OCR a category-appropriate device identifier.

    Smartphones use IMEI because CEIR/Luhn applies. Laptops/tablets use serial
    number or service tag. Other electronic categories may still call this as
    a best-effort serial read, but they are not blocked on it elsewhere.
    """
    if category_slug == "smartphones" or not category_slug:
        return await extract_imei(image_bytes, content_type)
    return await extract_serial(image_bytes, content_type, category_slug=category_slug)


async def extract_imei(image_bytes: bytes, content_type: str = "image/jpeg") -> dict:
    """OCR an IMEI sticker / box / Settings screen.

    Returns:
        {"imei": str|None, "confidence": float, "extracted_text": str}
    """
    client = _get_client()
    if client is None:
        return {"imei": None, "confidence": 0.0, "extracted_text": ""}

    from google.genai import types

    image_part = _identifier_ocr_part(types, image_bytes, content_type)

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
                "usually labelled 'IMEI', 'IMEI 1', 'IMEI1', 'IMEI (slot 1)', "
                "'Primary IMEI', or 'MEID/IMEI'. It may "
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

    imei = extract_imei_candidate(parsed.imei, parsed.extracted_text)
    if imei and imei != parsed.imei:
        log.info("ai_assistant.imei_normalized_from_ocr_text")

    return {
        "identifier_kind": "imei",
        "identifier_value": imei,
        "imei": imei,
        "serial_number": None,
        "confidence": float(parsed.confidence or 0.0),
        "extracted_text": str(parsed.extracted_text or "")[:500],
    }


async def extract_serial(
    image_bytes: bytes,
    content_type: str = "image/jpeg",
    *,
    category_slug: str | None = None,
) -> dict:
    """OCR a laptop/tablet serial number or service tag."""
    client = _get_client()
    if client is None:
        return {
            "identifier_kind": "serial",
            "identifier_value": None,
            "imei": None,
            "serial_number": None,
            "confidence": 0.0,
            "extracted_text": "",
        }

    from google.genai import types

    image_part = _identifier_ocr_part(types, image_bytes, content_type)

    model = _get_model("vision")
    config = types.GenerateContentConfig(
        system_instruction=PROMPT_SERIAL_OCR,
        response_mime_type="application/json",
        response_schema=_GeminiSerialOut,
        temperature=0.0,
        max_output_tokens=512,
        thinking_config=_thinking_config(types, model, "vision"),
    )

    category_hint = "tablet" if category_slug == "tablets" else "laptop"
    try:
        resp = await client.aio.models.generate_content(
            model=model,
            contents=[
                "Read the device serial number from this image. The item is a "
                f"{category_hint}. Prefer labels such as 'Serial Number', "
                "'S/N', 'SN', or Dell 'Service Tag'. Do not return model "
                "number, product number, SKU, IMEI, EID, ICCID, MAC address, "
                "invoice/order number, or barcode value.",
                image_part,
            ],
            config=config,
        )
    except Exception as e:
        log.warning(
            "ai_assistant.serial_api_failed",
            extra={"error": f"{type(e).__name__}: {str(e)[:200]}"},
        )
        return {
            "identifier_kind": "serial",
            "identifier_value": None,
            "imei": None,
            "serial_number": None,
            "confidence": 0.0,
            "extracted_text": "",
        }

    parsed = getattr(resp, "parsed", None)
    if parsed is None:
        raw = (resp.text or "").strip()
        if not raw:
            log.warning("ai_assistant.serial_empty_response")
            return {
                "identifier_kind": "serial",
                "identifier_value": None,
                "imei": None,
                "serial_number": None,
                "confidence": 0.0,
                "extracted_text": "",
            }
        import json
        try:
            data = json.loads(raw)
            parsed = _GeminiSerialOut(**data)
        except Exception as e:
            log.warning(
                "ai_assistant.serial_parse_failed",
                extra={"error": str(e)[:200], "raw": raw[:300]},
            )
            return {
                "identifier_kind": "serial",
                "identifier_value": None,
                "imei": None,
                "serial_number": None,
                "confidence": 0.0,
                "extracted_text": "",
            }

    serial = extract_serial_candidate(parsed.serial_number, parsed.extracted_text)
    if serial and serial != parsed.serial_number:
        log.info("ai_assistant.serial_normalized_from_ocr_text")

    return {
        "identifier_kind": "serial",
        "identifier_value": serial,
        "imei": None,
        "serial_number": serial,
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
        resp = await _generate_content_with_metrics(
            client,
            operation="description_regen",
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
    category_slug: str | None = None,
    detected_item_type: str | None = None,
) -> dict | None:
    client = _get_client()
    if client is None:
        return None

    from google.genai import types

    user_text = (
        f"Category: {category_slug or 'unknown'}\n"
        f"Item type: {detected_item_type or 'unknown'}\n"
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
        max_output_tokens=PRICE_ESTIMATE_MAX_OUTPUT_TOKENS,
        thinking_config=_thinking_config(types, model, "text"),
    )

    try:
        resp = await _generate_content_with_metrics(
            client,
            operation="price_text",
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

    if parsed.price_inr <= 0 and not parsed.mrp_inr:
        return None

    return {
        "price_inr": int(parsed.price_inr or 0),
        "confidence": float(parsed.confidence or 0.0),
        "reasoning": str(parsed.reasoning or "")[:200],
        "mrp_inr": int(parsed.mrp_inr) if parsed.mrp_inr else None,
        "mrp_confidence": float(parsed.mrp_confidence or 0.0),
        "mrp_source": parsed.mrp_source,
        "mrp_reasoning": str(parsed.mrp_reasoning or "")[:200] if parsed.mrp_reasoning else None,
    }
