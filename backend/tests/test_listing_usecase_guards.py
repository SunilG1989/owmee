from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.field_executive.router import (
    SubmitListingRequest,
    _validate_listing_package,
)
from app.modules.listings.router import _can_view_listing_detail
from app.modules.offers.router import MarkSoldRequest


def test_public_detail_allows_active_listing_without_auth():
    listing = SimpleNamespace(status="active", seller_id=uuid4())

    assert _can_view_listing_detail(listing, None) is True


def test_public_detail_blocks_non_active_listing_for_non_owner():
    seller_id = uuid4()
    listing = SimpleNamespace(status="reserved", seller_id=seller_id)
    buyer = SimpleNamespace(user_id=uuid4())

    assert _can_view_listing_detail(listing, buyer) is False


def test_seller_can_view_own_non_active_listing():
    seller_id = uuid4()
    listing = SimpleNamespace(status="pending_moderation", seller_id=seller_id)
    seller = SimpleNamespace(user_id=seller_id)

    assert _can_view_listing_detail(listing, seller) is True


def test_fe_listing_package_requires_three_photos():
    body = SubmitListingRequest(
        title="iPhone 13",
        category_id=str(uuid4()),
        condition="good",
        price=32000,
        brand="Apple",
        model="iPhone 13",
        image_urls=["fe-visits/v/one.jpg", "fe-visits/v/two.jpg"],
        city="Bengaluru",
    )

    with pytest.raises(HTTPException) as exc:
        _validate_listing_package(SimpleNamespace(slug="smartphones"), body)

    assert exc.value.status_code == 400
    assert exc.value.detail["error"] == "MIN_PHOTOS_REQUIRED"
    assert exc.value.detail["photos_uploaded"] == 2


def test_fe_listing_package_requires_specs_for_device_categories():
    body = SubmitListingRequest(
        title="Phone",
        category_id=str(uuid4()),
        condition="good",
        price=32000,
        image_urls=["fe-visits/v/1.jpg", "fe-visits/v/2.jpg", "fe-visits/v/3.jpg"],
        city="Bengaluru",
    )

    with pytest.raises(HTTPException) as exc:
        _validate_listing_package(SimpleNamespace(slug="smartphones"), body)

    assert exc.value.status_code == 400
    assert exc.value.detail["error"] == "MISSING_REQUIRED_SPECS"
    assert exc.value.detail["missing_fields"] == ["brand", "model"]


def test_seller_mark_sold_route_only_accepts_elsewhere():
    assert MarkSoldRequest(sold_where="elsewhere").sold_where == "elsewhere"

    with pytest.raises(ValidationError):
        MarkSoldRequest(sold_where="on_owmee")
