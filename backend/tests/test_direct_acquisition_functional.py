from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.main import create_app
from app.modules.direct_acquisition import router, service
from app.modules.direct_acquisition.router import (
    ApprovalDecisionRequest,
    ListingApprovalDecisionRequest,
    RejectItemRequest,
    ReviseOfferRequest,
    SellerFinalAcceptanceRequest,
)


class _Result:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value

    def scalar(self):
        return self.value

    def scalars(self):
        return self

    def all(self):
        if isinstance(self.value, list):
            return self.value
        return []


class _DB:
    def __init__(self, *, get_value=None, execute_values=None):
        self.get_value = get_value
        self.execute_values = list(execute_values or [])
        self.added = []
        self.committed = False

    async def get(self, *_args, **_kwargs):
        return self.get_value

    async def execute(self, *_args, **_kwargs):
        if self.execute_values:
            return _Result(self.execute_values.pop(0))
        return _Result(None)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.committed = True

    async def refresh(self, *_args, **_kwargs):
        return None


def _item(**overrides):
    base = dict(
        id=uuid4(),
        category="toys",
        item_type="wooden puzzle",
        item_title="Wooden puzzle board",
        seller_photos=["seller/front.jpg"],
        pickup_photos=["pickup/front.jpg"],
        seller_check_answers={"complete": True},
        ai_detected_type="wooden puzzle",
        policy_status="allowed",
        direct_eligibility_status="eligible",
        blocked_item_warnings=[],
        qc_checklist_template_id="toy-basic",
        required_pickup_photos=["front"],
        owmee_suggested_offer_inr=100,
        max_fe_auto_increase_allowed=10,
        fe_final_offer_inr=None,
        price_change_percent=None,
        price_change_reason_code=None,
        price_change_evidence_photos=[],
        approval_required=False,
        approval_status="not_required",
        qc_status="pending",
        qc_answers={},
        qc_notes=None,
        item_status="pending_qc",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _booking(**overrides):
    fe_id = overrides.pop("assigned_fe_id", uuid4())
    items = overrides.pop("items", [_item()])
    now = datetime.now(timezone.utc)
    base = dict(
        id=uuid4(),
        booking_code="OD-123456",
        seller_user_id=uuid4(),
        seller_account_id=uuid4(),
        pickup_address_id=uuid4(),
        pickup_address_snapshot={
            "house": "12",
            "street": "Pilot Street",
            "locality": "HSR Layout",
            "city": "Bengaluru",
            "pincode": "560102",
        },
        pickup_locality="HSR Layout",
        pickup_pincode="560102",
        slot_start=now + timedelta(hours=1),
        slot_end=now + timedelta(hours=3),
        status="seller_verified",
        assigned_fe_id=fe_id,
        assignment_method="ops_manual",
        seller_otp_hash=service.hash_otp("123456"),
        seller_phone_verified=True,
        seller_ownership_declaration=True,
        serviceable_area=True,
        item_count=len(items),
        estimated_total_offer_inr=sum(i.owmee_suggested_offer_inr for i in items),
        final_total_payout_inr=None,
        verified_at=now,
        seller_final_accepted_at=None,
        payout_initiated_at=None,
        payout_completed_at=None,
        handover_completed_at=None,
        warehouse_inbound_id=None,
        completed_at=None,
        created_at=now,
        updated_at=now,
        items=items,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


async def _patch_current_fe(monkeypatch, fe_id):
    async def fake_current_fe(_db, _current_user):
        return SimpleNamespace(id=fe_id, active=True)

    monkeypatch.setattr(router, "_current_fe", fake_current_fe)


def _patch_booking_loader(monkeypatch, booking, item=None):
    async def fake_load_booking(_db, _booking_id):
        return booking

    async def fake_load_item(_db, _booking_id, _item_id):
        return item

    monkeypatch.setattr(router, "_load_booking", fake_load_booking)
    if item is not None:
        monkeypatch.setattr(router, "_load_item", fake_load_item)


def test_direct_acquisition_routes_are_registered_and_no_off_platform_routes():
    paths = create_app().openapi()["paths"]

    required = {
        "/v1/direct-sell/pickup-slots",
        "/v1/direct-sell/bookings",
        "/v1/direct-sell/bookings/{booking_id}",
        "/v1/direct-sell/bookings/{booking_id}/cancel",
        "/v1/fe/bookings",
        "/v1/fe/bookings/{booking_id}",
        "/v1/fe/bookings/{booking_id}/start",
        "/v1/fe/bookings/{booking_id}/verify-seller-otp",
        "/v1/fe/bookings/{booking_id}/items/{item_id}/photos",
        "/v1/fe/bookings/{booking_id}/items/{item_id}/photos/request",
        "/v1/fe/bookings/{booking_id}/items/{item_id}/qc",
        "/v1/fe/bookings/{booking_id}/items/{item_id}/revise-offer",
        "/v1/fe/bookings/{booking_id}/items/{item_id}/reject",
        "/v1/fe/bookings/{booking_id}/seller-final-acceptance",
        "/v1/fe/bookings/{booking_id}/trigger-payout",
        "/v1/fe/bookings/{booking_id}/complete-handover",
        "/v1/ops/bookings",
        "/v1/ops/bookings/{booking_id}/assign-fe",
        "/v1/ops/price-approvals",
        "/v1/ops/price-approvals/{approval_id}/approve",
        "/v1/ops/price-approvals/{approval_id}/reject",
        "/v1/admin/listing-approvals",
        "/v1/admin/listing-approvals/{item_id}/approve",
        "/v1/admin/listing-approvals/{item_id}/send-back",
        "/v1/admin/listing-approvals/{item_id}/quarantine",
        "/v1/admin/listing-approvals/{item_id}/reject",
    }

    assert required.issubset(paths.keys())
    forbidden_terms = ("chat", "meetup", "cash", "manual-upi")
    assert all(not any(term in path for term in forbidden_terms) for path in paths)


@pytest.mark.asyncio
async def test_fe_revise_offer_above_threshold_creates_admin_approval(monkeypatch):
    fe_id = uuid4()
    item = _item(item_status="pending_qc")
    booking = _booking(assigned_fe_id=fe_id, items=[item])
    await _patch_current_fe(monkeypatch, fe_id)
    _patch_booking_loader(monkeypatch, booking, item)
    db = _DB()

    out = await router.fe_revise_offer(
        booking.id,
        item.id,
        ReviseOfferRequest(
            revised_offer_inr=125,
            reason_code="bundle_has_extra_piece",
            evidence_photos=["pickup/evidence.jpg"],
        ),
        SimpleNamespace(user_id=uuid4()),
        db,
    )

    assert db.committed is True
    assert len(db.added) == 1
    assert item.approval_required is True
    assert item.approval_status == "pending"
    assert item.item_status == "approval_pending"
    assert out["item"]["approval_required"] is True


@pytest.mark.asyncio
async def test_fe_revise_offer_requires_evidence_photo(monkeypatch):
    fe_id = uuid4()
    item = _item(item_status="pending_qc")
    booking = _booking(assigned_fe_id=fe_id, items=[item])
    await _patch_current_fe(monkeypatch, fe_id)
    _patch_booking_loader(monkeypatch, booking, item)

    with pytest.raises(HTTPException) as exc:
        await router.fe_revise_offer(
            booking.id,
            item.id,
            ReviseOfferRequest(
                revised_offer_inr=90,
                reason_code="condition_adjustment",
                evidence_photos=[],
            ),
            SimpleNamespace(user_id=uuid4()),
            _DB(),
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["error"] == "EVIDENCE_PHOTO_REQUIRED"


@pytest.mark.asyncio
async def test_fe_reject_all_items_closes_booking_without_payout(monkeypatch):
    fe_id = uuid4()
    item = _item(item_status="pending_qc")
    booking = _booking(assigned_fe_id=fe_id, items=[item])
    await _patch_current_fe(monkeypatch, fe_id)
    _patch_booking_loader(monkeypatch, booking, item)

    out = await router.fe_reject_item(
        booking.id,
        item.id,
        RejectItemRequest(reason_code="unsafe_toy", notes="Broken sharp edge.", evidence_photos=["pickup/reject.jpg"]),
        SimpleNamespace(user_id=uuid4()),
        _DB(),
    )

    assert booking.status == "item_rejected_by_fe"
    assert item.item_status == "rejected"
    assert out["status"] == "item_rejected_by_fe"


@pytest.mark.asyncio
async def test_seller_final_acceptance_requires_seller_otp(monkeypatch):
    fe_id = uuid4()
    item = _item(item_status="qc_passed", fe_final_offer_inr=100)
    booking = _booking(status="pickup_qc_in_progress", assigned_fe_id=fe_id, items=[item])
    await _patch_current_fe(monkeypatch, fe_id)
    _patch_booking_loader(monkeypatch, booking)

    with pytest.raises(HTTPException) as exc:
        await router.seller_final_acceptance(
            booking.id,
            SellerFinalAcceptanceRequest(accepted=True, method="otp", otp="999999"),
            SimpleNamespace(user_id=uuid4()),
            _DB(),
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["error"] == "INVALID_SELLER_FINAL_OTP"


@pytest.mark.asyncio
async def test_seller_final_acceptance_sets_final_total_after_all_items_resolved(monkeypatch):
    fe_id = uuid4()
    accepted = _item(item_status="qc_passed", fe_final_offer_inr=120)
    rejected = _item(item_status="rejected", fe_final_offer_inr=None)
    booking = _booking(status="pickup_qc_in_progress", assigned_fe_id=fe_id, items=[accepted, rejected])
    await _patch_current_fe(monkeypatch, fe_id)
    _patch_booking_loader(monkeypatch, booking)
    db = _DB()

    out = await router.seller_final_acceptance(
        booking.id,
        SellerFinalAcceptanceRequest(accepted=True, method="otp", otp="123456"),
        SimpleNamespace(user_id=uuid4()),
        db,
    )

    assert db.committed is True
    assert booking.status == "seller_final_acceptance"
    assert booking.final_total_payout_inr == 120
    assert out["final_total_payout_inr"] == 120


@pytest.mark.asyncio
async def test_trigger_payout_posts_single_seller_ledger_entry(monkeypatch):
    fe_id = uuid4()
    item = _item(item_status="qc_passed", fe_final_offer_inr=100)
    booking = _booking(
        status="seller_final_acceptance",
        assigned_fe_id=fe_id,
        items=[item],
        final_total_payout_inr=100,
        seller_final_accepted_at=datetime.now(timezone.utc),
    )
    await _patch_current_fe(monkeypatch, fe_id)
    _patch_booking_loader(monkeypatch, booking)
    db = _DB(execute_values=[None])

    out = await router.trigger_payout(booking.id, SimpleNamespace(user_id=uuid4()), db)

    assert db.committed is True
    assert len(db.added) == 1
    assert db.added[0].amount_inr == 100
    assert db.added[0].reference_id == "DIRECT-OD-123456"
    assert booking.status == "payout_completed"
    assert out["status"] == "payout_completed"


@pytest.mark.asyncio
async def test_complete_handover_moves_only_payable_items_to_warehouse(monkeypatch):
    fe_id = uuid4()
    payable = _item(item_status="qc_passed", fe_final_offer_inr=100)
    rejected = _item(item_status="rejected")
    booking = _booking(
        status="payout_completed",
        assigned_fe_id=fe_id,
        items=[payable, rejected],
        payout_completed_at=datetime.now(timezone.utc),
    )
    await _patch_current_fe(monkeypatch, fe_id)
    _patch_booking_loader(monkeypatch, booking)

    out = await router.complete_handover(booking.id, SimpleNamespace(user_id=uuid4()), _DB())

    assert booking.status == "booking_completed"
    assert booking.warehouse_inbound_id == "WIN-OD-123456"
    assert payable.item_status == "warehouse_inbound"
    assert rejected.item_status == "rejected"
    assert out["status"] == "booking_completed"


@pytest.mark.asyncio
async def test_price_approval_reject_restores_base_offer_and_pending_qc():
    approval = SimpleNamespace(
        id=uuid4(),
        acquisition_item_id=uuid4(),
        status="pending",
        approved_by_admin_id=None,
        resolved_at=None,
    )
    item = _item(
        item_status="approval_pending",
        approval_status="pending",
        qc_status="review_required",
        fe_final_offer_inr=125,
    )
    db = _DB(get_value=approval, execute_values=[])

    async def fake_get(_model, _id):
        return approval if _id == approval.id else item

    db.get = fake_get

    out = await router.reject_price(
        approval.id,
        ApprovalDecisionRequest(note="Use base offer"),
        SimpleNamespace(admin_id=uuid4()),
        db,
    )

    assert db.committed is True
    assert approval.status == "rejected"
    assert item.approval_status == "rejected"
    assert item.item_status == "pending_qc"
    assert item.fe_final_offer_inr == item.owmee_suggested_offer_inr
    assert out["status"] == "rejected"


@pytest.mark.asyncio
async def test_admin_listing_approval_requires_warehouse_inbound_item():
    item = _item(item_status="qc_passed")

    with pytest.raises(HTTPException) as exc:
        await router.approve_direct_listing(
            item.id,
            ListingApprovalDecisionRequest(note="Not at warehouse yet"),
            SimpleNamespace(admin_id=uuid4()),
            _DB(get_value=item),
        )

    assert exc.value.status_code == 409
    assert exc.value.detail["error"] == "ITEM_NOT_READY_FOR_ADMIN_APPROVAL"
