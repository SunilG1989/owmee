"""Sprint 6c — hybrid logistics endpoints.

Three audiences in one router; each path prefix tells you who it's for:

  /v1/admin/logistics/...   → admin web UI (hub dispatch, FE management)
  /v1/fe/...                → field executive mobile app
  /v1/transactions/{id}/tracking → consumer tracking (BasicUser)

Auth posture
------------
Admin endpoints use a permissive `require_admin` shim that matches the
existing kyc_queue.require_l2_reviewer pattern (no real verification at
present; pre-launch task to wire admin JWT properly — flagged with
TODO and tracked in KNOWN_ISSUES).

FE endpoints check that current_user.role == 'fe'. Phone-OTP-only users
without that role get 403.

Buyer endpoint is BasicUser (phone OTP).
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Annotated, Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select, text

from app.core.dependencies import BasicUser, CurrentUser, DBSession, require_basic
from app.modules.identity_auth.models import User
from app.modules.listings.models import Listing
from app.modules.offers.models import PaymentLink, Transaction
from app.modules.transactions.logistics_state import (
    AT_HUB, COMPLETED, DELIVERED, DELIVERY_IN_PROGRESS,
    PAYMENT_CAPTURED, PICKUP_REJECTED,
    assert_legal_transition,
)

logger = structlog.get_logger()
router = APIRouter(tags=["logistics"])


# ── Auth helpers ──────────────────────────────────────────────────────────────

# TODO pre-launch: wire real admin JWT verification (admin_users +
# admin_refresh_tokens are seeded but never enforced at request time).
# Matches the existing stub at admin/kyc_queue.require_l2_reviewer.
async def require_admin() -> None:
    return None


async def require_fe(current_user: BasicUser) -> CurrentUser:
    if current_user.role != "fe":
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, {"error": "FE_ROLE_REQUIRED"})
    return current_user


FeUser = Annotated[CurrentUser, Depends(require_fe)]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _gen_handover_code() -> str:
    """Six-digit OTP the FE asks the buyer to read aloud at handover.
    secrets.choice avoids the predictable-PRNG class of bug."""
    return "".join(secrets.choice("0123456789") for _ in range(6))


KNOWN_COURIERS = ("porter", "delhivery", "shiprocket", "self_delivered")


def _fmt_logistics(txn: Transaction, listing_title: str | None = None) -> dict:
    """Single representation reused by admin + FE + buyer responses; we
    redact PII for buyer (no FE user_id, etc.) at the call site, not here."""
    return {
        "transaction_id": str(txn.id),
        "status": txn.status,
        "listing_title": listing_title,
        "gross_amount": str(txn.gross_amount),
        "delivery_fee": str(txn.delivery_fee or 0),
        "delivery_mode": txn.delivery_mode,
        "pickup_fe_id": str(txn.pickup_fe_id) if txn.pickup_fe_id else None,
        "delivery_fe_id": str(txn.delivery_fe_id) if txn.delivery_fe_id else None,
        "courier_name": txn.courier_name,
        "courier_booking_id": txn.courier_booking_id,
        "courier_tracking_url": txn.courier_tracking_url,
        "pickup_inspection_passed": txn.pickup_inspection_passed,
        "pickup_inspection_notes": txn.pickup_inspection_notes,
        "pickup_inspection_photo_keys": txn.pickup_inspection_photo_keys,
        "delivery_handover_photo_key": txn.delivery_handover_photo_key,
        "at_hub_at": txn.at_hub_at.isoformat() if txn.at_hub_at else None,
        "routed_at": txn.routed_at.isoformat() if txn.routed_at else None,
        "delivered_at": txn.delivered_at.isoformat() if txn.delivered_at else None,
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class AssignPickupRequest(BaseModel):
    fe_user_id: UUID


class CompletePickupRequest(BaseModel):
    inspection_passed: bool
    inspection_notes: str = Field("", max_length=2000)
    inspection_photo_keys: list[str] = Field(default_factory=list, max_length=12)


class RouteToFeDeliveryRequest(BaseModel):
    fe_user_id: UUID


class RouteToCourierRequest(BaseModel):
    courier_name: str = Field(..., min_length=2, max_length=40)
    booking_id: str = Field(..., min_length=2, max_length=120)
    tracking_url: str | None = Field(None, max_length=500)


class CourierStatusRequest(BaseModel):
    new_status: str = Field(..., pattern="^(picked_up|in_transit|out_for_delivery|delivered|exception)$")
    note: str | None = Field(None, max_length=300)


class CompleteDeliveryRequest(BaseModel):
    handover_photo_key: str = Field(..., min_length=4, max_length=500)
    ack_code: str = Field(..., min_length=6, max_length=8)


# ── Admin: pickup queue ───────────────────────────────────────────────────────

@router.get("/v1/admin/logistics/pickup-queue", dependencies=[Depends(require_admin)])
async def admin_pickup_queue(db: DBSession):
    """Transactions where buyer paid but no FE has been assigned to pickup yet."""
    rows = await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(and_(
            Transaction.status == PAYMENT_CAPTURED,
            Transaction.pickup_fe_id.is_(None),
        ))
        .order_by(Transaction.created_at.asc())
    )
    return {"transactions": [_fmt_logistics(t, title) for t, title in rows.all()]}


@router.post(
    "/v1/admin/logistics/transactions/{transaction_id}/assign-pickup",
    dependencies=[Depends(require_admin)],
)
async def admin_assign_pickup(transaction_id: UUID, body: AssignPickupRequest, db: DBSession):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.status != PAYMENT_CAPTURED:
        raise HTTPException(400, {"error": "INVALID_STATUS", "current": txn.status})

    fe = await db.get(User, body.fe_user_id)
    if not fe:
        raise HTTPException(400, {"error": "FE_NOT_FOUND"})
    # role check is informational — admins can over-assign in unusual ops cases
    if fe.tier != "fe" and getattr(fe, "role", None) != "fe":
        logger.warning("logistics.assign_pickup.user_not_fe", user_id=str(body.fe_user_id))

    txn.pickup_fe_id = body.fe_user_id
    await db.commit()
    return _fmt_logistics(txn)


# ── FE: pickups ───────────────────────────────────────────────────────────────

@router.get("/v1/fe/pickups")
async def fe_my_pickups(current_user: FeUser, db: DBSession):
    rows = await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(and_(
            Transaction.pickup_fe_id == current_user.user_id,
            Transaction.status == PAYMENT_CAPTURED,
        ))
        .order_by(Transaction.created_at.asc())
    )
    return {"pickups": [_fmt_logistics(t, title) for t, title in rows.all()]}


@router.post("/v1/fe/pickups/{transaction_id}/complete")
async def fe_complete_pickup(
    transaction_id: UUID,
    body: CompletePickupRequest,
    current_user: FeUser,
    db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.pickup_fe_id != current_user.user_id:
        raise HTTPException(403, {"error": "NOT_YOUR_PICKUP"})

    target = AT_HUB if body.inspection_passed else PICKUP_REJECTED
    assert_legal_transition(txn.status, target)

    now = datetime.now(timezone.utc)
    txn.pickup_inspection_passed = body.inspection_passed
    txn.pickup_inspection_notes = body.inspection_notes
    txn.pickup_inspection_photo_keys = body.inspection_photo_keys
    txn.status = target

    if body.inspection_passed:
        txn.at_hub_at = now
    else:
        # Pickup rejected: refund flow is owned by the refund/return work
        # in the next sprint phase. For now we just mark the txn rejected
        # and rely on ops to push the refund through manually.
        logger.info(
            "logistics.pickup_rejected_refund_pending",
            transaction_id=str(transaction_id),
            seller_id=str(txn.seller_id),
            buyer_id=str(txn.buyer_id),
            notes=body.inspection_notes,
        )

    await db.commit()
    return _fmt_logistics(txn)


# ── Admin: hub dispatch ───────────────────────────────────────────────────────

@router.get("/v1/admin/logistics/hub-queue", dependencies=[Depends(require_admin)])
async def admin_hub_queue(db: DBSession):
    """Transactions sitting at hub waiting for an admin to choose FE or courier."""
    rows = await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(and_(
            Transaction.status == AT_HUB,
            Transaction.routed_at.is_(None),
        ))
        .order_by(Transaction.at_hub_at.asc())
    )
    return {"transactions": [_fmt_logistics(t, title) for t, title in rows.all()]}


@router.post(
    "/v1/admin/logistics/transactions/{transaction_id}/route-to-fe-delivery",
    dependencies=[Depends(require_admin)],
)
async def admin_route_to_fe_delivery(
    transaction_id: UUID, body: RouteToFeDeliveryRequest, db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    assert_legal_transition(txn.status, DELIVERY_IN_PROGRESS)

    fe = await db.get(User, body.fe_user_id)
    if not fe:
        raise HTTPException(400, {"error": "FE_NOT_FOUND"})

    now = datetime.now(timezone.utc)
    txn.delivery_mode = "fe"
    txn.delivery_fe_id = body.fe_user_id
    txn.buyer_acknowledgment_code = _gen_handover_code()
    txn.routed_at = now
    txn.status = DELIVERY_IN_PROGRESS
    await db.commit()
    # Buyer gets the ack code via push notification — see TODO below.
    logger.info(
        "logistics.routed_fe_delivery",
        transaction_id=str(transaction_id), fe_user_id=str(body.fe_user_id),
    )
    return _fmt_logistics(txn)


@router.post(
    "/v1/admin/logistics/transactions/{transaction_id}/route-to-courier",
    dependencies=[Depends(require_admin)],
)
async def admin_route_to_courier(
    transaction_id: UUID, body: RouteToCourierRequest, db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    assert_legal_transition(txn.status, DELIVERY_IN_PROGRESS)

    name = body.courier_name.lower()
    if name not in KNOWN_COURIERS:
        # We accept free-text but log so we can extend the dropdown.
        logger.info("logistics.unknown_courier", courier_name=body.courier_name)

    now = datetime.now(timezone.utc)
    txn.delivery_mode = "courier"
    txn.courier_name = body.courier_name
    txn.courier_booking_id = body.booking_id
    txn.courier_tracking_url = body.tracking_url
    txn.routed_at = now
    txn.status = DELIVERY_IN_PROGRESS
    await db.commit()
    return _fmt_logistics(txn)


@router.post(
    "/v1/admin/logistics/transactions/{transaction_id}/courier-status",
    dependencies=[Depends(require_admin)],
)
async def admin_courier_status(
    transaction_id: UUID, body: CourierStatusRequest, db: DBSession,
):
    """Pre-Shiprocket integration: admin manually progresses courier status.
    Only meaningful when delivery_mode='courier'. The 'delivered' status
    flips the transaction state machine; everything else is informational
    and stored in the log (we don't have a dedicated courier_events table)."""
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.delivery_mode != "courier":
        raise HTTPException(400, {"error": "NOT_A_COURIER_TXN"})

    if body.new_status == "delivered":
        assert_legal_transition(txn.status, DELIVERED)
        txn.status = DELIVERED
        txn.delivered_at = datetime.now(timezone.utc)

    logger.info(
        "logistics.courier_status_update",
        transaction_id=str(transaction_id),
        courier_name=txn.courier_name,
        new_status=body.new_status,
        note=body.note,
    )
    await db.commit()
    return _fmt_logistics(txn)


# ── FE: deliveries ────────────────────────────────────────────────────────────

@router.get("/v1/fe/deliveries")
async def fe_my_deliveries(current_user: FeUser, db: DBSession):
    rows = await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(and_(
            Transaction.delivery_fe_id == current_user.user_id,
            Transaction.status == DELIVERY_IN_PROGRESS,
        ))
        .order_by(Transaction.routed_at.asc())
    )
    return {"deliveries": [_fmt_logistics(t, title) for t, title in rows.all()]}


@router.post("/v1/fe/deliveries/{transaction_id}/complete")
async def fe_complete_delivery(
    transaction_id: UUID,
    body: CompleteDeliveryRequest,
    current_user: FeUser,
    db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.delivery_fe_id != current_user.user_id:
        raise HTTPException(403, {"error": "NOT_YOUR_DELIVERY"})

    assert_legal_transition(txn.status, DELIVERED)

    if not txn.buyer_acknowledgment_code or body.ack_code.strip() != txn.buyer_acknowledgment_code:
        raise HTTPException(400, {"error": "ACK_CODE_MISMATCH"})

    txn.delivery_handover_photo_key = body.handover_photo_key
    txn.status = DELIVERED
    txn.delivered_at = datetime.now(timezone.utc)
    await db.commit()
    return _fmt_logistics(txn)


# ── Buyer: tracking ───────────────────────────────────────────────────────────

@router.get("/v1/transactions/{transaction_id}/tracking")
async def buyer_tracking(transaction_id: UUID, current_user: BasicUser, db: DBSession):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    # Buyer or seller can see the tracking; FE handover assignments are
    # exposed via FE endpoints, not here.
    if txn.buyer_id != current_user.user_id and txn.seller_id != current_user.user_id:
        raise HTTPException(403, {"error": "FORBIDDEN"})

    timeline: list[dict] = [
        {"step": "payment_captured",      "at": txn.created_at.isoformat() if txn.created_at else None,
         "label": "Payment received", "done": True},
        {"step": "fe_pickup",             "at": txn.at_hub_at.isoformat() if txn.at_hub_at else None,
         "label": "Picked up + inspected", "done": txn.at_hub_at is not None},
        {"step": "at_hub",                "at": txn.at_hub_at.isoformat() if txn.at_hub_at else None,
         "label": "At Owmee hub", "done": txn.at_hub_at is not None},
        {"step": "routed_for_delivery",   "at": txn.routed_at.isoformat() if txn.routed_at else None,
         "label": "Out for delivery", "done": txn.routed_at is not None},
        {"step": "delivered",             "at": txn.delivered_at.isoformat() if txn.delivered_at else None,
         "label": "Delivered to you", "done": txn.delivered_at is not None},
    ]
    return {
        "transaction_id": str(transaction_id),
        "status": txn.status,
        "timeline": timeline,
        "delivery_mode": txn.delivery_mode,
        "courier_name": txn.courier_name,
        "courier_tracking_url": txn.courier_tracking_url,
        # The buyer needs the ack code only when an FE delivery is in
        # progress; redacted otherwise so we don't leak it to the seller.
        "ack_code": (
            txn.buyer_acknowledgment_code
            if (txn.buyer_id == current_user.user_id and txn.status == DELIVERY_IN_PROGRESS
                and txn.delivery_mode == "fe")
            else None
        ),
    }
