import pytest

from app.modules.ai_assistant import price_estimator


@pytest.mark.asyncio
async def test_estimate_price_skips_text_ai_when_vision_price_exists(monkeypatch):
    async def fake_comparables_query(*args, **kwargs):
        return []

    async def fail_ai_price_call(*args, **kwargs):
        raise AssertionError("text AI price fallback should not run")

    monkeypatch.setattr(price_estimator, "_comparables_query", fake_comparables_query)
    monkeypatch.setattr(price_estimator.ai_provider, "estimate_price", fail_ai_price_call)

    result = await price_estimator.estimate_price(
        None,
        brand="Apple",
        model="iPhone 13",
        storage="128 GB",
        condition="good",
        state="Karnataka",
        category_slug="smartphones",
        allow_ai_fallback=False,
    )

    assert result["source"] == "none"
    assert result["price"] is None
    assert result["comparables_count"] == 0


@pytest.mark.asyncio
async def test_estimate_price_keeps_comparables_priority_when_ai_disabled(monkeypatch):
    async def fake_comparables_query(*args, **kwargs):
        return [
            {"title": "A", "price": 11000, "days_ago": 3, "city": "Bengaluru", "image_urls": []},
            {"title": "B", "price": 12000, "days_ago": 4, "city": "Bengaluru", "image_urls": []},
            {"title": "C", "price": 13000, "days_ago": 5, "city": "Bengaluru", "image_urls": []},
        ]

    async def fail_ai_price_call(*args, **kwargs):
        raise AssertionError("comparables should win before AI fallback")

    monkeypatch.setattr(price_estimator, "_comparables_query", fake_comparables_query)
    monkeypatch.setattr(price_estimator.ai_provider, "estimate_price", fail_ai_price_call)

    result = await price_estimator.estimate_price(
        None,
        brand="Apple",
        model="iPhone 13",
        storage="128 GB",
        condition="good",
        state="Karnataka",
        category_slug="smartphones",
        allow_ai_fallback=False,
    )

    assert result["source"] == "comparables"
    assert result["price"] == 12000
    assert result["comparables_count"] == 3
