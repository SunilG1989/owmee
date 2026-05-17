from __future__ import annotations

import json

import pytest

from app.modules.ai_assistant import draft_analysis_jobs as jobs


@pytest.mark.asyncio
async def test_enqueue_payload_duplicate_is_retry_safe(monkeypatch):
    class _Redis:
        async def eval(self, *args):
            return None

    async def fake_get_redis():
        return _Redis()

    monkeypatch.setattr(jobs, "get_redis", fake_get_redis)

    queued = await jobs._enqueue_payload(
        {"draft_id": "draft-1", "user_id": "user-1", "photo_keys": ["k"], "attempt": 1},
        "dedupe-key",
    )

    assert queued is True


@pytest.mark.asyncio
async def test_download_bounded_object_checks_size_before_download(monkeypatch):
    downloaded = False

    def fake_object_size_bytes(key):
        return 9

    def fake_download_bytes(key):
        nonlocal downloaded
        downloaded = True
        return b"too-large"

    monkeypatch.setattr(jobs, "object_size_bytes", fake_object_size_bytes)
    monkeypatch.setattr(jobs, "download_bytes", fake_download_bytes)

    with pytest.raises(jobs.UploadedPhotoTooLarge):
        await jobs._download_bounded_object("ai-drafts/u/d_0.jpg", max_bytes=8)

    assert downloaded is False


@pytest.mark.asyncio
async def test_handle_message_marks_final_retry_failure(monkeypatch):
    payload = {
        "draft_id": "draft-1",
        "user_id": "user-1",
        "photo_keys": ["ai-drafts/u/d_0.jpg"],
        "attempt": 3,
    }
    marked = []
    dead_letters = []

    class _Redis:
        def __init__(self):
            self.acked = []

        async def xack(self, stream, group, message_id):
            self.acked.append((stream, group, message_id))

    async def fake_safe_process(received):
        return jobs.AIDraftAnalysisResult(
            status="failed",
            draft_id=received["draft_id"],
            reason="job_unhandled:TimeoutError",
        )

    async def fake_mark_payload_failed(received, result):
        marked.append((received, result.reason))

    async def fake_dead_letter(redis, received, result):
        dead_letters.append((received, result.reason))

    monkeypatch.setattr(jobs.settings, "ai_draft_analysis_retry_max_attempts", 3)
    monkeypatch.setattr(jobs, "_safe_process_ai_draft_analysis", fake_safe_process)
    monkeypatch.setattr(jobs, "_mark_payload_failed", fake_mark_payload_failed)
    monkeypatch.setattr(jobs, "_dead_letter", fake_dead_letter)

    redis = _Redis()
    await jobs._handle_message(redis, "1-0", {"payload": json.dumps(payload)})

    assert marked == [(payload, "job_unhandled:TimeoutError")]
    assert dead_letters == [(payload, "job_unhandled:TimeoutError")]
    assert redis.acked == [(jobs.AI_DRAFT_ANALYSIS_STREAM_KEY, jobs.AI_DRAFT_ANALYSIS_GROUP, "1-0")]
