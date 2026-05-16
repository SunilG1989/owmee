from datetime import datetime, timezone
from uuid import uuid4

from app.modules.ai_assistant.router import (
    _canonical_category_slug,
    _category_needs_identifier,
    _photo_rejection_detail,
    _with_canonical_category,
)
from app.modules.ai_assistant.schemas import AIDetected, DraftFromImageResponse


def test_category_aliases_supported_launch_taxonomy():
    assert _canonical_category_slug("mobile") == "smartphones"
    assert _canonical_category_slug("MacBook") == "laptops"
    assert _canonical_category_slug("iPad") == "tablets"
    assert _canonical_category_slug("small_appliances") == "small-appliances"
    assert _canonical_category_slug("kids toys") == "kids-utility"


def test_unknown_visible_products_fallback_to_other():
    assert _canonical_category_slug("headphones") == "others"
    assert _canonical_category_slug("collectibles") == "others"
    assert _canonical_category_slug("") == "others"
    assert _canonical_category_slug("", fallback_empty_to_others=False) is None


def test_other_fallback_preserves_raw_slug_and_seller_edit_fields():
    detected = AIDetected(
        category_slug="collectibles",
        category_confidence=0.62,
        detected_item_type="vintage wall clock",
        title_suggestion="Vintage wall clock",
        brand=None,
        model=None,
    )

    out = _with_canonical_category(detected)

    assert out.category_slug == "others"
    assert out.raw_category_slug == "collectibles"
    assert out.category_resolution == "fallback_others"
    assert out.category_rationale
    assert out.detected_item_type == "vintage wall clock"
    assert {"title", "brand", "model"}.issubset(set(out.seller_edit_fields))


def test_unresolved_empty_category_does_not_create_fake_other_when_photo_is_bad():
    detected = AIDetected(category_slug=None, flags=["no_product"])

    out = _with_canonical_category(detected)

    assert out.category_slug is None
    assert out.category_resolution == "unresolved"


def test_photo_rejection_blocks_bad_inputs_but_allows_other_category():
    assert _photo_rejection_detail(AIDetected(flags=["no_product"])) == {
        "error": "PHOTO_REJECTED",
        "flags": ["no_product"],
        "message": "We could not find a sellable product in these photos.",
    }

    assert _photo_rejection_detail(AIDetected(category_slug="others", flags=[])) is None


def test_identifier_requirement_tracks_canonical_category():
    assert _category_needs_identifier("mobile") is True
    assert _category_needs_identifier("laptop") is True
    assert _category_needs_identifier("others") is False
    assert _category_needs_identifier("collectibles") is False


def test_draft_response_exposes_new_ai_review_fields():
    detected = AIDetected(
        category_slug="others",
        raw_category_slug="collectibles",
        category_resolution="fallback_others",
        category_rationale="Outside launch categories.",
        detected_item_type="vintage wall clock",
        seller_edit_fields=["title", "brand", "model"],
        field_confidence={"title": 0.88},
        field_evidence={"title": "strong_visual_inference"},
    )
    response = DraftFromImageResponse(
        draft_id=uuid4(),
        photo_url="ai-drafts/test.jpg",
        detected=detected,
        expires_at=datetime.now(timezone.utc),
    )

    payload = response.model_dump()

    assert payload["detected"]["detected_item_type"] == "vintage wall clock"
    assert payload["detected"]["seller_edit_fields"] == ["title", "brand", "model"]
    assert payload["detected"]["field_confidence"] == {"title": 0.88}
