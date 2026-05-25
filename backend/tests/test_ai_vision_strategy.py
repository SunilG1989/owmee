from __future__ import annotations

import pytest

from app.modules.ai_assistant import router
from app.modules.ai_assistant.schemas import AIDetected


def _patch_metric_provider(monkeypatch, metrics: list[dict]) -> None:
    monkeypatch.setattr(router.ai_provider, "reset_call_metrics", metrics.clear)

    def consume(operation=None):
        if operation is None:
            return list(metrics)
        return [metric for metric in metrics if metric.get("operation") == operation]

    monkeypatch.setattr(router.ai_provider, "consume_call_metrics", consume)


@pytest.mark.asyncio
async def test_fast_low_confidence_runs_full_fallback(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "success", "latency_ms": 100})
        return AIDetected(category_slug="smartphones", category_confidence=0.2)

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "success", "latency_ms": 450})
        return AIDetected(category_slug="smartphones", category_confidence=0.91, brand="Apple")

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_full_fallback_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_shadow_full_analysis_enabled", False)
    monkeypatch.setattr(router.settings, "ai_draft_fast_min_category_confidence", 0.55)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"phone", "image/jpeg")])

    assert calls == ["fast", "full"]
    assert detected.brand == "Apple"
    assert metric["operation"] == "vision_full"
    assert metric["analysis_mode"] == "full_fallback_from_fast"
    assert metric["fallback_reasons"] == ["low_category_confidence"]
    assert metric["fallback_from_operation"] == "vision_fast"
    assert metric["fast_provider_metrics"]["operation"] == "vision_fast"


@pytest.mark.asyncio
async def test_fast_safety_blocker_does_not_get_cleared_by_full_fallback(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "success"})
        return AIDetected(
            category_slug="smartphones",
            category_confidence=0.2,
            flags=["personal_info"],
            image_set_quality={"has_private_info": True},
        )

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "success"})
        return AIDetected(category_slug="smartphones", category_confidence=0.95, flags=[])

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_full_fallback_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_shadow_full_analysis_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_fast_min_category_confidence", 0.55)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"private", "image/jpeg")])

    assert calls == ["fast"]
    assert "personal_info" in detected.flags
    assert metric["analysis_mode"] == "fast_draft"
    assert "fallback_reasons" not in metric
    assert "shadow_comparison" not in metric


@pytest.mark.asyncio
async def test_fast_timeout_does_not_run_full_fallback_or_shadow(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "timeout"})
        return AIDetected(flags=["ai_failed:vision_timeout"])

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "success"})
        return AIDetected(category_slug="smartphones", category_confidence=0.95)

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_full_fallback_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_shadow_full_analysis_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_fast_min_category_confidence", 0.55)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"phone", "image/jpeg")])

    assert calls == ["fast"]
    assert detected.flags == ["ai_failed:vision_timeout"]
    assert metric["analysis_mode"] == "fast_draft"
    assert "fallback_reasons" not in metric
    assert "shadow_comparison" not in metric


@pytest.mark.asyncio
async def test_fast_parse_failure_runs_full_fallback(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "parse_failed"})
        return AIDetected(flags=["ai_failed:parse_failed"])

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "success", "latency_ms": 620})
        return AIDetected(category_slug="smartphones", category_confidence=0.9, brand="Samsung")

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_full_fallback_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_shadow_full_analysis_enabled", False)
    monkeypatch.setattr(router.settings, "ai_draft_fast_min_category_confidence", 0.55)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"phone", "image/jpeg")])

    assert calls == ["fast", "full"]
    assert detected.brand == "Samsung"
    assert metric["analysis_mode"] == "full_fallback_from_fast"
    assert metric["fallback_reasons"] == ["fast_ai_failed"]
    assert metric["fast_provider_metrics"]["status"] == "parse_failed"


@pytest.mark.asyncio
async def test_full_fallback_failure_marks_fast_result_for_seller_review(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "success"})
        return AIDetected(category_slug="smartphones", category_confidence=0.22)

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "api_error"})
        return AIDetected(flags=["ai_failed:api_error"])

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_full_fallback_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_shadow_full_analysis_enabled", False)
    monkeypatch.setattr(router.settings, "ai_draft_fast_min_category_confidence", 0.55)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"phone", "image/jpeg")])

    assert calls == ["fast", "full"]
    assert detected.category_slug == "smartphones"
    assert detected.manual_review_required is True
    assert detected.auto_publish_candidate is False
    assert "fast_quality:low_category_confidence" in detected.flags
    assert "category_slug" in detected.seller_edit_fields
    assert metric["analysis_mode"] == "fast_draft_full_fallback_failed"
    assert metric["fallback_reasons"] == ["low_category_confidence"]
    assert metric["full_fallback_provider_metrics"]["status"] == "api_error"


@pytest.mark.asyncio
async def test_fast_quality_result_requires_review_when_full_fallback_disabled(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "success"})
        return AIDetected(category_slug="smartphones", category_confidence=0.24)

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "success"})
        return AIDetected(category_slug="smartphones", category_confidence=0.92)

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_full_fallback_enabled", False)
    monkeypatch.setattr(router.settings, "ai_draft_shadow_full_analysis_enabled", False)
    monkeypatch.setattr(router.settings, "ai_draft_fast_min_category_confidence", 0.55)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"phone", "image/jpeg")])

    assert calls == ["fast"]
    assert detected.manual_review_required is True
    assert detected.auto_publish_candidate is False
    assert "fast_quality:low_category_confidence" in detected.flags
    assert metric["analysis_mode"] == "fast_draft_review_required"
    assert metric["fast_quality_reasons"] == ["low_category_confidence"]
    assert "fallback_reasons" not in metric


@pytest.mark.asyncio
async def test_fast_kill_switch_uses_full_analysis(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "success"})
        return AIDetected(category_slug="others", category_confidence=0.4)

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "success", "latency_ms": 700})
        return AIDetected(category_slug="small-appliances", category_confidence=0.88)

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", False)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"mixer", "image/jpeg")])

    assert calls == ["full"]
    assert detected.category_slug == "small-appliances"
    assert metric["operation"] == "vision_full"
    assert metric["analysis_mode"] == "full_draft"
    assert metric["prompt_version"] == "vision_full_v2"


@pytest.mark.asyncio
async def test_shadow_full_analysis_keeps_fast_result_and_records_comparison(monkeypatch):
    metrics: list[dict] = []
    calls: list[str] = []

    async def fake_fast(images):
        calls.append("fast")
        metrics.append({"operation": "vision_fast", "status": "success", "latency_ms": 100})
        return AIDetected(category_slug="kids-utility", category_confidence=0.8, brand="ToyCo")

    async def fake_full(images):
        calls.append("full")
        metrics.append({"operation": "vision_full", "status": "success", "latency_ms": 800})
        return AIDetected(category_slug="small-appliances", category_confidence=0.7, brand="ToyCo")

    monkeypatch.setattr(router.settings, "ai_draft_fast_path_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_full_fallback_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_shadow_full_analysis_enabled", True)
    monkeypatch.setattr(router.settings, "ai_draft_fast_min_category_confidence", 0.55)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_fast)
    monkeypatch.setattr(router.ai_provider, "detect_from_images", fake_full)
    _patch_metric_provider(monkeypatch, metrics)

    detected, metric = await router._detect_from_images_bounded_with_metrics([(b"toy", "image/jpeg")])

    assert calls == ["fast", "full"]
    assert detected.category_slug == "kids-utility"
    assert metric["analysis_mode"] == "fast_draft"
    assert metric["shadow_comparison"]["category_match"] is False
    assert metric["shadow_provider_metrics"]["operation"] == "vision_full"
