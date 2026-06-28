from __future__ import annotations

from app.modules.ai_assistant import gemini_client
from app.modules.ai_assistant.gemini_client import _OwmeePhotoAnalysisV2
from app.modules.ai_assistant.schemas import AIDetected


def test_photo_analysis_v2_book_maps_to_launch_contract_and_preserves_raw_payload():
    analysis = _OwmeePhotoAnalysisV2(
        primary_item={
            "detected_item_type": "maths workbook",
            "category": "books",
            "subcategory": "school workbook",
            "category_confidence": 0.94,
        },
        title={
            "title_suggestion": "Class 4 maths workbook",
            "confidence": 0.88,
            "basis": "product_type_visible",
            "seller_edit_required": False,
        },
        visible_facts={
            "colors": ["blue"],
            "visible_text_snippets": [
                {"text": "MRP Rs. 250", "confidence": 0.9, "source_area": "back cover"},
            ],
        },
        pricing={
            "printed_mrp_visible": True,
            "printed_mrp_inr": 250,
            "printed_mrp_confidence": 0.9,
            "mrp_evidence": "MRP is printed on the back cover.",
        },
        condition_assessment={
            "visual_condition": "good",
            "confidence": 0.81,
            "condition_summary": "Cover is visible with light use.",
            "no_visible_damage": True,
            "working_status_from_photos": "not_applicable",
            "seller_condition_confirmation_required": True,
        },
        category_specific={
            "books": {
                "book_title": "Maths Workbook",
                "subject": "Maths",
                "language": "English",
                "class_or_grade": "Class 4",
                "board": "CBSE",
                "edition": "2025",
                "pages_missing_or_torn_visible": "no_visible_issue",
                "writing_or_highlighting_visible": "yes",
                "cover_condition": "good",
            },
        },
        p0_fields=[
            {
                "key": "price",
                "label": "Price",
                "status": "missing_answer_required",
                "seller_question": "What price do you want to list it for?",
                "reason": "Seller price is not available from photos.",
            },
        ],
        seller_required_checks=[
            {
                "field_key": "price",
                "priority": 1,
                "bottom_sheet_type": "price",
                "question": "Set your selling price",
                "why_required": "Price is required before publish.",
            },
        ],
        safe_description_draft="Class 4 maths workbook with visible blue cover.",
    )

    detected = gemini_client._translate_photo_analysis_v2(analysis)
    cleaned = gemini_client._apply_post_processing_guardrails(detected)

    assert cleaned.category_slug == "kids-utility"
    assert cleaned.category_family == "book"
    assert cleaned.title_suggestion == "Class 4 maths workbook"
    assert cleaned.category_specifics["language"] == "English"
    assert cleaned.category_specifics["class_board_edition"] == "Class 4 CBSE 2025"
    assert cleaned.category_specifics["markings_status"] == "Notes/highlights disclosed"
    assert cleaned.mrp_inr == 250
    assert cleaned.mrp_source == "visible_mrp"
    assert cleaned.field_evidence["mrp_inr"] == "direct_visible"
    assert "price" in cleaned.seller_edit_fields
    assert cleaned.photo_analysis["version"] == "owmee_photo_analysis_v2"
    assert cleaned.photo_analysis["p0_fields"][0]["key"] == "price"


def test_photo_analysis_v2_appliance_does_not_misread_not_working_as_working():
    analysis = _OwmeePhotoAnalysisV2(
        primary_item={
            "detected_item_type": "mixer grinder",
            "category": "home_appliances",
            "subcategory": "mixer grinder",
            "category_confidence": 0.91,
        },
        title={
            "title_suggestion": "Mixer grinder with jar",
            "confidence": 0.82,
            "basis": "product_type_visible",
        },
        visible_facts={"accessories_visible": ["jar"]},
        condition_assessment={
            "visual_condition": "fair",
            "confidence": 0.7,
            "seller_condition_confirmation_required": True,
        },
        category_specific={
            "home_appliances": {
                "appliance_type": "mixer grinder",
                "brand": "Preethi",
                "model": "Blue Leaf",
                "accessories_required_for_use_visible": ["jar"],
                "working_status": "not_working_visible",
            },
        },
    )

    detected = gemini_client._translate_photo_analysis_v2(analysis)

    assert detected.category_slug == "small-appliances"
    assert detected.category_family == "appliance"
    assert detected.brand == "Preethi"
    assert detected.model == "Blue Leaf"
    assert detected.category_specifics["working_status"] == "Not working"
    assert detected.accessories == "jar"
    assert detected.field_evidence["accessories"] == "direct_visible"


def test_photo_analysis_v2_repairs_other_colour_title_from_description():
    analysis = _OwmeePhotoAnalysisV2(
        primary_item={
            "detected_item_type": "Other",
            "category": "toys_kids",
            "subcategory": "Other",
            "category_confidence": 0.86,
        },
        title={
            "title_suggestion": "Other Pink",
            "confidence": 0.78,
            "basis": "fallback_catalog_type_and_colour",
        },
        visible_facts={"colors": ["Pink"]},
        condition_assessment={
            "visual_condition": "good",
            "confidence": 0.7,
            "seller_condition_confirmation_required": True,
        },
        safe_description_draft="Cute pink magnetic pencil box featuring a unicorn design.",
    )

    detected = gemini_client._translate_photo_analysis_v2(analysis)
    cleaned = gemini_client._apply_post_processing_guardrails(detected)

    assert cleaned.title_suggestion == "pink magnetic pencil box"
    assert cleaned.detected_item_type == "pink magnetic pencil box"
    assert cleaned.category_specifics["toy_type"] == "pink magnetic pencil box"
    assert "title" in cleaned.seller_edit_fields
    assert cleaned.field_confidence["title_suggestion"] <= 0.72


def test_photo_analysis_v2_never_keeps_other_camouflage_title():
    analysis = _OwmeePhotoAnalysisV2(
        primary_item={
            "detected_item_type": "Other",
            "category": "toys_kids",
            "subcategory": "Other",
            "category_confidence": 0.84,
        },
        title={"title_suggestion": "Other camouflage", "confidence": 0.8},
        visible_facts={"colors": ["camouflage"]},
        condition_assessment={"visual_condition": "good", "confidence": 0.7},
        safe_description_draft="Toy binoculars with a camouflage pattern are visible.",
    )

    detected = gemini_client._translate_photo_analysis_v2(analysis)
    cleaned = gemini_client._apply_post_processing_guardrails(detected)

    assert cleaned.title_suggestion == "Toy binoculars"
    assert cleaned.detected_item_type == "Toy binoculars"
    assert cleaned.category_specifics["toy_type"] == "Toy binoculars"


def test_photo_analysis_v2_blocking_flags_and_guardrails_preserve_audit_payload():
    detected = AIDetected(
        title_suggestion="Visible product",
        description_suggestion="Visible product description",
        flags=["nsfw"],
        photo_analysis={
            "version": "owmee_photo_analysis_v2",
            "blocking_flags": {"unsafe_or_prohibited": True},
        },
    )

    cleaned = gemini_client._apply_post_processing_guardrails(detected)

    assert cleaned.title_suggestion is None
    assert cleaned.description_suggestion is None
    assert cleaned.manual_review_required is True
    assert cleaned.auto_publish_candidate is False
    assert cleaned.photo_analysis["version"] == "owmee_photo_analysis_v2"
