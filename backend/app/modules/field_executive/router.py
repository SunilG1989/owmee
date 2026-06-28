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

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
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
from app.modules.field_executive.models import FEVisit, FEVisitIssue, FEVisitNps, FieldExecutive
from app.modules.field_executive.workflows import (
    FEVisitWorkflow,
    FEVisitWorkflowInput,
    VisitOutcomeSignal,
)
from app.modules.identity_auth.models import User
from app.modules.ai_assistant.category_taxonomy import (
    category_family_for,
    clean_category_specifics,
    has_educational_book_detail,
    has_issue_disclosure_detail,
    required_category_specific_fields,
    requires_appliance_pickup_status,
    requires_book_set_status,
    requires_educational_book_details,
    requires_issue_disclosure_detail,
    requires_powered_toy_status,
)
from app.modules.listings.models import Category, Listing
from app.modules.listings.service import MIN_PHOTOS_REQUIRED

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


# Master spec section 4.5: canonical Concierge tag set. Validated at API
# layer; not enforced in DB.
ALLOWED_TAGS = {"phone", "laptop", "audio", "appliance", "kids", "multiple"}


class RequestVisitRequest(BaseModel):
    """Concierge Phase 1 simplified booking shape.

    Required: address_id + slot. Everything else optional.

    `category_hint` is no longer required — admin locks the real category
    when assigning a specialist. Default is 'unknown' so the existing
    NOT NULL DB column stays satisfied.

    `notes` (free text) maps to the `item_notes` column. The booking
    addendum kept the legacy column name to avoid a renaming migration.
    """
    requested_slot_start: datetime
    requested_slot_end: datetime
    address_id: UUID
    notes: Optional[str] = Field(None, max_length=500)
    notes_tags: list[str] = Field(default_factory=list, max_length=6)
    # Optional fallback. Default 'unknown' so DB NOT NULL stays satisfied.
    category_hint: str = Field("unknown", max_length=100)

    @field_validator("notes_tags")
    @classmethod
    def _validate_tags(cls, v: list[str]) -> list[str]:
        invalid = set(v) - ALLOWED_TAGS
        if invalid:
            raise ValueError(
                f"Invalid tags: {sorted(invalid)}. Allowed: {sorted(ALLOWED_TAGS)}"
            )
        # Dedupe, preserving order.
        return list(dict.fromkeys(v))


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
    notes_tags: list[str] = Field(default_factory=list)
    # Concierge Phase 2 (master spec section 5.4)
    arrival_verification_code: Optional[str] = None
    arrival_confirmed_by_seller_at: Optional[str] = None
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
    age_suitability: Optional[str] = None
    hygiene_status: Optional[str] = None
    serial_number: Optional[str] = None
    image_urls: list[str] = Field(default_factory=list)
    city: str
    locality: Optional[str] = None
    # Pass 3 / 3h: kids safety checklist
    kids_safety_checklist: Optional[dict] = None
    is_kids_item: bool = False
    category_family: Optional[str] = None
    category_specifics: Optional[dict[str, Any]] = None


_FE_REQUIRED_SPEC_CATEGORIES = {"smartphones", "laptops", "tablets", "appliances"}


def _clean_non_empty(value: Optional[str]) -> str:
    return (value or "").strip()


def _specific_present(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return True
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_specific_present(item) for item in value)
    return bool(value)


def _clean_fe_category_specifics(
    category: Category,
    body: SubmitListingRequest,
) -> tuple[str, dict[str, Any], dict | None]:
    family = category_family_for(
        category.slug,
        detected_item_type=body.model,
        title=body.title,
        model=body.model,
    )
    specifics = clean_category_specifics(family, body.category_specifics)
    if family == "toy" and not _specific_present(specifics.get("toy_type")) and body.model:
        specifics["toy_type"] = body.model
    if family == "book" and not _specific_present(specifics.get("book_type")) and body.model:
        specifics["book_type"] = body.model
    if family == "appliance" and not _specific_present(specifics.get("appliance_type")) and body.model:
        specifics["appliance_type"] = body.model

    kids_checklist = None
    if isinstance(body.kids_safety_checklist, dict):
        kids_checklist = {
            str(key): bool(value)
            for key, value in body.kids_safety_checklist.items()
            if isinstance(value, bool)
        } or None
    return family, specifics, kids_checklist


def _fe_category_specifics_rejection(
    *,
    category_slug: str,
    family: str,
    specifics: dict[str, Any],
    kids_checklist: dict | None,
    body: SubmitListingRequest,
) -> dict | None:
    if family not in {"toy", "book", "appliance"}:
        return None

    missing: list[str] = []
    for field in required_category_specific_fields(family):
        if not _specific_present(specifics.get(field)):
            missing.append(field)

    if family == "toy":
        if not _specific_present(body.age_suitability):
            missing.append("age_suitability")
        if not _specific_present(body.hygiene_status):
            missing.append("hygiene_status")
        if requires_powered_toy_status(body.model, body.title) and not (
            _specific_present(specifics.get("working_status"))
            or _specific_present(specifics.get("battery_status"))
        ):
            missing.append("battery_or_working_status")
        if category_slug == "kids-utility":
            required_checklist = ("no_small_parts", "no_loose_batteries", "no_sharp_edges")
            if not all(key in (kids_checklist or {}) for key in required_checklist):
                missing.append("kids_safety_checklist")

    if family == "book" and requires_book_set_status(body.model, body.title):
        if not _specific_present(specifics.get("set_status")):
            missing.append("set_status")
    if family == "book" and requires_educational_book_details(body.model, body.title):
        if not has_educational_book_detail(specifics):
            missing.append("class_board_edition")

    if family == "appliance":
        if not _specific_present(specifics.get("appliance_type")):
            missing.append("appliance_type")
        if requires_appliance_pickup_status(body.model, body.title):
            if not _specific_present(specifics.get("pickup_complexity")):
                missing.append("pickup_complexity")
            if not _specific_present(specifics.get("installation_status")):
                missing.append("installation_status")
    if (
        requires_issue_disclosure_detail(family, specifics)
        and not has_issue_disclosure_detail(body.description)
    ):
        missing.append("issue_disclosure")

    deduped = list(dict.fromkeys(missing))
    if not deduped:
        return None
    return {
        "error": "CATEGORY_REQUIREMENTS_REQUIRED",
        "category_family": family,
        "missing_fields": deduped,
        "message": "Complete category-specific buyer details before submitting this listing.",
    }


def _validate_listing_package(category: Category, body: SubmitListingRequest) -> None:
    photo_count = len(body.image_urls or [])
    if photo_count < MIN_PHOTOS_REQUIRED:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "MIN_PHOTOS_REQUIRED",
                "message": (
                    f"Listings need at least {MIN_PHOTOS_REQUIRED} photos - "
                    f"you have {photo_count}."
                ),
                "photos_uploaded": photo_count,
                "photos_required": MIN_PHOTOS_REQUIRED,
            },
        )

    category_slug = (category.slug or "").strip().lower()
    if category_slug in _FE_REQUIRED_SPEC_CATEGORIES:
        missing: list[str] = []
        if not _clean_non_empty(body.brand):
            missing.append("brand")
        if not _clean_non_empty(body.model):
            missing.append("model")
        if missing:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "MISSING_REQUIRED_SPECS",
                    "missing_fields": missing,
                    "message": "Brand and model are required for this category.",
                },
            )

    family, specifics, kids_checklist = _clean_fe_category_specifics(category, body)
    category_rejection = _fe_category_specifics_rejection(
        category_slug=category_slug,
        family=family,
        specifics=specifics,
        kids_checklist=kids_checklist,
        body=body,
    )
    if category_rejection:
        raise HTTPException(status_code=400, detail=category_rejection)


class CreateFERequest(BaseModel):
    user_id: Optional[str] = None
    phone_number: Optional[str] = Field(None, min_length=10, max_length=20)
    city: str = Field(..., min_length=2, max_length=100)
    employment_type: str = Field("contractor", pattern="^(internal|contractor|vendor_staff)$")
    vendor_name: Optional[str] = Field(None, max_length=120)
    service_zones: list[str] = Field(default_factory=list, max_length=50)
    category_certifications: list[str] = Field(default_factory=list, max_length=30)
    languages: list[str] = Field(default_factory=list, max_length=12)
    daily_capacity: int = Field(4, ge=1, le=12)
    admin_notes: Optional[str] = Field(None, max_length=2000)


class FEResponse(BaseModel):
    id: str
    user_id: str
    fe_code: str
    city: str
    active: bool
    current_shift: str
    onboarding_status: str
    verification_status: str
    training_status: str
    device_status: str
    employment_type: str
    vendor_name: Optional[str] = None
    service_zones: list[str] = Field(default_factory=list)
    category_certifications: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    daily_capacity: int
    readiness_gaps: list[str] = Field(default_factory=list)
    profile_snapshot: dict = Field(default_factory=dict)
    device_binding: dict = Field(default_factory=dict)
    risk_metrics: dict = Field(default_factory=dict)
    suspended_reason: Optional[str] = None
    admin_notes: Optional[str] = None
    verified_at: Optional[str] = None
    certified_at: Optional[str] = None
    device_approved_at: Optional[str] = None
    activated_at: Optional[str] = None
    suspended_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    shift_started_at: Optional[str] = None
    created_at: str


class UpdateFEProfileRequest(BaseModel):
    city: Optional[str] = Field(None, min_length=2, max_length=100)
    employment_type: Optional[str] = Field(None, pattern="^(internal|contractor|vendor_staff)$")
    vendor_name: Optional[str] = Field(None, max_length=120)
    service_zones: Optional[list[str]] = Field(None, max_length=50)
    category_certifications: Optional[list[str]] = Field(None, max_length=30)
    languages: Optional[list[str]] = Field(None, max_length=12)
    daily_capacity: Optional[int] = Field(None, ge=1, le=12)
    profile_snapshot: Optional[dict] = None
    admin_notes: Optional[str] = Field(None, max_length=2000)


class FEStatusDecisionRequest(BaseModel):
    status: str
    note: Optional[str] = Field(None, max_length=2000)


class FEDeviceDecisionRequest(BaseModel):
    approved: bool = True
    note: Optional[str] = Field(None, max_length=2000)


class FEActionRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=2000)


class FEDeviceBindRequest(BaseModel):
    device_id: str = Field(..., min_length=6, max_length=160)
    platform: str = Field(..., max_length=32)
    app_version: Optional[str] = Field(None, max_length=40)
    os_version: Optional[str] = Field(None, max_length=80)
    device_model: Optional[str] = Field(None, max_length=120)
    push_token: Optional[str] = Field(None, max_length=500)


class FEShiftCheckInRequest(BaseModel):
    location: Optional[dict] = None


class ImageUploadRequest(BaseModel):
    content_type: str = Field("image/jpeg", pattern="^image/(jpeg|png|webp)$")
    sort_order: int = Field(0, ge=0, le=9)


class ImageConfirmRequest(BaseModel):
    r2_key: str
    sort_order: int = Field(0, ge=0, le=9)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _address_to_dict(addr: AddressSnapshot) -> dict:
    return addr.model_dump(exclude_none=False)


async def _resolve_address_id_to_snapshot(
    db, address_id: UUID, owner_user_id: UUID
) -> dict:
    """Look up a saved address, assert ownership, freeze into a JSONB
    snapshot suitable for the existing fe_visits.address_snapshot column.

    Mapping notes
    -------------
    The legacy AddressSnapshot used flat field names (`house`, `street`,
    `landmark`, etc.); UserAddress uses richer names (`flat_house_number`,
    `building_name`, `address_line_1`). The snapshot keeps both old and
    new shapes so downstream code (admin web Jinja templates, FE app
    visit-detail screen, etc.) doesn't have to change in lockstep — they
    can keep reading the legacy keys while new surfaces consume the
    richer keys.
    """
    from app.modules.identity_auth.models import UserAddress

    res = await db.execute(
        select(UserAddress).where(
            UserAddress.id == address_id,
            UserAddress.user_id == owner_user_id,
        )
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "ADDRESS_NOT_FOUND"},
        )

    # New keys (preferred by anything new) + legacy keys (kept for
    # backwards compat with screens that haven't been rewired yet).
    return {
        # Source pointer for forensics — never changes after snapshot.
        "address_id": str(row.id),
        "label": row.label,
        "custom_label": row.custom_label,
        "lat": float(row.lat),
        "lng": float(row.lng),
        # New richer fields
        "flat_house_number": row.flat_house_number,
        "building_name": row.building_name,
        "floor": row.floor,
        "address_line_1": row.address_line_1,
        # Legacy field names — keep these populated for old consumers.
        "house": row.flat_house_number,
        "street": row.address_line_1,
        "landmark": row.landmark,
        # Shared
        "locality": row.locality,
        "city": row.city,
        "state": row.state,
        "pincode": row.pincode,
    }


async def _load_fe_by_id(db, fe_id: UUID) -> FieldExecutive:
    res = await db.execute(select(FieldExecutive).where(FieldExecutive.id == fe_id))
    fe = res.scalar_one_or_none()
    if fe is None:
        raise HTTPException(status_code=404, detail={"error": "FE_NOT_FOUND"})
    return fe


async def _operational_fe_for_user(db, user_id: UUID) -> FieldExecutive:
    fe = await fe_service.get_fe_by_user_id(db, user_id)
    if fe is None:
        raise HTTPException(status_code=403, detail={"error": "FE_PROFILE_MISSING"})
    try:
        fe_service.assert_fe_ready_for_assignment(fe)
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=403, detail={"error": e.code, "message": e.message})
    return fe


def _dt(value) -> str | None:
    return value.isoformat() if value else None


def _normalize_india_phone(raw: str) -> str:
    value = "".join(ch for ch in raw.strip() if ch.isdigit() or ch == "+")
    if value.startswith("+"):
        digits = "".join(ch for ch in value[1:] if ch.isdigit())
        if len(digits) == 12 and digits.startswith("91"):
            return f"+{digits}"
        raise HTTPException(status_code=400, detail={"error": "INVALID_PHONE_NUMBER"})
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    raise HTTPException(status_code=400, detail={"error": "INVALID_PHONE_NUMBER"})


def _fe_to_response(fe: FieldExecutive) -> FEResponse:
    legacy_active = bool(fe.active)
    service_zones = list(getattr(fe, "service_zones", None) or (["legacy"] if legacy_active else []))
    category_certifications = list(getattr(fe, "category_certifications", None) or (["*"] if legacy_active else []))
    return FEResponse(
        id=str(fe.id),
        user_id=str(fe.user_id),
        fe_code=fe.fe_code,
        city=fe.city,
        active=bool(fe.active),
        current_shift=fe.current_shift,
        onboarding_status=getattr(fe, "onboarding_status", None) or ("active" if fe.active else "candidate"),
        verification_status=getattr(fe, "verification_status", None) or "pending",
        training_status=getattr(fe, "training_status", None) or "not_started",
        device_status=getattr(fe, "device_status", None) or "not_bound",
        employment_type=getattr(fe, "employment_type", None) or "contractor",
        vendor_name=getattr(fe, "vendor_name", None),
        service_zones=service_zones,
        category_certifications=category_certifications,
        languages=list(getattr(fe, "languages", None) or []),
        daily_capacity=int(getattr(fe, "daily_capacity", 0) or (4 if legacy_active else 0)),
        readiness_gaps=fe_service.readiness_gaps(fe),
        profile_snapshot=getattr(fe, "profile_snapshot", None) or {},
        device_binding=getattr(fe, "device_binding", None) or {},
        risk_metrics=getattr(fe, "risk_metrics", None) or {},
        suspended_reason=getattr(fe, "suspended_reason", None),
        admin_notes=getattr(fe, "admin_notes", None),
        verified_at=_dt(getattr(fe, "verified_at", None)),
        certified_at=_dt(getattr(fe, "certified_at", None)),
        device_approved_at=_dt(getattr(fe, "device_approved_at", None)),
        activated_at=_dt(getattr(fe, "activated_at", None)),
        suspended_at=_dt(getattr(fe, "suspended_at", None)),
        last_seen_at=_dt(getattr(fe, "last_seen_at", None)),
        shift_started_at=_dt(getattr(fe, "shift_started_at", None)),
        created_at=fe.created_at.isoformat(),
    )


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
        notes_tags=list(visit.notes_tags or []),
        arrival_verification_code=visit.arrival_verification_code,
        arrival_confirmed_by_seller_at=(
            visit.arrival_confirmed_by_seller_at.isoformat()
            if visit.arrival_confirmed_by_seller_at
            else None
        ),
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

    # Concierge Phase 1: address_id is required (Pydantic enforces). Resolve
    # to an owned user_addresses row and snapshot into address_snapshot.
    addr_snapshot = await _resolve_address_id_to_snapshot(
        db, body.address_id, current_user.user_id
    )

    try:
        visit = await fe_service.create_visit_request(
            db,
            seller=seller,
            requested_start=body.requested_slot_start,
            requested_end=body.requested_slot_end,
            address_snapshot=addr_snapshot,
            category_hint=body.category_hint,
            item_notes=body.notes,
            notes_tags=body.notes_tags,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400, detail={"error": "INVALID_REQUEST", "message": str(e)}
        )

    await db.commit()
    await db.refresh(visit)

    # Concierge Phase 2 N1: "Visit booked, matching specialist now."
    # Fire-and-forget so a notification failure can't roll back the booking.
    try:
        from app.modules.notifications.concierge_templates import notify_visit_booked
        await notify_visit_booked(seller_id=visit.seller_id, visit_id=visit.id)
    except Exception as e:  # noqa: BLE001
        logger.warning("concierge.notify_visit_booked.failed", visit_id=str(visit.id), error=str(e))

    return await _visit_to_response(db, visit)


@seller_router.get("/me", response_model=list[VisitResponse])
async def my_visits(current_user: BasicUser, db: DBSession):
    """List the seller's own visits, newest first.

    NOTE: this route MUST be registered BEFORE /{visit_id} so FastAPI's
    path matcher doesn't try to parse "me" as a UUID (it 422s the
    request). See also /v1/listings/price-suggestion which had the same
    issue. New static endpoints here go above /{visit_id}.
    """
    res = await db.execute(
        select(FEVisit)
        .where(FEVisit.seller_id == current_user.user_id)
        .order_by(desc(FEVisit.created_at))
        .limit(50)
    )
    visits = list(res.scalars().all())
    return [await _visit_to_response(db, v) for v in visits]


@seller_router.get("/{visit_id}", response_model=VisitResponse)
async def my_visit(
    visit_id: UUID,
    current_user: BasicUser,
    db: DBSession,
):
    """Seller-side single-visit fetch — used by the Phase 2 visit detail
    screen + ArrivalVerificationScreen."""
    visit = await _load_visit_by_id(db, visit_id)
    if visit.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    return await _visit_to_response(db, visit)


# Canonical cancel-reason set — mirrors mobile's FEVisitCancelReason
# (services/api.ts) and the listings.deletion_reason set, so analytics
# can join across both surfaces.
_CANCEL_REASONS = {
    "changed_mind",
    "sold_elsewhere",
    "fe_late",
    "schedule_conflict",
    "no_longer_selling",
    "other",
}


class CancelVisitBody(BaseModel):
    """Optional structured body for seller-cancel.

    Backwards-compatible: an empty/missing body still cancels (legacy
    mobile builds). When supplied, `cancellation_reason` must be one of
    the canonical keys above so it joins cleanly with listings analytics.
    """
    cancellation_reason: Optional[str] = Field(default=None, max_length=50)
    note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("cancellation_reason")
    @classmethod
    def _validate_reason(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if v not in _CANCEL_REASONS:
            raise ValueError(f"invalid reason: {v}")
        return v


@seller_router.post("/{visit_id}/cancel", response_model=VisitResponse)
async def cancel_my_visit(
    visit_id: UUID,
    current_user: BasicUser,
    db: DBSession,
    body: Optional[CancelVisitBody] = None,
):
    visit = await _load_visit_by_id(db, visit_id)
    if visit.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})

    # Snapshot pre-cancel state so we know whether the FE was assigned
    # / en route — drives whether we push-notify them.
    fe_id_before = visit.fe_id
    status_before = visit.status

    structured_reason = body.cancellation_reason if body else None
    structured_note = body.note.strip() if body and body.note else None

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

    # Persist structured analytics fields. cancellation_reason is the
    # canonical analytics key; outcome_reason already carries a free-text
    # blend (set by the service layer) — append the user note if present.
    if structured_reason is not None:
        visit.cancellation_reason = structured_reason
    if structured_note:
        visit.outcome_reason = (
            f"{visit.outcome_reason or 'seller_cancelled'}: {structured_note}"
        )

    await db.commit()
    await db.refresh(visit)

    # Push-notify the assigned FE if they were already routed to this
    # visit. Statuses that imply an FE is on the move: `scheduled`,
    # `in_progress` (door arrival was reached but seller bailed before
    # handover). `requested` means no FE assigned yet → no push.
    if fe_id_before and status_before in {"scheduled", "in_progress"}:
        try:
            fe_user_id = await _fe_user_id_for_fe(db, fe_id_before)
            if fe_user_id:
                from app.modules.notifications.concierge_templates import (
                    notify_visit_cancelled_to_fe,
                )
                await notify_visit_cancelled_to_fe(
                    fe_user_id=fe_user_id,
                    visit_id=visit.id,
                    reason=structured_reason,
                )
        except Exception as e:
            # Notification is best-effort; the cancel itself already
            # committed, so swallow and log.
            logger.warning(
                "concierge.notify_cancel_to_fe.failed",
                visit_id=str(visit.id),
                error=str(e),
            )

    return await _visit_to_response(db, visit)


async def _fe_user_id_for_fe(db, fe_id: UUID) -> Optional[UUID]:
    """Resolve FieldExecutive.id → underlying user_id for push targeting."""
    fe = await db.get(FieldExecutive, fe_id)
    if not fe:
        return None
    return getattr(fe, "user_id", None)


# ── Concierge Phase 2 seller-facing endpoints (master spec section 5) ────


class SpecialistProfileResponse(BaseModel):
    specialist_id: str
    name: str
    photo_url: Optional[str]
    rating_avg: float
    visit_count_total: int
    joined_year: int
    verified: bool
    background_checked: bool


@seller_router.get(
    "/{visit_id}/specialist-profile",
    response_model=SpecialistProfileResponse,
)
async def get_specialist_profile(
    visit_id: UUID,
    current_user: BasicUser,
    db: DBSession,
):
    """Master spec section 5.3: specialist profile card data.

    Owner-only — visit must belong to the requesting seller. The `name`
    field returns first name + last initial (privacy + brand polish).
    Pilot-era defaults: rating 4.8 if no NPS rows yet (Phase 5 wires the
    real aggregate); background_checked=True (manual policy).
    """
    visit = await _load_visit_by_id(db, visit_id)
    if visit.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if visit.fe_id is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "SPECIALIST_NOT_ASSIGNED",
                "message": "We're still matching you with a specialist.",
            },
        )

    fe = await _load_fe_by_id(db, visit.fe_id)
    name_str = "Owmee Specialist"
    photo_url: Optional[str] = None
    joined_year = 2025
    if fe.user_id:
        u_res = await db.execute(select(User).where(User.id == fe.user_id))
        u = u_res.scalar_one_or_none()
        if u and u.name:
            parts = u.name.strip().split()
            first = parts[0] if parts else ""
            last_initial = f" {parts[-1][0].upper()}." if len(parts) > 1 else ""
            name_str = f"{first}{last_initial}".strip() or name_str
        if u and u.created_at:
            joined_year = u.created_at.year

    completed_res = await db.execute(
        select(FEVisit.id).where(FEVisit.fe_id == fe.id, FEVisit.status == "completed")
    )
    visit_count = len(completed_res.scalars().all())

    return SpecialistProfileResponse(
        specialist_id=str(fe.id),
        name=name_str,
        photo_url=photo_url,
        rating_avg=4.8,
        visit_count_total=visit_count,
        joined_year=joined_year,
        verified=True,
        background_checked=True,
    )


class SellerConfirmArrivalRequest(BaseModel):
    code_matched: bool


@seller_router.post(
    "/{visit_id}/seller-confirm-arrival",
)
async def seller_confirm_arrival(
    visit_id: UUID,
    body: SellerConfirmArrivalRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Master spec section 5.4: seller's at-door verification action.

    On match: stamp the confirmation timestamp. The visit's status
    transition to in_progress is owned by the FE-side `/start` endpoint
    (which already fires N6); this endpoint is the seller's confirmation
    record and does not move status.

    On mismatch: create an `fe_visit_issue` row with severity `urgent`
    and category `safety_concern` so admin web shows the alert. Phase 5
    introduces the table; for Phase 2 we log + return alerted=True.
    Phase 5 will replace the log with the real insert.
    """
    visit = await _load_visit_by_id(db, visit_id)
    if visit.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})

    if body.code_matched:
        from datetime import datetime, timezone
        visit.arrival_confirmed_by_seller_at = datetime.now(timezone.utc)
        await db.commit()
        return {"confirmed": True, "alerted": False}

    # Phase 5: real fe_visit_issues row + admin alert.
    issue = FEVisitIssue(
        visit_id=visit.id,
        reporter_user_id=current_user.user_id,
        category="safety_concern",
        severity="urgent",
        description="Seller flagged code mismatch at the door.",
        photo_urls=[],
    )
    db.add(issue)
    await db.commit()
    logger.error(
        "concierge.code_mismatch_alert",
        visit_id=str(visit.id),
        issue_id=str(issue.id),
        seller_id=str(visit.seller_id),
        fe_id=str(visit.fe_id) if visit.fe_id else None,
    )
    return {"confirmed": False, "alerted": True, "issue_id": str(issue.id)}


# ── FE-facing router: /v1/fe/visits ───────────────────────────────────────────

fe_router = APIRouter()
onboarding_router = APIRouter()


@onboarding_router.get("/me", response_model=FEResponse)
async def my_fe_onboarding(current_user: BasicUser, db: DBSession):
    fe = await fe_service.get_fe_by_user_id(db, current_user.user_id)
    if fe is None:
        raise HTTPException(status_code=404, detail={"error": "FE_INVITE_NOT_FOUND"})
    return _fe_to_response(fe)


@onboarding_router.post("/device", response_model=FEResponse)
async def bind_fe_device(body: FEDeviceBindRequest, current_user: BasicUser, db: DBSession):
    fe = await fe_service.get_fe_by_user_id(db, current_user.user_id)
    if fe is None:
        raise HTTPException(status_code=404, detail={"error": "FE_INVITE_NOT_FOUND"})
    try:
        fe_service.request_device_binding(
            fe,
            {
                "device_id": body.device_id,
                "platform": body.platform,
                "app_version": body.app_version,
                "os_version": body.os_version,
                "device_model": body.device_model,
                "push_token": body.push_token,
            },
        )
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=400, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@onboarding_router.post("/shift/check-in", response_model=FEResponse)
async def fe_shift_check_in(body: FEShiftCheckInRequest, current_fe: FEUser, db: DBSession):
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None:
        raise HTTPException(status_code=403, detail={"error": "FE_PROFILE_MISSING"})
    try:
        fe_service.check_in_shift(fe, location=body.location)
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=403, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@onboarding_router.post("/shift/check-out", response_model=FEResponse)
async def fe_shift_check_out(current_fe: FEUser, db: DBSession):
    fe = await fe_service.get_fe_by_user_id(db, current_fe.user_id)
    if fe is None:
        raise HTTPException(status_code=403, detail={"error": "FE_PROFILE_MISSING"})
    try:
        fe_service.check_out_shift(fe)
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=403, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@fe_router.get("/assigned", response_model=list[VisitResponse])
async def assigned_visits(current_fe: FEUser, db: DBSession):
    """List visits assigned to the current FE, newest first."""
    fe = await _operational_fe_for_user(db, current_fe.user_id)
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
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    return await _visit_to_response(db, visit)


@fe_router.post("/{visit_id}/start", response_model=VisitResponse)
async def start_visit(
    visit_id: UUID,
    current_fe: FEUser,
    db: DBSession,
):
    """FE taps "Arrived" — moves visit to in_progress + fires N6 (at the door).

    Master spec section 5.2: this is the "I'm at the seller's door" moment.
    The N6 push deep-links the seller to ArrivalVerificationScreen which
    shows the same arrival_verification_code generated at booking time.
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
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

    # Concierge Phase 2 N6: "at the door" notification with code.
    try:
        from app.modules.notifications.concierge_templates import notify_specialist_at_door
        first_name = await _fe_first_name(db, fe)
        await notify_specialist_at_door(
            seller_id=visit.seller_id,
            visit_id=visit.id,
            specialist_first_name=first_name,
            arrival_code=visit.arrival_verification_code or "----",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("concierge.notify_at_door.failed", visit_id=str(visit.id), error=str(e))

    return await _visit_to_response(db, visit)


@fe_router.post("/{visit_id}/start-route", response_model=VisitResponse)
async def start_route(
    visit_id: UUID,
    current_fe: FEUser,
    db: DBSession,
):
    """FE taps "Start route" in their day-of view — fires N4 ("on the way").

    No status change. The visit stays `scheduled` until the FE actually
    arrives (POST /start). This endpoint is purely a notification trigger
    so the seller's app shows progress before the door knock.
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})

    try:
        from app.modules.notifications.concierge_templates import notify_specialist_starting
        first_name = await _fe_first_name(db, fe)
        eta_label = ""
        if visit.scheduled_slot_start:
            eta_label = f"Estimated arrival: {visit.scheduled_slot_start.astimezone().strftime('%-I:%M%p').lower()}"
        await notify_specialist_starting(
            seller_id=visit.seller_id,
            visit_id=visit.id,
            specialist_first_name=first_name,
            eta_label=eta_label or "On the way",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("concierge.notify_start_route.failed", visit_id=str(visit.id), error=str(e))

    return await _visit_to_response(db, visit)


@fe_router.post("/{visit_id}/arriving-soon", response_model=VisitResponse)
async def arriving_soon(
    visit_id: UUID,
    current_fe: FEUser,
    db: DBSession,
):
    """FE taps "I'm 30 mins away" — fires N5.

    Same pattern as start-route — no status change, pure notification.
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})

    try:
        from app.modules.notifications.concierge_templates import notify_specialist_arriving_soon
        first_name = await _fe_first_name(db, fe)
        await notify_specialist_arriving_soon(
            seller_id=visit.seller_id,
            visit_id=visit.id,
            specialist_first_name=first_name,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("concierge.notify_arriving_soon.failed", visit_id=str(visit.id), error=str(e))

    return await _visit_to_response(db, visit)


async def _fe_first_name(db, fe) -> str | None:
    """Fetch the FE's user record's first name for notification copy."""
    if not fe.user_id:
        return None
    res = await db.execute(select(User).where(User.id == fe.user_id))
    u = res.scalar_one_or_none()
    if not u or not u.name:
        return None
    return u.name.strip().split()[0]


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
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
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
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
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
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
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
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if visit.status != "in_progress":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "VISIT_NOT_IN_PROGRESS",
                "message": "Start the visit before submitting the listing.",
            },
        )

    # Concierge Phase 3 (master spec section 6.4 + 6.6): cap at 10
    # listings per visit. Above that the specialist closes the visit
    # and books another. The cap protects ops capacity (a 60-90 minute
    # visit can't responsibly process more than 10 items).
    cnt_res = await db.execute(
        select(Listing.id).where(Listing.fe_visit_id == visit.id)
    )
    if len(cnt_res.scalars().all()) >= 10:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "MAX_LISTINGS_PER_VISIT",
                "message": "Max 10 items per visit. Close the visit and book another.",
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

    # Verify category exists and validate the listing-quality package before
    # creating any listing row.
    category = await _load_category(db, resolved_category_id)
    _validate_listing_package(category, body)
    category_family, category_specifics, kids_checklist = _clean_fe_category_specifics(category, body)

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
        age_suitability=body.age_suitability,
        hygiene_status=body.hygiene_status,
        serial_number=body.serial_number,
        city=body.city,
        locality=body.locality,
        listing_source="fe_assisted",
        fe_visit_id=visit.id,
        created_via_fe_visit_id=visit.id,  # Concierge Phase 4 timeline
        reviewed_by="fe",
        is_kids_item=bool(body.is_kids_item),
        kids_safety_checklist=kids_checklist,
        seller_review_snapshot={
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
            "source": "fe_assisted",
            "fe_visit_id": str(visit.id),
            "seller_confirmed": {
                "category_slug": category.slug,
                "category_family": category_family,
                "category_specifics": category_specifics,
                "title": body.title,
                "condition": body.condition,
                "price": float(body.price),
                "brand": body.brand,
                "model": body.model,
                "age_suitability": body.age_suitability,
                "hygiene_status": body.hygiene_status,
                "kids_safety_checklist": kids_checklist,
            },
        },
    )
    db.add(listing)
    await db.flush()

    # Concierge Phase 3 (master spec section 6.4): submit-listing NO
    # LONGER closes the visit. The specialist can submit multiple items
    # in a single visit and explicitly closes via POST /close-visit when
    # done. visit.status stays 'in_progress' until then; visit.outcome
    # only stamps at close-visit time.
    visit.listing_id = listing.id  # last-listing-pointer for the workflow signal

    await db.commit()
    await db.refresh(visit)

    logger.info(
        "fe_visit.listing_submitted",
        visit_id=str(visit.id),
        listing_id=str(listing.id),
    )
    return await _visit_to_response(db, visit)


class CloseVisitRequest(BaseModel):
    """Concierge Phase 3 (master spec section 6.6) — explicit close.

    `outcome` carries the final status of the visit:
      listed                  — at least one listing was submitted
      rejected_item           — specialist judged none worth listing
      seller_missing_verification — KYC/ID didn't pan out
      pickup_not_ready        — seller wasn't ready, reschedule

    Phase 5 additions:
      handover_photo_r2_key — group photo of items being taken (optional)
      handover_skipped — true if seller agreed verbally instead
    """
    outcome: str = Field(..., pattern=r"^(listed|rejected_item|seller_missing_verification|pickup_not_ready)$")
    outcome_reason: Optional[str] = Field(None, max_length=500)
    handover_photo_r2_key: Optional[str] = Field(None, max_length=500)
    handover_skipped: bool = False


@fe_router.post("/{visit_id}/close-visit", response_model=VisitResponse)
async def close_visit(
    visit_id: UUID,
    body: CloseVisitRequest,
    current_fe: FEUser,
    db: DBSession,
):
    """Master spec 6.6 close-visit. Triggers earnings recording +
    workflow outcome signal. Phase 5 will add the chain-of-custody
    handover photo + seller-confirmation step in front of this; for
    Phase 3 it's a clean status transition only.
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if visit.status != "in_progress":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "VISIT_NOT_IN_PROGRESS",
                "message": f"Cannot close from {visit.status}.",
            },
        )

    # Phase 5: stamp handover artefacts before the status transition.
    if body.handover_photo_r2_key:
        visit.handover_photo_r2_key = body.handover_photo_r2_key
    if body.handover_skipped:
        visit.handover_skipped = True

    listing_id_for_signal: Optional[UUID] = visit.listing_id
    try:
        await fe_service.complete_visit(
            db,
            visit=visit,
            outcome=body.outcome,
            outcome_reason=body.outcome_reason,
            listing_id=listing_id_for_signal,
        )
    except fe_service.IllegalVisitTransition as e:
        raise HTTPException(
            status_code=409,
            detail={"error": "ILLEGAL_TRANSITION", "message": str(e)},
        )
    except TypeError:
        # complete_visit may not accept outcome_reason kwarg; retry
        # without it. Defensive against signature drift.
        await fe_service.complete_visit(
            db,
            visit=visit,
            outcome=body.outcome,
            listing_id=listing_id_for_signal,
        )

    await db.commit()
    await db.refresh(visit)

    if visit.workflow_id:
        await _signal_fe_outcome(
            visit.workflow_id,
            outcome=body.outcome,
            outcome_reason=body.outcome_reason,
            listing_id=str(listing_id_for_signal) if listing_id_for_signal else None,
        )

    logger.info(
        "fe_visit.closed",
        visit_id=str(visit.id),
        outcome=body.outcome,
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
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
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


# ── Concierge Phase 5: trust safety net (master spec section 8) ──────────────


_ISSUE_CATEGORIES = {
    "item_damage", "seller_backout", "address_mismatch",
    "seller_absent", "safety_concern", "other",
}
_CATEGORY_DEFAULT_SEVERITY = {
    "item_damage": "medium",
    "seller_backout": "medium",
    "address_mismatch": "low",
    "seller_absent": "high",
    "safety_concern": "urgent",
    "other": "low",
}


class IssueReportRequest(BaseModel):
    category: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = Field(None, max_length=2000)
    photo_urls: list[str] = Field(default_factory=list, max_length=10)


class IssueResponse(BaseModel):
    id: str
    visit_id: str
    category: str
    severity: str
    description: Optional[str]
    photo_urls: list[str]
    admin_resolved_at: Optional[str]
    admin_resolution_notes: Optional[str]
    created_at: str

    @classmethod
    def from_row(cls, r: FEVisitIssue) -> "IssueResponse":
        return cls(
            id=str(r.id),
            visit_id=str(r.visit_id),
            category=r.category,
            severity=r.severity,
            description=r.description,
            photo_urls=list(r.photo_urls or []),
            admin_resolved_at=r.admin_resolved_at.isoformat() if r.admin_resolved_at else None,
            admin_resolution_notes=r.admin_resolution_notes,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )


@fe_router.post("/{visit_id}/issues", response_model=IssueResponse, status_code=201)
async def fe_report_issue(
    visit_id: UUID,
    body: IssueReportRequest,
    current_fe: FEUser,
    db: DBSession,
):
    """Specialist-side issue report — master spec section 8.2.

    Severity is auto-assigned from the category. urgent issues should
    page admin (Slack/Discord webhook is env-driven and off by default
    in pilot; admin web /admin/fe-issues page surfaces the alert).
    """
    visit = await _load_visit_by_id(db, visit_id)
    fe = await _operational_fe_for_user(db, current_fe.user_id)
    if visit.fe_id != fe.id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if body.category not in _ISSUE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_CATEGORY",
                "message": f"category must be one of {sorted(_ISSUE_CATEGORIES)}",
            },
        )
    severity = _CATEGORY_DEFAULT_SEVERITY[body.category]

    issue = FEVisitIssue(
        visit_id=visit.id,
        reporter_user_id=current_fe.user_id,
        category=body.category,
        severity=severity,
        description=body.description,
        photo_urls=body.photo_urls,
    )
    db.add(issue)
    await db.commit()
    await db.refresh(issue)
    logger.info(
        "fe_visit_issue.created",
        visit_id=str(visit.id),
        issue_id=str(issue.id),
        category=body.category,
        severity=severity,
    )
    return IssueResponse.from_row(issue)


# ── NPS (master spec section 8.4) ────────────────────────────────────


class NpsSubmitRequest(BaseModel):
    nps_score: int = Field(..., ge=0, le=10)
    free_text: Optional[str] = Field(None, max_length=2000)


@seller_router.post("/{visit_id}/nps", status_code=201)
async def submit_nps(
    visit_id: UUID,
    body: NpsSubmitRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Seller submits NPS for the visit's specialist. One per visit.

    The specialist row is required to derive specialist_user_id. If the
    FE record has no linked user, we 409 — that's a data-quality issue
    ops should fix, not silently skip.
    """
    visit = await _load_visit_by_id(db, visit_id)
    if visit.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "NOT_YOUR_VISIT"})
    if visit.status != "completed":
        raise HTTPException(
            status_code=409,
            detail={"error": "VISIT_NOT_COMPLETED"},
        )
    if visit.fe_id is None:
        raise HTTPException(status_code=409, detail={"error": "NO_SPECIALIST"})

    fe = await _load_fe_by_id(db, visit.fe_id)
    if not fe.user_id:
        raise HTTPException(status_code=409, detail={"error": "SPECIALIST_HAS_NO_USER"})

    # Reject duplicate NPS for the same visit (unique index also blocks at DB).
    dup_res = await db.execute(
        select(FEVisitNps).where(FEVisitNps.visit_id == visit.id)
    )
    if dup_res.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail={"error": "NPS_ALREADY_SUBMITTED"},
        )

    nps = FEVisitNps(
        visit_id=visit.id,
        seller_user_id=current_user.user_id,
        specialist_user_id=fe.user_id,
        nps_score=body.nps_score,
        free_text=body.free_text,
    )
    db.add(nps)
    await db.commit()
    logger.info(
        "fe_visit_nps.submitted",
        visit_id=str(visit.id),
        score=body.nps_score,
    )
    return {"submitted": True, "nps_score": body.nps_score}


# ── Admin router: /v1/admin/fe-visits ─────────────────────────────────────────
#
# Pass 3: real AdminUser dep (AdminAny for reads, AdminL2 for writes).

admin_router = APIRouter()


@admin_router.get("/issues", response_model=list[IssueResponse])
async def admin_list_issues(
    current_admin: AdminAny,
    db: DBSession,
    severity: Optional[str] = None,
    unresolved_only: bool = True,
):
    """Concierge Phase 5 — admin web /admin/fe-issues backing list.

    Default: unresolved issues newest-first. severity filter narrows to
    'urgent' for the at-a-glance dashboard surface; pass empty/null to
    see all severities.
    """
    q = select(FEVisitIssue).order_by(desc(FEVisitIssue.created_at))
    if unresolved_only:
        q = q.where(FEVisitIssue.admin_resolved_at.is_(None))
    if severity:
        q = q.where(FEVisitIssue.severity == severity)
    res = await db.execute(q.limit(200))
    rows = list(res.scalars().all())
    return [IssueResponse.from_row(r) for r in rows]


class ResolveIssueRequest(BaseModel):
    resolution_notes: Optional[str] = Field(None, max_length=2000)


@admin_router.post("/issues/{issue_id}/resolve", response_model=IssueResponse)
async def admin_resolve_issue(
    issue_id: UUID,
    body: ResolveIssueRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    res = await db.execute(select(FEVisitIssue).where(FEVisitIssue.id == issue_id))
    issue = res.scalar_one_or_none()
    if issue is None:
        raise HTTPException(status_code=404, detail={"error": "ISSUE_NOT_FOUND"})
    from datetime import datetime, timezone
    issue.admin_resolved_at = datetime.now(timezone.utc)
    issue.admin_resolution_notes = body.resolution_notes
    await db.commit()
    await db.refresh(issue)
    return IssueResponse.from_row(issue)


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
    return [_fe_to_response(fe) for fe in fes]


@admin_router.post("/fes", response_model=FEResponse, status_code=201)
async def admin_create_fe(
    body: CreateFERequest,
    current_admin: AdminL2,
    db: DBSession,
):
    if not body.user_id and not body.phone_number:
        raise HTTPException(status_code=400, detail={"error": "USER_OR_PHONE_REQUIRED"})
    user = None
    if body.user_id:
        try:
            user_uuid = UUID(body.user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail={"error": "INVALID_USER_ID"})
        res = await db.execute(select(User).where(User.id == user_uuid))
        user = res.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})
    else:
        normalized = _normalize_india_phone(body.phone_number or "")
        res = await db.execute(select(User).where(User.phone_number == normalized))
        user = res.scalar_one_or_none()
        if user is None:
            user = User(
                phone_number=normalized,
                phone_verified=False,
                tier="basic",
                kyc_status="not_started",
                auth_state="guest",
                buyer_eligible=False,
                seller_tier="not_eligible",
            )
            db.add(user)
            await db.flush()

    try:
        fe = await fe_service.create_fe_for_user(
            db,
            user=user,
            city=body.city,
            created_by_admin_id=current_admin.admin_id,
            employment_type=body.employment_type,
            vendor_name=body.vendor_name,
            service_zones=body.service_zones,
            category_certifications=body.category_certifications,
            languages=body.languages,
            daily_capacity=body.daily_capacity,
            active=False,
        )
        if body.admin_notes:
            fe.admin_notes = body.admin_notes
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=400, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)

    return _fe_to_response(fe)


@admin_router.get("/fes/{fe_id}", response_model=FEResponse)
async def admin_get_fe(fe_id: UUID, current_admin: AdminAny, db: DBSession):
    return _fe_to_response(await _load_fe_by_id(db, fe_id))


@admin_router.patch("/fes/{fe_id}", response_model=FEResponse)
async def admin_update_fe_profile(
    fe_id: UUID,
    body: UpdateFEProfileRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    fe = await _load_fe_by_id(db, fe_id)
    try:
        fe_service.update_fe_profile(
            fe,
            city=body.city,
            employment_type=body.employment_type,
            vendor_name=body.vendor_name,
            service_zones=body.service_zones,
            category_certifications=body.category_certifications,
            languages=body.languages,
            daily_capacity=body.daily_capacity,
            profile_snapshot=body.profile_snapshot,
            admin_notes=body.admin_notes,
        )
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=400, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@admin_router.post("/fes/{fe_id}/verification", response_model=FEResponse)
async def admin_update_fe_verification(
    fe_id: UUID,
    body: FEStatusDecisionRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    fe = await _load_fe_by_id(db, fe_id)
    try:
        fe_service.set_verification_status(fe, body.status, note=body.note)
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=400, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@admin_router.post("/fes/{fe_id}/training", response_model=FEResponse)
async def admin_update_fe_training(
    fe_id: UUID,
    body: FEStatusDecisionRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    fe = await _load_fe_by_id(db, fe_id)
    try:
        fe_service.set_training_status(fe, body.status, note=body.note)
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=400, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@admin_router.post("/fes/{fe_id}/device", response_model=FEResponse)
async def admin_decide_fe_device(
    fe_id: UUID,
    body: FEDeviceDecisionRequest,
    current_admin: AdminL2,
    db: DBSession,
):
    fe = await _load_fe_by_id(db, fe_id)
    try:
        fe_service.approve_device(fe, approved=body.approved, note=body.note)
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=400, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@admin_router.post("/fes/{fe_id}/activate", response_model=FEResponse)
async def admin_activate_fe(fe_id: UUID, current_admin: AdminL2, db: DBSession):
    fe = await _load_fe_by_id(db, fe_id)
    try:
        fe_service.activate_fe(fe)
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=409, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@admin_router.post("/fes/{fe_id}/suspend", response_model=FEResponse)
async def admin_suspend_fe(fe_id: UUID, body: FEActionRequest, current_admin: AdminL2, db: DBSession):
    fe = await _load_fe_by_id(db, fe_id)
    try:
        fe_service.suspend_fe(fe, body.reason or "")
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=400, detail={"error": e.code, "message": e.message})
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


@admin_router.post("/fes/{fe_id}/deactivate", response_model=FEResponse)
async def admin_deactivate_fe(fe_id: UUID, body: FEActionRequest, current_admin: AdminL2, db: DBSession):
    fe = await _load_fe_by_id(db, fe_id)
    fe_service.deactivate_fe(fe, reason=body.reason)
    await db.commit()
    await db.refresh(fe)
    return _fe_to_response(fe)


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
    category = await _load_category(db, category_uuid)
    try:
        fe_service.assert_fe_ready_for_assignment(fe, required_categories={category.slug})
    except fe_service.FEOnboardingError as e:
        raise HTTPException(status_code=409, detail={"error": e.code, "message": e.message})

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

    # Concierge Phase 2 N2: notify seller "Vikram is your Owmee Specialist"
    try:
        await _fire_specialist_assigned_notification(db, visit, fe)
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "concierge.notify_specialist_assigned.failed",
            visit_id=str(visit.id),
            error=str(e),
        )

    return await _visit_to_response(db, visit)


async def _fire_specialist_assigned_notification(db, visit, fe) -> None:
    """N2 wrapper — derives display fields from the FE's linked user row.

    `fe.user_id` may be unset for legacy FE records; in that case we call
    the notify with all-fallbacks so the seller still gets *something*.
    """
    from app.modules.notifications.concierge_templates import notify_specialist_assigned

    first_name: str | None = None
    last_initial: str | None = None
    visit_count = 0
    if fe.user_id:
        user_res = await db.execute(select(User).where(User.id == fe.user_id))
        u = user_res.scalar_one_or_none()
        if u and u.name:
            parts = u.name.strip().split()
            first_name = parts[0] if parts else None
            last_initial = parts[-1][0] if len(parts) > 1 else None

    # Pull a rough visit count for trust signal. Cheap COUNT(*).
    cnt_res = await db.execute(
        select(FEVisit.id).where(FEVisit.fe_id == fe.id, FEVisit.status == "completed")
    )
    visit_count = len(cnt_res.scalars().all())

    await notify_specialist_assigned(
        seller_id=visit.seller_id,
        visit_id=visit.id,
        specialist_first_name=first_name,
        specialist_last_initial=last_initial,
        rating=4.8,  # NPS aggregate ships in Phase 5; default for now
        visit_count=visit_count,
    )


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
        category = await _load_category(db, category_uuid)
        try:
            fe_service.assert_fe_ready_for_assignment(fe, required_categories={category.slug})
        except fe_service.FEOnboardingError as e:
            raise HTTPException(status_code=409, detail={"error": e.code, "message": e.message})
    elif visit.category_id:
        category = await _load_category(db, visit.category_id)
        try:
            fe_service.assert_fe_ready_for_assignment(fe, required_categories={category.slug})
        except fe_service.FEOnboardingError as e:
            raise HTTPException(status_code=409, detail={"error": e.code, "message": e.message})

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
