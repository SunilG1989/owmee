from __future__ import annotations

from app.core.settings import settings
from app.modules.media.providers.base import (
    BackgroundCleanupProvider,
    NoopBackgroundCleanupProvider,
)


def get_background_cleanup_provider() -> BackgroundCleanupProvider:
    provider = (settings.image_cleanup_provider or "none").strip().lower()
    if provider in {"", "none", "off", "disabled", "noop"}:
        return NoopBackgroundCleanupProvider()
    if provider in {"gemini", "google", "google-gemini", "google_gemini"}:
        from app.modules.media.providers.google_gemini import (
            GoogleGeminiBackgroundCleanupProvider,
        )

        return GoogleGeminiBackgroundCleanupProvider()
    return NoopBackgroundCleanupProvider()
