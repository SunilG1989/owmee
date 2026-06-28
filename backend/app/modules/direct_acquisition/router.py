from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID
import uuid

import structlog
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.admin_dependencies import AdminAny, AdminFinance, AdminL2
from app.core.dependencies import BasicUser, DBSession
from app.core.fe_dependencies import FEUser
from app.core.storage import generate_presigned_upload_url
from app.modules.direct_acquisition.models import (
    AcquisitionItem,
    DirectAcquisitionBooking,
    PriceOverrideApproval,
    SellerAccountLedgerEntry,
)
from app.modules.direct_acquisition import service as direct_service
from app.modules.field_executive.models import FieldExecutive
from app.modules.identity_auth.models import UserAddress

logger = structlog.get_logger()


seller_router = APIRouter()
fe_router = APIRouter()
ops_router = APIRouter()
admin_router = APIRouter()


class AcquisitionItemInput(BaseModel):
    category: str = Field(..., min_length=3, max_length=24)
    item_type: str = Field(..., min_length=2, max_length=120)
    item_title: str = Field(..., min_length=3, max_length=200)
    seller_photos: list[str] = Field(..., min_length=1, max_length=10)
    seller_check_answers: dict[str, Any] = Field(default_factory=dict)
    ai_detected_type: str = Field(..., min_length=2, max_length=120)
    policy_status: str = Field("allowed", max_length=32)
    direct_eligibility_status: str = Field("eligible", max_length=32)
    owmee_suggested_offer_inr: int = Field(..., gt=0, le=200000)
    offer_valid_until: Optional[datetime] = None
    max_fe_auto_increase_allowed: Decimal = Field(Decimal("10.00"), ge=0, le=100)
    qc_checklist_template_id: str = Field(..., min_length=2, max_length=80)
    required_pickup_photos: list[str] = Field(default_factory=list)
    blocked_item_warnings: list[str] = Field(default_factory=list)

    @field_validator("category")
    @classmethod
    def _category(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in direct_service.SUPPORTED_DIRECT_CATEGORIES:
            raise ValueError("Owmee Direct MVP supports only toys and books.")
        return normalized


class CreateBookingRequest(BaseModel):
    pickup_address_id: UUID
    slot_start: datetime
    slot_end: datetime
    seller_ownership_declaration: bool
    estimated_visit_duration_minutes: int = Field(30, ge=15, le=180)
    assignment_priority: Optional[str] = Field(None, max_length=32)
    items: list[AcquisitionItemInput] = Field(..., min_length=1, max_length=20)


class BookingCancelRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=64)


class AssignBookingRequest(BaseModel):
    fe_id: UUID
    assignment_method: str = Field("ops_manual", pattern="^(auto|ops_manual)$")


class VerifySellerOtpRequest(BaseModel):
    otp: str = Field(..., min_length=4, max_length=8)


class LocationPayload(BaseModel):
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    accuracy_meters: Optional[float] = Field(None, ge=0, le=10000)
    source: Optional[str] = Field(None, max_length=40)


class FeVisitCheckpointRequest(BaseModel):
    location: Optional[LocationPayload] = None


class ItemPhotosRequest(BaseModel):
    photo_keys: list[str] = Field(..., min_length=1, max_length=10)


class DirectImageUploadRequest(BaseModel):
    content_type: str = Field("image/jpeg", pattern="^image/(jpeg|png|webp)$")


class ItemQcRequest(BaseModel):
    qc_answers: dict[str, Any] = Field(default_factory=dict)
    qc_notes: Optional[str] = Field(None, max_length=1000)
    pickup_photos: list[str] = Field(default_factory=list, max_length=10)


class ReviseOfferRequest(BaseModel):
    revised_offer_inr: int = Field(..., gt=0, le=200000)
    reason_code: str = Field(..., min_length=2, max_length=80)
    evidence_photos: list[str] = Field(default_factory=list, max_length=10)


class RejectItemRequest(BaseModel):
    reason_code: str = Field(..., min_length=2, max_length=80)
    notes: Optional[str] = Field(None, max_length=1000)
    evidence_photos: list[str] = Field(default_factory=list, max_length=10)


class SellerFinalAcceptanceRequest(BaseModel):
    accepted: bool = True
    method: str = Field("otp", pattern="^(seller_app|otp)$")
    otp: Optional[str] = Field(None, min_length=4, max_length=8)
    location: Optional[LocationPayload] = None


class ApprovalDecisionRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=1000)


class PayoutDecisionRequest(BaseModel):
    success: bool = True
    reference_id: Optional[str] = Field(None, max_length=100)
    failure_reason: Optional[str] = Field(None, max_length=1000)


class WarehouseReceiveRequest(BaseModel):
    receipt_code: Optional[str] = Field(None, max_length=80)
    notes: Optional[str] = Field(None, max_length=1000)


class ListingApprovalDecisionRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=1000)
    sale_price_inr: Optional[int] = Field(None, gt=0, le=500000)


def _raise(err: direct_service.DirectAcquisitionError) -> None:
    status_code = status.HTTP_409_CONFLICT
    if err.code in {"NOT_YOUR_BOOKING", "NOT_YOUR_ITEM"}:
        status_code = status.HTTP_403_FORBIDDEN
    if err.code in {
        "INVALID_BASE_OFFER",
        "INVALID_PAYOUT_AMOUNT",
        "BOOKING_NOT_ASSIGNABLE",
        "EVIDENCE_PHOTO_REQUIRED",
        "PICKUP_PHOTOS_REQUIRED",
        "FINAL_ACCEPTANCE_NOT_READY",
    }:
        status_code = status.HTTP_400_BAD_REQUEST
    raise HTTPException(status_code, {"error": err.code, "message": err.message})


def _location_dict(location: LocationPayload | None) -> dict:
    if location is None:
        return {}
    return location.model_dump(exclude_none=True)


async def _address_snapshot(db, address_id: UUID, owner_user_id: UUID) -> dict:
    res = await db.execute(
        select(UserAddress).where(UserAddress.id == address_id, UserAddress.user_id == owner_user_id)
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, {"error": "ADDRESS_NOT_FOUND"})
    return {
        "address_id": str(row.id),
        "label": row.label,
        "custom_label": row.custom_label,
        "lat": float(row.lat),
        "lng": float(row.lng),
        "flat_house_number": row.flat_house_number,
        "building_name": row.building_name,
        "floor": row.floor,
        "address_line_1": row.address_line_1,
        "house": row.flat_house_number,
        "street": row.address_line_1,
        "landmark": row.landmark,
        "locality": row.locality,
        "city": row.city,
        "state": row.state,
        "pincode": row.pincode,
    }


async def _load_booking(db, booking_id: UUID) -> DirectAcquisitionBooking:
    res = await db.execute(
        select(DirectAcquisitionBooking)
        .options(selectinload(DirectAcquisitionBooking.items))
        .where(DirectAcquisitionBooking.id == booking_id)
    )
    booking = res.scalar_one_or_none()
    if booking is None:
        raise HTTPException(404, {"error": "BOOKING_NOT_FOUND"})
    return booking


async def _load_item(db, booking_id: UUID, item_id: UUID) -> AcquisitionItem:
    res = await db.execute(
        select(AcquisitionItem).where(
            AcquisitionItem.booking_id == booking_id,
            AcquisitionItem.id == item_id,
        )
    )
    item = res.scalar_one_or_none()
    if item is None:
        raise HTTPException(404, {"error": "ITEM_NOT_FOUND"})
    return item


async def _current_fe(db, current_user: FEUser) -> FieldExecutive:
    res = await db.execute(
        select(FieldExecutive).where(
            FieldExecutive.user_id == current_user.user_id,
            FieldExecutive.active.is_(True),
        )
    )
    fe = res.scalar_one_or_none()
    if fe is None:
        raise HTTPException(403, {"error": "FE_PROFILE_REQUIRED"})
    return fe


def _item_dict(item: AcquisitionItem) -> dict:
    return {
        "id": str(item.id),
        "category": item.category,
        "item_type": item.item_type,
        "item_title": item.item_title,
        "seller_photos": item.seller_photos or [],
        "pickup_photos": item.pickup_photos or [],
        "seller_check_answers": item.seller_check_answers or {},
        "ai_detected_type": item.ai_detected_type,
        "policy_status": item.policy_status,
        "direct_eligibility_status": item.direct_eligibility_status,
        "blocked_item_warnings": item.blocked_item_warnings or [],
        "qc_checklist_template_id": item.qc_checklist_template_id,
        "required_pickup_photos": item.required_pickup_photos or [],
        "owmee_suggested_offer_inr": item.owmee_suggested_offer_inr,
        "fe_final_offer_inr": item.fe_final_offer_inr,
        "price_change_percent": float(item.price_change_percent) if item.price_change_percent is not None else None,
        "price_change_reason_code": item.price_change_reason_code,
        "approval_required": item.approval_required,
        "approval_status": item.approval_status,
        "qc_status": item.qc_status,
        "qc_answers": item.qc_answers or {},
        "qc_evidence_manifest": getattr(item, "qc_evidence_manifest", None) or {},
        "qc_notes": item.qc_notes,
        "reject_evidence_photos": getattr(item, "reject_evidence_photos", None) or [],
        "custody_seal_code": getattr(item, "custody_seal_code", None),
        "warehouse_status": getattr(item, "warehouse_status", None) or "pending",
        "warehouse_notes": getattr(item, "warehouse_notes", None),
        "item_status": item.item_status,
    }


async def _approval_dict(db, approval: PriceOverrideApproval) -> dict:
    item = await db.get(AcquisitionItem, approval.acquisition_item_id)
    booking = await db.get(DirectAcquisitionBooking, approval.booking_id)
    return {
        "id": str(approval.id),
        "booking_id": str(approval.booking_id),
        "booking_code": booking.booking_code if booking else None,
        "acquisition_item_id": str(approval.acquisition_item_id),
        "requested_by_fe_id": str(approval.requested_by_fe_id),
        "base_offer_inr": approval.base_offer_inr,
        "requested_offer_inr": approval.requested_offer_inr,
        "change_percent": float(approval.change_percent),
        "reason_code": approval.reason_code,
        "evidence_photos": approval.evidence_photos or [],
        "status": approval.status,
        "item": _item_dict(item) if item else None,
        "created_at": approval.created_at.isoformat() if approval.created_at else None,
        "resolved_at": approval.resolved_at.isoformat() if approval.resolved_at else None,
    }


async def _fe_code(db, fe_id: UUID | None) -> str | None:
    if not fe_id:
        return None
    res = await db.execute(select(FieldExecutive.fe_code).where(FieldExecutive.id == fe_id))
    return res.scalar_one_or_none()


async def _booking_dict(
    db,
    booking: DirectAcquisitionBooking,
    *,
    seller_otp: str | None = None,
    final_acceptance_otp: str | None = None,
) -> dict:
    return {
        "id": str(booking.id),
        "booking_code": booking.booking_code,
        "seller_user_id": str(booking.seller_user_id),
        "seller_account_id": str(booking.seller_account_id),
        "pickup_address_id": str(booking.pickup_address_id),
        "pickup_address": booking.pickup_address_snapshot or {},
        "pickup_locality": booking.pickup_locality,
        "pickup_pincode": booking.pickup_pincode,
        "slot_start": booking.slot_start.isoformat(),
        "slot_end": booking.slot_end.isoformat(),
        "status": booking.status,
        "assigned_fe_id": str(booking.assigned_fe_id) if booking.assigned_fe_id else None,
        "fe_code": await _fe_code(db, booking.assigned_fe_id),
        "assignment_method": booking.assignment_method,
        "item_count": booking.item_count,
        "estimated_total_offer_inr": booking.estimated_total_offer_inr,
        "final_total_payout_inr": booking.final_total_payout_inr,
        "fe_started_at": booking.fe_started_at.isoformat() if getattr(booking, "fe_started_at", None) else None,
        "fe_arrived_at": booking.fe_arrived_at.isoformat() if getattr(booking, "fe_arrived_at", None) else None,
        "fe_start_location": getattr(booking, "fe_start_location", None) or {},
        "fe_arrival_location": getattr(booking, "fe_arrival_location", None) or {},
        "seller_verified_location": getattr(booking, "seller_verified_location", None) or {},
        "seller_final_acceptance_location": getattr(booking, "seller_final_acceptance_location", None) or {},
        "verified_at": booking.verified_at.isoformat() if booking.verified_at else None,
        "seller_final_accepted_at": booking.seller_final_accepted_at.isoformat() if booking.seller_final_accepted_at else None,
        "payout_ready_at": booking.payout_ready_at.isoformat() if getattr(booking, "payout_ready_at", None) else None,
        "payout_status": getattr(booking, "payout_status", None) or "not_started",
        "payout_reference_id": getattr(booking, "payout_reference_id", None),
        "payout_failure_reason": getattr(booking, "payout_failure_reason", None),
        "payout_completed_at": booking.payout_completed_at.isoformat() if booking.payout_completed_at else None,
        "handover_completed_at": booking.handover_completed_at.isoformat() if booking.handover_completed_at else None,
        "warehouse_inbound_id": booking.warehouse_inbound_id,
        "warehouse_received_at": booking.warehouse_received_at.isoformat() if getattr(booking, "warehouse_received_at", None) else None,
        "warehouse_receipt_code": getattr(booking, "warehouse_receipt_code", None),
        "warehouse_receipt_notes": getattr(booking, "warehouse_receipt_notes", None),
        "risk_flags": getattr(booking, "risk_flags", None) or [],
        "seller_otp": seller_otp,
        "final_acceptance_otp": final_acceptance_otp,
        "items": [_item_dict(item) for item in booking.items],
        "created_at": booking.created_at.isoformat() if booking.created_at else None,
        "updated_at": booking.updated_at.isoformat() if booking.updated_at else None,
    }


@seller_router.get("/pickup-slots")
async def pickup_slots(address_id: UUID, current_user: BasicUser, db: DBSession):
    await _address_snapshot(db, address_id, current_user.user_id)
    now = datetime.now(timezone.utc)
    slots = []
    for day in range(0, 5):
        for hour in (10, 12, 14, 16):
            start = now.replace(hour=hour, minute=0, second=0, microsecond=0) + timedelta(days=day)
            if start <= now + timedelta(hours=1):
                continue
            end = start + timedelta(hours=2)
            slots.append({
                "slot_start": start.isoformat(),
                "slot_end": end.isoformat(),
                "available": True,
            })
    return {"address_id": str(address_id), "slots": slots[:16]}


@seller_router.post("/bookings", status_code=201)
async def create_booking(body: CreateBookingRequest, current_user: BasicUser, db: DBSession):
    if body.slot_end <= body.slot_start:
        raise HTTPException(400, {"error": "INVALID_SLOT"})
    if body.slot_start < datetime.now(timezone.utc) - timedelta(minutes=30):
        raise HTTPException(400, {"error": "SLOT_IN_PAST"})
    if not body.seller_ownership_declaration:
        raise HTTPException(400, {"error": "OWNERSHIP_DECLARATION_REQUIRED"})

    snapshot = await _address_snapshot(db, body.pickup_address_id, current_user.user_id)
    seller_otp = direct_service.new_seller_otp()
    final_acceptance_otp = direct_service.new_seller_otp()
    otp_expiry = direct_service.otp_expires_at(body.slot_end)
    booking = DirectAcquisitionBooking(
        booking_code=direct_service.new_booking_code(),
        seller_user_id=current_user.user_id,
        seller_account_id=current_user.user_id,
        pickup_address_id=body.pickup_address_id,
        pickup_address_snapshot=snapshot,
        pickup_locality=snapshot.get("locality") or snapshot.get("city") or "Unknown",
        pickup_pincode=snapshot.get("pincode") or "000000",
        slot_start=body.slot_start,
        slot_end=body.slot_end,
        status="pending_fe_assignment",
        seller_otp_hash=direct_service.hash_otp(seller_otp),
        arrival_otp_expires_at=otp_expiry,
        arrival_otp_attempts=0,
        final_acceptance_otp_hash=direct_service.hash_otp(final_acceptance_otp),
        final_acceptance_otp_expires_at=otp_expiry,
        final_acceptance_otp_attempts=0,
        seller_phone_verified=bool(current_user.phone_verified),
        seller_ownership_declaration=True,
        serviceable_area=True,
        estimated_visit_duration_minutes=body.estimated_visit_duration_minutes,
        assignment_priority=body.assignment_priority,
        item_count=len(body.items),
        estimated_total_offer_inr=sum(i.owmee_suggested_offer_inr for i in body.items),
        payout_status="not_started",
        risk_flags=[],
    )
    for item_in in body.items:
        booking.items.append(AcquisitionItem(
            category=item_in.category,
            item_type=item_in.item_type,
            item_title=item_in.item_title,
            seller_photos=item_in.seller_photos,
            seller_check_answers=item_in.seller_check_answers,
            ai_detected_type=item_in.ai_detected_type,
            policy_status=item_in.policy_status,
            direct_eligibility_status=item_in.direct_eligibility_status,
            blocked_item_warnings=item_in.blocked_item_warnings,
            qc_checklist_template_id=item_in.qc_checklist_template_id,
            required_pickup_photos=item_in.required_pickup_photos,
            owmee_suggested_offer_inr=item_in.owmee_suggested_offer_inr,
            offer_valid_until=item_in.offer_valid_until or direct_service.default_offer_valid_until(),
            max_fe_auto_increase_allowed=item_in.max_fe_auto_increase_allowed,
        ))
    db.add(booking)
    await db.flush()
    try:
        direct_service.assert_booking_assignable(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    await db.commit()
    await db.refresh(booking)
    booking = await _load_booking(db, booking.id)
    logger.info("direct.booking.created", booking_id=str(booking.id), seller_id=str(current_user.user_id))
    return await _booking_dict(db, booking, seller_otp=seller_otp, final_acceptance_otp=final_acceptance_otp)


@seller_router.get("/bookings/{booking_id}")
async def get_my_booking(booking_id: UUID, current_user: BasicUser, db: DBSession):
    booking = await _load_booking(db, booking_id)
    if booking.seller_user_id != current_user.user_id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    return await _booking_dict(db, booking)


@seller_router.post("/bookings/{booking_id}/verification-codes")
async def refresh_my_booking_codes(booking_id: UUID, current_user: BasicUser, db: DBSession):
    booking = await _load_booking(db, booking_id)
    if booking.seller_user_id != current_user.user_id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    if booking.status in direct_service.BOOKING_TERMINAL_STATUSES or booking.status in {"seller_final_acceptance", "payout_ready", "payout_completed"}:
        raise HTTPException(409, {"error": "CANNOT_REFRESH_CODES"})
    seller_otp = direct_service.new_seller_otp()
    final_acceptance_otp = direct_service.new_seller_otp()
    expiry = direct_service.otp_expires_at(booking.slot_end)
    booking.seller_otp_hash = direct_service.hash_otp(seller_otp)
    booking.arrival_otp_expires_at = expiry
    booking.arrival_otp_attempts = 0
    booking.final_acceptance_otp_hash = direct_service.hash_otp(final_acceptance_otp)
    booking.final_acceptance_otp_expires_at = expiry
    booking.final_acceptance_otp_attempts = 0
    await db.commit()
    return await _booking_dict(db, booking, seller_otp=seller_otp, final_acceptance_otp=final_acceptance_otp)


@seller_router.post("/bookings/{booking_id}/cancel")
async def cancel_my_booking(booking_id: UUID, body: BookingCancelRequest, current_user: BasicUser, db: DBSession):
    booking = await _load_booking(db, booking_id)
    if booking.seller_user_id != current_user.user_id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    if booking.status not in {"pending_fe_assignment", "assigned_to_fe", "fe_en_route", "fe_arrived"}:
        raise HTTPException(409, {"error": "CANNOT_CANCEL_BOOKING"})
    booking.status = "seller_cancelled_before_visit"
    booking.cancellation_reason = body.reason
    await db.commit()
    return await _booking_dict(db, booking)


@ops_router.get("/bookings")
async def ops_bookings(current_admin: AdminAny, db: DBSession, status_filter: str | None = Query(None, alias="status")):
    q = select(DirectAcquisitionBooking).options(selectinload(DirectAcquisitionBooking.items)).order_by(DirectAcquisitionBooking.created_at.desc()).limit(100)
    if status_filter:
        q = q.where(DirectAcquisitionBooking.status == status_filter)
    rows = (await db.execute(q)).scalars().all()
    return {"bookings": [await _booking_dict(db, row) for row in rows]}


@ops_router.post("/bookings/{booking_id}/assign-fe")
async def assign_fe(booking_id: UUID, body: AssignBookingRequest, current_admin: AdminAny, db: DBSession):
    booking = await _load_booking(db, booking_id)
    try:
        direct_service.assert_booking_assignable(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    fe = await db.get(FieldExecutive, body.fe_id)
    if fe is None or not fe.active:
        raise HTTPException(404, {"error": "FE_NOT_FOUND"})
    if booking.status not in {"pending_fe_assignment", "assigned_to_fe"}:
        raise HTTPException(409, {"error": "BOOKING_NOT_ASSIGNABLE_STATE"})
    booking.assigned_fe_id = fe.id
    booking.assignment_method = body.assignment_method
    booking.status = "assigned_to_fe"
    await db.commit()
    await db.refresh(booking)
    logger.info("direct.booking.assigned", booking_id=str(booking.id), fe_id=str(fe.id), admin_id=str(current_admin.admin_id))
    return await _booking_dict(db, await _load_booking(db, booking.id))


@fe_router.get("/bookings")
async def fe_bookings(current_user: FEUser, db: DBSession, date: str | None = None, status_filter: str | None = Query(None, alias="status")):
    fe = await _current_fe(db, current_user)
    statuses = {status_filter} if status_filter else {
        "assigned_to_fe",
        "fe_en_route",
        "fe_arrived",
        "seller_verified",
        "pickup_qc_in_progress",
        "seller_final_acceptance",
        "payout_ready",
        "payout_completed",
    }
    rows = (await db.execute(
        select(DirectAcquisitionBooking)
        .options(selectinload(DirectAcquisitionBooking.items))
        .where(DirectAcquisitionBooking.assigned_fe_id == fe.id, DirectAcquisitionBooking.status.in_(statuses))
        .order_by(DirectAcquisitionBooking.slot_start.asc())
    )).scalars().all()
    return {"bookings": [await _booking_dict(db, row) for row in rows]}


@fe_router.get("/bookings/{booking_id}")
async def fe_booking_detail(booking_id: UUID, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    return await _booking_dict(db, booking)


@fe_router.post("/bookings/{booking_id}/start")
async def fe_start_booking(
    booking_id: UUID,
    current_user: FEUser,
    db: DBSession,
    body: FeVisitCheckpointRequest | None = None,
):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    try:
        direct_service.assert_can_start_booking(booking, fe.id)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    booking.status = "fe_en_route"
    booking.fe_started_at = datetime.now(timezone.utc)
    booking.fe_start_location = _location_dict(body.location if body else None)
    await db.commit()
    return await _booking_dict(db, booking)


@fe_router.post("/bookings/{booking_id}/arrive")
async def fe_arrive_booking(
    booking_id: UUID,
    current_user: FEUser,
    db: DBSession,
    body: FeVisitCheckpointRequest | None = None,
):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    if booking.status not in {"fe_en_route", "assigned_to_fe"}:
        raise HTTPException(409, {"error": "BOOKING_NOT_EN_ROUTE"})
    if booking.status == "assigned_to_fe":
        booking.fe_started_at = booking.fe_started_at or datetime.now(timezone.utc)
    booking.status = "fe_arrived"
    booking.fe_arrived_at = datetime.now(timezone.utc)
    booking.fe_arrival_location = _location_dict(body.location if body else None)
    await db.commit()
    return await _booking_dict(db, booking)


@fe_router.post("/bookings/{booking_id}/verify-seller-otp")
async def fe_verify_seller_otp(booking_id: UUID, body: VerifySellerOtpRequest, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    if booking.status != "fe_arrived":
        raise HTTPException(409, {"error": "BOOKING_NOT_AT_DOOR"})
    try:
        direct_service.assert_otp_attempt_allowed(
            attempts=getattr(booking, "arrival_otp_attempts", 0) or 0,
            expires_at=getattr(booking, "arrival_otp_expires_at", None),
            purpose="Arrival",
        )
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    if not direct_service.verify_otp(body.otp, booking.seller_otp_hash):
        booking.arrival_otp_attempts = (getattr(booking, "arrival_otp_attempts", 0) or 0) + 1
        await db.commit()
        raise HTTPException(400, {"error": "INVALID_SELLER_OTP"})
    booking.status = "seller_verified"
    booking.verified_at = datetime.now(timezone.utc)
    booking.seller_verified_location = getattr(booking, "fe_arrival_location", None) or {}
    await db.commit()
    return await _booking_dict(db, booking)


@fe_router.post("/bookings/{booking_id}/items/{item_id}/photos")
async def fe_item_photos(booking_id: UUID, item_id: UUID, body: ItemPhotosRequest, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    try:
        direct_service.assert_seller_verified(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    item = await _load_item(db, booking_id, item_id)
    item.pickup_photos = list(dict.fromkeys([*(item.pickup_photos or []), *body.photo_keys]))
    item.qc_evidence_manifest = {
        **(getattr(item, "qc_evidence_manifest", None) or {}),
        "pickup_photo_count": len(item.pickup_photos or []),
        "required_photo_count": len(item.required_pickup_photos or []),
        "last_added_count": len(body.photo_keys),
    }
    booking.status = "pickup_qc_in_progress"
    await db.commit()
    return {"item": _item_dict(item)}


@fe_router.post("/bookings/{booking_id}/items/{item_id}/photos/request")
async def fe_item_photo_upload_request(
    booking_id: UUID,
    item_id: UUID,
    body: DirectImageUploadRequest,
    current_user: FEUser,
    db: DBSession,
):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    try:
        direct_service.assert_seller_verified(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    await _load_item(db, booking_id, item_id)
    ext = "jpg"
    if body.content_type == "image/png":
        ext = "png"
    elif body.content_type == "image/webp":
        ext = "webp"
    r2_key = f"direct-acquisition/{booking_id}/{item_id}/{uuid.uuid4()}.{ext}"
    upload_url = generate_presigned_upload_url(r2_key, content_type=body.content_type, expires_in=300)
    return {"upload_url": upload_url, "r2_key": r2_key, "expires_in_seconds": 300}


@fe_router.post("/bookings/{booking_id}/items/{item_id}/qc")
async def fe_item_qc(booking_id: UUID, item_id: UUID, body: ItemQcRequest, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    item = await _load_item(db, booking_id, item_id)
    try:
        direct_service.assert_item_can_be_qced(booking, item)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    item.qc_status = "passed"
    item.item_status = "qc_passed"
    item.fe_final_offer_inr = item.fe_final_offer_inr or item.owmee_suggested_offer_inr
    item.qc_answers = body.qc_answers
    item.qc_notes = body.qc_notes
    item.pickup_photos = list(dict.fromkeys([*(item.pickup_photos or []), *body.pickup_photos]))
    try:
        direct_service.assert_required_pickup_evidence(item)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    item.qc_evidence_manifest = {
        **(getattr(item, "qc_evidence_manifest", None) or {}),
        "accepted_by_fe": True,
        "pickup_photo_count": len(item.pickup_photos or []),
        "required_photo_count": len(item.required_pickup_photos or []),
        "qc_answer_keys": sorted((item.qc_answers or {}).keys()),
    }
    booking.status = "pickup_qc_in_progress"
    await db.commit()
    return {"item": _item_dict(item)}


@fe_router.post("/bookings/{booking_id}/items/{item_id}/revise-offer")
async def fe_revise_offer(booking_id: UUID, item_id: UUID, body: ReviseOfferRequest, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    item = await _load_item(db, booking_id, item_id)
    try:
        direct_service.assert_item_can_be_qced(booking, item)
        change = direct_service.compute_change_percent(item.owmee_suggested_offer_inr, body.revised_offer_inr)
        direct_service.assert_price_revision_evidence(body.evidence_photos)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    item.fe_final_offer_inr = body.revised_offer_inr
    item.price_change_percent = change
    item.price_change_reason_code = body.reason_code
    item.price_change_evidence_photos = body.evidence_photos
    item.pickup_photos = list(dict.fromkeys([*(item.pickup_photos or []), *body.evidence_photos]))
    if direct_service.requires_price_approval(
        base_offer_inr=item.owmee_suggested_offer_inr,
        requested_offer_inr=body.revised_offer_inr,
        max_auto_increase_percent=item.max_fe_auto_increase_allowed,
    ):
        item.approval_required = True
        item.approval_status = "pending"
        item.qc_status = "review_required"
        item.item_status = "approval_pending"
        db.add(PriceOverrideApproval(
            booking_id=booking.id,
            acquisition_item_id=item.id,
            requested_by_fe_id=fe.id,
            base_offer_inr=item.owmee_suggested_offer_inr,
            requested_offer_inr=body.revised_offer_inr,
            change_percent=change,
            reason_code=body.reason_code,
            evidence_photos=body.evidence_photos,
        ))
    else:
        item.approval_required = False
        item.approval_status = "not_required"
        item.qc_status = "passed"
        item.item_status = "qc_revised"
    booking.status = "pickup_qc_in_progress"
    await db.commit()
    return {"item": _item_dict(item)}


@fe_router.post("/bookings/{booking_id}/items/{item_id}/reject")
async def fe_reject_item(booking_id: UUID, item_id: UUID, body: RejectItemRequest, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    item = await _load_item(db, booking_id, item_id)
    try:
        direct_service.assert_item_can_be_qced(booking, item)
        direct_service.assert_reject_evidence(body.evidence_photos, item)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    item.qc_status = "rejected"
    item.item_status = "rejected"
    item.price_change_reason_code = body.reason_code
    item.qc_notes = body.notes
    item.reject_evidence_photos = list(dict.fromkeys([*(getattr(item, "reject_evidence_photos", None) or []), *body.evidence_photos]))
    item.pickup_photos = list(dict.fromkeys([*(item.pickup_photos or []), *body.evidence_photos]))
    item.qc_evidence_manifest = {
        **(getattr(item, "qc_evidence_manifest", None) or {}),
        "rejected_by_fe": True,
        "reject_reason_code": body.reason_code,
        "pickup_photo_count": len(item.pickup_photos or []),
    }
    if all(i.item_status == "rejected" for i in booking.items):
        booking.status = "item_rejected_by_fe"
    else:
        booking.status = "pickup_qc_in_progress"
    await db.commit()
    return await _booking_dict(db, booking)


@fe_router.post("/bookings/{booking_id}/seller-final-acceptance")
async def seller_final_acceptance(booking_id: UUID, body: SellerFinalAcceptanceRequest, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    if not body.accepted:
        booking.status = "seller_rejected_revised_offer"
        await db.commit()
        return await _booking_dict(db, booking)
    if body.method == "seller_app":
        raise HTTPException(400, {"error": "SELLER_APP_CONFIRMATION_REQUIRES_SELLER_SESSION"})
    final_hash = getattr(booking, "final_acceptance_otp_hash", None) or booking.seller_otp_hash
    try:
        direct_service.assert_otp_attempt_allowed(
            attempts=getattr(booking, "final_acceptance_otp_attempts", 0) or 0,
            expires_at=getattr(booking, "final_acceptance_otp_expires_at", None),
            purpose="Final acceptance",
        )
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    if not body.otp or not direct_service.verify_otp(body.otp, final_hash):
        booking.final_acceptance_otp_attempts = (getattr(booking, "final_acceptance_otp_attempts", 0) or 0) + 1
        await db.commit()
        raise HTTPException(400, {"error": "INVALID_SELLER_FINAL_OTP"})
    try:
        direct_service.assert_final_acceptance_allowed(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    booking.final_total_payout_inr = direct_service.final_payout_total(booking.items)
    booking.seller_final_accepted_at = datetime.now(timezone.utc)
    booking.seller_final_acceptance_location = _location_dict(body.location) or getattr(booking, "seller_verified_location", None) or {}
    booking.payout_status = "not_started"
    booking.status = "seller_final_acceptance"
    await db.commit()
    return await _booking_dict(db, booking)


@fe_router.post("/bookings/{booking_id}/request-payout")
async def request_payout(booking_id: UUID, current_user: FEUser, db: DBSession):
    fe = await _current_fe(db, current_user)
    booking = await _load_booking(db, booking_id)
    if booking.assigned_fe_id != fe.id:
        raise HTTPException(403, {"error": "NOT_YOUR_BOOKING"})
    try:
        direct_service.assert_payout_request_allowed(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    now = datetime.now(timezone.utc)
    booking.status = "payout_ready"
    booking.payout_status = "ready_for_finance"
    booking.payout_ready_at = booking.payout_ready_at or now
    booking.payout_ready_by_fe_id = fe.id
    await db.commit()
    return await _booking_dict(db, booking)


@fe_router.post("/bookings/{booking_id}/trigger-payout")
async def trigger_payout(booking_id: UUID, current_user: FEUser, db: DBSession):
    # Backward-compatible route name for older FE builds. It no longer posts money.
    return await request_payout(booking_id, current_user, db)


@fe_router.post("/bookings/{booking_id}/complete-handover")
async def complete_handover(booking_id: UUID, current_user: FEUser, db: DBSession):
    await _current_fe(db, current_user)
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        {"error": "WAREHOUSE_RECEIPT_REQUIRED", "message": "Warehouse/Admin must receive inventory before completion."},
    )


@ops_router.post("/bookings/{booking_id}/process-payout")
async def process_payout(booking_id: UUID, body: PayoutDecisionRequest, current_admin: AdminFinance, db: DBSession):
    booking = await _load_booking(db, booking_id)
    try:
        direct_service.assert_payout_process_allowed(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    now = datetime.now(timezone.utc)
    booking.payout_processed_by_admin_id = current_admin.admin_id
    booking.payout_initiated_at = booking.payout_initiated_at or now
    if not body.success:
        booking.status = "payout_failed"
        booking.payout_status = "failed"
        booking.payout_failure_reason = body.failure_reason or "Finance marked payout as failed."
        await db.commit()
        return await _booking_dict(db, booking)
    existing = (await db.execute(
        select(SellerAccountLedgerEntry).where(SellerAccountLedgerEntry.booking_id == booking.id)
    )).scalar_one_or_none()
    reference_id = body.reference_id or f"DIRECT-{booking.booking_code}"
    if existing is None:
        db.add(SellerAccountLedgerEntry(
            seller_account_id=booking.seller_account_id,
            booking_id=booking.id,
            amount_inr=booking.final_total_payout_inr or 0,
            status="posted",
            reference_id=reference_id,
            posted_at=now,
        ))
    else:
        existing.status = "posted"
        existing.reference_id = existing.reference_id or reference_id
        existing.posted_at = existing.posted_at or now
    booking.status = "payout_completed"
    booking.payout_status = "posted"
    booking.payout_reference_id = reference_id
    booking.payout_completed_at = booking.payout_completed_at or now
    await db.commit()
    return await _booking_dict(db, booking)


@ops_router.post("/bookings/{booking_id}/warehouse-receive")
async def warehouse_receive(booking_id: UUID, body: WarehouseReceiveRequest, current_admin: AdminL2, db: DBSession):
    booking = await _load_booking(db, booking_id)
    try:
        direct_service.assert_warehouse_receive_allowed(booking)
    except direct_service.DirectAcquisitionError as err:
        _raise(err)
    now = datetime.now(timezone.utc)
    receipt_code = body.receipt_code or f"WIN-{booking.booking_code}"
    booking.handover_completed_at = booking.handover_completed_at or now
    booking.warehouse_inbound_id = booking.warehouse_inbound_id or receipt_code
    booking.warehouse_received_at = now
    booking.warehouse_received_by_admin_id = current_admin.admin_id
    booking.warehouse_receipt_code = receipt_code
    booking.warehouse_receipt_notes = body.notes
    booking.status = "booking_completed"
    booking.completed_at = now
    for item in booking.items:
        if item.item_status in {"qc_passed", "qc_revised"}:
            item.item_status = "warehouse_inbound"
            item.warehouse_status = "received"
            item.warehouse_notes = body.notes
            item.custody_seal_code = item.custody_seal_code or f"SEAL-{booking.booking_code}-{str(item.id)[:8]}"
    await db.commit()
    return await _booking_dict(db, booking)


@admin_router.get("/listing-approvals")
async def direct_listing_approvals(current_admin: AdminAny, db: DBSession, status_filter: str = Query("pending", alias="status")):
    item_status = "warehouse_inbound" if status_filter == "pending" else status_filter
    rows = (await db.execute(
        select(AcquisitionItem)
        .where(AcquisitionItem.item_status == item_status)
        .order_by(AcquisitionItem.created_at.asc())
        .limit(100)
    )).scalars().all()
    return {"items": [_item_dict(row) for row in rows]}


@admin_router.post("/listing-approvals/{item_id}/approve")
async def approve_direct_listing(item_id: UUID, body: ListingApprovalDecisionRequest, current_admin: AdminL2, db: DBSession):
    item = await db.get(AcquisitionItem, item_id)
    if item is None:
        raise HTTPException(404, {"error": "ITEM_NOT_FOUND"})
    if item.item_status != "warehouse_inbound":
        raise HTTPException(409, {"error": "ITEM_NOT_READY_FOR_ADMIN_APPROVAL"})
    item.item_status = "admin_approved"
    item.qc_notes = "\n".join(filter(None, [item.qc_notes, f"Admin approved: {body.note or ''}".strip()]))
    await db.commit()
    return {"item": _item_dict(item), "buyer_live_ready": bool(item.draft_listing_id)}


@admin_router.post("/listing-approvals/{item_id}/send-back")
async def send_back_direct_listing(item_id: UUID, body: ListingApprovalDecisionRequest, current_admin: AdminL2, db: DBSession):
    item = await db.get(AcquisitionItem, item_id)
    if item is None:
        raise HTTPException(404, {"error": "ITEM_NOT_FOUND"})
    if item.item_status not in {"warehouse_inbound", "admin_approved", "quarantined"}:
        raise HTTPException(409, {"error": "ITEM_NOT_IN_ADMIN_REVIEW"})
    item.item_status = "warehouse_rework_required"
    item.qc_notes = "\n".join(filter(None, [item.qc_notes, f"Admin send-back: {body.note or ''}".strip()]))
    await db.commit()
    return {"item": _item_dict(item)}


@admin_router.post("/listing-approvals/{item_id}/quarantine")
async def quarantine_direct_listing(item_id: UUID, body: ListingApprovalDecisionRequest, current_admin: AdminL2, db: DBSession):
    item = await db.get(AcquisitionItem, item_id)
    if item is None:
        raise HTTPException(404, {"error": "ITEM_NOT_FOUND"})
    item.item_status = "quarantined"
    item.qc_notes = "\n".join(filter(None, [item.qc_notes, f"Admin quarantine: {body.note or ''}".strip()]))
    await db.commit()
    return {"item": _item_dict(item)}


@admin_router.post("/listing-approvals/{item_id}/reject")
async def reject_direct_listing(item_id: UUID, body: ListingApprovalDecisionRequest, current_admin: AdminL2, db: DBSession):
    item = await db.get(AcquisitionItem, item_id)
    if item is None:
        raise HTTPException(404, {"error": "ITEM_NOT_FOUND"})
    item.item_status = "admin_rejected"
    item.qc_notes = "\n".join(filter(None, [item.qc_notes, f"Admin rejected: {body.note or ''}".strip()]))
    await db.commit()
    return {"item": _item_dict(item)}


@ops_router.get("/price-approvals")
async def price_approvals(current_admin: AdminAny, db: DBSession, status_filter: str = Query("pending", alias="status")):
    q = select(PriceOverrideApproval).order_by(PriceOverrideApproval.created_at.asc()).limit(100)
    if status_filter:
        q = q.where(PriceOverrideApproval.status == status_filter)
    approvals = (await db.execute(q)).scalars().all()
    return {"approvals": [await _approval_dict(db, approval) for approval in approvals]}


@ops_router.post("/price-approvals/{approval_id}/approve")
async def approve_price(approval_id: UUID, body: ApprovalDecisionRequest, current_admin: AdminL2, db: DBSession):
    approval = await db.get(PriceOverrideApproval, approval_id)
    if approval is None:
        raise HTTPException(404, {"error": "APPROVAL_NOT_FOUND"})
    if approval.status != "pending":
        raise HTTPException(409, {"error": "APPROVAL_ALREADY_RESOLVED"})
    item = await db.get(AcquisitionItem, approval.acquisition_item_id)
    if item is None:
        raise HTTPException(404, {"error": "ITEM_NOT_FOUND"})
    now = datetime.now(timezone.utc)
    approval.status = "approved"
    approval.approved_by_admin_id = current_admin.admin_id
    approval.resolved_at = now
    item.approval_status = "approved"
    item.qc_status = "passed"
    item.item_status = "qc_revised"
    item.fe_final_offer_inr = approval.requested_offer_inr
    await db.commit()
    return {"approval_id": str(approval.id), "status": approval.status, "item": _item_dict(item)}


@ops_router.post("/price-approvals/{approval_id}/reject")
async def reject_price(approval_id: UUID, body: ApprovalDecisionRequest, current_admin: AdminL2, db: DBSession):
    approval = await db.get(PriceOverrideApproval, approval_id)
    if approval is None:
        raise HTTPException(404, {"error": "APPROVAL_NOT_FOUND"})
    if approval.status != "pending":
        raise HTTPException(409, {"error": "APPROVAL_ALREADY_RESOLVED"})
    item = await db.get(AcquisitionItem, approval.acquisition_item_id)
    if item is None:
        raise HTTPException(404, {"error": "ITEM_NOT_FOUND"})
    approval.status = "rejected"
    approval.approved_by_admin_id = current_admin.admin_id
    approval.resolved_at = datetime.now(timezone.utc)
    item.approval_status = "rejected"
    item.item_status = "pending_qc"
    item.qc_status = "pending"
    item.fe_final_offer_inr = item.owmee_suggested_offer_inr
    await db.commit()
    return {"approval_id": str(approval.id), "status": approval.status, "item": _item_dict(item)}
