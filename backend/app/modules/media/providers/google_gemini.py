from __future__ import annotations

import logging
import os
from base64 import b64decode
from io import BytesIO

from app.core.settings import settings
from app.modules.media.providers.base import BackgroundCleanupResult

log = logging.getLogger(__name__)


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

        category_hint = category_slug or "general resale item"
        prompt = (
            "Create one marketplace hero photo for Owmee from this seller-uploaded "
            f"{category_hint} image. Only clean the background. Preserve the actual "
            "product exactly: same shape, color, model text, scratches, dents, wear, "
            "damage, stickers, labels, accessories, and perspective. Do not repair, "
            "beautify, upscale details, add objects, remove product defects, or invent "
            "missing parts. Remove messy room/background clutter and place the unchanged "
            "product on a clean premium warm ivory background with a very subtle soft "
            "green tint and natural contact shadow. Keep the product centered and fully "
            "visible. Return only the cleaned image."
        )

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
            )

        output_bytes = self._extract_image_bytes(response)
        if output_bytes is None:
            return BackgroundCleanupResult(
                ok=False,
                provider=self.provider_name,
                model=settings.gemini_image_model,
                reason="no_image_output",
            )

        return BackgroundCleanupResult(
            ok=True,
            image_bytes=output_bytes,
            content_type="image/png",
            provider=self.provider_name,
            model=settings.gemini_image_model,
        )

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
