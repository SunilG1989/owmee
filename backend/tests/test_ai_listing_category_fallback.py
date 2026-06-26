import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.modules.ai_assistant.category_taxonomy import CATEGORY_SLUGS
from app.modules.ai_assistant.router import (
    _canonical_category_slug,
    _category_needs_identifier,
    _publish_detail_rejection,
    _photo_rejection_detail,
    _publish_rejection_detail,
    _with_canonical_category,
)
from app.modules.ai_assistant.schemas import AIDetected, CreateFromDraftRequest, DraftFromImageResponse


def test_category_aliases_supported_launch_taxonomy():
    assert _canonical_category_slug("mobile") == "smartphones"
    assert _canonical_category_slug("MacBook") == "laptops"
    assert _canonical_category_slug("iPad") == "tablets"
    assert _canonical_category_slug("small_appliances") == "small-appliances"
    assert _canonical_category_slug("kids toys") == "kids-utility"


def test_mobile_category_picks_match_backend_launch_taxonomy():
    repo_root = Path(__file__).resolve().parents[2]
    mobile_catalog = repo_root / "mobile" / "src" / "utils" / "listingCatalog.ts"
    slugs = re.findall(r"\{ slug: '([^']+)'", mobile_catalog.read_text())

    assert slugs == CATEGORY_SLUGS


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


def test_publish_rejection_blocks_manual_review_photo_risks():
    assert _publish_rejection_detail({"flags": ["packaging_only"]}) == {
        "error": "DRAFT_PHOTOS_BLOCKED",
        "flags": ["packaging_only"],
        "message": "Add a clear photo of the actual item. Packaging alone is not enough to publish.",
    }
    assert _publish_rejection_detail({"image_set_quality": {"has_private_info": True}})["flags"] == ["personal_info"]


def test_other_publish_requires_specific_product_type():
    generic_payload = CreateFromDraftRequest(
        draft_id=uuid4(),
        title="Used item",
        price=500,
        condition="good",
        category_slug="others",
        model="item",
    )
    assert _publish_detail_rejection("others", generic_payload) == {
        "error": "OTHER_DETAILS_REQUIRED",
        "fields": ["title"],
        "message": "Add a specific title for this Other category listing.",
    }

    missing_type_payload = generic_payload.model_copy(update={
        "title": "Sony headphones",
        "model": "item",
    })
    assert _publish_detail_rejection("others", missing_type_payload) == {
        "error": "OTHER_DETAILS_REQUIRED",
        "fields": ["model"],
        "message": "Add a concrete product type or product name before publishing an Other category listing.",
    }

    valid_payload = missing_type_payload.model_copy(update={"model": "wireless headphones"})
    assert _publish_detail_rejection("others", valid_payload) is None


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
        category_family="other",
        category_specifics={"ignored": "value"},
        detected_item_type="vintage wall clock",
        seller_edit_fields=["title", "brand", "model"],
        field_confidence={"title": 0.88},
        field_evidence={"title": "strong_visual_inference"},
    )
    response = DraftFromImageResponse(
        draft_id=uuid4(),
        photo_url="ai-drafts/test.jpg",
        photo_urls=["ai-drafts/test.jpg", "ai-drafts/test-2.jpg"],
        detected=detected,
        expires_at=datetime.now(timezone.utc),
    )

    payload = response.model_dump()

    assert payload["detected"]["detected_item_type"] == "vintage wall clock"
    assert payload["detected"]["category_family"] == "other"
    assert payload["detected"]["category_specifics"] == {"ignored": "value"}
    assert payload["detected"]["seller_edit_fields"] == ["title", "brand", "model"]
    assert payload["detected"]["field_confidence"] == {"title": 0.88}
    assert payload["photo_urls"] == ["ai-drafts/test.jpg", "ai-drafts/test-2.jpg"]
