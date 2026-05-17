from __future__ import annotations

import logging
import os
from base64 import b64decode
from colorsys import rgb_to_hls
from dataclasses import dataclass
from io import BytesIO

from app.core.settings import settings
from app.modules.media.providers.base import BackgroundCleanupResult

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class _BackgroundStyle:
    name: str
    description: str


_DEFAULT_STYLE = _BackgroundStyle(
    name="owmee_warm_ivory",
    description=(
        "Owmee standard warm ivory studio background (#FEFBF4) with a very "
        "subtle soft eucalyptus green wash (#EAF4F1), matte finish, clean floor "
        "curve, and a natural soft contact shadow."
    ),
)

_WARM_CONTRAST_STYLE = _BackgroundStyle(
    name="owmee_soft_burnt_orange_contrast",
    description=(
        "Owmee contrast background for green/teal/blue products: warm ivory "
        "base (#FEFBF4) with a soft desaturated burnt-orange/coral wash "
        "(#F1D7C8), matte finish, clean floor curve, and a natural soft "
        "contact shadow."
    ),
)

_EUCALYPTUS_CONTRAST_STYLE = _BackgroundStyle(
    name="owmee_soft_eucalyptus_contrast",
    description=(
        "Owmee contrast background for orange/copper/brown products: soft "
        "eucalyptus green studio background (#E3F0EB), matte finish, clean "
        "floor curve, and a natural soft contact shadow."
    ),
)

_SAGE_CONTRAST_STYLE = _BackgroundStyle(
    name="owmee_soft_sage_contrast",
    description=(
        "Owmee contrast background for white/cream/silver products: slightly "
        "deeper soft sage green-gray studio background (#D7E7E1), matte finish, "
        "clean floor curve, and a natural soft contact shadow."
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
                "media.cleanup.google_failed",
                extra={"error": f"{type(e).__name__}: {str(e)[:240]}"},
            )
            return BackgroundCleanupResult(
                ok=False,
                provider=self.provider_name,
                model=settings.gemini_image_model,
                reason="api_error",
                style=style.name,
            )

        output_bytes = self._extract_image_bytes(response)
        if output_bytes is None:
            return BackgroundCleanupResult(
                ok=False,
                provider=self.provider_name,
                model=settings.gemini_image_model,
                reason="no_image_output",
                style=style.name,
            )

        return BackgroundCleanupResult(
            ok=True,
            image_bytes=output_bytes,
            content_type="image/png",
            provider=self.provider_name,
            model=settings.gemini_image_model,
            style=style.name,
        )

    @staticmethod
    def _build_cleanup_prompt(category_hint: str, style: _BackgroundStyle) -> str:
        return (
            "Create one marketplace hero photo for Owmee from this seller-uploaded "
            f"{category_hint} image.\n\n"
            "TASK SCOPE: only replace/clean the background. The product must remain "
            "the real seller item.\n\n"
            "PRODUCT PRESERVATION RULES: preserve the product exactly: same shape, "
            "silhouette, dimensions, color, material, texture, printed text, labels, "
            "logos, scratches, dents, wear, stains, cracks, stickers, accessories, "
            "and perspective. Do not repair, beautify, recolor, repaint, sharpen into "
            "new detail, remove defects, add missing parts, add accessories, change "
            "screen contents, or hide damage. If preserving the product exactly is "
            "not possible, return the original product unchanged and only soften the "
            "background.\n\n"
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
            "reflections, no glow, no logo watermark. Return only the cleaned image."
        )

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
        hue_buckets = {
            "warm": 0,
            "green_blue": 0,
        }
        vivid_pixels = 0

        for r, g, b in pixels:
            hue, lightness, saturation = rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
            degrees = hue * 360.0
            light_total += lightness
            sat_total += saturation
            if saturation > 0.16 and 0.18 < lightness < 0.88:
                vivid_pixels += 1
                if 15 <= degrees <= 70 or degrees >= 335:
                    hue_buckets["warm"] += 1
                elif 80 <= degrees <= 230:
                    hue_buckets["green_blue"] += 1

        avg_light = light_total / len(pixels)
        avg_sat = sat_total / len(pixels)
        vivid_ratio = vivid_pixels / len(pixels)
        warm_ratio = hue_buckets["warm"] / len(pixels)
        green_blue_ratio = hue_buckets["green_blue"] / len(pixels)

        if avg_light > 0.80 and (avg_sat < 0.45 or vivid_ratio < 0.08):
            return _SAGE_CONTRAST_STYLE
        if vivid_ratio > 0.12 and green_blue_ratio > 0.10:
            return _WARM_CONTRAST_STYLE
        if vivid_ratio > 0.12 and warm_ratio > 0.10:
            return _EUCALYPTUS_CONTRAST_STYLE
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
