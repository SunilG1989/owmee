"""Fast regression tests for Owmee's managed order E2E contract.

These are deliberately DB-free. The DB-backed offer tests still cover real
persistence when a migrated Postgres is available; this file protects the
state-machine, route, notification, and snapshot contracts on every local run.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.main import create_app
from app.modules.notifications.service import BUCKET_MAP
from app.modules.offers import service as offer_service
from app.modules.transactions import logistics_router
from app.modules.transactions.address_snapshots import (
    snapshot_from_user_address,
    snapshot_summary,
)
from app.modules.transactions.logistics_state import (
    AT_HUB,
    COMPLETED,
    DELIVERED,
    DELIVERY_IN_PROGRESS,
    PAYMENT_CAPTURED,
    PICKUP_REJECTED,
    assert_legal_transition,
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
        self.committed = False

    async def get(self, *_args, **_kwargs):
        return self.get_value

    async def execute(self, *_args, **_kwargs):
        if self.execute_values:
            return _Result(self.execute_values.pop(0))
        return _Result(self.get_value)

    async def commit(self):
        self.committed = True


def _address(user_id, role: str, name: str = "Test User") -> dict:
    return {
        "snapshot_version": 1,
        "source": "test",
        "role": role,
        "user_id": str(user_id),
        "full_name": name,
        "phone_number": "9999999999",
        "lat": 12.9716,
        "lng": 77.5946,
        "flat_house_number": "12",
        "address_line_1": "Pilot Street",
        "locality": "Indiranagar",
        "city": "Bengaluru",
        "state": "Karnataka",
        "pincode": "560038",
        "full_address": "12, Pilot Street, Indiranagar, Bengaluru, Karnataka, 560038",
    }


def _txn(**overrides):
    buyer_id = overrides.pop("buyer_id", uuid4())
    seller_id = overrides.pop("seller_id", uuid4())
    now = datetime.now(timezone.utc)
    base = {
        "id": uuid4(),
        "listing_id": uuid4(),
        "buyer_id": buyer_id,
        "seller_id": seller_id,
        "status": PAYMENT_CAPTURED,
        "gross_amount": Decimal("9000"),
        "delivery_fee": Decimal("0"),
        "seller_readiness_status": "pending",
        "seller_readiness_reason": None,
        "seller_response_deadline": now + timedelta(hours=4),
        "seller_responded_at": None,
        "pickup_ready_at": None,
        "seller_pickup_slot_start": None,
        "seller_pickup_slot_end": None,
        "buyer_delivery_address_snapshot": _address(buyer_id, "buyer_delivery", "Buyer"),
        "seller_pickup_address_snapshot": _address(seller_id, "seller_pickup", "Seller"),
        "pickup_fe_id": None,
        "delivery_fe_id": None,
        "delivery_mode": None,
        "courier_name": None,
        "courier_booking_id": None,
        "courier_tracking_url": None,
        "pickup_inspection_passed": None,
        "pickup_inspection_notes": None,
        "pickup_inspection_photo_keys": None,
        "delivery_handover_photo_key": None,
        "buyer_acknowledgment_code": None,
        "created_at": now,
        "at_hub_at": None,
        "routed_at": None,
        "delivered_at": None,
        "confirmation_deadline": None,
        "buyer_confirmed_at": None,
        "completed_at": None,
        "auto_completed_at": None,
        "payout_flagged_at": None,
        "payout_released_at": None,
        "refund_status": "none",
        "refund_amount": None,
        "refund_reason": None,
        "refund_completed_at": None,
        "return_status": "none",
        "return_reason": None,
        "return_decision_note": None,
        "return_requested_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_order_routes_are_registered_and_no_direct_handoff_routes_return():
    paths = create_app().openapi()["paths"]

    required = {
        "/v1/transactions/{transaction_id}/seller-readiness/confirm",
        "/v1/transactions/{transaction_id}/seller-readiness/decline",
        "/v1/admin/logistics/seller-readiness-queue",
        "/v1/admin/logistics/transactions/{transaction_id}/expire-seller-readiness",
        "/v1/admin/logistics/pickup-queue",
        "/v1/fe/pickups",
        "/v1/fe/deliveries",
        "/v1/transactions/{transaction_id}/tracking",
    }
    assert required.issubset(paths.keys())
    assert all("chat" not in path for path in paths)
    assert all("accept-cash" not in path for path in paths)
    assert all("meetup" not in path for path in paths)


def test_order_notification_events_stay_transaction_bucket_only():
    required_events = {
        "seller_readiness_required",
        "seller_ready",
        "seller_unavailable_refund",
        "seller_timeout_refund",
        "pickup_assigned",
        "pickup_completed",
        "item_at_hub",
        "pickup_rejected_refund",
        "payout_processing_started",
        "payout_verification_required",
        "out_for_delivery",
        "delivery_in_progress",
        "delivered_confirm_receipt",
        "delivered_awaiting_confirmation",
    }

    assert all(BUCKET_MAP[event] == "transactions" for event in required_events)
    assert "messages" not in set(BUCKET_MAP.values())
    assert "new_message" not in BUCKET_MAP


def test_address_snapshot_is_immutable_shape_with_safe_summary():
    user_id = uuid4()
    row = SimpleNamespace(
        id=uuid4(),
        user_id=user_id,
        label="home",
        custom_label=None,
        full_name="Buyer One",
        phone_number="9876543210",
        lat=Decimal("12.9716000"),
        lng=Decimal("77.5946000"),
        flat_house_number="12",
        building_name="Palm Court",
        floor=None,
        landmark="Near metro",
        address_line_1="Pilot Street",
        locality="Indiranagar",
        city="Bengaluru",
        state="Karnataka",
        pincode="560038",
    )

    snap = snapshot_from_user_address(row, role="buyer_delivery")
    summary = snapshot_summary(snap)

    assert snap["role"] == "buyer_delivery"
    assert snap["user_id"] == str(user_id)
    assert snap["lat"] == 12.9716
    assert snap["lng"] == 77.5946
    assert snap["full_address"] == "12, Palm Court, Pilot Street, Indiranagar, Bengaluru, Karnataka, 560038"
    assert summary == {
        "full_name": "Buyer One",
        "phone_number": "9876543210",
        "full_address": snap["full_address"],
        "locality": "Indiranagar",
        "city": "Bengaluru",
        "state": "Karnataka",
        "pincode": "560038",
        "lat": 12.9716,
        "lng": 77.5946,
    }


def test_logistics_state_blocks_skipping_pickup_and_delivery():
    assert_legal_transition(PAYMENT_CAPTURED, AT_HUB)
    assert_legal_transition(PAYMENT_CAPTURED, PICKUP_REJECTED)
    assert_legal_transition(AT_HUB, DELIVERY_IN_PROGRESS)
    assert_legal_transition(DELIVERY_IN_PROGRESS, DELIVERED)
    assert_legal_transition(DELIVERED, COMPLETED)

    with pytest.raises(ValueError, match="payment_captured->delivered"):
        assert_legal_transition(PAYMENT_CAPTURED, DELIVERED)


@pytest.mark.asyncio
async def test_payment_capture_opens_seller_readiness_only_when_address_exists(monkeypatch):
    from app.modules.verification import service as verification_service

    buyer_id = uuid4()
    seller_id = uuid4()
    txn = _txn(buyer_id=buyer_id, seller_id=seller_id)
    pl = SimpleNamespace(
        status="created",
        paid_at=None,
        razorpay_payment_id=None,
        webhook_payload=None,
        transaction_id=txn.id,
    )
    listing = SimpleNamespace(id=txn.listing_id, category_id=uuid4())
    notified = []
    decisions = []

    async def fake_eval(*_args, **_kwargs):
        return verification_service.allow("BUYER_OK")

    async def fake_record(*_args, **kwargs):
        decisions.append(kwargs)

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        notified.append((user_id, event_type))

    async def no_op_prefill(_db, _txn):
        return None

    monkeypatch.setattr(verification_service, "evaluate_user_action", fake_eval)
    monkeypatch.setattr(verification_service, "record_action_policy_decision", fake_record)
    monkeypatch.setattr(offer_service, "_notify", fake_notify)
    monkeypatch.setattr(offer_service, "_prefill_missing_transaction_snapshots", no_op_prefill)

    db = _DB(execute_values=[pl, txn, listing, "smartphones"])
    out = await offer_service.process_payment_paid(db, "link_1", "pay_1", {"ok": True})

    assert out is txn
    assert pl.status == "paid"
    assert txn.status == PAYMENT_CAPTURED
    assert txn.seller_readiness_status == "pending"
    assert txn.seller_response_deadline is not None
    assert txn.payout_flagged_at is None
    assert txn.payout_released_at is None
    assert (seller_id, "seller_readiness_required") in notified
    assert (buyer_id, "payment_confirmed") in notified
    assert decisions[0]["metadata"]["stage"] == "payment_webhook"


@pytest.mark.asyncio
async def test_payment_capture_without_buyer_address_holds_ops_flow(monkeypatch):
    from app.modules.verification import service as verification_service

    buyer_id = uuid4()
    seller_id = uuid4()
    txn = _txn(
        buyer_id=buyer_id,
        seller_id=seller_id,
        buyer_delivery_address_snapshot=None,
    )
    pl = SimpleNamespace(
        status="created",
        paid_at=None,
        razorpay_payment_id=None,
        webhook_payload=None,
        transaction_id=txn.id,
    )
    listing = SimpleNamespace(id=txn.listing_id, category_id=uuid4())
    notified = []

    async def fake_eval(*_args, **_kwargs):
        return verification_service.allow("BUYER_OK")

    async def fake_record(*_args, **_kwargs):
        return None

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        notified.append((user_id, event_type))

    async def no_op_prefill(_db, _txn):
        return None

    monkeypatch.setattr(verification_service, "evaluate_user_action", fake_eval)
    monkeypatch.setattr(verification_service, "record_action_policy_decision", fake_record)
    monkeypatch.setattr(offer_service, "_notify", fake_notify)
    monkeypatch.setattr(offer_service, "_prefill_missing_transaction_snapshots", no_op_prefill)

    db = _DB(execute_values=[pl, txn, listing, "smartphones"])
    out = await offer_service.process_payment_paid(db, "link_1", "pay_1", {"ok": True})

    assert out is txn
    assert txn.status == "payment_capture_uncertain"
    assert txn.seller_response_deadline is None
    assert (buyer_id, "delivery_address_required") in notified
    assert (seller_id, "seller_readiness_required") not in notified


@pytest.mark.asyncio
async def test_seller_readiness_confirm_mutates_only_structured_state(monkeypatch):
    txn = _txn()
    notified = []

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        notified.append((user_id, event_type))

    monkeypatch.setattr(offer_service, "_notify", fake_notify)

    out = await offer_service.confirm_seller_readiness(
        _DB(get_value=txn),
        txn.id,
        txn.seller_id,
    )

    assert out is txn
    assert txn.status == PAYMENT_CAPTURED
    assert txn.seller_readiness_status == "confirmed"
    assert txn.seller_readiness_reason is None
    assert txn.seller_responded_at is not None
    assert txn.pickup_ready_at is not None
    assert txn.payout_flagged_at is None
    assert txn.payout_released_at is None
    assert (txn.buyer_id, "seller_ready") in notified


@pytest.mark.asyncio
async def test_pickup_completion_starts_verified_seller_payout_processing(monkeypatch):
    from app.modules.transactions import payout_service

    fe_id = uuid4()
    txn = _txn(
        status=PAYMENT_CAPTURED,
        seller_readiness_status="confirmed",
        pickup_fe_id=fe_id,
    )
    notified = []

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        notified.append((user_id, event_type))

    async def fake_seller_payout_verified(*_args, **_kwargs):
        return True

    monkeypatch.setattr(offer_service, "_notify", fake_notify)
    monkeypatch.setattr(payout_service, "seller_payout_verified", fake_seller_payout_verified)

    out = await logistics_router.fe_complete_pickup(
        txn.id,
        logistics_router.CompletePickupRequest(
            inspection_passed=True,
            inspection_notes="serial and condition match",
            inspection_photo_keys=["evidence/pickup.jpg"],
        ),
        SimpleNamespace(user_id=fe_id, role="fe"),
        _DB(get_value=txn),
    )

    assert out["status"] == AT_HUB
    assert txn.status == AT_HUB
    assert txn.at_hub_at is not None
    assert txn.payout_flagged_at is not None
    assert txn.payout_released_at is None
    assert txn.net_payout == Decimal("9000")
    assert (txn.seller_id, "pickup_completed") in notified
    assert (txn.seller_id, "payout_processing_started") in notified


@pytest.mark.asyncio
async def test_pickup_completion_prompts_unverified_seller_before_payout_release(monkeypatch):
    from app.modules.transactions import payout_service

    fe_id = uuid4()
    txn = _txn(
        status=PAYMENT_CAPTURED,
        seller_readiness_status="confirmed",
        pickup_fe_id=fe_id,
    )
    notified = []

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        notified.append((user_id, event_type))

    async def fake_seller_payout_verified(*_args, **_kwargs):
        return False

    monkeypatch.setattr(offer_service, "_notify", fake_notify)
    monkeypatch.setattr(payout_service, "seller_payout_verified", fake_seller_payout_verified)

    await logistics_router.fe_complete_pickup(
        txn.id,
        logistics_router.CompletePickupRequest(
            inspection_passed=True,
            inspection_notes="serial and condition match",
            inspection_photo_keys=["evidence/pickup.jpg"],
        ),
        SimpleNamespace(user_id=fe_id, role="fe"),
        _DB(get_value=txn),
    )

    assert txn.status == AT_HUB
    assert txn.payout_flagged_at is not None
    assert txn.payout_released_at is None
    assert (txn.seller_id, "payout_verification_required") in notified


@pytest.mark.asyncio
async def test_delivery_completion_still_holds_payout_until_buyer_confirmation(monkeypatch):
    fe_id = uuid4()
    txn = _txn(
        status=DELIVERY_IN_PROGRESS,
        delivery_fe_id=fe_id,
        buyer_acknowledgment_code="123456",
        payout_flagged_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    original_payout_started_at = txn.payout_flagged_at
    notified = []

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        notified.append((user_id, event_type))

    monkeypatch.setattr(offer_service, "_notify", fake_notify)

    out = await logistics_router.fe_complete_delivery(
        txn.id,
        logistics_router.CompleteDeliveryRequest(
            handover_photo_key="evidence/delivery.jpg",
            ack_code="123456",
        ),
        SimpleNamespace(user_id=fe_id, role="fe"),
        _DB(get_value=txn),
    )

    assert out["status"] == DELIVERED
    assert txn.status == DELIVERED
    assert txn.delivered_at is not None
    assert txn.confirmation_deadline is not None
    assert txn.payout_flagged_at == original_payout_started_at
    assert txn.payout_released_at is None
    assert (txn.seller_id, "delivered_awaiting_confirmation") in notified


@pytest.mark.asyncio
async def test_payout_activity_refuses_before_pickup_confirmation(monkeypatch):
    from app.db import session as db_session
    from app.modules.transactions import activities as transaction_activities

    txn = _txn(status=PAYMENT_CAPTURED)

    class FakeSessionFactory:
        def __call__(self):
            return self

        async def __aenter__(self):
            return _DB(get_value=txn)

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(db_session, "AsyncSessionLocal", FakeSessionFactory())

    out = await transaction_activities.act_trigger_payout_eligibility(
        transaction_activities.ActivityTransactionInput(transaction_id=str(txn.id))
    )

    assert out == {"success": False, "reason": "PICKUP_NOT_CONFIRMED", "status": PAYMENT_CAPTURED}
    assert txn.payout_flagged_at is None
    assert txn.payout_released_at is None


@pytest.mark.asyncio
async def test_payout_activity_allows_after_pickup_confirmation(monkeypatch):
    from app.db import session as db_session
    from app.modules.transactions import activities as transaction_activities
    from app.modules.transactions import payout_service

    txn = _txn(status=AT_HUB)

    async def fake_seller_payout_verified(*_args, **_kwargs):
        return True

    class FakeSessionFactory:
        def __call__(self):
            return self

        async def __aenter__(self):
            return _DB(get_value=txn)

        async def __aexit__(self, *_args):
            return False

    monkeypatch.setattr(db_session, "AsyncSessionLocal", FakeSessionFactory())
    monkeypatch.setattr(payout_service, "seller_payout_verified", fake_seller_payout_verified)

    out = await transaction_activities.act_trigger_payout_eligibility(
        transaction_activities.ActivityTransactionInput(transaction_id=str(txn.id))
    )

    assert out == {
        "success": True,
        "already_flagged": False,
        "seller_payout_verified": True,
    }
    assert txn.payout_flagged_at is not None
    assert txn.payout_released_at is None


@pytest.mark.asyncio
async def test_seller_readiness_decline_cancels_suppresses_and_refunds(monkeypatch):
    txn = _txn()
    calls = {"suppressed": None, "refunded": None, "notified": []}

    async def fake_suppress(_db, declined_txn, reason):
        calls["suppressed"] = (declined_txn.id, reason)

    async def fake_refund(_db, declined_txn, *, reason):
        calls["refunded"] = (declined_txn.id, reason)

    async def fake_notify(_db, user_id, event_type, *_args, **_kwargs):
        calls["notified"].append((user_id, event_type))

    monkeypatch.setattr(offer_service, "_suppress_listing_after_seller_readiness_failure", fake_suppress)
    monkeypatch.setattr(offer_service, "_refund_for_seller_readiness_failure", fake_refund)
    monkeypatch.setattr(offer_service, "_notify", fake_notify)

    out = await offer_service.decline_seller_readiness(
        _DB(get_value=txn),
        txn.id,
        txn.seller_id,
        reason="sold_elsewhere",
    )

    assert out is txn
    assert txn.status == "cancelled"
    assert txn.seller_readiness_status == "declined"
    assert txn.cancelled_reason == "seller_sold_elsewhere"
    assert calls["suppressed"] == (txn.id, "sold_elsewhere")
    assert calls["refunded"] == (txn.id, "Seller declined: sold_elsewhere")
    assert (txn.buyer_id, "seller_unavailable_refund") in calls["notified"]


@pytest.mark.asyncio
async def test_admin_pickup_assignment_requires_confirmed_seller_readiness():
    txn = _txn(seller_readiness_status="pending")

    with pytest.raises(HTTPException) as exc:
        await logistics_router.admin_assign_pickup(
            txn.id,
            logistics_router.AssignPickupRequest(fe_user_id=uuid4()),
            _DB(get_value=txn),
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["error"] == "SELLER_NOT_READY"


@pytest.mark.asyncio
async def test_buyer_tracking_timeline_reflects_payment_and_seller_ready():
    buyer_id = uuid4()
    seller_id = uuid4()
    pending = _txn(
        buyer_id=buyer_id,
        seller_id=seller_id,
        status="payment_pending",
        seller_readiness_status="pending",
        seller_response_deadline=None,
    )

    pending_out = await logistics_router.buyer_tracking(
        pending.id,
        SimpleNamespace(user_id=buyer_id),
        _DB(get_value=pending),
    )

    assert pending_out["timeline"][0]["step"] == "payment_captured"
    assert pending_out["timeline"][0]["done"] is False
    assert pending_out["timeline"][1]["step"] == "seller_ready"
    assert pending_out["timeline"][1]["done"] is False

    ready_at = datetime.now(timezone.utc)
    ready = _txn(
        buyer_id=buyer_id,
        seller_id=seller_id,
        status=PAYMENT_CAPTURED,
        seller_readiness_status="confirmed",
        pickup_ready_at=ready_at,
    )
    ready_out = await logistics_router.buyer_tracking(
        ready.id,
        SimpleNamespace(user_id=buyer_id),
        _DB(get_value=ready),
    )

    assert ready_out["seller_readiness_status"] == "confirmed"
    assert ready_out["timeline"][0]["done"] is True
    assert ready_out["timeline"][1]["done"] is True
