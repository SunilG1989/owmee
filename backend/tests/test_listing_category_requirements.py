from __future__ import annotations

from uuid import uuid4

from app.modules.ai_assistant.category_taxonomy import (
    category_family_for,
    clean_category_specifics,
)
from app.modules.ai_assistant.router import (
    _publish_category_specifics_rejection,
    _seller_review_snapshot_after_edit,
    _with_seeded_category_specifics,
)
from app.modules.ai_assistant.schemas import CreateFromDraftRequest, EditListingRequest
from app.modules.field_executive.router import (
    SubmitListingRequest,
    _clean_fe_category_specifics,
    _fe_category_specifics_rejection,
)
from app.modules.listings.router import (
    CreateListingRequest,
    _clean_manual_category_specifics,
    _manual_category_specifics_rejection,
)


def _payload(**kwargs) -> CreateFromDraftRequest:
    base = {
        "draft_id": uuid4(),
        "title": "LEGO city set",
        "price": 1200,
        "condition": "good",
        "category_slug": "kids-utility",
        "model": "LEGO set",
    }
    base.update(kwargs)
    return CreateFromDraftRequest(**base)


def test_category_family_infers_books_toys_and_appliances_without_new_db_categories():
    assert category_family_for("smartphones", title="iPhone") == "device"
    assert category_family_for("kids-utility", model="Story book set") == "book"
    assert category_family_for("kids-utility", model="LEGO set") == "toy"
    assert category_family_for("others", model="Book set") == "book"
    assert category_family_for("others", model="Air fryer") == "appliance"
    assert category_family_for("others", model="Wireless headphones") == "other"


def test_toy_publish_requires_age_cleanliness_parts_safety_and_checklist():
    payload = _payload()
    specifics = _with_seeded_category_specifics(
        category_family="toy",
        payload=payload,
        draft_ai_response={},
    )

    rejection = _publish_category_specifics_rejection(
        category_slug="kids-utility",
        category_family="toy",
        category_specifics=specifics,
        kids_safety_checklist=None,
        payload=payload,
    )

    assert rejection is not None
    assert rejection["error"] == "CATEGORY_REQUIREMENTS_REQUIRED"
    assert set(rejection["missing_fields"]) >= {
        "age_suitability",
        "hygiene_status",
        "missing_parts_status",
        "safety_status",
        "kids_safety_checklist",
    }


def test_toy_publish_allows_honest_negative_disclosures():
    payload = _payload(
        age_suitability="5-7 years",
        hygiene_status="Needs cleaning",
        category_specifics={
            "missing_parts_status": "Minor missing parts disclosed",
            "safety_status": "Issue disclosed",
        },
    )
    specifics = _with_seeded_category_specifics(
        category_family="toy",
        payload=payload,
        draft_ai_response={},
    )

    rejection = _publish_category_specifics_rejection(
        category_slug="kids-utility",
        category_family="toy",
        category_specifics=specifics,
        kids_safety_checklist={
            "no_small_parts": False,
            "no_loose_batteries": True,
            "no_sharp_edges": False,
        },
        payload=payload,
    )

    assert rejection is None
    assert specifics["toy_type"] == "LEGO set"


def test_powered_toy_requires_working_or_battery_status():
    payload = _payload(
        title="Remote control ride-on toy",
        model="Ride-on toy",
        age_suitability="3-5 years",
        hygiene_status="Cleaned",
        category_specifics={
            "missing_parts_status": "Complete / no parts missing",
            "safety_status": "No visible safety issue",
        },
    )

    rejection = _publish_category_specifics_rejection(
        category_slug="kids-utility",
        category_family="toy",
        category_specifics=clean_category_specifics("toy", payload.category_specifics),
        kids_safety_checklist={
            "no_small_parts": True,
            "no_loose_batteries": True,
            "no_sharp_edges": True,
        },
        payload=payload,
    )

    assert rejection is not None
    assert "battery_or_working_status" in rejection["missing_fields"]


def test_book_publish_requires_page_and_marking_disclosures():
    payload = _payload(
        title="Class 4 science book set",
        category_slug="others",
        model="Book set",
        category_specifics={
            "book_type": "Book set",
            "language": "English",
            "page_condition": "Minor wear",
            "markings_status": "Notes/highlights disclosed",
            "pages_complete": "All pages present",
        },
    )

    rejection = _publish_category_specifics_rejection(
        category_slug="others",
        category_family="book",
        category_specifics=clean_category_specifics("book", payload.category_specifics),
        kids_safety_checklist=None,
        payload=payload,
    )

    assert rejection is not None
    assert rejection["missing_fields"] == ["set_status"]

    complete = payload.model_copy(update={
        "category_specifics": {
            **payload.category_specifics,
            "set_status": "Partial set disclosed",
        },
    })
    assert _publish_category_specifics_rejection(
        category_slug="others",
        category_family="book",
        category_specifics=clean_category_specifics("book", complete.category_specifics),
        kids_safety_checklist=None,
        payload=complete,
    ) is None


def test_bulky_appliance_requires_pickup_complexity():
    payload = _payload(
        title="Samsung washing machine",
        category_slug="small-appliances",
        model="Washing machine",
        category_specifics={
            "working_status": "Fully working",
            "accessories_status": "Not applicable",
            "defects_disclosed": "No known defects",
        },
    )

    rejection = _publish_category_specifics_rejection(
        category_slug="small-appliances",
        category_family="appliance",
        category_specifics=_with_seeded_category_specifics(
            category_family="appliance",
            payload=payload,
            draft_ai_response={},
        ),
        kids_safety_checklist=None,
        payload=payload,
    )

    assert rejection is not None
    assert rejection["missing_fields"] == ["pickup_complexity"]

    complete = payload.model_copy(update={
        "category_specifics": {
            **payload.category_specifics,
            "pickup_complexity": "Needs two people",
        },
    })
    assert _publish_category_specifics_rejection(
        category_slug="small-appliances",
        category_family="appliance",
        category_specifics=_with_seeded_category_specifics(
            category_family="appliance",
            payload=complete,
            draft_ai_response={},
        ),
        kids_safety_checklist=None,
        payload=complete,
    ) is None


def test_manual_listing_rejects_kids_toy_without_seller_confirmed_safety():
    body = CreateListingRequest(
        category_id=uuid4(),
        title="Kids puzzle set",
        description=None,
        price=500,
        condition="good",
        city="Bengaluru",
        state="Karnataka",
        model="Puzzle",
        age_suitability="5-7 years",
        hygiene_status="Cleaned",
        category_specifics={
            "missing_parts_status": "Complete / no parts missing",
            "safety_status": "No visible safety issue",
        },
        is_kids_item=True,
    )
    family, specifics, kids_checklist = _clean_manual_category_specifics("kids-utility", body)

    rejection = _manual_category_specifics_rejection(
        category_slug="kids-utility",
        family=family,
        specifics=specifics,
        kids_checklist=kids_checklist,
        body=body,
    )

    assert family == "toy"
    assert rejection is not None
    assert "kids_safety_checklist" in rejection["missing_fields"]


def test_manual_listing_accepts_other_book_set_with_page_disclosures():
    body = CreateListingRequest(
        category_id=uuid4(),
        title="Class 5 science book set",
        description=None,
        price=700,
        condition="good",
        city="Bengaluru",
        state="Karnataka",
        model="Book set",
        category_specifics={
            "language": "English",
            "page_condition": "Minor wear",
            "markings_status": "Notes/highlights disclosed",
            "pages_complete": "All pages present",
            "set_status": "Complete set",
        },
    )
    family, specifics, kids_checklist = _clean_manual_category_specifics("others", body)

    assert family == "book"
    assert specifics["book_type"] == "Book set"
    assert _manual_category_specifics_rejection(
        category_slug="others",
        family=family,
        specifics=specifics,
        kids_checklist=kids_checklist,
        body=body,
    ) is None


def test_edit_listing_request_accepts_mobile_edit_fields():
    payload = EditListingRequest(
        title="Updated iPhone",
        screen_condition="minor_scratches",
        body_condition="minor_dents",
        defects=["small scratch"],
        has_box=True,
        has_bill=False,
        has_charger=True,
        water_damage_history=False,
        seller_functional_attestation=True,
    )

    assert payload.screen_condition == "minor_scratches"
    assert payload.defects == ["small scratch"]
    assert payload.seller_functional_attestation is True


def test_seller_review_snapshot_merges_editable_updates():
    snapshot = {
        "confirmed_at": "2026-06-01T00:00:00+00:00",
        "seller_confirmed": {
            "title": "Old title",
            "price": 1000,
            "warranty_status": "No warranty",
        },
    }

    updated = _seller_review_snapshot_after_edit(
        snapshot,
        {
            "title": "New title",
            "price": 1200,
            "warranty_info": "2 months left",
            "has_box": True,
        },
    )

    assert updated is not None
    assert updated["seller_confirmed"]["title"] == "New title"
    assert updated["seller_confirmed"]["price"] == 1200.0
    assert updated["seller_confirmed"]["warranty_status"] == "2 months left"
    assert updated["seller_confirmed"]["has_box"] is True
    assert updated["last_edited_at"]


def test_fe_listing_rejects_kids_toy_without_required_seller_facts():
    body = SubmitListingRequest(
        title="Kids remote control car",
        category_id=str(uuid4()),
        condition="good",
        price=900,
        brand="Hot Wheels",
        model="Remote control toy",
        image_urls=["fe-visits/v/1.jpg", "fe-visits/v/2.jpg", "fe-visits/v/3.jpg"],
        city="Bengaluru",
        is_kids_item=True,
    )
    category = type("Category", (), {"slug": "kids-utility"})()
    family, specifics, kids_checklist = _clean_fe_category_specifics(category, body)

    rejection = _fe_category_specifics_rejection(
        category_slug="kids-utility",
        family=family,
        specifics=specifics,
        kids_checklist=kids_checklist,
        body=body,
    )

    assert family == "toy"
    assert rejection is not None
    assert set(rejection["missing_fields"]) >= {
        "age_suitability",
        "hygiene_status",
        "missing_parts_status",
        "safety_status",
        "battery_or_working_status",
        "kids_safety_checklist",
    }


def test_fe_listing_accepts_book_with_complete_page_disclosures():
    body = SubmitListingRequest(
        title="Class 5 science book set",
        category_id=str(uuid4()),
        condition="good",
        price=700,
        brand="NCERT",
        model="Book set",
        image_urls=["fe-visits/v/1.jpg", "fe-visits/v/2.jpg", "fe-visits/v/3.jpg"],
        city="Bengaluru",
        is_kids_item=True,
        category_specifics={
            "language": "English",
            "page_condition": "Minor wear",
            "markings_status": "Light pencil marks",
            "pages_complete": "All pages present",
            "set_status": "Complete set",
        },
    )
    category = type("Category", (), {"slug": "kids-utility"})()
    family, specifics, kids_checklist = _clean_fe_category_specifics(category, body)

    assert family == "book"
    assert specifics["book_type"] == "Book set"
    assert _fe_category_specifics_rejection(
        category_slug="kids-utility",
        family=family,
        specifics=specifics,
        kids_checklist=kids_checklist,
        body=body,
    ) is None
