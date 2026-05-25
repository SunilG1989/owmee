from __future__ import annotations

import json
from uuid import uuid4

import pytest

from app.modules.ai_assistant import draft_contracts
from app.modules.ai_assistant.schemas import AIDetected


def test_smartphone_contract_requires_identifier_and_seller_confirmations():
    detected = AIDetected(
        category_slug="smartphones",
        brand="Apple",
        model=None,
        condition_guess="good",
        flags=[],
    )

    contract = draft_contracts.build_draft_contract(
        detected,
        {"price": None, "source": "none"},
    )

    assert contract["schema_version"] == draft_contracts.AI_DRAFT_CONTRACT_SCHEMA_VERSION
    assert contract["category_slug"] == "smartphones"
    assert contract["publish_blockers"] == []
    assert "confirm_model" in contract["required_actions"]
    assert "confirm_screen_condition" in contract["required_actions"]
    assert "confirm_body_condition" in contract["required_actions"]
    assert "confirm_seller_functional_attestation" in contract["required_actions"]
    assert "capture_identifier" in contract["required_actions"]
    assert "set_price" in contract["required_actions"]
    assert contract["statuses"]["pricing_status"] == "needs_seller"


def test_blocked_photo_contract_marks_safety_and_retake_action():
    detected = AIDetected(
        category_slug="kids-utility",
        detected_item_type="toy car",
        condition_guess="good",
        flags=["personal_info"],
        image_set_quality={"has_private_info": True},
    )

    contract = draft_contracts.build_draft_contract(
        detected,
        {"price": 250, "source": "category_anchor"},
    )

    assert contract["publish_blockers"] == ["personal_info"]
    assert contract["statuses"]["safety_status"] == "blocked"
    assert "retake_product_photos" in contract["required_actions"]


def test_fast_path_contract_defers_enrichment_and_copy_status():
    detected = AIDetected(
        category_slug="smartphones",
        brand="Apple",
        model="iPhone 13",
        condition_guess="good",
        screen_condition="flawless",
        body_condition="minor_dents",
        title_suggestion="Apple iPhone 13",
        flags=[],
    )

    contract = draft_contracts.build_draft_contract(
        detected,
        {"price": 24000, "source": "vision"},
        fast_path=True,
    )

    assert contract["statuses"]["core_analysis_status"] == "success"
    assert contract["statuses"]["category_enrichment_status"] == "pending"
    assert contract["statuses"]["copy_status"] == "pending"
    assert contract["statuses"]["pricing_status"] == "success"


def test_category_change_reconciliation_invalidates_category_price_and_copy_fields():
    reconciliation = draft_contracts.category_change_reconciliation(
        "smartphones",
        "kids-utility",
    )

    assert reconciliation["category_changed"] is True
    assert reconciliation["old_category_slug"] == "smartphones"
    assert reconciliation["new_category_slug"] == "kids-utility"
    assert "storage" in reconciliation["stale_fields"]
    assert "battery_health" in reconciliation["stale_fields"]
    assert "imei_1" in reconciliation["stale_fields"]
    assert "suggested_price_inr" in reconciliation["stale_fields"]
    assert "title_suggestion" in reconciliation["stale_fields"]
    assert draft_contracts.STAGE_PRICING in reconciliation["rerun_stages"]


@pytest.mark.asyncio
async def test_record_category_change_persists_event_and_marks_ai_fields_stale():
    draft_id = uuid4()
    calls: list[tuple[str, dict]] = []

    class _DB:
        async def execute(self, stmt, params=None):
            calls.append((str(stmt), params or {}))

    reconciliation = await draft_contracts.record_category_change_if_needed(
        _DB(),
        draft_id=draft_id,
        old_category="smartphones",
        new_category="small-appliances",
        changed_by="seller",
    )

    assert reconciliation["category_changed"] is True
    assert any("INSERT INTO draft_category_change_events" in sql for sql, _ in calls)
    stale_update = next(params for sql, params in calls if "UPDATE draft_field_values" in sql)
    assert stale_update["draft_id"] == draft_id
    assert "imei_1" in stale_update["field_keys"]
    assert "suggested_price_inr" in stale_update["field_keys"]


@pytest.mark.asyncio
async def test_record_analysis_artifact_writes_versioned_json_contract():
    draft_id = uuid4()
    captured = {}

    class _DB:
        async def execute(self, stmt, params=None):
            captured["sql"] = str(stmt)
            captured["params"] = params or {}

    artifact_id = await draft_contracts.record_analysis_artifact(
        _DB(),
        draft_id=draft_id,
        stage=draft_contracts.STAGE_VISION_CORE,
        status="success",
        input_payload={"image_count": 3},
        output_payload={"category_slug": "laptops"},
        model="gemini-test",
        latency_ms=1234,
        input_tokens=111,
        output_tokens=22,
        cached_tokens=3,
    )

    assert artifact_id == captured["params"]["id"]
    assert "INSERT INTO ai_analysis_artifacts" in captured["sql"]
    assert captured["params"]["draft_id"] == draft_id
    assert captured["params"]["schema_version"] == draft_contracts.AI_DRAFT_CONTRACT_SCHEMA_VERSION
    assert captured["params"]["latency_ms"] == 1234
    assert captured["params"]["input_tokens"] == 111
    assert captured["params"]["output_tokens"] == 22
    assert captured["params"]["cached_tokens"] == 3
    assert json.loads(captured["params"]["input_json"]) == {"image_count": 3}
    assert json.loads(captured["params"]["output_json"]) == {"category_slug": "laptops"}


@pytest.mark.asyncio
async def test_record_pricing_field_values_mirrors_final_price_result():
    draft_id = uuid4()
    artifact_id = uuid4()
    calls: list[tuple[str, dict]] = []

    class _DB:
        async def execute(self, stmt, params=None):
            calls.append((str(stmt), params or {}))

    await draft_contracts.record_pricing_field_values(
        _DB(),
        draft_id=draft_id,
        price_result={
            "price": 2450.0,
            "source": "category_anchor",
            "reasoning": "Category anchor after fast draft analysis.",
        },
        artifact_id=artifact_id,
    )

    field_params = [
        params for sql, params in calls
        if "INSERT INTO draft_field_values" in sql
    ]

    assert [params["field_key"] for params in field_params] == [
        "suggested_price_inr",
        "price_reasoning",
    ]
    assert json.loads(field_params[0]["value"]) == 2450
    assert field_params[0]["source"] == "pricing"
    assert field_params[0]["evidence"] == "category_anchor"
    assert field_params[0]["artifact_id"] == artifact_id
    assert json.loads(field_params[1]["value"]) == "Category anchor after fast draft analysis."

    calls.clear()
    await draft_contracts.record_pricing_field_values(
        _DB(),
        draft_id=draft_id,
        price_result={"price": float("nan"), "source": "category_anchor"},
        artifact_id=artifact_id,
    )
    assert calls == []
