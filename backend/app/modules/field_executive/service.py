"""
Field Executive service — Sprint 4 / Pass 3.

Pure-logic + async DB helpers for FE workflow transitions. All state changes
go through these functions so that admin endpoints, FE endpoints, seller
endpoints and Temporal activities all follow the same invariants.

Status state machine:
    requested  -> scheduled (admin assigns)
    requested  -> cancelled (seller cancels)
    scheduled  -> in_progress (FE starts)
    scheduled  -> cancelled   (admin/seller cancels before start)
    scheduled  -> postponed   (FE or admin postpones)
    in_progress -> completed | no_show | postponed

Pass 3: assign_fe now captures `category_id` so FE capture can submit a
listing without client-side category resolution.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.field_executive.models import FEVisit, FieldExecutive
from app.modules.identity_auth.models import User

logger = structlog.get_logger()


# ── Allowed transitions ───────────────────────────────────────────────────────

_ALLOWED_STATUS_TRANSITIONS = {
    "requested": {"scheduled", "cancelled"},
    "scheduled": {"in_progress", "cancelled", "postponed"},
    "in_progress": {"completed", "no_show", "postponed"},
    # Terminal states — no transitions out.
    "completed": set(),
    "cancelled": set(),
    "postponed": {"scheduled"},   # admin can re-schedule a postponed visit
    "no_show": set(),
}

_VALID_OUTCOMES = {
    "listed",
    "rejected_item",
    "seller_missing_verification",
    "pickup_not_ready",
    "postponed",
}

ONBOARDING_TERMINAL_STATUSES = {"rejected", "deactivated"}
ONBOARDING_BLOCKED_STATUSES = ONBOARDING_TERMINAL_STATUSES | {"suspended"}
VALID_EMPLOYMENT_TYPES = {"internal", "contractor", "vendor_staff"}
VALID_VERIFICATION_STATUSES = {"pending", "approved", "rejected", "resubmission_required"}
VALID_TRAINING_STATUSES = {"not_started", "in_progress", "certified", "failed", "expired"}
VALID_DEVICE_STATUSES = {"not_bound", "pending_admin_approval", "approved", "blocked"}
VALID_SHIFT_STATUSES = {"off", "available", "assigned", "on_route", "busy", "blocked"}


class IllegalVisitTransition(ValueError):
    pass


class FEOnboardingError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean_list(values: list[str] | None) -> list[str]:
    return list(dict.fromkeys(str(v).strip() for v in (values or []) if str(v).strip()))


def _status(fe: FieldExecutive, field: str, fallback: str) -> str:
    value = getattr(fe, field, None)
    if value:
        return str(value)
    active = bool(getattr(fe, "active", False))
    if field == "onboarding_status":
        return "active" if active else fallback
    if active and field == "verification_status":
        return "approved"
    if active and field == "training_status":
        return "certified"
    if active and field == "device_status":
        return "approved"
    return fallback


def readiness_gaps(fe: FieldExecutive) -> list[str]:
    gaps: list[str] = []
    onboarding_status = _status(fe, "onboarding_status", "candidate")
    if onboarding_status in ONBOARDING_TERMINAL_STATUSES:
        gaps.append(onboarding_status)
    if onboarding_status == "suspended":
        gaps.append("suspended")
    if _status(fe, "verification_status", "pending") != "approved":
        gaps.append("verification_not_approved")
    if _status(fe, "training_status", "not_started") != "certified":
        gaps.append("training_not_certified")
    if _status(fe, "device_status", "not_bound") != "approved":
        gaps.append("device_not_approved")
    capacity = getattr(fe, "daily_capacity", 4 if getattr(fe, "active", False) else 0)
    if int(capacity or 0) <= 0:
        gaps.append("capacity_missing")
    zones = list(getattr(fe, "service_zones", None) or (["legacy"] if getattr(fe, "active", False) else []))
    if not zones:
        gaps.append("service_zones_missing")
    categories = list(getattr(fe, "category_certifications", None) or (["*"] if getattr(fe, "active", False) else []))
    if not categories:
        gaps.append("category_certification_missing")
    return list(dict.fromkeys(gaps))


def is_fe_ready(fe: FieldExecutive) -> bool:
    return bool(getattr(fe, "active", False)) and not readiness_gaps(fe)


def assert_fe_ready_for_assignment(
    fe: FieldExecutive,
    *,
    required_categories: set[str] | None = None,
) -> None:
    if not getattr(fe, "active", False):
        raise FEOnboardingError("FE_INACTIVE", "FE is not active.")
    gaps = readiness_gaps(fe)
    if gaps:
        raise FEOnboardingError("FE_NOT_READY", f"FE onboarding is incomplete: {', '.join(gaps)}")
    if getattr(fe, "current_shift", None) == "blocked":
        raise FEOnboardingError("FE_SHIFT_BLOCKED", "FE shift is blocked.")
    categories = set(getattr(fe, "category_certifications", None) or (["*"] if getattr(fe, "active", False) else []))
    if "*" not in categories and required_categories:
        missing = sorted(required_categories - categories)
        if missing:
            raise FEOnboardingError("FE_CATEGORY_NOT_CERTIFIED", f"FE is not certified for: {', '.join(missing)}")


def _next_status_from_checks(fe: FieldExecutive) -> str:
    if _status(fe, "onboarding_status", "candidate") in ONBOARDING_BLOCKED_STATUSES:
        return fe.onboarding_status
    if _status(fe, "verification_status", "pending") != "approved":
        return "verification_pending"
    if _status(fe, "training_status", "not_started") != "certified":
        return "training_pending"
    if _status(fe, "device_status", "not_bound") != "approved":
        return "certified"
    return "device_ready"


def refresh_onboarding_status(fe: FieldExecutive) -> None:
    if getattr(fe, "active", False):
        fe.onboarding_status = "active"
        return
    fe.onboarding_status = _next_status_from_checks(fe)


# ── FE CRUD ───────────────────────────────────────────────────────────────────

async def get_fe_by_user_id(
    db: AsyncSession, user_id: UUID
) -> Optional[FieldExecutive]:
    res = await db.execute(
        select(FieldExecutive).where(FieldExecutive.user_id == user_id)
    )
    return res.scalar_one_or_none()


async def assert_fe_user_ready_for_assignment(
    db: AsyncSession,
    user_id: UUID,
    *,
    required_categories: set[str] | None = None,
) -> FieldExecutive:
    """Resolve a user id to an FE profile and enforce assignment readiness.

    Admin endpoints should use this rather than checking ``users.role``. The
    FE profile is the operational source of truth for active status, training,
    verification, device approval, capacity, zones, and category coverage.
    """
    fe = await get_fe_by_user_id(db, user_id)
    if not fe:
        raise FEOnboardingError("FE_PROFILE_NOT_FOUND", "FE profile was not found.")
    assert_fe_ready_for_assignment(fe, required_categories=required_categories)
    return fe


async def is_active_fe(db: AsyncSession, user_id: UUID) -> bool:
    fe = await get_fe_by_user_id(db, user_id)
    return bool(fe and fe.active)


async def _next_fe_code(db: AsyncSession, city: str) -> str:
    """Produce next fe_code like FE-BLR-007 (3-letter city prefix, zero-pad to 3)."""
    prefix = (city[:3] or "XXX").upper()
    res = await db.execute(
        select(func.count(FieldExecutive.id)).where(FieldExecutive.city == city)
    )
    count = res.scalar_one() or 0
    return f"FE-{prefix}-{(count + 1):03d}"


async def create_fe_for_user(
    db: AsyncSession,
    user: User,
    city: str,
    created_by_admin_id: Optional[UUID] = None,
    *,
    employment_type: str = "contractor",
    vendor_name: str | None = None,
    service_zones: list[str] | None = None,
    category_certifications: list[str] | None = None,
    languages: list[str] | None = None,
    daily_capacity: int = 4,
    active: bool = False,
) -> FieldExecutive:
    existing = await get_fe_by_user_id(db, user.id)
    if existing:
        return existing
    if employment_type not in VALID_EMPLOYMENT_TYPES:
        raise FEOnboardingError("INVALID_EMPLOYMENT_TYPE", "Unsupported FE employment type.")
    if daily_capacity < 1 or daily_capacity > 12:
        raise FEOnboardingError("INVALID_DAILY_CAPACITY", "Daily capacity must be between 1 and 12.")

    code = await _next_fe_code(db, city)
    fe = FieldExecutive(
        user_id=user.id,
        fe_code=code,
        city=city,
        active=active,
        current_shift="off",
        created_by_admin_id=created_by_admin_id,
        onboarding_status="active" if active else "candidate",
        verification_status="approved" if active else "pending",
        training_status="certified" if active else "not_started",
        device_status="approved" if active else "not_bound",
        employment_type=employment_type,
        vendor_name=vendor_name,
        manager_admin_id=created_by_admin_id,
        service_zones=_clean_list(service_zones) or ([city] if active else []),
        category_certifications=_clean_list(category_certifications) or (["*"] if active else []),
        languages=_clean_list(languages),
        daily_capacity=daily_capacity,
        profile_snapshot={},
        onboarding_checklist={},
        device_binding={},
        risk_metrics={},
        verified_at=_now() if active else None,
        certified_at=_now() if active else None,
        device_approved_at=_now() if active else None,
        activated_at=_now() if active else None,
    )
    db.add(fe)
    await db.flush()
    logger.info("fe.created", user_id=str(user.id), fe_code=code, city=city)
    return fe


def update_fe_profile(
    fe: FieldExecutive,
    *,
    city: str | None = None,
    employment_type: str | None = None,
    vendor_name: str | None = None,
    service_zones: list[str] | None = None,
    category_certifications: list[str] | None = None,
    languages: list[str] | None = None,
    daily_capacity: int | None = None,
    profile_snapshot: dict | None = None,
    admin_notes: str | None = None,
) -> None:
    if city is not None:
        if len(city.strip()) < 2:
            raise FEOnboardingError("INVALID_CITY", "City is required.")
        fe.city = city.strip()
    if employment_type is not None:
        if employment_type not in VALID_EMPLOYMENT_TYPES:
            raise FEOnboardingError("INVALID_EMPLOYMENT_TYPE", "Unsupported FE employment type.")
        fe.employment_type = employment_type
    if vendor_name is not None:
        fe.vendor_name = vendor_name.strip() or None
    if service_zones is not None:
        fe.service_zones = _clean_list(service_zones)
    if category_certifications is not None:
        fe.category_certifications = _clean_list(category_certifications)
    if languages is not None:
        fe.languages = _clean_list(languages)
    if daily_capacity is not None:
        if daily_capacity < 1 or daily_capacity > 12:
            raise FEOnboardingError("INVALID_DAILY_CAPACITY", "Daily capacity must be between 1 and 12.")
        fe.daily_capacity = daily_capacity
    if profile_snapshot is not None:
        fe.profile_snapshot = profile_snapshot
    if admin_notes is not None:
        fe.admin_notes = admin_notes
    refresh_onboarding_status(fe)


def set_verification_status(fe: FieldExecutive, status: str, *, note: str | None = None) -> None:
    if status not in VALID_VERIFICATION_STATUSES:
        raise FEOnboardingError("INVALID_VERIFICATION_STATUS", "Unsupported verification status.")
    fe.verification_status = status
    checklist = dict(getattr(fe, "onboarding_checklist", None) or {})
    checklist["verification_note"] = note
    checklist["verification_updated_at"] = _now().isoformat()
    fe.onboarding_checklist = checklist
    if status == "approved":
        fe.verified_at = fe.verified_at or _now()
    elif status in {"rejected", "resubmission_required"}:
        fe.active = False
        if status == "rejected":
            fe.onboarding_status = "rejected"
            fe.rejected_at = _now()
            fe.admin_notes = note or fe.admin_notes
            return
    refresh_onboarding_status(fe)


def set_training_status(fe: FieldExecutive, status: str, *, note: str | None = None) -> None:
    if status not in VALID_TRAINING_STATUSES:
        raise FEOnboardingError("INVALID_TRAINING_STATUS", "Unsupported training status.")
    fe.training_status = status
    checklist = dict(getattr(fe, "onboarding_checklist", None) or {})
    checklist["training_note"] = note
    checklist["training_updated_at"] = _now().isoformat()
    fe.onboarding_checklist = checklist
    if status == "certified":
        fe.certified_at = fe.certified_at or _now()
    else:
        fe.active = False
    refresh_onboarding_status(fe)


def request_device_binding(fe: FieldExecutive, payload: dict) -> None:
    if _status(fe, "onboarding_status", "candidate") in ONBOARDING_TERMINAL_STATUSES:
        raise FEOnboardingError("FE_NOT_OPERATIONAL", "This FE profile is no longer operational.")
    device_id = str(payload.get("device_id") or "").strip()
    if not device_id:
        raise FEOnboardingError("DEVICE_ID_REQUIRED", "Device id is required.")
    existing = getattr(fe, "device_binding", None) or {}
    if existing.get("device_id") and existing.get("device_id") != device_id and fe.device_status == "approved":
        fe.device_status = "pending_admin_approval"
        payload["previous_device_id"] = existing.get("device_id")
    else:
        fe.device_status = "pending_admin_approval"
    fe.device_binding = {
        **existing,
        **payload,
        "device_id": device_id,
        "requested_at": _now().isoformat(),
    }
    fe.last_seen_at = _now()
    if fe.active:
        fe.active = False
        fe.onboarding_status = "certified"
    refresh_onboarding_status(fe)


def approve_device(fe: FieldExecutive, *, approved: bool, note: str | None = None) -> None:
    if approved:
        if not (getattr(fe, "device_binding", None) or {}).get("device_id"):
            raise FEOnboardingError("DEVICE_NOT_BOUND", "FE must bind a device before approval.")
        fe.device_status = "approved"
        fe.device_approved_at = _now()
    else:
        fe.device_status = "blocked"
        fe.active = False
    checklist = dict(getattr(fe, "onboarding_checklist", None) or {})
    checklist["device_note"] = note
    checklist["device_updated_at"] = _now().isoformat()
    fe.onboarding_checklist = checklist
    refresh_onboarding_status(fe)


def activate_fe(fe: FieldExecutive) -> None:
    gaps = readiness_gaps(fe)
    if gaps:
        raise FEOnboardingError("FE_NOT_READY", f"Cannot activate FE. Missing: {', '.join(gaps)}")
    fe.active = True
    fe.onboarding_status = "active"
    fe.suspended_at = None
    fe.suspended_reason = None
    fe.activated_at = fe.activated_at or _now()


def suspend_fe(fe: FieldExecutive, reason: str) -> None:
    if not reason.strip():
        raise FEOnboardingError("SUSPENSION_REASON_REQUIRED", "Suspension reason is required.")
    fe.active = False
    fe.onboarding_status = "suspended"
    fe.suspended_at = _now()
    fe.suspended_reason = reason.strip()
    fe.current_shift = "blocked"


def deactivate_fe(fe: FieldExecutive, reason: str | None = None) -> None:
    fe.active = False
    fe.onboarding_status = "deactivated"
    fe.deactivated_at = _now()
    fe.current_shift = "off"
    if reason:
        fe.admin_notes = reason


def check_in_shift(fe: FieldExecutive, *, location: dict | None = None) -> None:
    assert_fe_ready_for_assignment(fe)
    fe.current_shift = "available"
    fe.shift_started_at = _now()
    fe.shift_location = location or {}
    fe.last_seen_at = _now()


def check_out_shift(fe: FieldExecutive) -> None:
    if _status(fe, "onboarding_status", "candidate") in ONBOARDING_BLOCKED_STATUSES:
        raise FEOnboardingError("FE_NOT_OPERATIONAL", "FE is not operational.")
    fe.current_shift = "off"
    fe.shift_started_at = None
    fe.shift_location = {}
    fe.last_seen_at = _now()


# ── Visit CRUD ────────────────────────────────────────────────────────────────

async def create_visit_request(
    db: AsyncSession,
    *,
    seller: User,
    requested_start: datetime,
    requested_end: datetime,
    address_snapshot: dict,
    category_hint: str,
    item_notes: Optional[str] = None,
    notes_tags: Optional[list[str]] = None,
) -> FEVisit:
    if requested_end <= requested_start:
        raise ValueError("requested_slot_end must be after requested_slot_start")

    # Block bookings in the past. Mobile slot picker hides past slots
    # already, but the API was unguarded until QA flagged it (a malicious
    # or out-of-sync client could schedule a visit "yesterday"). 30 min
    # of grace lets a slow round-trip during a slot's first minute still
    # succeed; anything older than that is clearly a mistake or attack.
    now_utc = datetime.now(timezone.utc)
    if requested_start < now_utc - timedelta(minutes=30):
        raise ValueError("requested_slot_start cannot be in the past")

    # Concierge Phase 2: generate the 4-digit at-door verification code
    # right here so it's stable from booking through visit-day. Zero-pad
    # to 4 chars so codes like "0042" stay 4 digits in display.
    import secrets
    arrival_code = f"{secrets.randbelow(10000):04d}"

    visit = FEVisit(
        seller_id=seller.id,
        requested_slot_start=requested_start,
        requested_slot_end=requested_end,
        address_snapshot=address_snapshot,
        category_hint=category_hint,
        item_notes=item_notes,
        notes_tags=notes_tags or [],
        arrival_verification_code=arrival_code,
        status="requested",
    )
    db.add(visit)
    await db.flush()
    logger.info(
        "fe_visit.requested",
        visit_id=str(visit.id),
        seller_id=str(seller.id),
        category=category_hint,
        tags=notes_tags or [],
    )
    return visit


async def _apply_status_transition(
    visit: FEVisit, new_status: str
) -> None:
    allowed = _ALLOWED_STATUS_TRANSITIONS.get(visit.status, set())
    if new_status not in allowed:
        raise IllegalVisitTransition(
            f"Cannot transition visit from {visit.status} to {new_status}"
        )
    visit.status = new_status


async def assign_fe(
    db: AsyncSession,
    *,
    visit: FEVisit,
    fe: FieldExecutive,
    scheduled_start: datetime,
    scheduled_end: datetime,
    category_id: Optional[UUID] = None,
) -> FEVisit:
    if visit.status not in ("requested", "postponed"):
        raise IllegalVisitTransition(
            f"Can only assign from requested/postponed, not {visit.status}"
        )
    if scheduled_end <= scheduled_start:
        raise ValueError("scheduled_slot_end must be after scheduled_slot_start")
    assert_fe_ready_for_assignment(fe)

    visit.fe_id = fe.id
    visit.scheduled_slot_start = scheduled_start
    visit.scheduled_slot_end = scheduled_end
    if category_id is not None:
        visit.category_id = category_id
    await _apply_status_transition(visit, "scheduled")
    logger.info(
        "fe_visit.assigned",
        visit_id=str(visit.id),
        fe_id=str(fe.id),
        fe_code=fe.fe_code,
        category_id=str(category_id) if category_id else None,
    )
    return visit


async def reassign_fe(
    db: AsyncSession,
    *,
    visit: FEVisit,
    new_fe: FieldExecutive,
    scheduled_start: Optional[datetime] = None,
    scheduled_end: Optional[datetime] = None,
    category_id: Optional[UUID] = None,
) -> FEVisit:
    if visit.status != "scheduled":
        raise IllegalVisitTransition(
            f"Can only reassign a scheduled visit, not {visit.status}"
        )
    assert_fe_ready_for_assignment(new_fe)

    visit.fe_id = new_fe.id
    if scheduled_start and scheduled_end:
        if scheduled_end <= scheduled_start:
            raise ValueError("scheduled_slot_end must be after scheduled_slot_start")
        visit.scheduled_slot_start = scheduled_start
        visit.scheduled_slot_end = scheduled_end
    if category_id is not None:
        visit.category_id = category_id
    logger.info(
        "fe_visit.reassigned",
        visit_id=str(visit.id),
        new_fe_id=str(new_fe.id),
    )
    return visit


async def start_visit(db: AsyncSession, *, visit: FEVisit) -> FEVisit:
    await _apply_status_transition(visit, "in_progress")
    visit.started_at = datetime.now(timezone.utc)
    logger.info("fe_visit.started", visit_id=str(visit.id))
    return visit


async def complete_visit(
    db: AsyncSession,
    *,
    visit: FEVisit,
    outcome: str,
    outcome_reason: Optional[str] = None,
    listing_id: Optional[UUID] = None,
) -> FEVisit:
    if outcome not in _VALID_OUTCOMES:
        raise ValueError(f"Invalid outcome: {outcome}")

    # Outcome -> status mapping
    if outcome == "listed":
        target = "completed"
    elif outcome == "rejected_item":
        target = "completed"
    elif outcome == "seller_missing_verification":
        target = "completed"
    elif outcome == "pickup_not_ready":
        target = "no_show"
    elif outcome == "postponed":
        target = "postponed"
    else:  # defensive — should never reach here
        target = "completed"

    await _apply_status_transition(visit, target)
    visit.outcome = outcome
    visit.outcome_reason = outcome_reason
    if listing_id is not None:
        visit.listing_id = listing_id
    visit.completed_at = datetime.now(timezone.utc)
    logger.info(
        "fe_visit.completed",
        visit_id=str(visit.id),
        outcome=outcome,
        status=target,
    )
    return visit


async def cancel_visit(
    db: AsyncSession, *, visit: FEVisit, reason: str, triggered_by: str
) -> FEVisit:
    await _apply_status_transition(visit, "cancelled")
    visit.outcome_reason = reason
    visit.completed_at = datetime.now(timezone.utc)
    logger.info(
        "fe_visit.cancelled",
        visit_id=str(visit.id),
        triggered_by=triggered_by,
        reason=reason,
    )
    return visit


# ── SLA helpers ───────────────────────────────────────────────────────────────

def is_visit_stuck(visit: FEVisit, now: Optional[datetime] = None) -> bool:
    """Heuristic for admin ops: visit is stuck if FE hasn't progressed it."""
    now = now or datetime.now(timezone.utc)
    if visit.status == "scheduled" and visit.scheduled_slot_end:
        # FE didn't start within 30 min after scheduled slot end
        gap_min = (now - visit.scheduled_slot_end).total_seconds() / 60
        if gap_min > 30:
            return True
    if visit.status == "in_progress" and visit.started_at:
        # Visit taking more than 2 hours
        dur_min = (now - visit.started_at).total_seconds() / 60
        if dur_min > 120:
            return True
    return False
