from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.modules.ai_assistant import router
from app.modules.ai_assistant.schemas import (
    AIDraftUploadImageRequest,
    AIDraftUploadSessionRequest,
    DraftPriceRefreshRequest,
)


def test_ai_draft_async_routes_are_registered_for_release_app():
    from app.main import create_app

    app = create_app()
    schema = app.openapi()

    assert "/v1/listings/draft/uploads/request" in schema["paths"]
    assert "post" in schema["paths"]["/v1/listings/draft/uploads/request"]
    assert "/v1/listings/draft/{draft_id}/analysis/start" in schema["paths"]
    assert "post" in schema["paths"]["/v1/listings/draft/{draft_id}/analysis/start"]
    assert "/v1/listings/draft/{draft_id}/analysis/status" in schema["paths"]
    assert "get" in schema["paths"]["/v1/listings/draft/{draft_id}/analysis/status"]
    assert "/v1/listings/draft/{draft_id}/price-suggestion" in schema["paths"]
    assert "post" in schema["paths"]["/v1/listings/draft/{draft_id}/price-suggestion"]
    assert "/v1/listings/draft/from-images" in schema["paths"]
    assert "post" in schema["paths"]["/v1/listings/draft/from-images"]


class _Result:
    def __init__(self, *, value=None, row=None) -> None:
        self._value = value
        self._row = row

    def scalar(self):
        return self._value

    def mappings(self):
        return self

    def first(self):
        return self._row


@pytest.mark.asyncio
async def test_request_ai_draft_uploads_creates_uploading_draft(monkeypatch):
    user_id = uuid4()
    captured = {}

    class _DB:
        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "INSERT INTO listing_drafts" in sql:
                captured["insert"] = params
            if "SELECT expires_at FROM listing_drafts" in sql:
                return _Result(value=datetime(2099, 1, 1, tzinfo=timezone.utc))
            return _Result()

        async def commit(self):
            captured["committed"] = True

    monkeypatch.setattr(
        router,
        "generate_presigned_upload_url",
        lambda key, content_type, expires_in=300: f"https://upload.test/{key}?ct={content_type}",
    )

    response = await router.request_ai_draft_uploads(
        payload=AIDraftUploadSessionRequest(
            images=[
                AIDraftUploadImageRequest(content_type="image/jpeg"),
                AIDraftUploadImageRequest(content_type="image/png"),
            ]
        ),
        user=SimpleNamespace(user_id=user_id),
        db=_DB(),
    )

    assert response.status == "uploading"
    assert len(response.uploads) == 2
    assert response.uploads[0].r2_key.startswith(f"ai-drafts/{user_id}/{response.draft_id}_0.")
    assert captured["insert"]["photo_urls"] == [slot.r2_key for slot in response.uploads]
    assert json.loads(captured["insert"]["ai_response"]) == {"async_status": "uploading"}
    assert captured["committed"] is True


@pytest.mark.asyncio
async def test_start_ai_draft_analysis_queues_existing_upload_session(monkeypatch):
    user_id = uuid4()
    draft_id = uuid4()
    key = f"ai-drafts/{user_id}/{draft_id}_0.jpg"
    queued = []
    updates = []

    class _DB:
        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "SELECT user_id, photo_urls, expires_at, status" in sql:
                return _Result(
                    row={
                        "user_id": user_id,
                        "photo_urls": [key],
                        "expires_at": datetime(2099, 1, 1, tzinfo=timezone.utc),
                        "status": "uploading",
                        "ai_response": {},
                    }
                )
            if "UPDATE listing_drafts" in sql:
                updates.append(params)
            return _Result()

        async def commit(self):
            pass

    async def fake_enqueue_ai_draft_analysis(**kwargs):
        queued.append(kwargs)
        return True

    monkeypatch.setattr(router, "enqueue_ai_draft_analysis", fake_enqueue_ai_draft_analysis)

    response = await router.start_ai_draft_analysis(
        draft_id=draft_id,
        user=SimpleNamespace(user_id=user_id),
        db=_DB(),
    )

    assert response.status == "processing"
    assert queued == [{"draft_id": draft_id, "user_id": user_id, "photo_keys": [key]}]
    assert json.loads(updates[0]["ai_response"]) == {"async_status": "processing"}


@pytest.mark.asyncio
async def test_get_ai_draft_analysis_status_returns_ready_draft(monkeypatch):
    user_id = uuid4()
    draft_id = uuid4()

    class _DB:
        async def execute(self, stmt, params=None):
            return _Result(
                row={
                    "user_id": user_id,
                    "photo_urls": ["ai-drafts/u/d_0.jpg.display.webp"],
                    "ai_response": {
                        "category_slug": "kids-utility",
                        "condition_guess": "good",
                        "image_set_quality": {},
                        "flags": [],
                    },
                    "suggested_price": 250,
                    "comparables_count": 0,
                    "status": "open",
                    "expires_at": datetime(2099, 1, 1, tzinfo=timezone.utc),
                }
            )

    monkeypatch.setattr(router, "generate_presigned_download_url", lambda key, expires_in=0: f"https://cdn.test/{key}")

    response = await router.get_ai_draft_analysis_status(
        draft_id=draft_id,
        user=SimpleNamespace(user_id=user_id),
        db=_DB(),
    )

    assert response.status == "ready"
    assert response.draft is not None
    assert response.draft.draft_id == draft_id
    assert response.draft.photo_url.endswith(".display.webp")
    assert response.draft.photo_urls == ["https://cdn.test/ai-drafts/u/d_0.jpg.display.webp"]
    assert response.draft.suggested_price == 250


@pytest.mark.asyncio
async def test_refresh_ai_draft_price_recovers_from_seller_confirmed_details(monkeypatch):
    user_id = uuid4()
    draft_id = uuid4()
    updates = []

    class _DB:
        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "SELECT user_id, photo_urls, ai_response" in sql:
                return _Result(
                    row={
                        "user_id": user_id,
                        "photo_urls": ["ai-drafts/u/d_0.jpg.display.webp"],
                        "ai_response": {
                            "category_slug": "smartphones",
                            "condition_guess": "good",
                            "brand": "Apple",
                            "model": None,
                            "storage": None,
                            "image_set_quality": {},
                            "flags": [],
                        },
                        "suggested_price": None,
                        "comparables_count": 0,
                        "status": "open",
                        "expires_at": datetime(2099, 1, 1, tzinfo=timezone.utc),
                    }
                )
            if "UPDATE listing_drafts" in sql:
                updates.append(params)
            return _Result()

        async def commit(self):
            pass

    async def fake_estimate_price(*args, **kwargs):
        assert kwargs["brand"] == "Apple"
        assert kwargs["model"] == "iPhone 13"
        assert kwargs["storage"] == "128GB"
        assert kwargs["allow_ai_fallback"] is True
        return {
            "price": 28000,
            "source": "ai",
            "reasoning": "Seller-confirmed model and storage are enough to price.",
            "comparables": [],
            "comparables_count": 0,
            "mrp_inr": 69900,
            "mrp_source": "market_anchor",
            "mrp_confidence": 0.65,
            "mrp_reasoning": "Conservative market anchor for iPhone 13 128GB.",
        }

    async def fake_user_location(*args, **kwargs):
        return None, None, "Bengaluru", "Karnataka"

    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(router.price_estimator, "estimate_price", fake_estimate_price)
    monkeypatch.setattr(user_location, "get_user_location", fake_user_location)
    monkeypatch.setattr(router, "generate_presigned_download_url", lambda key, expires_in=0: f"https://cdn.test/{key}")

    response = await router.refresh_ai_draft_price(
        draft_id=draft_id,
        payload=DraftPriceRefreshRequest(
            category_slug="smartphones",
            brand="Apple",
            model="iPhone 13",
            storage="128GB",
            condition="good",
        ),
        user=SimpleNamespace(user_id=user_id),
        db=_DB(),
    )

    assert response.suggested_price == 28000
    assert response.price_source == "ai"
    assert response.detected.model == "iPhone 13"
    assert response.detected.storage == "128GB"
    assert response.detected.mrp_inr == 69900
    assert response.detected.mrp_source == "market_anchor"
    assert updates[0]["price"] == 28000
    saved_ai = json.loads(updates[0]["ai_response"])
    assert saved_ai["_owmee_price_source"] == "ai"
    assert saved_ai["mrp_inr"] == 69900
