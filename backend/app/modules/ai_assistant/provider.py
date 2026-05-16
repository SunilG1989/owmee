"""Provider-neutral AI listing interface.

Routers and business services import this module, not a vendor SDK wrapper.
Swapping Gemini for another model provider should require a new adapter here,
not changes throughout listing creation, pricing, or description code.
"""
from __future__ import annotations

from typing import Any, Protocol

from app.core.settings import settings
from app.modules.ai_assistant.schemas import AIDetected


class AIListingProvider(Protocol):
    def current_vision_model(self) -> str: ...
    def current_text_model(self) -> str: ...
    async def detect_from_images(self, images: list[tuple[bytes, str]]) -> AIDetected: ...
    async def detect_from_image(self, image_bytes: bytes, content_type: str = "image/jpeg") -> AIDetected: ...
    async def extract_imei(self, image_bytes: bytes, content_type: str = "image/jpeg") -> dict: ...
    async def regenerate_description(self, fields: dict[str, Any]) -> str: ...
    async def estimate_price(
        self,
        brand: str | None,
        model: str | None,
        storage: str | None,
        condition: str | None,
        market: str = "India",
    ) -> dict | None: ...


class _GeminiListingProvider:
    """Gemini implementation of the AI listing contract."""

    def __init__(self) -> None:
        from app.modules.ai_assistant import gemini_client

        self._client = gemini_client

    def current_vision_model(self) -> str:
        return self._client.current_vision_model()

    def current_text_model(self) -> str:
        return self._client.current_text_model()

    async def detect_from_images(self, images: list[tuple[bytes, str]]) -> AIDetected:
        return await self._client.detect_from_images(images)

    async def detect_from_image(
        self, image_bytes: bytes, content_type: str = "image/jpeg",
    ) -> AIDetected:
        return await self._client.detect_from_image(image_bytes, content_type)

    async def extract_imei(
        self, image_bytes: bytes, content_type: str = "image/jpeg",
    ) -> dict:
        return await self._client.extract_imei(image_bytes, content_type)

    async def regenerate_description(self, fields: dict[str, Any]) -> str:
        return await self._client.regenerate_description(fields)

    async def estimate_price(
        self,
        brand: str | None,
        model: str | None,
        storage: str | None,
        condition: str | None,
        market: str = "India",
    ) -> dict | None:
        return await self._client.estimate_price(
            brand=brand,
            model=model,
            storage=storage,
            condition=condition,
            market=market,
        )


def _provider_name() -> str:
    return (settings.ai_provider or "gemini").strip().lower()


def get_ai_listing_provider() -> AIListingProvider:
    provider = _provider_name()
    if provider in {"", "gemini", "google", "google-gemini", "google_gemini"}:
        return _GeminiListingProvider()
    raise RuntimeError(f"Unsupported AI_PROVIDER={settings.ai_provider!r}")


def current_vision_model() -> str:
    return get_ai_listing_provider().current_vision_model()


def current_text_model() -> str:
    return get_ai_listing_provider().current_text_model()


async def detect_from_images(images: list[tuple[bytes, str]]) -> AIDetected:
    return await get_ai_listing_provider().detect_from_images(images)


async def detect_from_image(
    image_bytes: bytes, content_type: str = "image/jpeg",
) -> AIDetected:
    return await get_ai_listing_provider().detect_from_image(image_bytes, content_type)


async def extract_imei(
    image_bytes: bytes, content_type: str = "image/jpeg",
) -> dict:
    return await get_ai_listing_provider().extract_imei(image_bytes, content_type)


async def regenerate_description(fields: dict[str, Any]) -> str:
    return await get_ai_listing_provider().regenerate_description(fields)


async def estimate_price(
    brand: str | None,
    model: str | None,
    storage: str | None,
    condition: str | None,
    market: str = "India",
) -> dict | None:
    return await get_ai_listing_provider().estimate_price(
        brand=brand,
        model=model,
        storage=storage,
        condition=condition,
        market=market,
    )
