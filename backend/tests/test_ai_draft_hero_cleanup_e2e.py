from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.storage import ProcessedListingImage
from app.modules.ai_assistant import router
from app.modules.ai_assistant.schemas import AIDetected, CreateFromDraftRequest
from app.modules.media.image_cleanup import HeroCleanupOutcome


class _Upload:
    def __init__(self, data: bytes, content_type: str = "image/jpeg") -> None:
        self._data = data
        self.content_type = content_type

    async def read(self) -> bytes:
        return self._data


class _Result:
    def __init__(self, value=None, row=None) -> None:
        self._value = value
        self._row = row

    def scalar(self):
        return self._value

    def first(self):
        return self._row


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


def _toy_publish_fields() -> dict:
    return {
        "age_suitability": "5-7 years",
        "hygiene_status": "Cleaned",
        "category_specifics": {
            "missing_parts_status": "Complete / no parts missing",
            "safety_status": "No visible safety issue",
            "working_status": "Not applicable",
        },
        "kids_safety_checklist": {
            "no_small_parts": True,
            "no_loose_batteries": True,
            "no_sharp_edges": True,
        },
    }


@pytest.mark.asyncio
async def test_hero_cleanup_marks_retake_when_human_artifacts_remain(monkeypatch):
    detected = AIDetected(
        category_slug="kids-utility",
        image_set_quality={"overall_photo_quality": "good"},
    )

    async def fake_clean_hero_background(image_bytes, content_type, *, original_key, selected_index, category_slug):
        assert image_bytes == b"held-product"
        assert content_type == "image/jpeg"
        assert original_key == "ai-drafts/u/d_0.jpg"
        assert selected_index == 0
        assert category_slug == "kids-utility"
        return HeroCleanupOutcome(
            selected_index=selected_index,
            cleaned=False,
            provider="test-cleaner",
            model="test-model",
            reason="human_artifact_remaining",
            style="owmee_warm_ivory",
        )

    monkeypatch.setattr(router, "clean_hero_background", fake_clean_hero_background)

    key, updated = await router._clean_hero_and_mark_detected(
        detected=detected,
        image_bytes=b"held-product",
        content_type="image/jpeg",
        original_key="ai-drafts/u/d_0.jpg",
        selected_index=0,
        fallback_key="ai-drafts/u/d_0.jpg.display.webp",
    )

    assert key == "ai-drafts/u/d_0.jpg.display.webp"
    cleanup = updated.image_set_quality["hero_image_cleanup"]
    assert cleanup["status"] == "needs_retake"
    assert cleanup["requires_retake"] is True
    assert cleanup["reason"] == "human_artifact_remaining"
    assert cleanup["selected_index"] == 0


def test_phone_hero_prefers_front_face_metadata_over_back_panel_choice():
    detected = AIDetected(
        category_slug="smartphones",
        hero_image_index=2,
        image_set_quality={"front_face_image_index": 0},
    )

    assert router._front_face_hero_override(detected, 2, 4) == 0


def test_phone_hero_keeps_ai_choice_when_front_face_metadata_missing():
    detected = AIDetected(
        category_slug="smartphones",
        hero_image_index=2,
        image_set_quality={},
    )

    assert router._front_face_hero_override(detected, 2, 4) == 2


def test_mrp_anchor_price_fallback_uses_valid_mrp_and_condition():
    detected = AIDetected(
        category_slug="smartphones",
        brand="Apple",
        model="iPhone 13",
        condition_guess="good",
        mrp_inr=60000,
        mrp_confidence=0.7,
        mrp_source="visible_mrp",
        flags=[],
    )

    result = router._apply_price_fallbacks(
        {
            "price": None,
            "source": "none",
            "reasoning": "no price",
            "comparables": [],
            "comparables_count": 0,
        },
        detected,
    )

    assert result["source"] == "mrp_anchor"
    assert result["price"] == 30000
    assert result["reasoning"] == "Conservative resale estimate from validated MRP and visible condition."


def test_mrp_anchor_price_fallback_rejects_unclear_condition():
    detected = AIDetected(
        category_slug="smartphones",
        brand="Apple",
        model="iPhone 13",
        condition_guess=None,
        mrp_inr=60000,
        mrp_confidence=0.7,
        mrp_source="visible_mrp",
        flags=[],
    )

    result = router._apply_price_fallbacks(
        {
            "price": None,
            "source": "none",
            "reasoning": "no price",
            "comparables": [],
            "comparables_count": 0,
        },
        detected,
    )

    assert result["source"] == "none"
    assert result["price"] is None


def test_mrp_anchor_price_fallback_rejects_market_anchor_mrp():
    detected = AIDetected(
        category_slug="smartphones",
        brand="Apple",
        model="iPhone 13",
        condition_guess="good",
        mrp_inr=60000,
        mrp_confidence=0.9,
        mrp_source="market_anchor",
        flags=[],
    )

    result = router._apply_price_fallbacks(
        {
            "price": None,
            "source": "none",
            "reasoning": "no price",
            "comparables": [],
            "comparables_count": 0,
        },
        detected,
    )

    assert result["source"] == "none"
    assert result["price"] is None


def test_price_result_merge_rejects_market_anchor_mrp():
    detected = AIDetected(category_slug="smartphones", suggested_price_inr=28000)

    merged = router._merge_mrp_from_price_result(
        detected,
        {
            "price": 28000,
            "source": "ai",
            "mrp_inr": 69900,
            "mrp_source": "market_anchor",
            "mrp_confidence": 0.95,
        },
    )

    assert merged.mrp_inr is None
    assert merged.mrp_source is None


@pytest.mark.asyncio
async def test_hero_cleanup_marks_retake_when_product_is_modified(monkeypatch):
    detected = AIDetected(
        category_slug="smartphones",
        image_set_quality={"overall_photo_quality": "good"},
    )

    async def fake_clean_hero_background(image_bytes, content_type, *, original_key, selected_index, category_slug):
        return HeroCleanupOutcome(
            selected_index=selected_index,
            cleaned=False,
            provider="test-cleaner",
            model="test-model",
            reason="product_modified",
            style="owmee_warm_ivory",
        )

    monkeypatch.setattr(router, "clean_hero_background", fake_clean_hero_background)

    _, updated = await router._clean_hero_and_mark_detected(
        detected=detected,
        image_bytes=b"phone",
        content_type="image/jpeg",
        original_key="ai-drafts/u/d_0.jpg",
        selected_index=0,
        fallback_key="ai-drafts/u/d_0.jpg.display.webp",
    )

    cleanup = updated.image_set_quality["hero_image_cleanup"]
    assert cleanup["status"] == "needs_retake"
    assert cleanup["requires_retake"] is True
    assert cleanup["reason"] == "product_modified"


@pytest.mark.asyncio
async def test_hero_cleanup_marks_retake_when_ai_saw_hand_and_cleanup_fallback(monkeypatch):
    detected = AIDetected(
        category_slug="smartphones",
        image_set_quality={"hero_image_has_human_artifact": True},
    )

    async def fake_clean_hero_background(image_bytes, content_type, *, original_key, selected_index, category_slug):
        return HeroCleanupOutcome(
            selected_index=selected_index,
            cleaned=False,
            provider="test-cleaner",
            reason="quality_audit_unavailable",
        )

    monkeypatch.setattr(router, "clean_hero_background", fake_clean_hero_background)

    _, updated = await router._clean_hero_and_mark_detected(
        detected=detected,
        image_bytes=b"phone",
        content_type="image/jpeg",
        original_key="ai-drafts/u/d_0.jpg",
        selected_index=0,
        fallback_key="ai-drafts/u/d_0.jpg.display.webp",
    )

    cleanup = updated.image_set_quality["hero_image_cleanup"]
    assert cleanup["status"] == "needs_retake"
    assert cleanup["requires_retake"] is True


@pytest.mark.asyncio
async def test_hero_cleanup_timeout_falls_back_without_failing_analysis(monkeypatch):
    detected = AIDetected(
        category_slug="kids-utility",
        image_set_quality={"overall_photo_quality": "good"},
    )

    async def slow_clean_hero_background(*args, **kwargs):
        await asyncio.sleep(0.05)

    monkeypatch.setattr(router, "HERO_CLEANUP_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(router, "clean_hero_background", slow_clean_hero_background)

    key, updated = await router._clean_hero_and_mark_detected(
        detected=detected,
        image_bytes=b"product",
        content_type="image/jpeg",
        original_key="ai-drafts/u/d_0.jpg",
        selected_index=0,
        fallback_key="ai-drafts/u/d_0.jpg.display.webp",
    )

    assert key == "ai-drafts/u/d_0.jpg.display.webp"
    cleanup = updated.image_set_quality["hero_image_cleanup"]
    assert cleanup["status"] == "fallback_original"
    assert cleanup["provider"] == "timeout"
    assert cleanup["reason"] == "cleanup_timeout"


@pytest.mark.asyncio
async def test_draft_from_images_vision_timeout_persists_manual_draft(monkeypatch):
    db = _FakeDB()
    user = SimpleNamespace(user_id=uuid4())

    async def slow_detect_from_images(images):
        await asyncio.sleep(0.05)

    def fake_process_listing_image_bytes(raw, *, original_key, content_type, **kwargs):
        return ProcessedListingImage(
            original_key=original_key,
            display_key=f"{original_key}.display.webp",
            thumbnail_key=f"{original_key}.thumb.webp",
        )

    async def fail_if_cleanup_runs(*args, **kwargs):
        raise AssertionError("cleanup should be skipped when vision times out")

    async def fake_estimate_price(*args, **kwargs):
        assert kwargs["allow_ai_fallback"] is False
        return {
            "price": None,
            "source": "none",
            "reasoning": "manual price",
            "comparables": [],
            "comparables_count": 0,
        }

    async def fake_get_user_location(db, user_id):
        return (12.9, 77.6, "Bengaluru", "Karnataka")

    monkeypatch.setattr(router, "VISION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", slow_detect_from_images)
    monkeypatch.setattr(router.price_estimator, "estimate_price", fake_estimate_price)
    monkeypatch.setattr(router, "process_listing_image_bytes", fake_process_listing_image_bytes)
    monkeypatch.setattr(router, "clean_hero_background", fail_if_cleanup_runs)
    monkeypatch.setattr(router, "generate_presigned_download_url", lambda key, expires_in=0: f"https://cdn.test/{key}")

    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(user_location, "get_user_location", fake_get_user_location)

    response = await router.draft_from_images(
        user=user,
        db=db,
        images=[
            _Upload(b"front"),
            _Upload(b"side"),
            _Upload(b"back"),
        ],
    )

    assert response.fallback_reason == "vision_timeout"
    assert db.insert_params is not None
    saved_urls = db.insert_params["photo_urls"]
    assert saved_urls[0].endswith("_0.jpg.display.webp")
    cleanup = response.detected.image_set_quality["hero_image_cleanup"]
    assert cleanup["provider"] == "skipped"
    assert cleanup["reason"] == "vision_failed"


@pytest.mark.asyncio
async def test_single_image_draft_defers_hero_cleanup_for_legacy_clients(monkeypatch):
    db = _FakeDB()
    user = SimpleNamespace(user_id=uuid4())

    async def fake_detect_fast_from_images(images):
        image_bytes, content_type = images[0]
        assert image_bytes == b"single"
        assert content_type == "image/jpeg"
        return AIDetected(
            category_slug="kids-utility",
            category_confidence=0.91,
            condition_guess="good",
            image_set_quality={"overall_photo_quality": "good"},
        )

    def fake_process_listing_image_bytes(raw, *, original_key, content_type, **kwargs):
        return ProcessedListingImage(
            original_key=original_key,
            display_key=f"{original_key}.display.webp",
            thumbnail_key=f"{original_key}.thumb.webp",
        )

    async def fail_if_cleanup_runs(*args, **kwargs):
        raise AssertionError("cleanup should run after listing creation, not during analysis")

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

    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_detect_fast_from_images)
    monkeypatch.setattr(router.price_estimator, "estimate_price", fake_estimate_price)
    monkeypatch.setattr(router, "process_listing_image_bytes", fake_process_listing_image_bytes)
    monkeypatch.setattr(router, "clean_hero_background", fail_if_cleanup_runs)
    monkeypatch.setattr(router, "generate_presigned_download_url", lambda key, expires_in=0: f"https://cdn.test/{key}")

    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(user_location, "get_user_location", fake_get_user_location)

    response = await router.draft_from_image(
        user=user,
        db=db,
        image=_Upload(b"single"),
    )

    assert response.photo_url.endswith(".jpg.display.webp")
    assert db.insert_params is not None
    saved_urls = db.insert_params["photo_urls"]
    assert len(saved_urls) == 1
    assert saved_urls[0].endswith(".jpg.display.webp")
    cleanup = response.detected.image_set_quality["hero_image_cleanup"]
    assert cleanup["status"] == "queued_after_listing"
    assert cleanup["provider"] == "owmee-media-worker"
    assert cleanup["reason"] == "runs_after_listing_created"
    assert db.commits == 1


@pytest.mark.asyncio
async def test_draft_from_images_selects_and_promotes_ai_hero_without_inline_cleanup(monkeypatch):
    db = _FakeDB()
    user = SimpleNamespace(user_id=uuid4())
    seen_images: list[tuple[bytes, str]] = []

    async def fake_detect_fast_from_images(images):
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

    async def fail_if_cleanup_runs(*args, **kwargs):
        raise AssertionError("cleanup should run after listing creation, not during analysis")

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

    monkeypatch.setattr(router.ai_provider, "detect_fast_from_images", fake_detect_fast_from_images)
    monkeypatch.setattr(router.price_estimator, "estimate_price", fake_estimate_price)
    monkeypatch.setattr(router, "process_listing_image_bytes", fake_process_listing_image_bytes)
    monkeypatch.setattr(router, "clean_hero_background", fail_if_cleanup_runs)
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
    assert response.photo_url.endswith("_2.jpg.display.webp")
    assert db.insert_params is not None
    saved_urls = db.insert_params["photo_urls"]
    assert saved_urls[0].endswith("_2.jpg.display.webp")
    assert saved_urls[1].endswith("_0.jpg.display.webp")
    assert saved_urls[2].endswith("_1.jpg.display.webp")
    assert saved_urls[3].endswith("_3.jpg.display.webp")
    saved_ai = json.loads(db.insert_params["ai_response"])
    saved_contract = saved_ai["_owmee_contract"]
    assert db.insert_params["category_slug"] == saved_contract["category_slug"]
    assert db.insert_params["category_schema_version"] == saved_contract["category_schema_version"]
    assert db.insert_params["safety_status"] == saved_contract["statuses"]["safety_status"]
    assert db.insert_params["core_analysis_status"] == saved_contract["statuses"]["core_analysis_status"]
    assert db.insert_params["pricing_status"] == saved_contract["statuses"]["pricing_status"]
    assert json.loads(db.insert_params["publish_blockers"]) == saved_contract["publish_blockers"]
    assert json.loads(db.insert_params["required_actions"]) == saved_contract["required_actions"]
    cleanup = response.detected.image_set_quality["hero_image_cleanup"]
    assert cleanup["status"] == "queued_after_listing"
    assert cleanup["provider"] == "owmee-media-worker"
    assert cleanup["selected_index"] == 2
    assert db.commits == 1


@pytest.mark.asyncio
async def test_create_from_draft_enqueues_hero_cleanup_after_commit(monkeypatch):
    user_id = uuid4()
    draft_id = uuid4()
    category_id = uuid4()
    enqueued: list[dict] = []

    class _CreateDB:
        def __init__(self) -> None:
            self.commits = 0
            self.insert_params = None

        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "SELECT user_id, photo_urls, expires_at, status" in sql:
                return _Result(
                    row=SimpleNamespace(
                        user_id=user_id,
                        photo_urls=[
                            "ai-drafts/u/draft_0.jpg.display.webp",
                            "ai-drafts/u/draft_1.jpg.display.webp",
                            "ai-drafts/u/draft_2.jpg.display.webp",
                        ],
                        expires_at=datetime(2099, 5, 17, tzinfo=timezone.utc),
                        status="open",
                        ai_response={"mrp_inr": 650, "mrp_source": "market_anchor"},
                    )
                )
            if "SELECT id FROM categories" in sql:
                return _Result(category_id)
            if "SELECT id FROM listings" in sql:
                return _Result(None)
            if "INSERT INTO listings" in sql:
                self.insert_params = params
            return _Result()

        async def commit(self) -> None:
            self.commits += 1

    async def fake_get_user_location(db, user_id):
        return (12.9, 77.6, "Bengaluru", "Karnataka")

    async def fake_enqueue_listing_hero_cleanup(**kwargs):
        enqueued.append(kwargs)
        return True

    import app.core.zones as zones
    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(user_location, "get_user_location", fake_get_user_location)
    monkeypatch.setattr(zones, "is_in_service_area", lambda lat, lng: True)
    monkeypatch.setattr(router.ceir_client, "check", lambda *args, **kwargs: None)
    monkeypatch.setattr(router, "enqueue_listing_hero_cleanup", fake_enqueue_listing_hero_cleanup)

    db = _CreateDB()
    response = await router.create_from_draft(
        payload=CreateFromDraftRequest(
            draft_id=draft_id,
            title="Kids water bottle",
            price=350,
            original_price=700,
            mrp_source="seller_entered",
            seller_mrp_confirmed=True,
            condition="good",
            category_slug="kids-utility",
            brand="Milton",
            model="School bottle",
            **_toy_publish_fields(),
        ),
        user=SimpleNamespace(user_id=user_id),
        db=db,
    )

    assert response.status == "active"
    assert response.original_price == 700
    assert db.commits == 1
    assert db.insert_params is not None
    assert db.insert_params["original_price"] == 700
    assert enqueued == [
        {
            "listing_id": response.listing_id,
            "hero_key": "ai-drafts/u/draft_0.jpg.display.webp",
            "category_slug": "kids-utility",
        }
    ]


@pytest.mark.asyncio
async def test_create_from_draft_rejects_when_review_removes_below_photo_floor(monkeypatch):
    user_id = uuid4()
    draft_id = uuid4()
    category_id = uuid4()

    class _CreateDB:
        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "SELECT user_id, photo_urls, expires_at, status" in sql:
                return _Result(
                    row=SimpleNamespace(
                        user_id=user_id,
                        photo_urls=[
                            "ai-drafts/u/draft_0.jpg.display.webp",
                            "ai-drafts/u/draft_1.jpg.display.webp",
                            "ai-drafts/u/draft_2.jpg.display.webp",
                        ],
                        expires_at=datetime(2099, 5, 17, tzinfo=timezone.utc),
                        status="open",
                        ai_response={},
                    )
                )
            if "SELECT id FROM categories" in sql:
                return _Result(category_id)
            return _Result(None)

        async def commit(self) -> None:
            raise AssertionError("create_from_draft should not commit")

    async def fake_get_user_location(db, user_id):
        return (12.9, 77.6, "Bengaluru", "Karnataka")

    import app.core.zones as zones
    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(user_location, "get_user_location", fake_get_user_location)
    monkeypatch.setattr(zones, "is_in_service_area", lambda lat, lng: True)

    with pytest.raises(HTTPException) as exc:
        await router.create_from_draft(
            payload=CreateFromDraftRequest(
                draft_id=draft_id,
                title="Kids puzzle set",
                price=450,
                condition="good",
                category_slug="kids-utility",
                model="Puzzle",
                removed_photo_indices=[1, 2],
                **_toy_publish_fields(),
            ),
            user=SimpleNamespace(user_id=user_id),
            db=_CreateDB(),
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["error"] == "MIN_PHOTOS_REQUIRED"
    assert exc.value.detail["photos_uploaded"] == 1


@pytest.mark.asyncio
async def test_create_from_draft_does_not_publish_unconfirmed_draft_mrp(monkeypatch):
    user_id = uuid4()
    draft_id = uuid4()
    category_id = uuid4()

    class _CreateDB:
        def __init__(self) -> None:
            self.insert_params = None

        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "SELECT user_id, photo_urls, expires_at, status, ai_response" in sql:
                return _Result(
                    row=SimpleNamespace(
                        user_id=user_id,
                        photo_urls=[
                            "ai-drafts/u/draft_0.jpg.display.webp",
                            "ai-drafts/u/draft_1.jpg.display.webp",
                            "ai-drafts/u/draft_2.jpg.display.webp",
                        ],
                        expires_at=datetime(2099, 5, 17, tzinfo=timezone.utc),
                        status="open",
                        ai_response={"mrp_inr": 1200, "mrp_source": "market_anchor"},
                    )
                )
            if "SELECT id FROM categories" in sql:
                return _Result(category_id)
            if "INSERT INTO listings" in sql:
                self.insert_params = params
            return _Result(None)

        async def commit(self) -> None:
            pass

    async def fake_get_user_location(db, user_id):
        return (12.9, 77.6, "Bengaluru", "Karnataka")

    async def fake_enqueue_listing_hero_cleanup(**kwargs):
        return True

    import app.core.zones as zones
    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(user_location, "get_user_location", fake_get_user_location)
    monkeypatch.setattr(zones, "is_in_service_area", lambda lat, lng: True)
    monkeypatch.setattr(router, "enqueue_listing_hero_cleanup", fake_enqueue_listing_hero_cleanup)

    db = _CreateDB()
    response = await router.create_from_draft(
        payload=CreateFromDraftRequest(
            draft_id=draft_id,
            title="Kids puzzle set",
            price=450,
            condition="good",
            category_slug="kids-utility",
            model="Puzzle",
            **_toy_publish_fields(),
        ),
        user=SimpleNamespace(user_id=user_id),
        db=db,
    )

    assert response.original_price is None
    assert db.insert_params["original_price"] is None


@pytest.mark.asyncio
async def test_create_from_draft_drops_mrp_that_cannot_discount(monkeypatch):
    user_id = uuid4()
    draft_id = uuid4()
    category_id = uuid4()

    class _CreateDB:
        def __init__(self) -> None:
            self.insert_params = None

        async def execute(self, stmt, params=None):
            sql = str(stmt)
            if "SELECT user_id, photo_urls, expires_at, status, ai_response" in sql:
                return _Result(
                    row=SimpleNamespace(
                        user_id=user_id,
                        photo_urls=[
                            "ai-drafts/u/draft_0.jpg.display.webp",
                            "ai-drafts/u/draft_1.jpg.display.webp",
                            "ai-drafts/u/draft_2.jpg.display.webp",
                        ],
                        expires_at=datetime(2099, 5, 17, tzinfo=timezone.utc),
                        status="open",
                        ai_response={"mrp_inr": 300},
                    )
                )
            if "SELECT id FROM categories" in sql:
                return _Result(category_id)
            if "INSERT INTO listings" in sql:
                self.insert_params = params
            return _Result(None)

        async def commit(self) -> None:
            pass

    async def fake_get_user_location(db, user_id):
        return (12.9, 77.6, "Bengaluru", "Karnataka")

    async def fake_enqueue_listing_hero_cleanup(**kwargs):
        return True

    import app.core.zones as zones
    import app.modules.identity_auth.user_location as user_location

    monkeypatch.setattr(user_location, "get_user_location", fake_get_user_location)
    monkeypatch.setattr(zones, "is_in_service_area", lambda lat, lng: True)
    monkeypatch.setattr(router, "enqueue_listing_hero_cleanup", fake_enqueue_listing_hero_cleanup)

    db = _CreateDB()
    response = await router.create_from_draft(
        payload=CreateFromDraftRequest(
            draft_id=draft_id,
            title="Kids puzzle set",
            price=450,
            original_price=400,
            condition="good",
            category_slug="kids-utility",
            model="Puzzle",
            **_toy_publish_fields(),
        ),
        user=SimpleNamespace(user_id=user_id),
        db=db,
    )

    assert response.original_price is None
    assert db.insert_params["original_price"] is None
