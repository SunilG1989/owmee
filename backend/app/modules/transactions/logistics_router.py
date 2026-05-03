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

from app.core.dependencies import BasicUser, CurrentUser, DBSession, VerifiedUser, require_basic
from app.modules.identity_auth.models import User
from app.modules.listings.models import Listing
from app.modules.offers.models import PaymentLink, Transaction
from app.modules.transactions.logistics_state import (
    AT_HUB, COMPLETED, DELIVERED, DELIVERY_IN_PROGRESS,
    PAYMENT_CAPTURED, PICKUP_REJECTED,
    assert_legal_transition,
)
from app.modules.transactions import return_service

logger = structlog.get_logger()
router = APIRouter(tags=["logistics"])


# ── Auth helpers ──────────────────────────────────────────────────────────────

# Admin JWT verification — see app/modules/admin/admin_auth.py.
# Earlier this was a permissive `return None` stub.
from app.modules.admin.admin_auth import require_admin  # noqa: F401


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
        # Pickup rejected = trust failure. Auto-initiate the buyer's
        # refund right here so ops doesn't have to chase it manually.
        from app.modules.transactions.refund_service import (
            initiate_refund, INITIATED_BY_SYSTEM_PICKUP,
        )
        try:
            await initiate_refund(
                db, txn,
                reason=f"Pickup inspection failed: {body.inspection_notes}"[:200],
                initiated_by=INITIATED_BY_SYSTEM_PICKUP,
            )
        except ValueError as ref_err:
            # Already-refunded or not-paid is a no-op for the FE flow;
            # log so ops can investigate but don't block the pickup.
            logger.warning(
                "logistics.pickup_rejected_refund_skip",
                transaction_id=str(transaction_id),
                reason=str(ref_err),
            )

    await db.commit()
    return _fmt_logistics(txn)


# ── Admin: refund queue + initiate ────────────────────────────────────────────

class _InitiateRefundRequest(BaseModel):
    reason: str = Field(..., min_length=2, max_length=200)


@router.get("/v1/admin/logistics/refunds", dependencies=[Depends(require_admin)])
async def admin_refund_queue(db: DBSession):
    """Refunds in flight (requested / processing / failed) for the admin
    dashboard. 'completed' refunds are fine — we don't need to look at
    them after the fact."""
    rows = (await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(Transaction.refund_status.in_(["requested", "processing", "failed"]))
        .order_by(Transaction.refund_initiated_at.desc())
    )).all()
    out = []
    for t, title in rows:
        d = _fmt_logistics(t, title)
        d["refund_status"] = t.refund_status
        d["refund_amount"] = str(t.refund_amount) if t.refund_amount else None
        d["refund_reason"] = t.refund_reason
        d["refund_initiated_at"] = t.refund_initiated_at.isoformat() if t.refund_initiated_at else None
        d["refund_initiated_by"] = t.refund_initiated_by
        out.append(d)
    return {"refunds": out}


@router.post(
    "/v1/admin/logistics/transactions/{transaction_id}/refund",
    dependencies=[Depends(require_admin)],
)
async def admin_initiate_refund(
    transaction_id: UUID, body: _InitiateRefundRequest, db: DBSession,
):
    from app.modules.transactions.refund_service import (
        initiate_refund, INITIATED_BY_ADMIN,
    )
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    try:
        await initiate_refund(db, txn, reason=body.reason, initiated_by=INITIATED_BY_ADMIN)
    except ValueError as e:
        raise HTTPException(400, {"error": str(e)})
    await db.commit()
    return _fmt_logistics(txn)


# ── Returns: buyer + admin + FE ───────────────────────────────────────────────

class _RequestReturnRequest(BaseModel):
    reason: str = Field(..., min_length=2, max_length=50)
    description: str = Field(..., min_length=10, max_length=1000)
    # P0.4 (2026-05-03) — buyer-uploaded return-evidence photos. Cap 3.
    photo_uris: list[str] | None = Field(default=None, max_length=3)


class _AdminReturnDecisionRequest(BaseModel):
    note: str = Field("", max_length=500)


class _AdminAssignReturnPickupRequest(BaseModel):
    fe_user_id: UUID


@router.post("/v1/transactions/{transaction_id}/condition_confirmed")
async def buyer_condition_confirmed(
    transaction_id: UUID,
    current_user: BasicUser, db: DBSession,
):
    """Buyer-side beacon set when the in-app inspection-confirm checkbox is
    tapped before the 6-digit handover code is shown (mobile P0.5).

    Idempotent: only sets condition_confirmed_at the first time. Subsequent
    calls are no-ops (so a flaky network won't flip the timestamp around).

    Allowed only when:
    - Caller is the buyer of the transaction
    - Status is delivery_in_progress (we're at the door)
    """
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.buyer_id != current_user.user_id:
        raise HTTPException(403, {"error": "NOT_YOUR_TRANSACTION"})
    if txn.status != "delivery_in_progress":
        raise HTTPException(400, {
            "error": "WRONG_STATUS",
            "message": "Inspection confirm is only valid during delivery.",
        })
    if txn.condition_confirmed_at is None:
        from datetime import datetime, timezone
        txn.condition_confirmed_at = datetime.now(timezone.utc)
        await db.commit()
    return {
        "status": "ok",
        "condition_confirmed_at": txn.condition_confirmed_at.isoformat()
                                  if txn.condition_confirmed_at else None,
    }


@router.post("/v1/transactions/{transaction_id}/return")
async def buyer_request_return(
    transaction_id: UUID, body: _RequestReturnRequest,
    current_user: VerifiedUser, db: DBSession,
):
    """Buyer initiates a return. KYC-gated (VerifiedUser) per Sprint 6
    brief — refund/return/dispute are the only things that need KYC."""
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    try:
        await return_service.request_return(
            db, txn, current_user.user_id,
            reason=body.reason, description=body.description,
        )
        # P0.4 — persist evidence photos verbatim until presigned-URL flow
        # for returns ships. Mirrors disputes.photo_keys.
        if body.photo_uris:
            txn.return_photo_keys = body.photo_uris
        await db.commit()
    except ValueError as e:
        code = str(e)
        msgs = {
            "NOT_YOUR_TRANSACTION": "This isn't your order.",
            "RETURN_ALREADY_OPEN": "A return request is already open on this order.",
            "RETURN_WINDOW_EXPIRED": "Returns can only be requested within 7 days of delivery.",
        }
        msg = msgs.get(code.split(":")[0], code)
        raise HTTPException(400, {"error": code.split(":")[0], "message": msg})
    return _fmt_logistics(txn)


@router.get("/v1/admin/logistics/returns", dependencies=[Depends(require_admin)])
async def admin_returns_queue(db: DBSession):
    rows = (await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(Transaction.return_status.in_(["requested", "approved", "pickup_scheduled"]))
        .order_by(Transaction.return_requested_at.desc())
    )).all()
    out = []
    for t, title in rows:
        d = _fmt_logistics(t, title)
        d["return_status"] = t.return_status
        d["return_reason"] = t.return_reason
        d["return_description"] = t.return_description
        d["return_requested_at"] = t.return_requested_at.isoformat() if t.return_requested_at else None
        d["return_pickup_fe_id"] = str(t.return_pickup_fe_id) if t.return_pickup_fe_id else None
        out.append(d)
    return {"returns": out}


@router.post(
    "/v1/admin/logistics/returns/{transaction_id}/approve",
    dependencies=[Depends(require_admin)],
)
async def admin_approve_return(
    transaction_id: UUID, body: _AdminReturnDecisionRequest, db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    try:
        # admin_id is unknown at this stub-auth layer — pass the seller_id
        # as a placeholder so the audit trail isn't NULL. Real admin id
        # plumbs in when require_admin is wired to admin_users.
        await return_service.admin_approve_return(db, txn, admin_id=txn.seller_id, note=body.note)
        await db.commit()
    except ValueError as e:
        raise HTTPException(400, {"error": str(e)})
    return _fmt_logistics(txn)


@router.post(
    "/v1/admin/logistics/returns/{transaction_id}/reject",
    dependencies=[Depends(require_admin)],
)
async def admin_reject_return(
    transaction_id: UUID, body: _AdminReturnDecisionRequest, db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    try:
        await return_service.admin_reject_return(db, txn, admin_id=txn.seller_id, note=body.note)
        await db.commit()
    except ValueError as e:
        raise HTTPException(400, {"error": str(e)})
    return _fmt_logistics(txn)


@router.post(
    "/v1/admin/logistics/returns/{transaction_id}/assign-pickup",
    dependencies=[Depends(require_admin)],
)
async def admin_assign_return_pickup(
    transaction_id: UUID, body: _AdminAssignReturnPickupRequest, db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    try:
        await return_service.admin_assign_return_pickup(
            db, txn, admin_id=txn.seller_id, fe_user_id=body.fe_user_id,
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(400, {"error": str(e)})
    return _fmt_logistics(txn)


# ── FE: return pickups ────────────────────────────────────────────────────────

@router.get("/v1/fe/return-pickups")
async def fe_my_return_pickups(current_user: FeUser, db: DBSession):
    rows = await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(and_(
            Transaction.return_pickup_fe_id == current_user.user_id,
            Transaction.return_status == "pickup_scheduled",
        ))
        .order_by(Transaction.return_decision_at.asc())
    )
    return {"return_pickups": [_fmt_logistics(t, title) for t, title in rows.all()]}


@router.post("/v1/fe/return-pickups/{transaction_id}/complete")
async def fe_complete_return_pickup(
    transaction_id: UUID, current_user: FeUser, db: DBSession,
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    try:
        await return_service.fe_complete_return_pickup(db, txn, fe_user_id=current_user.user_id)
        await db.commit()
    except ValueError as e:
        raise HTTPException(400, {"error": str(e)})
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
    """List my active deliveries.

    P0 launch-fix: enrich each row with the buyer's default-address
    full_name + phone_number + order_notes so the FE delivery agent
    knows whose name is on the package and any gate/parking notes
    before they ring the bell. Pulled from user_addresses (the
    buyer's default row) to avoid a redundant snapshot.
    """
    from app.modules.identity_auth.models import UserAddress

    rows = await db.execute(
        select(Transaction, Listing.title, UserAddress)
        .join(Listing, Listing.id == Transaction.listing_id)
        .outerjoin(
            UserAddress,
            and_(
                UserAddress.user_id == Transaction.buyer_id,
                UserAddress.is_default == True,  # noqa: E712
            ),
        )
        .where(and_(
            Transaction.delivery_fe_id == current_user.user_id,
            Transaction.status == DELIVERY_IN_PROGRESS,
        ))
        .order_by(Transaction.routed_at.asc())
    )
    out: list[dict] = []
    for txn, title, addr in rows.all():
        d = _fmt_logistics(txn, title)
        d["buyer_name"] = addr.full_name if addr else None
        d["buyer_phone"] = addr.phone_number if addr else None
        d["order_notes"] = txn.order_notes
        out.append(d)
    return {"deliveries": out}


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
    # Return-window eligibility: only buyers, only delivered/completed
    # transactions inside the 7-day window with no return already open.
    return_eligible = (
        txn.buyer_id == current_user.user_id
        and txn.status in ("delivered", "completed")
        and txn.return_status in ("none", "rejected")
        and txn.delivered_at is not None
        and (datetime.now(timezone.utc) - txn.delivered_at).days <= 7
    )

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
        # Refund visibility — the buyer wants to know "did the money come
        # back" during pickup-rejected / dispute resolution flows.
        "refund_status": txn.refund_status,
        "refund_amount": str(txn.refund_amount) if txn.refund_amount else None,
        "refund_reason": txn.refund_reason,
        "refund_completed_at": txn.refund_completed_at.isoformat() if txn.refund_completed_at else None,
        # Return flow visibility
        "return_eligible": return_eligible,
        "return_status": txn.return_status,
        "return_reason": txn.return_reason,
        "return_decision_note": txn.return_decision_note,
        "return_requested_at": txn.return_requested_at.isoformat() if txn.return_requested_at else None,
    }
