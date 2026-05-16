from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class BackgroundCleanupResult:
    ok: bool
    image_bytes: bytes | None = None
    content_type: str = "image/png"
    provider: str = "none"
    model: str | None = None
    reason: str | None = None


class BackgroundCleanupProvider(Protocol):
    async def clean_listing_background(
        self,
        image_bytes: bytes,
        content_type: str,
        *,
        category_slug: str | None = None,
    ) -> BackgroundCleanupResult: ...


class NoopBackgroundCleanupProvider:
    async def clean_listing_background(
        self,
        image_bytes: bytes,
        content_type: str,
        *,
        category_slug: str | None = None,
    ) -> BackgroundCleanupResult:
        return BackgroundCleanupResult(
            ok=False,
            provider="none",
            reason="provider_disabled",
        )
