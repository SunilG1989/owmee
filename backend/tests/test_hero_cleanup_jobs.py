from __future__ import annotations

from app.modules.media import hero_cleanup_jobs as jobs


def test_original_key_for_cleanup_normalizes_variants_and_urls(monkeypatch):
    monkeypatch.setattr(jobs.settings, "r2_bucket", "owmee-media")

    assert (
        jobs._original_key_for_cleanup("ai-drafts/u/draft_0.jpg.display.webp")
        == "ai-drafts/u/draft_0.jpg"
    )
    assert (
        jobs._original_key_for_cleanup("ai-drafts/u/draft_0.jpg.hero-cleaned.png.display.webp")
        == "ai-drafts/u/draft_0.jpg"
    )
    assert (
        jobs._original_key_for_cleanup("https://cdn.test/owmee-media/ai-drafts/u/draft_0.jpg.display.webp")
        == "ai-drafts/u/draft_0.jpg"
    )


def test_gallery_with_cleaned_hero_removes_old_hero_variants():
    values = [
        "ai-drafts/u/draft_0.jpg.display.webp",
        "ai-drafts/u/draft_0.jpg.thumb.webp",
        "ai-drafts/u/draft_1.jpg.display.webp",
        "ai-drafts/u/draft_0.jpg.hero-cleaned.png.display.webp",
    ]

    assert jobs._gallery_with_cleaned_hero(
        values,
        original_key="ai-drafts/u/draft_0.jpg",
        cleaned_display_key="ai-drafts/u/draft_0.jpg.hero-cleaned.png.display.webp",
    ) == [
        "ai-drafts/u/draft_0.jpg.hero-cleaned.png.display.webp",
        "ai-drafts/u/draft_1.jpg.display.webp",
    ]
