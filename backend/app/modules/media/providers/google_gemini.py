from __future__ import annotations

import json
import logging
import os
from base64 import b64decode
from colorsys import rgb_to_hls
from dataclasses import dataclass
from io import BytesIO
from typing import Any

from pydantic import BaseModel

from app.core.settings import settings
from app.modules.media.providers.base import BackgroundCleanupResult

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class _BackgroundStyle:
    name: str
    description: str


class _CleanupQualityAudit(BaseModel):
    has_human_artifact: bool = False
    product_modified: bool = False
    confidence: float | None = None
    reason: str | None = None


_DEFAULT_STYLE = _BackgroundStyle(
    name="owmee_warm_ivory",
    description=(
        "Owmee standard warm ivory studio background (#FEFBF4), matte finish, "
        "clean floor curve, and a natural soft contact shadow. Keep the surface "
        "neutral, premium, and marketplace-clean. Do not use brown, tan, "
        "caramel, copper, orange, or burnt-orange background tones."
    ),
)

_LIGHT_PRODUCT_CONTRAST_STYLE = _BackgroundStyle(
    name="owmee_soft_green_contrast",
    description=(
        "Owmee contrast background only for white/ivory/cream/silver products: "
        "soft eucalyptus green studio background (#E3F0EB), matte finish, clean "
        "floor curve, and a natural soft contact shadow. Keep it light and "
        "fresh, not dark or saturated."
    ),
)


class GoogleGeminiBackgroundCleanupProvider:
    """Google Gemini image-edit provider for listing hero background cleanup.

    The prompt is intentionally narrow: remove/clean the background only and
    preserve the product exactly, including visible wear. If the provider
    cannot produce an image, callers fall back to the original processed photo.
    """

    provider_name = "google-gemini"

    async def clean_listing_background(
        self,
        image_bytes: bytes,
        content_type: str,
        *,
        category_slug: str | None = None,
    ) -> BackgroundCleanupResult:
        api_key = (
            settings.gemini_api_key
            or os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", "")
        ).strip()
        if not api_key:
            return BackgroundCleanupResult(
                ok=False,
                provider=self.provider_name,
                model=settings.gemini_image_model,
                reason="missing_gemini_api_key",
            )

        try:
            from google.genai import Client, types
            from PIL import Image, ImageOps  # type: ignore
        except Exception as e:
            log.warning("media.cleanup.sdk_missing", extra={"error": str(e)})
            return BackgroundCleanupResult(
                ok=False,
                provider=self.provider_name,
                model=settings.gemini_image_model,
                reason="sdk_missing",
            )

        try:
            source = Image.open(BytesIO(image_bytes))
            source = ImageOps.exif_transpose(source)
        except Exception as e:
            return BackgroundCleanupResult(
                ok=False,
                provider=self.provider_name,
                model=settings.gemini_image_model,
                reason=f"invalid_image:{type(e).__name__}",
            )

        style = self._choose_background_style(source)
        category_hint = category_slug or "general resale item"
        prompt = self._build_cleanup_prompt(category_hint, style)

        client = Client(api_key=api_key)
        output_bytes, reason = await self._generate_cleanup_image(
            client,
            types,
            prompt,
            source,
            log_event="media.cleanup.google_failed",
        )
        if output_bytes is None:
            return BackgroundCleanupResult(
                ok=False,
                provider=self.provider_name,
                model=settings.gemini_image_model,
                reason=reason or "no_image_output",
                style=style.name,
            )

        audit = await self._audit_cleanup_quality(client, types, source, output_bytes)
        rejection_reason = self._audit_rejection_reason(audit)
        if rejection_reason:
            log.warning(
                "media.cleanup.quality_rejected",
                extra={
                    "provider": self.provider_name,
                    "model": settings.gemini_image_model,
                    "audit_confidence": audit.confidence,
                    "audit_reason": (audit.reason or "")[:180],
                    "rejection_reason": rejection_reason,
                    "style": style.name,
                },
            )
            strict_prompt = self._build_cleanup_prompt(
                category_hint,
                style,
                strict_human_removal=True,
            )
            retry_bytes, retry_failure_reason = await self._generate_cleanup_image(
                client,
                types,
                strict_prompt,
                source,
                log_event="media.cleanup.google_retry_failed",
            )
            if retry_bytes is None:
                return BackgroundCleanupResult(
                    ok=False,
                    provider=self.provider_name,
                    model=settings.gemini_image_model,
                    reason=f"{rejection_reason}_retry_failed:{retry_failure_reason or 'unknown'}",
                    style=style.name,
                )

            retry_audit = await self._audit_cleanup_quality(client, types, source, retry_bytes)
            retry_rejection_reason = self._audit_rejection_reason(retry_audit)
            if retry_rejection_reason:
                log.warning(
                    "media.cleanup.quality_rejected_after_retry",
                    extra={
                        "provider": self.provider_name,
                        "model": settings.gemini_image_model,
                        "audit_confidence": retry_audit.confidence,
                        "audit_reason": (retry_audit.reason or "")[:180],
                        "rejection_reason": retry_rejection_reason,
                        "style": style.name,
                    },
                )
                return BackgroundCleanupResult(
                    ok=False,
                    provider=self.provider_name,
                    model=settings.gemini_image_model,
                    reason=retry_rejection_reason,
                    style=style.name,
                )
            output_bytes = retry_bytes

        return BackgroundCleanupResult(
            ok=True,
            image_bytes=output_bytes,
            content_type="image/png",
            provider=self.provider_name,
            model=settings.gemini_image_model,
            style=style.name,
        )

    @staticmethod
    def _build_cleanup_prompt(
        category_hint: str,
        style: _BackgroundStyle,
        *,
        strict_human_removal: bool = False,
    ) -> str:
        strict_block = (
            "STRICT CORRECTION MODE: a previous cleanup may have left a visible "
            "hand, finger, skin patch, sleeve edge, or body shadow, or may have "
            "changed the product color/material. Prioritize a product-only hero "
            "result with exact product fidelity over preserving empty surrounding "
            "space. If needed, crop, zoom, or recompose slightly to remove all "
            "human pixels while keeping the actual product fully visible and "
            "centered. Repeat the cleanup internally until the result contains no "
            "skin, hand, sleeve, or person reflection. Never recolor, restyle, "
            "repair, or beautify the product.\n\n"
            if strict_human_removal
            else ""
        )
        return (
            "Create one marketplace hero photo for Owmee from this seller-uploaded "
            f"{category_hint} image.\n\n"
            f"{strict_block}"
            "TASK SCOPE: only replace/clean the background. The product must remain "
            "the real seller item.\n\n"
            "MANDATORY MASK-STYLE WORKFLOW: perform the edit as if using a precise "
            "product mask, not as a generative redesign. Step 1: identify the actual "
            "sellable product boundary and all visible original product pixels. Step "
            "2: create a removal mask for every non-product human artifact, including "
            "skin-toned regions, fingers wrapped around phone edges/corners, thumbs "
            "behind the item, palms under the item, wrists, arms, sleeves, faces, hair, "
            "body shadows, and people reflected on glossy screens or plastic. Step 3: "
            "erase the entire human-artifact mask and inpaint only the background/soft "
            "shadow behind it. Step 4: composite the original visible product pixels "
            "back unchanged. Step 5: inspect edges at high zoom so no skin-colored "
            "fringe, finger curve, cutout halo, sleeve patch, or hand shadow remains. "
            "Do not transform the seller item into a stock render.\n\n"
            "PRODUCT PRESERVATION RULES: preserve the product exactly: same shape, "
            "silhouette, dimensions, color, material, texture, printed text, labels, "
            "logos, scratches, dents, wear, stains, cracks, stickers, accessories, "
            "and perspective. Do not repair, beautify, recolor, repaint, sharpen into "
            "new detail, remove defects, add missing parts, add accessories, change "
            "screen contents, or hide damage. If preserving the product exactly is "
            "not possible, return the visible product unchanged and only soften the "
            "background, except human body parts must still be removed.\n\n"
            "PRIORITY ORDER: first remove human/body artifacts, second preserve the "
            "real visible product, third apply the catalog background. Never keep a "
            "hand or skin area merely because it touches the product.\n\n"
            "HUMAN REMOVAL RULES: the final hero image must contain the product only. "
            "Treat every human body part as background/occlusion, never as part of "
            "the product. Remove all visible hands, fingers, thumbs, arms, wrists, "
            "skin, nails, faces, hair, clothing, reflections of people, and body "
            "shadows. Replace removed human regions with the Owmee catalog background "
            "and natural product shadow. If a hand is holding or touching the product, "
            "erase the hand cleanly while preserving the visible product edges and "
            "surface exactly. For phones/tablets, this includes fingers along the "
            "side rails, fingertips near the camera island, thumb edges on the screen, "
            "skin reflected in the glass, and palm/wrist shapes behind the device. "
            "Do not leave skin-colored fragments, finger outlines, hand shadows, "
            "cutout halos, or blurred human residue. Do not invent hidden labels, "
            "serial numbers, condition marks, ports, buttons, accessories, or defects "
            "that were covered by the hand; only make the minimal neutral edge/"
            "background fill needed so the image looks clean and not broken. If any "
            "human pixels cannot be removed cleanly, crop, zoom, or recompose slightly "
            "to exclude the human artifact while keeping the product fully visible, "
            "centered, and true to the source. A slightly tighter product crop is "
            "better than leaving even one hand/finger/skin artifact.\n\n"
            f"BACKGROUND STYLE: use exactly this Owmee catalog style: {style.description} "
            "Use this same style consistently across listings. Adjust only the "
            "background shade within this style if needed for edge separation; never "
            "recolor the product to create contrast. If the product is transparent, "
            "glossy, reflective, or the same color as the background, preserve the "
            "real material and edges; change only the background tone and shadow.\n\n"
            "COMPOSITION: keep the product centered, fully visible, upright when the "
            "source is upright, and large enough for buyers to inspect. Add only a "
            "natural soft contact shadow under the actual product. No props, no hands, "
            "no extra objects, no decorative patterns, no text overlays, no artificial "
            "reflections, no glow, no logo watermark.\n\n"
            "FINAL QUALITY GATE: before returning, inspect the final image. If any "
            "human body part, skin patch, finger edge, sleeve, face, hair, or person "
            "reflection remains visible, fix it before returning. This image will be "
            "rejected by an automatic audit if any hand, finger, skin, clothing, "
            "person reflection, product recoloring, product reshaping, logo/text "
            "change, condition change, fake stock-render look, or over-smoothed cheap "
            "AI finish remains. Return only the cleaned image."
        )

    async def _generate_cleanup_image(
        self,
        client: Any,
        types: Any,
        prompt: str,
        source: Any,
        *,
        log_event: str,
    ) -> tuple[bytes | None, str | None]:
        try:
            response = await client.aio.models.generate_content(
                model=settings.gemini_image_model,
                contents=[prompt, source],
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    temperature=0.08,
                ),
            )
        except Exception as e:
            log.warning(
                log_event,
                extra={"error": f"{type(e).__name__}: {str(e)[:240]}"},
            )
            return None, "api_error"

        output_bytes = self._extract_image_bytes(response)
        if output_bytes is None:
            return None, "no_image_output"
        return output_bytes, None

    async def _audit_cleanup_quality(
        self,
        client: Any,
        types: Any,
        source_image: Any,
        image_bytes: bytes,
    ) -> _CleanupQualityAudit | None:
        try:
            from PIL import Image, ImageOps  # type: ignore

            audit_image = Image.open(BytesIO(image_bytes))
            audit_image = ImageOps.exif_transpose(audit_image)
        except Exception as e:
            log.warning("media.cleanup.audit_image_invalid", extra={"error": str(e)[:160]})
            return None

        prompt = (
            "You are auditing a marketplace background-cleanup result. The first "
            "image is the seller's original source photo. The second image is the "
            "candidate cleaned hero photo. Return JSON only.\n\n"
            "Set has_human_artifact=true if the candidate contains any human hand, "
            "finger, thumb, arm, wrist, skin patch, nail, sleeve/clothing edge, "
            "face, hair, person reflection, or human-shaped shadow anywhere.\n\n"
            "Set product_modified=true if the candidate changed the actual product "
            "from the source: color, material, screen tint/content, printed text, "
            "logos, stickers, labels, camera layout, ports/buttons, silhouette, "
            "damage, scratches, dents, cracks, or visible wear. Ignore background "
            "changes, removed hands/props, and neutral fill where a hand used to "
            "occlude the product edge. Do not mark a product's normal warm color "
            "as human unless it is visibly part of a person.\n\n"
            "confidence must be 0 to 1. reason should be a short visual note."
        )
        try:
            response = await client.aio.models.generate_content(
                model=settings.gemini_vision_model,
                contents=[
                    prompt,
                    "Original source photo:",
                    source_image,
                    "Candidate cleaned hero photo:",
                    audit_image,
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=_CleanupQualityAudit,
                    temperature=0.0,
                    max_output_tokens=160,
                ),
            )
        except Exception as e:
            log.warning(
                "media.cleanup.audit_failed",
                extra={"error": f"{type(e).__name__}: {str(e)[:200]}"},
            )
            return None

        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, _CleanupQualityAudit):
            return parsed
        if isinstance(parsed, dict):
            try:
                return _CleanupQualityAudit(**parsed)
            except Exception:
                return None

        raw = (getattr(response, "text", "") or "").strip()
        if not raw:
            return None
        try:
            return _CleanupQualityAudit(**json.loads(raw))
        except Exception as e:
            log.warning(
                "media.cleanup.audit_parse_failed",
                extra={"error": str(e)[:160], "raw": raw[:240]},
            )
            return None

    @staticmethod
    def _audit_rejection_reason(audit: _CleanupQualityAudit | None) -> str | None:
        if audit is None:
            return None
        if audit.confidence is not None and audit.confidence < 0.35:
            return None
        if audit.has_human_artifact:
            return "human_artifact_remaining"
        if audit.product_modified:
            return "product_modified"
        return None

    @staticmethod
    def _choose_background_style(source) -> _BackgroundStyle:
        """Keep one catalog background, switching only when product contrast needs it.

        We use the centered crop as a practical proxy because the AI capture flow
        asks sellers for centered product photos and the selected hero image should
        have the item centered. This is intentionally conservative: most products
        stay on the standard Owmee warm ivory background.
        """
        try:
            image = source.convert("RGB")
            width, height = image.size
            crop = image.crop((
                int(width * 0.2),
                int(height * 0.2),
                int(width * 0.8),
                int(height * 0.8),
            ))
            crop.thumbnail((72, 72))
            pixels = list(crop.getdata())
        except Exception:
            return _DEFAULT_STYLE

        if not pixels:
            return _DEFAULT_STYLE

        light_total = 0.0
        sat_total = 0.0
        vivid_pixels = 0

        for r, g, b in pixels:
            _hue, lightness, saturation = rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
            light_total += lightness
            sat_total += saturation
            if saturation > 0.16 and 0.18 < lightness < 0.88:
                vivid_pixels += 1

        avg_light = light_total / len(pixels)
        avg_sat = sat_total / len(pixels)
        vivid_ratio = vivid_pixels / len(pixels)

        if avg_light > 0.80 and (avg_sat < 0.45 or vivid_ratio < 0.08):
            return _LIGHT_PRODUCT_CONTRAST_STYLE
        return _DEFAULT_STYLE

    @staticmethod
    def _extract_image_bytes(response) -> bytes | None:
        parts = list(getattr(response, "parts", None) or [])
        if not parts:
            candidates = getattr(response, "candidates", None) or []
            for candidate in candidates:
                content = getattr(candidate, "content", None)
                parts.extend(getattr(content, "parts", None) or [])

        for part in parts:
            inline = getattr(part, "inline_data", None)
            data = getattr(inline, "data", None)
            if data:
                raw = b64decode(data) if isinstance(data, str) else data
                normalized = GoogleGeminiBackgroundCleanupProvider._normalize_image_bytes(raw)
                if normalized is not None:
                    return normalized

            as_image = getattr(part, "as_image", None)
            if callable(as_image):
                try:
                    image = as_image()
                    normalized = GoogleGeminiBackgroundCleanupProvider._normalize_image_object(image)
                    if normalized is not None:
                        return normalized
                except Exception:
                    pass

        return None

    @staticmethod
    def _normalize_image_bytes(image_bytes: bytes) -> bytes | None:
        try:
            from PIL import Image, ImageOps  # type: ignore

            image = Image.open(BytesIO(image_bytes))
            image = ImageOps.exif_transpose(image)
            out = BytesIO()
            image.save(out, format="PNG")
            return out.getvalue()
        except Exception:
            return None

    @staticmethod
    def _normalize_image_object(image) -> bytes | None:
        if image is None:
            return None

        try:
            from PIL import Image, ImageOps  # type: ignore

            if isinstance(image, Image.Image):
                image = ImageOps.exif_transpose(image)
                out = BytesIO()
                image.save(out, format="PNG")
                return out.getvalue()
        except Exception:
            pass

        image_bytes = getattr(image, "image_bytes", None) or getattr(image, "data", None)
        if image_bytes:
            if isinstance(image_bytes, str):
                try:
                    image_bytes = b64decode(image_bytes)
                except Exception:
                    return None
            return GoogleGeminiBackgroundCleanupProvider._normalize_image_bytes(image_bytes)

        return None
