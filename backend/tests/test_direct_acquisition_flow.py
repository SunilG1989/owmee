from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.modules.direct_acquisition import service


def _item(**overrides):
    base = dict(
        id=uuid4(),
        category="toys",
        seller_photos=["seller/front.jpg"],
        policy_status="allowed",
        direct_eligibility_status="eligible",
        qc_checklist_template_id="toy-basic",
        owmee_suggested_offer_inr=100,
        fe_final_offer_inr=None,
        max_fe_auto_increase_allowed=Decimal("10.00"),
        approval_required=False,
        approval_status="not_required",
        pickup_photos=["pickup/front.jpg"],
        required_pickup_photos=["front"],
        item_status="pending_qc",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _booking(**overrides):
    base = dict(
        seller_user_id=uuid4(),
        seller_account_id=uuid4(),
        pickup_address_id=uuid4(),
        pickup_locality="HSR Layout",
        pickup_pincode="560102",
        slot_start=datetime.now(timezone.utc),
        slot_end=datetime.now(timezone.utc),
        seller_phone_verified=True,
        seller_ownership_declaration=True,
        serviceable_area=True,
        status="pending_fe_assignment",
        assigned_fe_id=None,
        seller_final_accepted_at=None,
        final_total_payout_inr=None,
        payout_ready_at=None,
        payout_completed_at=None,
        items=[_item()],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_booking_assignment_requires_item_manifest_and_ownership():
    booking = _booking(seller_ownership_declaration=False, items=[])

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_booking_assignable(booking)

    assert exc.value.code == "BOOKING_NOT_ASSIGNABLE"
    assert "seller_ownership_declaration" in exc.value.message
    assert "acquisition_items" in exc.value.message


def test_booking_assignment_blocks_unsupported_direct_category():
    booking = _booking(items=[_item(category="phones")])

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_booking_assignable(booking)

    assert exc.value.code == "BOOKING_NOT_ASSIGNABLE"
    assert "unsupported_category:phones" in exc.value.message


def test_fe_cannot_start_someone_elses_booking():
    fe_id = uuid4()
    booking = _booking(status="assigned_to_fe", assigned_fe_id=uuid4())

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_can_start_booking(booking, fe_id)

    assert exc.value.code == "NOT_YOUR_BOOKING"


def test_qc_requires_seller_verification_first():
    booking = _booking(status="fe_arrived")

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_item_can_be_qced(booking, booking.items[0])

    assert exc.value.code == "SELLER_NOT_VERIFIED"


def test_price_increase_above_ten_percent_requires_approval():
    assert service.compute_change_percent(100, 110) == Decimal("10.00")
    assert service.requires_price_approval(base_offer_inr=100, requested_offer_inr=110) is False
    assert service.requires_price_approval(base_offer_inr=100, requested_offer_inr=111) is True


def test_seller_final_acceptance_blocks_pending_price_approval():
    item = _item(
        item_status="qc_revised",
        approval_required=True,
        approval_status="pending",
        fe_final_offer_inr=130,
    )
    booking = _booking(status="pickup_qc_in_progress", items=[item])

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_final_acceptance_allowed(booking)

    assert exc.value.code == "PRICE_APPROVAL_PENDING"


def test_seller_final_acceptance_blocks_unresolved_manifest_items():
    accepted = _item(item_status="qc_passed", fe_final_offer_inr=100)
    unresolved = _item(item_status="pending_qc")
    booking = _booking(status="pickup_qc_in_progress", items=[accepted, unresolved])

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_final_acceptance_allowed(booking)

    assert exc.value.code == "UNRESOLVED_ITEMS"


def test_price_revision_requires_pickup_evidence_photos():
    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_price_revision_evidence([])

    assert exc.value.code == "EVIDENCE_PHOTO_REQUIRED"


def test_payout_processing_requires_finance_ready_and_positive_amount():
    booking = _booking(status="pickup_qc_in_progress", final_total_payout_inr=100)

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_payout_allowed(booking)

    assert exc.value.code == "PAYOUT_NOT_READY"

    booking.status = "payout_ready"
    booking.seller_final_accepted_at = datetime.now(timezone.utc)
    booking.payout_ready_at = datetime.now(timezone.utc)
    booking.final_total_payout_inr = 0
    with pytest.raises(service.DirectAcquisitionError) as exc2:
        service.assert_payout_allowed(booking)
    assert exc2.value.code == "INVALID_PAYOUT_AMOUNT"


def test_handover_requires_completed_payout():
    booking = _booking(status="seller_final_acceptance", payout_completed_at=None)

    with pytest.raises(service.DirectAcquisitionError) as exc:
        service.assert_handover_allowed(booking)

    assert exc.value.code == "PAYOUT_NOT_COMPLETED"
