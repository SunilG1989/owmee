from __future__ import annotations

import logging
from dataclasses import dataclass

from app.core.storage import ProcessedListingImage, process_listing_image_bytes
from app.modules.media.providers import get_background_cleanup_provider

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class HeroCleanupOutcome:
    selected_index: int
    cleaned: bool
    display_key: str | None = None
    thumbnail_key: str | None = None
    provider: str = "none"
    model: str | None = None
    reason: str | None = None
    style: str | None = None


def select_hero_image_index(detected, image_count: int) -> int:
    if image_count <= 0:
        return 0
    raw = getattr(detected, "hero_image_index", None)
    try:
        idx = int(raw)
    except (TypeError, ValueError):
        return 0
    return idx if 0 <= idx < image_count else 0


def move_hero_first(items: list[str], hero_index: int) -> list[str]:
    if not items or hero_index <= 0 or hero_index >= len(items):
        return list(items)
    return [items[hero_index], *items[:hero_index], *items[hero_index + 1:]]


async def clean_hero_background(
    image_bytes: bytes,
    content_type: str,
    *,
    original_key: str,
    selected_index: int,
    category_slug: str | None,
) -> HeroCleanupOutcome:
    provider = get_background_cleanup_provider()
    result = await provider.clean_listing_background(
        image_bytes,
        content_type,
        category_slug=category_slug,
    )
    if not result.ok or not result.image_bytes:
        return HeroCleanupOutcome(
            selected_index=selected_index,
            cleaned=False,
            provider=result.provider,
            model=result.model,
            reason=result.reason,
            style=result.style,
        )

    cleaned_key = f"{original_key}.hero-cleaned.png"
    try:
        processed: ProcessedListingImage = process_listing_image_bytes(
            result.image_bytes,
            original_key=cleaned_key,
            content_type=result.content_type,
        )
    except Exception as e:
        log.warning(
            "media.cleanup.persist_failed",
            extra={"error": str(e), "key": cleaned_key},
        )
        return HeroCleanupOutcome(
            selected_index=selected_index,
            cleaned=False,
            provider=result.provider,
            model=result.model,
            reason="persist_failed",
            style=result.style,
        )

    return HeroCleanupOutcome(
        selected_index=selected_index,
        cleaned=bool(processed.display_key),
        display_key=processed.display_key,
        thumbnail_key=processed.thumbnail_key,
        provider=result.provider,
        model=result.model,
        reason=None if processed.display_key else "display_variant_failed",
        style=result.style,
    )
