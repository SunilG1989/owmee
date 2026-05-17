from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image

from app.core.storage import ProcessedListingImage
from app.modules.media import image_cleanup
from app.modules.media.providers.base import BackgroundCleanupResult
from app.modules.media.providers.google_gemini import (
    _CleanupQualityAudit,
    GoogleGeminiBackgroundCleanupProvider,
)


def test_select_hero_image_index_uses_ai_choice_when_valid():
    detected = SimpleNamespace(hero_image_index=2)

    assert image_cleanup.select_hero_image_index(detected, 4) == 2


def test_select_hero_image_index_falls_back_to_first_photo():
    assert image_cleanup.select_hero_image_index(SimpleNamespace(hero_image_index=8), 2) == 0
    assert image_cleanup.select_hero_image_index(SimpleNamespace(hero_image_index=None), 2) == 0
    assert image_cleanup.select_hero_image_index(SimpleNamespace(hero_image_index="bad"), 2) == 0


def test_move_hero_first_preserves_other_photo_order():
    assert image_cleanup.move_hero_first(["a", "b", "c", "d"], 2) == ["c", "a", "b", "d"]
    assert image_cleanup.move_hero_first(["a", "b"], 0) == ["a", "b"]


@pytest.mark.asyncio
async def test_clean_hero_background_persists_provider_output(monkeypatch):
    class Provider:
        async def clean_listing_background(self, image_bytes, content_type, *, category_slug=None):
            assert image_bytes == b"original"
            assert content_type == "image/jpeg"
            assert category_slug == "kids-utility"
            return BackgroundCleanupResult(
                ok=True,
                image_bytes=b"cleaned",
                content_type="image/png",
                provider="test-provider",
                model="test-model",
                style="owmee_warm_ivory",
            )

    monkeypatch.setattr(image_cleanup, "get_background_cleanup_provider", lambda: Provider())

    def fake_process_listing_image_bytes(raw, *, original_key, content_type, **kwargs):
        assert raw == b"cleaned"
        assert original_key == "ai-drafts/u/d_1.jpg.hero-cleaned.png"
        assert content_type == "image/png"
        return ProcessedListingImage(
            original_key=original_key,
            display_key=f"{original_key}.display.webp",
            thumbnail_key=f"{original_key}.thumb.webp",
        )

    monkeypatch.setattr(
        image_cleanup,
        "process_listing_image_bytes",
        fake_process_listing_image_bytes,
    )

    outcome = await image_cleanup.clean_hero_background(
        b"original",
        "image/jpeg",
        original_key="ai-drafts/u/d_1.jpg",
        selected_index=1,
        category_slug="kids-utility",
    )

    assert outcome.selected_index == 1
    assert outcome.cleaned is True
    assert outcome.provider == "test-provider"
    assert outcome.style == "owmee_warm_ivory"
    assert outcome.display_key == "ai-drafts/u/d_1.jpg.hero-cleaned.png.display.webp"


def test_google_gemini_provider_uses_standard_background_for_most_products():
    image = Image.new("RGB", (120, 120), "#7d7d7d")

    style = GoogleGeminiBackgroundCleanupProvider._choose_background_style(image)

    assert style.name == "owmee_warm_ivory"


def test_google_gemini_provider_switches_background_for_light_products():
    image = Image.new("RGB", (120, 120), "#f3eee3")

    style = GoogleGeminiBackgroundCleanupProvider._choose_background_style(image)

    assert style.name == "owmee_soft_green_contrast"


def test_google_gemini_provider_keeps_ivory_background_for_green_products():
    image = Image.new("RGB", (120, 120), "#4f9b82")

    style = GoogleGeminiBackgroundCleanupProvider._choose_background_style(image)

    assert style.name == "owmee_warm_ivory"


def test_google_gemini_provider_keeps_ivory_background_for_warm_products():
    image = Image.new("RGB", (120, 120), "#b66b3d")

    style = GoogleGeminiBackgroundCleanupProvider._choose_background_style(image)

    assert style.name == "owmee_warm_ivory"


def test_google_gemini_cleanup_prompt_locks_product_preservation():
    style = GoogleGeminiBackgroundCleanupProvider._choose_background_style(
        Image.new("RGB", (120, 120), "#4f9b82")
    )

    prompt = GoogleGeminiBackgroundCleanupProvider._build_cleanup_prompt(
        "kids-utility",
        style,
    )

    assert "only replace/clean the background" in prompt
    assert "preserve the product exactly" in prompt
    assert "never recolor the product" in prompt
    assert "human body parts must still be removed" in prompt
    assert "Never keep a hand or skin area merely because it touches the product" in prompt
    assert "MANDATORY MASK-STYLE WORKFLOW" in prompt
    assert "fingers wrapped around phone edges/corners" in prompt
    assert "composite the original visible product pixels" in prompt
    assert "Do not transform the seller item into a stock render" in prompt
    assert "Treat every human body part as background/occlusion" in prompt
    assert "Remove all visible hands, fingers, thumbs, arms" in prompt
    assert "Do not leave skin-colored fragments" in prompt
    assert "thumb edges on the screen" in prompt
    assert "A slightly tighter product crop is better" in prompt
    assert "crop, zoom, or recompose slightly" in prompt
    assert "rejected by an automatic audit" in prompt
    assert "If any human body part, skin patch, finger edge" in prompt
    assert "warm ivory studio background" in prompt
    assert "Do not use brown, tan, caramel" in prompt


def test_google_gemini_cleanup_prompt_has_strict_human_retry_mode():
    style = GoogleGeminiBackgroundCleanupProvider._choose_background_style(
        Image.new("RGB", (120, 120), "#7d7d7d")
    )

    prompt = GoogleGeminiBackgroundCleanupProvider._build_cleanup_prompt(
        "kids-utility",
        style,
        strict_human_removal=True,
    )

    assert "STRICT CORRECTION MODE" in prompt
    assert "previous cleanup may have left a visible hand" in prompt
    assert "Repeat the cleanup internally" in prompt
    assert "Never recolor, restyle, repair, or beautify the product" in prompt
    assert "crop, zoom, or recompose slightly" in prompt


def test_google_gemini_cleanup_rejects_confident_quality_audit_failures():
    assert GoogleGeminiBackgroundCleanupProvider._audit_rejection_reason(
        _CleanupQualityAudit(has_human_artifact=True, confidence=0.8)
    ) == "human_artifact_remaining"
    assert GoogleGeminiBackgroundCleanupProvider._audit_rejection_reason(
        _CleanupQualityAudit(product_modified=True, confidence=0.8)
    ) == "product_modified"
    assert GoogleGeminiBackgroundCleanupProvider._audit_rejection_reason(
        _CleanupQualityAudit(has_human_artifact=True, confidence=0.2)
    ) is None
    assert GoogleGeminiBackgroundCleanupProvider._audit_rejection_reason(
        _CleanupQualityAudit(has_human_artifact=False, product_modified=False, confidence=0.95)
    ) is None


def test_google_gemini_provider_extracts_inline_image_bytes_before_sdk_image_object():
    image = Image.new("RGB", (12, 8), "#d9824b")
    raw = BytesIO()
    image.save(raw, format="PNG")

    class BadSdkImagePart:
        inline_data = SimpleNamespace(data=raw.getvalue())

        def as_image(self):
            raise TypeError("SDK image save signature is not Pillow-compatible")

    response = SimpleNamespace(parts=[BadSdkImagePart()])

    extracted = GoogleGeminiBackgroundCleanupProvider._extract_image_bytes(response)

    assert extracted is not None
    normalized = Image.open(BytesIO(extracted))
    assert normalized.size == (12, 8)
    assert normalized.format == "PNG"
