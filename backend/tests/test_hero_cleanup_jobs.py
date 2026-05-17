from __future__ import annotations

import json

import pytest

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


def test_retryability_keeps_transient_failures_out_of_dead_letter_initially():
    assert jobs._is_retryable_result(
        jobs.HeroCleanupJobResult(
            status="failed",
            listing_id="listing-1",
            reason="cleanup_timeout",
        )
    )
    assert jobs._is_retryable_result(
        jobs.HeroCleanupJobResult(
            status="failed",
            listing_id="listing-1",
            reason="listing_update_failed:TimeoutError",
        )
    )
    assert not jobs._is_retryable_result(
        jobs.HeroCleanupJobResult(
            status="failed",
            listing_id="listing-1",
            reason="human_artifact_remaining",
        )
    )


def test_retry_delay_is_bounded_exponential_backoff():
    assert jobs._retry_delay_seconds(1) == 60
    assert jobs._retry_delay_seconds(2) == 300
    assert jobs._retry_delay_seconds(3) == 900
    assert jobs._retry_delay_seconds(99) == 900


def test_message_payload_decodes_stream_field():
    payload = {"listing_id": "listing-1", "attempt": 2}

    assert jobs._message_payload({"payload": json.dumps(payload)}) == payload


@pytest.mark.asyncio
async def test_enqueue_payload_uses_atomic_stream_script(monkeypatch):
    calls = []

    class _Redis:
        async def eval(self, *args):
            calls.append(args)
            return "1700000000-0"

    async def fake_get_redis():
        return _Redis()

    monkeypatch.setattr(jobs, "get_redis", fake_get_redis)
    monkeypatch.setattr(jobs.settings, "hero_cleanup_stream_maxlen", 1234)

    queued = await jobs._enqueue_payload(
        {"listing_id": "listing-1", "hero_key": "ai-drafts/u/draft_0.jpg.display.webp", "attempt": 1},
        "dedupe-key",
    )

    assert queued is True
    assert calls
    assert calls[0][0] == jobs._ENQUEUE_SCRIPT
    assert calls[0][2] == "dedupe-key"
    assert calls[0][3] == jobs.HERO_CLEANUP_STREAM_KEY


@pytest.mark.asyncio
async def test_enqueue_payload_returns_false_for_duplicate(monkeypatch):
    class _Redis:
        async def eval(self, *args):
            return None

    async def fake_get_redis():
        return _Redis()

    monkeypatch.setattr(jobs, "get_redis", fake_get_redis)

    queued = await jobs._enqueue_payload(
        {"listing_id": "listing-1", "hero_key": "ai-drafts/u/draft_0.jpg.display.webp", "attempt": 1},
        "dedupe-key",
    )

    assert queued is False
