"""
Field Executive HTTP routers — Sprint 4 / Pass 3.

Three routers, registered by main.py under three different prefixes:

    seller_router  (/v1/fe-visits)       — seller-facing, any OTP-verified user
    fe_router      (/v1/fe/visits)       — FE-role-gated
    admin_router   (/v1/admin/fe-visits) — admin-gated (L2_REVIEWER+)

Pass 3 changes:
  - Admin endpoints use real AdminUser / AdminL2 deps (was: AuthUser stub)
  - `admin_assign` starts FEVisitWorkflow on Temporal; stores workflow_id
  - `admin_assign` now accepts category_id (locked at assignment time)
  - `start_visit` signals fe_started on the workflow
  - `submit_listing` / `submit_outcome` signal fe_submitted_outcome
  - New endpoints: POST /v1/fe/visits/{id}/images/request and /confirm
    for S3 presigned-URL photo upload (reuses listing image pipeline)
  - `submit_listing` accepts `kids_safety_checklist: dict | None`
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from app.core.admin_dependencies import AdminAny, AdminL2
from app.core.dependencies import AuthUser, BasicUser, DBSession
from app.core.fe_dependencies import FEUser
from app.core.storage import (
    generate_presigned_upload_url,
    object_key_for_fe_visit_image,
    public_url,
)
from app.core.temporal_client import TASK_QUEUE, get_temporal_client
from app.modules.field_executive import service as fe_service
from app.modules.field_executive.models import FEVisit, FieldExecutive
from app.modules.field_executive.workflows import (
    FEVisitWorkflow,
    FEVisitWorkflowInput,
    VisitOutcomeSignal,
)
from app.modules.identity_auth.models import User
from app.modules.listings.models import Category, Listing

logger = structlog.get_logger()


# ── Schemas ───────────────────────────────────────────────────────────────────

class AddressSnapshot(BaseModel):
    house: Optional[str] = None
    street: Optional[str] = None
    locality: Optional[str] = None
    city: str
    pincode: Optional[str] = None
    state: Optional[str] = None
    landmark: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class RequestVisitRequest(BaseModel):
    requested_slot_start: datetime
    requested_slot_end: datetime
    category_hint: str = Field(..., min_length=1, max_length=100)
    item_notes: Optional[str] = Field(None, max_length=2000)
    address: AddressSnapshot


class VisitResponse(BaseModel):
    id: str
    seller_id: str
    fe_id: Optional[str]
    fe_code: Optional[str]
    status: str
    outcome: Optional[str]
    outcome_reason: Optional[str]
    category_hint: str
    category_id: Optional[str]
    category_slug: Optional[str]
    category_name: Optional[str]
    item_notes: Optional[str]
    address: dict
    requested_slot_start: str
    requested_slot_end: str
    scheduled_slot_start: Optional[str]
    scheduled_slot_end: Optional[str]
    listing_id: Optional[str]
    workflow_id: Optional[str]
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]


class AssignVisitRequest(BaseModel):
    fe_id: str
    scheduled_slot_start: datetime
    scheduled_slot_end: datetime
    category_id: str = Field(
        ...,
        description="Category locked at assignment time so FE capture can submit listing.",
    )


class ReassignVisitRequest(BaseModel):
    fe_id: str
    scheduled_slot_start: Optional[datetime] = None
    scheduled_slot_end: Optional[datetime] = None
    category_id: Optional[str] = None


class SubmitOutcomeRequest(BaseModel):
    outcome: str = Field(
        ...,
        pattern="^(listed|rejected_item|seller_missing_verification|pickup_not_ready|postponed)$",
    )
    outcome_reason: Optional[str] = Field(None, max_length=2000)
    listing_id: Optional[str] = None


class SubmitListingRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = None
    # category_id is optional — if absent, falls back to visit.category_id set at assignment.
    category_id: Optional[str] = None
    condition: str = Field(..., pattern="^(flawless|excellent|good|fair|poor)$")
    price: float = Field(..., gt=0)
    brand: Optional[str] = None
    model: Optional[str] = None
    storage: Optional[str] = None
    ram: Optional[str] = None
    color: Optional[str] = None
    purchase_year: Optional[int] = None
    screen_condition: Optional[str] = None
    body_condition: Optional[str] = None
    accessories: Optional[str] = None
    warranty_info: Optional[str] = None
    battery_health: Optional[int] = None
    serial_number: Optional[str] = None
    image_urls: list[str] = Field(default_factory=list)
    city: str
    locality: Optional[str] = None
    # Pass 3 / 3h: kids safety checklist
    kids_safety_checklist: Optional[dict] = None
    is_kids_item: bool = False


class CreateFERequest(BaseModel):
    user_id: str
    city: str = Field(..., min_length=2, max_length=100)


class FEResponse(BaseModel):
    id: str
    user_id: str
    fe_code: str
    city: str
    active: bool
    current_shift: str
    created_at: str


class ImageUploadRequest(BaseModel):
    content_type: str = Field("image/jpeg", pattern="^image/(jpeg|png|webp)$")
    sort_order: int = Field(0, ge=0, le=9)


class ImageConfirmRequest(BaseModel):
    r2_key: str
    sort_order: int = Field(0, ge=0, le=9)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _address_to_dict(addr: AddressSnapshot) -> dict:
    return addr.model_dump(exclude_none=False)


async def _load_fe_by_id(db, fe_id: UUID) -> FieldExecutive:
    res = await db.execute(select(FieldExecutive).where(FieldExecutive.id == fe_id))
    fe = res.scalar_one_or_none()
    if fe is None:
        raise HTTPException(status_code=404, detail={"error": "FE_NOT_FOUND"})
    return fe


async def _load_visit_by_id(db, visit_id: UUID) -> FEVisit:
    res = await db.execute(select(FEVisit).where(FEVisit.id == visit_id))
    v = res.scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail={"error": "VISIT_NOT_FOUND"})
    return v


async def _load_category(db, category_id: UUID) -> Category:
    res = await db.execute(select(Category).where(Category.id == category_id))
    c = res.scalar_one_or_none()
    if c is None:
        raise HTTPException(status_code=404, detail={"error": "CATEGORY_NOT_FOUND"})
    return c


async def _fe_code_for_visit(db, visit: FEVisit) -> Optional[str]:
    if visit.fe_id is None:
        return None
    res = await db.execute(
        select(FieldExecutive.fe_code).where(FieldExecutive.id == visit.fe_id)
    )
    return res.scalar_one_or_none()


async def _category_info_for_visit(db, visit: FEVisit) -> tuple[Optional[str], Optional[str]]:
    if visit.category_id is None:
        return None, None
    res = await db.execute(
        select(Category.slug, Category.name).where(Category.id == visit.category_id)
    )
    row = res.one_or_none()
    if row is None:
        return None, None
    return row.slug, row.name


async def _visit_to_response(db, visit: FEVisit) -> VisitResponse:
    fe_code = await _fe_code_for_visit(db, visit)
    cat_slug, cat_name = await _category_info_for_visit(db, visit)
    return VisitResponse(
        id=str(visit.id),
        seller_id=str(visit.seller_id),
        fe_id=str(visit.fe_id) if visit.fe_id else None,
        fe_code=fe_code,
        status=visit.status,
        outcome=visit.outcome,
        outcome_reason=visit.outcome_reason,
        category_hint=visit.category_hint,
        category_id=str(visit.category_id) if visit.category_id else None,
        category_slug=cat_slug,
        category_name=cat_name,
        item_notes=visit.item_notes,
        address=visit.address_snapshot or {},
        requested_slot_start=visit.requested_slot_start.isoformat(),
        requested_slot_end=visit.requested_slot_end.isoformat(),
        scheduled_slot_start=(
            visit.scheduled_slot_start.isoformat()
            if visit.scheduled_slot_start
            else None
        ),
        scheduled_slot_end=(
            visit.scheduled_slot_end.isoformat()
            if visit.scheduled_slot_end
            else None
        ),
        listing_id=str(visit.listing_id) if visit.listing_id else None,
        workflow_id=visit.workflow_id,
        created_at=visit.created_at.isoformat(),
        started_at=visit.started_at.isoformat() if visit.started_at else None,
        completed_at=visit.completed_at.isoformat() if visit.completed_at else None,
    )


async def _start_fe_workflow(visit: FEVisit) -> Optional[str]:
    """
    Best-effort kick off FEVisitWorkflow. Returns workflow_id on success,
    None on failure. Failures are logged but do NOT fail the caller — the
    DB row is source of truth; the workflow is ops-visibility.
    """
    if visit.scheduled_slot_end is None or visit.fe_id is None:
        return None
    workflow_id = f"fe-visit-{visit.id}"
    try:
        client = await get_temporal_client()
        # Need fe.user_id for the notification activity. Look it up through
        # the relationship already loaded (ORM) — but we kept things simple:
        # the activity just logs the user_id, so we can pass visit.fe_id as
        # a proxy and let the activity resolve if needed. Here we pass empty
        # string and let the activity log the fe_id via the visit lookup.
        fe_user_id = ""  # activity is log-only for MVP (see activities.py)
        await client.start_workflow(
            FEVisitWorkflow.run,
            FEVisitWorkflowInput(
                visit_id=str(visit.id),
                fe_user_id=fe_user_id,
                scheduled_end_iso=visit.scheduled_slot_end.isoformat(),
            ),
            id=workflow_id,
            task_queue=TASK_QUEUE,
        )
        logger.info("fe_visit.workflow_started", visit_id=str(visit.id), workflow_id=workflow_id)
        return workflow_id
    except Exception as e:  # noqa: BLE001 — Temporal errors are noisy; swallow with log
        logger.warning(
            "fe_visit.workflow_start_failed",
            visit_id=str(visit.id),
            error=str(e),
        )
        return None


async def _signal_fe_started(workflow_id: str) -> None:
    """Best-effort signal fe_started on the visit workflow."""
    if not workflow_id:
        return
    try:
        client = await get_temporal_client()
        handle = client.get_workflow_handle(workflow_id)
        await handle.signal(FEVisitWorkflow.fe_started)
        logger.info("fe_visit.signal.fe_started", workflow_id=workflow_id)
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "fe_visit.signal_failed",
            signal="fe_started",
            workflow_id=workflow_id,
            error=str(e),
        )


async def _signal_fe_outcome(
    workflow_id: str,
    outcome: str,
    outcome_reason: Optional[str],
    listing_id: Optional[str],
) -> None:
    """Best-effort signal fe_submitted_outcome on the visit workflow."""
    if not workflow_id:
        return
    try:
        client = await get_temporal_client()
        handle = client.get_workflow_handle(workflow_id)
        await handle.signal(
            FEVisitWorkflow.fe_submitted_outcome,
            VisitOutcomeSignal(
                outcome=outcome,
                outcome_reason=outcome_reason,
                listing_id=listing_id,
            ),
        )
        logger.info(
            "fe_visit.signal.fe_submitted_outcome",
            workflow_id=workflow_id,
            outcome=outcome,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "fe_visit.signal_failed",
            signal="fe_submitted_outcome",
            workflow_id=workflow_id,
            error=str(e),
        )


# ── Seller-facing router: /v1/fe-visits ───────────────────────────────────────

seller_router = APIRouter()


@seller_router.post("/request", response_model=VisitResponse, status_code=201)
async def request_visit(
    body: RequestVisitRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """
    Seller requests an FE visit. No KYC required — FE visit is itself an
    onboarding path for sellers who can't / won't self-prep a listing.
    """
    res = await db.execute(select(User).where(User.id == current_user.user_id))
    seller = res.scalar_one_or_none()
    if seller is None:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    try:
        visit = await fe_service.create_visit_request(
            db,
            seller=seller,
            requested_start=body.requested_slot_start,
            requested_end=body.requested_slot_end,
            address_snapshot=_address_to_dict(body.address),
            category_hint=body.category_hint,
            item_notes=body.item_notes,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400, detail={"error": "INVALID_REQUEST", "message": str(e)}
        )

    await db.commit()
    await db.refresh(visit)
    return await _visit_to_response(db, visit)


@seller_router.get("/me", response_model=list[VisitResponse])
async def my_visits(current_user: BasicUser, db: DBSession):
    res = await db.execute(
        select(FEVisit)
        .where(FEVisit.seller_id == current_user.user_id)
        .order_by(desc(FEVisit.created_at))
        .limit(50)
    )
    visits = list(res.scalars().all())
    return [await _visit_to_response(db, v) for v in visits]


@seller_router.post("/{visit_id}/cancel", response_model=VisitResponse)
async def cancel_my_visit(
    visit_id: UUID,
    current_user: BasicUser,
    db: DBSession,
):
    visit = await _load_visit_by_id(db, visit_id)
    if visit.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    try:
        await fe_service.cancel_visit(
            db,
            visit=visit,
            reason="seller_cancelled",
            triggered_by=f"user:{current_user.user_id}",
        )
    except fe_service.IllegalVisitTransition as e:
        raise HTTPException(
            status_code=409,
            detail={"error": "ILLEGAL_TRANSITION", "message": str(e)},
        )
    await db.commit()
    await db.refresh(visit)
    return await _visit_to_response(db, visit)


# ── FE-facing router: /v1/fe/visits ───────────────────────────────────────────

fe_router = APIRouter()


@fe_router.get("/assigned", response_model=list[VisitResponse])
async def assigned_visits(current_fe: FEUser, db: DBSession):
    """List visits assigned to the current FE, newest first."""
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None:
        raise HTTPException(status_code=403, detail={"error": "FE_PROFILE_MISSING"})
    res = await db.execute(
        select(FEVisit)
        .where(FEVisit.fe_id == fe.id)
        .order_by(desc(FEVisit.created_at))
        .limit(50)
    )
    visits = list(res.scalars().all())
    return [await _visit_to_response(db, v) for v in visits]


@fe_router.get("/{visit_id}", response_model=VisitResponse)
async def get_visit(
    visit_id: UUID,
    current_fe: FEUser,
    db: DBSession,
):
    visit = await _load_visit_by_id(db, visit_id)
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None or visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    return await _visit_to_response(db, visit)


@fe_router.post("/{visit_id}/start", response_model=VisitResponse)
async def start_visit(
    visit_id: UUID,
    current_fe: FEUser,
    db: DBSession,
):
    visit = await _load_visit_by_id(db, visit_id)
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None or visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    try:
        await fe_service.start_visit(db, visit=visit)
    except fe_service.IllegalVisitTransition as e:
        raise HTTPException(
            status_code=409,
            detail={"error": "ILLEGAL_TRANSITION", "message": str(e)},
        )
    await db.commit()
    await db.refresh(visit)

    # Signal workflow after commit so DB is source of truth first
    if visit.workflow_id:
        await _signal_fe_started(visit.workflow_id)

    return await _visit_to_response(db, visit)


@fe_router.post("/{visit_id}/enforce-aadhaar")
async def enforce_aadhaar(
    visit_id: UUID,
    current_fe: FEUser,
    db: DBSession,
):
    """
    Trigger the seller's Aadhaar verification flow. Returns a deep-link the
    seller taps on their phone. MVP: returns a placeholder link. Phase 3:
    integrates with partner short-link + push to seller device.
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None or visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if visit.status != "in_progress":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "VISIT_NOT_IN_PROGRESS",
                "message": "Start the visit before asking for Aadhaar.",
            },
        )
    logger.info(
        "fe_visit.enforce_aadhaar",
        visit_id=str(visit.id),
        seller_id=str(visit.seller_id),
    )
    return {
        "deep_link": f"owmee://kyc/start?visit_id={visit.id}",
        "expires_in_seconds": 600,
    }


# ── Pass 3 / 3e: FE image upload endpoints ───────────────────────────────────

@fe_router.post("/{visit_id}/images/request")
async def fe_request_image_upload(
    visit_id: UUID,
    body: ImageUploadRequest,
    current_fe: FEUser,
    db: DBSession,
):
    """
    Request a presigned PUT URL for uploading a photo captured during this
    visit. Reuses the listing image pipeline (S3/MinIO presign + confirm).
    Photos are namespaced under fe-visits/{visit_id}/ so they survive even
    if no listing is created (e.g. outcome=rejected_item).
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None or visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if visit.status != "in_progress":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "VISIT_NOT_IN_PROGRESS",
                "message": "Start the visit before uploading photos.",
            },
        )
    r2_key = object_key_for_fe_visit_image(str(visit_id))
    upload_url = generate_presigned_upload_url(
        r2_key, content_type=body.content_type, expires_in=300
    )
    logger.info(
        "fe_visit.image.requested",
        visit_id=str(visit.id),
        r2_key=r2_key,
    )
    return {
        "upload_url": upload_url,
        "r2_key": r2_key,
        "expires_in_seconds": 300,
    }


@fe_router.post("/{visit_id}/images/confirm")
async def fe_confirm_image_upload(
    visit_id: UUID,
    body: ImageConfirmRequest,
    current_fe: FEUser,
    db: DBSession,
):
    """
    Confirm a successful PUT. No DB row is created for FE-capture photos at
    this stage — they become part of the listing's image_urls when the FE
    calls /submit-listing. We return the computed public URL so the client
    can preview them immediately.
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None or visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    # Require the r2_key to be in this visit's prefix — prevents injecting
    # random keys from other visits/listings.
    if not body.r2_key.startswith(f"fe-visits/{visit_id}/"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_KEY_PREFIX",
                "message": "r2_key must belong to this visit.",
            },
        )
    logger.info(
        "fe_visit.image.confirmed",
        visit_id=str(visit.id),
        r2_key=body.r2_key,
    )
    return {
        "r2_key": body.r2_key,
        "public_url": public_url(body.r2_key),
        "moderation_status": "pending",
    }


@fe_router.post("/{visit_id}/submit-listing", response_model=VisitResponse)
async def submit_listing(
    visit_id: UUID,
    body: SubmitListingRequest,
    current_fe: FEUser,
    db: DBSession,
):
    """
    FE submits the listing package for the seller. Creates a Listing row with
    listing_source='fe_assisted', reviewed_by='fe', status='pending_moderation',
    fe_visit_id set. Marks the visit's outcome as 'listed'.

    Pass 3:
      - If body.category_id is absent, falls back to visit.category_id locked
        at admin assignment. If neither is present → 400.
      - Accepts kids_safety_checklist; persists to listings.kids_safety_checklist.
      - Signals fe_submitted_outcome on the workflow after commit.
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None or visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if visit.status != "in_progress":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "VISIT_NOT_IN_PROGRESS",
                "message": "Start the visit before submitting the listing.",
            },
        )

    # Resolve category: request override > visit.category_id > 400
    resolved_category_id: Optional[UUID] = None
    if body.category_id:
        try:
            resolved_category_id = UUID(body.category_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail={"error": "INVALID_CATEGORY_ID"},
            )
    elif visit.category_id is not None:
        resolved_category_id = visit.category_id

    if resolved_category_id is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "CATEGORY_REQUIRED",
                "message": (
                    "Category must be locked at admin assignment or passed in "
                    "the request body."
                ),
            },
        )

    # Verify category exists (fast fail with a clean error)
    await _load_category(db, resolved_category_id)

    # Build listing
    listing = Listing(
        seller_id=visit.seller_id,
        category_id=resolved_category_id,
        title=body.title,
        description=body.description,
        price=body.price,
        condition=body.condition,
        status="pending_moderation",
        moderation_status="pending",
        image_urls=body.image_urls,
        thumbnail_url=body.image_urls[0] if body.image_urls else None,
        brand=body.brand,
        model=body.model,
        storage=body.storage,
        ram=body.ram,
        color=body.color,
        purchase_year=body.purchase_year,
        screen_condition=body.screen_condition,
        body_condition=body.body_condition,
        accessories=body.accessories,
        warranty_info=body.warranty_info,
        battery_health=body.battery_health,
        serial_number=body.serial_number,
        city=body.city,
        locality=body.locality,
        listing_source="fe_assisted",
        fe_visit_id=visit.id,
        reviewed_by="fe",
        is_kids_item=bool(body.is_kids_item),
        kids_safety_checklist=body.kids_safety_checklist,
    )
    db.add(listing)
    await db.flush()

    # Complete visit with listed outcome
    try:
        await fe_service.complete_visit(
            db,
            visit=visit,
            outcome="listed",
            listing_id=listing.id,
        )
    except fe_service.IllegalVisitTransition as e:
        raise HTTPException(
            status_code=409,
            detail={"error": "ILLEGAL_TRANSITION", "message": str(e)},
        )

    await db.commit()
    await db.refresh(visit)

    # Signal workflow after commit
    if visit.workflow_id:
        await _signal_fe_outcome(
            visit.workflow_id,
            outcome="listed",
            outcome_reason=None,
            listing_id=str(listing.id),
        )

    logger.info(
        "fe_visit.listing_submitted",
        visit_id=str(visit.id),
        listing_id=str(listing.id),
    )
    return await _visit_to_response(db, visit)


@fe_router.post("/{visit_id}/outcome", response_model=VisitResponse)
async def submit_outcome(
    visit_id: UUID,
    body: SubmitOutcomeRequest,
    current_fe: FEUser,
    db: DBSession,
):
    visit = await _load_visit_by_id(db, visit_id)
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None or visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})

    listing_uuid = UUID(body.listing_id) if body.listing_id else None

    try:
        await fe_service.complete_visit(
            db,
            visit=visit,
            outcome=body.outcome,
            outcome_reason=body.outcome_reason,
            listing_id=listing_uuid,
        )
    except fe_service.IllegalVisitTransition as e:
        raise HTTPException(
            status_code=409,
            detail={"error": "ILLEGAL_TRANSITION", "message": str(e)},
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400, detail={"error": "INVALID_OUTCOME", "message": str(e)}
        )

    await db.commit()
    await db.refresh(visit)

    if visit.workflow_id:
        await _signal_fe_outcome(
            visit.workflow_id,
            outcome=body.outcome,
            outcome_reason=body.outcome_reason,
            listing_id=str(listing_uuid) if listing_uuid else None,
        )

    return await _visit_to_response(db, visit)


# ── Admin router: /v1/admin/fe-visits ─────────────────────────────────────────
#
# Pass 3: real AdminUser dep (AdminAny for reads, AdminL2 for writes).

admin_router = APIRouter()


@admin_router.get("/fes", response_model=list[FEResponse])
async def admin_list_fes(
    current_admin: AdminAny,
    db: DBSession,
    active_only: bool = True,
):
    q = select(FieldExecutive)
    if active_only:
        q = q.where(FieldExecutive.active == True)  # noqa: E712
    q = q.order_by(FieldExecutive.fe_code)
    res = await db.execute(q)
    fes = list(res.scalars().all())
    return [
        FEResponse(
            id=str(fe.id),
            user_id=str(fe.user_id),
            fe_code=fe.fe_code,
            city=fe.city,
            active=bool(fe.active),
            current_shift=fe.current_shift,
            created_at=fe.created_at.isoformat(),
        )
        for fe in fes
    ]


@admin_router.post("/fes", response_model=FEResponse, status_code=201)
async def admin_create_fe(
    body: CreateFERequest,
    current_admin: AdminL2,
    db: DBSession,
):
    res = await db.execute(select(User).where(User.id == UUID(body.user_id)))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    fe = await fe_service.create_fe_for_user(
        db,
        user=user,
        city=body.city,
        created_by_admin_id=current_admin.admin_id,
    )
    await db.commit()
    await db.refresh(fe)

    return FEResponse(
        id=str(fe.id),
        user_id=str(fe.user_id),
        fe_code=fe.fe_code,
        city=fe.city,
        active=bool(fe.active),
        current_shift=fe.current_shift,
        created_at=fe.created_at.isoformat(),
    )


@admin_router.get("/", response_model=list[VisitResponse])
async def admin_list_visits(
    current_admin: AdminAny,
    db: DBSession,
    status_filter: Optional[str] = None,
):
    q = select(FEVisit)
    if status_filter:
        q = q.where(FEVisit.status == status_filter)
    q = q.order_by(desc(FEVisit.created_at)).limit(200)
    res = await db.execute(q)
    visits = list(res.scalars().all())
    return [await _visit_to_response(db, v) for v in visits]


@admin_router.get("/{visit_id}", response_model=VisitResponse)
async def admin_get_visit(
    visit_id: UUID,
    current_admin: AdminAny,
    db: DBSession,
):
    visit = await _load_visit_by_id(db, visit_id)
    return await _visit_to_response(db, visit)


@admin_router.post("/{visit_id}/assign", response_model=VisitResponse)
async def admin_assign(
    visit_id: UUID,
    body: AssignVisitRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    visit = await _load_visit_by_id(db, visit_id)
    fe = await _load_fe_by_id(db, UUID(body.fe_id))
    try:
        category_uuid = UUID(body.category_id)
    except ValueError:
        raise HTTPException(
            status_code=400, detail={"error": "INVALID_CATEGORY_ID"}
        )
    # Verify category exists before we persist
    await _load_category(db, category_uuid)

    try:
        await fe_service.assign_fe(
            db,
            visit=visit,
            fe=fe,
            scheduled_start=body.scheduled_slot_start,
            scheduled_end=body.scheduled_slot_end,
            category_id=category_uuid,
        )
    except fe_service.IllegalVisitTransition as e:
        raise HTTPException(
            status_code=409, detail={"error": "ILLEGAL_TRANSITION", "message": str(e)}
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400, detail={"error": "INVALID_REQUEST", "message": str(e)}
        )
    await db.commit()
    await db.refresh(visit)

    # Start Temporal workflow and persist workflow_id (best-effort)
    workflow_id = await _start_fe_workflow(visit)
    if workflow_id:
        visit.workflow_id = workflow_id
        await db.commit()
        await db.refresh(visit)

    return await _visit_to_response(db, visit)


@admin_router.post("/{visit_id}/reassign", response_model=VisitResponse)
async def admin_reassign(
    visit_id: UUID,
    body: ReassignVisitRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    visit = await _load_visit_by_id(db, visit_id)
    fe = await _load_fe_by_id(db, UUID(body.fe_id))
    category_uuid: Optional[UUID] = None
    if body.category_id:
        try:
            category_uuid = UUID(body.category_id)
        except ValueError:
            raise HTTPException(
                status_code=400, detail={"error": "INVALID_CATEGORY_ID"}
            )
        await _load_category(db, category_uuid)

    try:
        await fe_service.reassign_fe(
            db,
            visit=visit,
            new_fe=fe,
            scheduled_start=body.scheduled_slot_start,
            scheduled_end=body.scheduled_slot_end,
            category_id=category_uuid,
        )
    except fe_service.IllegalVisitTransition as e:
        raise HTTPException(
            status_code=409, detail={"error": "ILLEGAL_TRANSITION", "message": str(e)}
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400, detail={"error": "INVALID_REQUEST", "message": str(e)}
        )
    await db.commit()
    await db.refresh(visit)
    return await _visit_to_response(db, visit)


