from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.storage import ProcessedListingImage
from app.modules.ai_assistant import router
from app.modules.ai_assistant.schemas import AIDetected
from app.modules.media.image_cleanup import HeroCleanupOutcome


class _Upload:
    def __init__(self, data: bytes, content_type: str = "image/jpeg") -> None:
        self._data = data
        self.content_type = content_type

    async def read(self) -> bytes:
        return self._data


class _Result:
    def __init__(self, value=None) -> None:
        self._value = value

    def scalar(self):
        return self._value


class _FakeDB:
    def __init__(self) -> None:
        self.insert_params = None
        self.commits = 0

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        if "INSERT INTO listing_drafts" in sql:
            self.insert_params = params
            return _Result()
        if "SELECT expires_at FROM listing_drafts" in sql:
            return _Result(datetime(2026, 5, 17, tzinfo=timezone.utc))
        return _Result()

    async def commit(self) -> None:
        self.commits += 1


@pytest.mark.asyncio
async def test_draft_from_images_selects_cleans_and_promotes_ai_hero(monkeypatch):
    db = _FakeDB()
    user = SimpleNamespace(user_id=uuid4())
    seen_images: list[tuple[bytes, str]] = []

    async def fake_detect_from_images(images):
        seen_images.extend(images)
        return AIDetected(
            category_slug="kids-utility",
            category_confidence=0.94,
            condition_guess="good",
            hero_image_index=2,
            hero_image_rationale="Photo 2 has the full product centered.",
            image_set_quality={"overall_photo_quality": "good"},
        )

    def fake_process_listing_image_bytes(raw, *, original_key, content_type, **kwargs):
        return ProcessedListingImage(
            original_key=original_key,
            display_key=f"{original_key}.display.webp",
            thumbnail_key=f"{original_key}.thumb.webp",
        )

    async def fake_clean_hero_background(image_bytes, content_type, *, original_key, selected_index, category_slug):
        assert image_bytes == b"hero"
        assert content_type == "image/jpeg"
        assert selected_index == 2
        assert category_slug == "kids-utility"
        return HeroCleanupOutcome(
            selected_index=selected_index,
            cleaned=True,
            display_key=f"{original_key}.hero-cleaned.png.display.webp",
            thumbnail_key=f"{original_key}.hero-cleaned.png.thumb.webp",
            provider="test-cleaner",
            model="test-model",
        )

    async def fake_estimate_price(*args, **kwargs):
        return {
            "price": None,
            "source": "none",
            "reasoning": "no comparable data",
            "comparables": [],
            "comparables_count": 0,
        }

    async def fake_get_user_location(db, user_id):
        return (12.9, 77.6, "Bengaluru", "Karnataka")

    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_detect_from_images)
    monkeypatch.setattr(router.price_estimator, "estimate_price", fake_estimate_price)
    monkeypatch.setattr(router, "process_listing_image_bytes", fake_process_listing_image_bytes)
    monkeypatch.setattr(router, "clean_hero_background", fake_clean_hero_background)
    monkeypatch.setattr(router, "generate_presigned_download_url", lambda key, expires_in=0: f"https://cdn.test/{key}")

    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(user_location, "get_user_location", fake_get_user_location)

    response = await router.draft_from_images(
        user=user,
        db=db,
        images=[
            _Upload(b"front"),
            _Upload(b"side"),
            _Upload(b"hero"),
            _Upload(b"label"),
        ],
    )

    assert len(seen_images) == 4
    assert response.detected.hero_image_index == 2
    assert response.photo_url.endswith("_2.jpg.hero-cleaned.png.display.webp")
    assert db.insert_params is not None
    saved_urls = db.insert_params["photo_urls"]
    assert saved_urls[0].endswith("_2.jpg.hero-cleaned.png.display.webp")
    assert saved_urls[1].endswith("_0.jpg.display.webp")
    assert saved_urls[2].endswith("_1.jpg.display.webp")
    assert saved_urls[3].endswith("_3.jpg.display.webp")
    cleanup = response.detected.image_set_quality["hero_image_cleanup"]
    assert cleanup["status"] == "ready"
    assert cleanup["provider"] == "test-cleaner"
    assert db.commits == 1
