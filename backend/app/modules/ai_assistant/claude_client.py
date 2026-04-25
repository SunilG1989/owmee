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

Models (free-tier defaults, override via .env):
    Vision:  gemini-2.5-flash
    Text:    gemini-2.0-flash-lite

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


# ── Pydantic schemas used as response_schema for Gemini ───────────────────
#
# These mirror the AIDetected/IMEI/Price shapes but are kept LOCAL because:
# (a) Gemini's response_schema only accepts simple types (no Field metadata,
#     no extra default factories beyond plain values), and
# (b) we want to decouple the on-the-wire AI shape from app-internal
#     domain types so we can evolve them separately.


class _GeminiVisionOut(BaseModel):
    """Schema we ask Gemini to fill. Matches AIDetected loosely."""
    category_slug: str | None = None
    category_confidence: float = 0.0
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    color: str | None = None
    condition_guess: str | None = None
    title_suggestion: str | None = None
    description_suggestion: str | None = None
    flags: list[str] = []


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
                or "gemini-2.5-flash"
            )
        return (
            getattr(settings, "gemini_text_model", "")
            or os.environ.get("GEMINI_TEXT_MODEL", "")
            or "gemini-2.0-flash-lite"
        )
    except Exception:
        return "gemini-2.5-flash" if kind == "vision" else "gemini-2.0-flash-lite"


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
        "Combine signals from all photos. Be confident."
    )
    parts.append(text_intro)
    for image_bytes, content_type in images:
        parts.append(
            types.Part.from_bytes(
                data=image_bytes,
                mime_type=_normalize_media_type(content_type),
            )
        )

    config = types.GenerateContentConfig(
        system_instruction=PROMPT_VISION_DETECT,
        response_mime_type="application/json",
        response_schema=_GeminiVisionOut,
        temperature=0.2,
        max_output_tokens=1024,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=_get_model("vision"),
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

    # Translate Gemini's output to the AIDetected domain type.
    flags = parsed.flags if isinstance(parsed.flags, list) else []
    return AIDetected(
        category_slug=parsed.category_slug,
        category_confidence=float(parsed.category_confidence or 0.0),
        brand=parsed.brand,
        model=parsed.model,
        storage=parsed.storage,
        color=parsed.color,
        condition_guess=parsed.condition_guess,
        title_suggestion=parsed.title_suggestion,
        description_suggestion=parsed.description_suggestion,
        flags=[str(f) for f in flags],
    )


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

    config = types.GenerateContentConfig(
        system_instruction=PROMPT_IMEI_OCR,
        response_mime_type="application/json",
        response_schema=_GeminiIMEIOut,
        temperature=0.0,
        max_output_tokens=512,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=_get_model("vision"),
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

    config = types.GenerateContentConfig(
        system_instruction=PROMPT_DESCRIPTION_REGEN,
        temperature=0.7,
        max_output_tokens=600,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=_get_model("text"),
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

    config = types.GenerateContentConfig(
        system_instruction=PROMPT_PRICE_ESTIMATE,
        response_mime_type="application/json",
        response_schema=_GeminiPriceOut,
        temperature=0.3,
        max_output_tokens=512,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    try:
        resp = await client.aio.models.generate_content(
            model=_get_model("text"),
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
