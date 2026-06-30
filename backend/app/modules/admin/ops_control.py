"""Admin ops-control APIs.

This module is the launch cockpit for super admins and ops leads. It does not
replace the underlying FE/logistics/direct-acquisition routers; it summarizes
their queues, surfaces provider readiness, and handles high-risk admin-user
governance with explicit audit trails.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

import bcrypt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, update

from app.core.admin_dependencies import (
    ADMIN_ROLE_DEFINITIONS,
    ADMIN_ROLES,
    AdminAny,
    AdminSuper,
    CurrentAdmin,
)
from app.core.dependencies import DBSession
from app.core.settings import Settings, settings


router = APIRouter(tags=["admin-ops-control"])


# ── Provider health ─────────────────────────────────────────────────────────

DEV_PROVIDER_NAMES = {"", "mock", "dev", "log"}


class ProviderHealthItem(BaseModel):
    service: str
    provider: str
    status: str
    missing: list[str] = Field(default_factory=list)
    launch_blocker: bool = False
    next_action: str | None = None


def _missing(value: str | None) -> bool:
    raw = str(value or "").strip()
    return not raw or raw.startswith("REPLACE_WITH_")


def _health_item(
    *,
    service: str,
    provider: str,
    missing: list[str],
    launch_blocker: bool,
    next_action: str | None = None,
) -> ProviderHealthItem:
    normalized_provider = (provider or "").strip().lower()
    uses_dev_provider = normalized_provider in DEV_PROVIDER_NAMES
    if launch_blocker and (missing or uses_dev_provider):
        item_status = "blocked"
    elif missing or uses_dev_provider:
        item_status = "warning"
    else:
        item_status = "ok"
    return ProviderHealthItem(
        service=service,
        provider=provider or "not_configured",
        status=item_status,
        missing=missing,
        launch_blocker=launch_blocker,
        next_action=next_action,
    )


def build_provider_health(config: Settings = settings) -> list[ProviderHealthItem]:
    """Return launch-readiness checks without exposing secret values."""
    sms_provider = (config.sms_provider or "").strip().lower()
    sms_missing: list[str] = []
    if sms_provider in {"msg91", "msg-91"}:
        sms_missing = [
            name for name, value in {
                "SMS_API_KEY": config.sms_api_key,
                "SMS_TEMPLATE_ID": config.sms_template_id,
                "SMS_SENDER_ID": config.sms_sender_id,
                "SMS_DLT_ENTITY_ID": config.sms_dlt_entity_id,
            }.items() if _missing(value)
        ]

    pa_provider = (config.pa_provider or "").strip().lower()
    payment_missing: list[str] = []
    if pa_provider in {"razorpay", "razor-pay"}:
        payment_missing = [
            name for name, value in {
                "PA_KEY_ID": config.pa_key_id,
                "PA_KEY_SECRET": config.pa_key_secret,
                "PA_WEBHOOK_SECRET": config.pa_webhook_secret,
            }.items() if _missing(value)
        ]

    ai_provider = (config.ai_provider or "").strip().lower()
    ai_missing: list[str] = []
    if ai_provider in {"gemini", "google", "google-gemini", "google_gemini"}:
        ai_missing = [
            name for name, value in {
                "GEMINI_API_KEY": config.gemini_api_key,
                "GEMINI_VISION_MODEL": config.gemini_vision_model,
                "GEMINI_TEXT_MODEL": config.gemini_text_model,
            }.items() if _missing(value)
        ]

    storage_missing = [
        name for name, value in {
            "R2_ENDPOINT": config.r2_endpoint,
            "R2_ACCESS_KEY": config.r2_access_key,
            "R2_SECRET_KEY": config.r2_secret_key,
            "R2_PUBLIC_URL": config.r2_public_url,
        }.items() if _missing(value)
    ]

    fraud_provider = (config.fraud_provider or "").strip().lower()
    fraud_missing: list[str] = []
    if fraud_provider not in DEV_PROVIDER_NAMES:
        fraud_missing = [
            name for name, value in {
                "FRAUD_API_BASE_URL": config.fraud_api_base_url,
                "FRAUD_API_KEY": config.fraud_api_key,
            }.items() if _missing(value)
        ]

    kyc_partner = (config.kyc_partner or "").strip().lower()
    kyc_missing: list[str] = []
    if kyc_partner not in DEV_PROVIDER_NAMES:
        kyc_missing = [
            name for name, value in {
                "KYC_PARTNER_API_KEY": config.kyc_partner_api_key,
                "KYC_PARTNER_BASE_URL": config.kyc_partner_base_url,
                "KYC_WEBHOOK_SECRET": config.kyc_webhook_secret,
            }.items() if _missing(value)
        ]

    push_provider = (config.push_provider or "").strip().lower()
    push_missing: list[str] = []
    if push_provider == "fcm" and _missing(config.fcm_server_key):
        push_missing = ["FCM_SERVER_KEY"]

    geocoding_missing: list[str] = []
    if (config.geocoding_provider or "").strip().lower() == "photon" and _missing(config.photon_url):
        geocoding_missing = ["PHOTON_URL"]

    return [
        _health_item(
            service="OTP SMS",
            provider=config.sms_provider,
            missing=sms_missing,
            launch_blocker=True,
            next_action="Use MSG91 with approved DLT entity, header, and content template.",
        ),
        _health_item(
            service="Payments",
            provider=config.pa_provider,
            missing=payment_missing,
            launch_blocker=True,
            next_action="Configure Razorpay key pair and webhook secret for the active mode.",
        ),
        _health_item(
            service="AI listing analysis",
            provider=config.ai_provider,
            missing=ai_missing,
            launch_blocker=True,
            next_action="Configure Gemini key/model values or switch to a supported listing provider.",
        ),
        _health_item(
            service="Media storage",
            provider="cloudflare-r2",
            missing=storage_missing,
            launch_blocker=True,
            next_action="Configure private upload credentials and a public media URL.",
        ),
        _health_item(
            service="Fraud checks",
            provider=config.fraud_provider,
            missing=fraud_missing,
            launch_blocker=bool(config.fraud_enforcement_enabled),
            next_action="Use a real provider before enabling strict launch enforcement.",
        ),
        _health_item(
            service="KYC",
            provider=config.kyc_partner,
            missing=kyc_missing,
            launch_blocker=True,
            next_action="Configure partner API key, base URL, and webhook secret.",
        ),
        _health_item(
            service="Push notifications",
            provider=config.push_provider,
            missing=push_missing,
            launch_blocker=True,
            next_action="Configure FCM for seller, buyer, and FE transactional alerts.",
        ),
        _health_item(
            service="Geocoding",
            provider=config.geocoding_provider,
            missing=geocoding_missing,
            launch_blocker=True,
            next_action="Use Photon or a self-hosted equivalent with a reachable URL.",
        ),
    ]


# ── Ops queue summary ───────────────────────────────────────────────────────


class QueueMetric(BaseModel):
    id: str
    title: str
    count: int
    severity: str
    owner_role: str
    route: str
    description: str


class OpsSummaryResponse(BaseModel):
    generated_at: str
    queues: list[QueueMetric]
    provider_health: list[ProviderHealthItem]


async def _count(db, model, *where) -> int:
    q = select(func.count(model.id))
    if where:
        q = q.where(*where)
    return int((await db.execute(q)).scalar_one() or 0)


def _queue_metric(
    *,
    id: str,
    title: str,
    count: int,
    owner_role: str,
    route: str,
    description: str,
    critical: bool = False,
) -> QueueMetric:
    if count <= 0:
        severity = "ok"
    elif critical:
        severity = "critical"
    else:
        severity = "warning"
    return QueueMetric(
        id=id,
        title=title,
        count=count,
        severity=severity,
        owner_role=owner_role,
        route=route,
        description=description,
    )


@router.get("/summary", response_model=OpsSummaryResponse)
async def ops_control_summary(_: AdminAny, db: DBSession):
    from app.modules.admin.models import Dispute
    from app.modules.direct_acquisition.models import (
        AcquisitionItem,
        DirectAcquisitionBooking,
        PriceOverrideApproval,
    )
    from app.modules.field_executive.models import FieldExecutive
    from app.modules.offers.models import Transaction
    from app.modules.stuck_workflow import StuckWorkflowAlert
    from app.modules.transactions.logistics_state import AT_HUB, PAYMENT_CAPTURED

    seller_readiness = await _count(
        db,
        Transaction,
        Transaction.status == PAYMENT_CAPTURED,
        Transaction.seller_readiness_status == "pending",
    )
    pickup_assignment = await _count(
        db,
        Transaction,
        Transaction.status == PAYMENT_CAPTURED,
        Transaction.seller_readiness_status == "confirmed",
        Transaction.pickup_fe_id.is_(None),
    )
    hub_routing = await _count(
        db,
        Transaction,
        Transaction.status == AT_HUB,
        Transaction.routed_at.is_(None),
    )
    returns = await _count(
        db,
        Transaction,
        Transaction.return_status.in_(["requested", "approved", "pickup_scheduled"]),
    )
    refunds = await _count(
        db,
        Transaction,
        Transaction.refund_status.in_(["requested", "processing", "failed"]),
    )
    disputes = await _count(
        db,
        Dispute,
        Dispute.status.in_(["opened", "in_review", "pending"]),
    )
    stuck_workflows = await _count(
        db,
        StuckWorkflowAlert,
        StuckWorkflowAlert.resolved_at.is_(None),
    )
    direct_assignments = await _count(
        db,
        DirectAcquisitionBooking,
        DirectAcquisitionBooking.status == "pending_fe_assignment",
    )
    direct_price_approvals = await _count(
        db,
        PriceOverrideApproval,
        PriceOverrideApproval.status == "pending",
    )
    direct_listing_approvals = await _count(
        db,
        AcquisitionItem,
        AcquisitionItem.item_status == "warehouse_inbound",
    )
    direct_payouts = await _count(
        db,
        DirectAcquisitionBooking,
        DirectAcquisitionBooking.status == "payout_ready",
        DirectAcquisitionBooking.payout_status.in_(["ready_for_finance", "failed"]),
    )
    fe_onboarding = await _count(
        db,
        FieldExecutive,
        FieldExecutive.onboarding_status.in_([
            "candidate",
            "verification_pending",
            "verified",
            "training_pending",
            "certified",
            "device_ready",
        ]),
    )

    provider_health = build_provider_health(settings)
    provider_blockers = sum(1 for item in provider_health if item.status == "blocked")

    queues = [
        _queue_metric(
            id="provider_health",
            title="Provider health blockers",
            count=provider_blockers,
            critical=True,
            owner_role="SUPER_ADMIN",
            route="/provider-health",
            description="Real SMS, payments, AI, storage, KYC, push, and geocoding readiness.",
        ),
        _queue_metric(
            id="seller_readiness",
            title="Seller readiness pending",
            count=seller_readiness,
            owner_role="OPS_DISPATCHER",
            route="/admin",
            description="Paid orders waiting for sellers to confirm pickup readiness.",
        ),
        _queue_metric(
            id="pickup_assignment",
            title="Pickup assignment",
            count=pickup_assignment,
            owner_role="OPS_DISPATCHER",
            route="/admin/pickups",
            description="Seller-confirmed orders waiting for FE pickup assignment.",
        ),
        _queue_metric(
            id="hub_routing",
            title="Hub routing",
            count=hub_routing,
            owner_role="OPS_DISPATCHER",
            route="/admin/hub",
            description="Items at hub waiting for delivery routing.",
        ),
        _queue_metric(
            id="refunds",
            title="Refund exceptions",
            count=refunds,
            critical=True,
            owner_role="FINANCE_OPS",
            route="/admin/refunds",
            description="Refunds requested, processing, or failed.",
        ),
        _queue_metric(
            id="returns",
            title="Return queue",
            count=returns,
            critical=True,
            owner_role="FINANCE_OPS",
            route="/admin/returns",
            description="Buyer returns waiting for decision or pickup scheduling.",
        ),
        _queue_metric(
            id="disputes",
            title="Disputes",
            count=disputes,
            critical=True,
            owner_role="RISK_ANALYST",
            route="/admin/disputes",
            description="Open buyer/seller disputes requiring risk review.",
        ),
        _queue_metric(
            id="stuck_workflows",
            title="Stuck workflows",
            count=stuck_workflows,
            critical=True,
            owner_role="OPS_MANAGER",
            route="/stuck-workflows",
            description="Workflow alerts that have not been resolved.",
        ),
        _queue_metric(
            id="fe_onboarding",
            title="FE onboarding",
            count=fe_onboarding,
            owner_role="FE_MANAGER",
            route="/fes",
            description="FE candidates not yet active or rejected.",
        ),
        _queue_metric(
            id="direct_assignments",
            title="Direct pickup assignment",
            count=direct_assignments,
            owner_role="OPS_DISPATCHER",
            route="/direct-acquisitions",
            description="Direct acquisition bookings waiting for FE assignment.",
        ),
        _queue_metric(
            id="direct_price_approvals",
            title="Direct price approvals",
            count=direct_price_approvals,
            critical=True,
            owner_role="L2_REVIEWER",
            route="/direct-acquisitions",
            description="FE price changes requiring admin approval before seller acceptance.",
        ),
        _queue_metric(
            id="direct_payouts",
            title="Direct seller payouts",
            count=direct_payouts,
            critical=True,
            owner_role="FINANCE_OPS",
            route="/direct-acquisitions",
            description="Direct payouts ready for finance or failed and needing retry.",
        ),
        _queue_metric(
            id="direct_listing_approvals",
            title="Direct inventory approval",
            count=direct_listing_approvals,
            owner_role="LISTING_REVIEWER",
            route="/direct-acquisitions",
            description="Warehouse-received items waiting for buyer-live listing approval.",
        ),
    ]

    return OpsSummaryResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        queues=queues,
        provider_health=provider_health,
    )


@router.get("/provider-health", response_model=list[ProviderHealthItem])
async def provider_health(_: AdminAny):
    return build_provider_health(settings)


# ── Role and admin-user governance ──────────────────────────────────────────


class RoleDefinitionOut(BaseModel):
    role: str
    label: str
    description: str
    capabilities: list[str]


class AdminUserOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: str
    is_active: bool
    mfa_enabled: bool
    last_login_at: str | None = None
    created_at: str | None = None


class UpdateAdminUserRequest(BaseModel):
    reason: str = Field(..., min_length=8, max_length=500)
    name: str | None = Field(None, min_length=1, max_length=200)
    role: str | None = None
    is_active: bool | None = None


class ResetAdminPasswordRequest(BaseModel):
    reason: str = Field(..., min_length=8, max_length=500)


class ResetAdminPasswordResponse(BaseModel):
    admin_id: str
    temp_password: str
    message: str


def _admin_user_dict(admin) -> dict[str, Any]:
    return {
        "id": str(admin.id),
        "email": admin.email,
        "name": admin.name,
        "role": admin.role,
        "is_active": bool(admin.is_active),
        "mfa_enabled": bool(admin.mfa_enabled),
        "last_login_at": admin.last_login_at.isoformat() if admin.last_login_at else None,
        "created_at": admin.created_at.isoformat() if getattr(admin, "created_at", None) else None,
    }


async def _record_super_admin_action(
    db,
    *,
    admin: CurrentAdmin,
    action: str,
    entity_type: str,
    entity_id: str,
    before_state: dict[str, Any],
    after_state: dict[str, Any],
    reason: str,
):
    from app.modules.admin.models import AdminAuditLog, SuperAdminAction

    audit = AdminAuditLog(
        admin_user_id=admin.admin_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_state=before_state,
        after_state=after_state,
        reviewer_notes=reason,
        mfa_verified=False,
    )
    db.add(audit)
    await db.flush()
    db.add(SuperAdminAction(
        audit_log_id=audit.id,
        admin_user_id=admin.admin_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        full_state_snapshot={
            "before": before_state,
            "after": after_state,
            "reason": reason,
        },
        mfa_verified=False,
    ))
    await db.flush()


@router.get("/roles", response_model=list[RoleDefinitionOut])
async def list_admin_roles(_: AdminAny):
    return [
        RoleDefinitionOut(role=role, **definition)
        for role, definition in ADMIN_ROLE_DEFINITIONS.items()
    ]


@router.get("/admins", response_model=list[AdminUserOut])
async def list_admin_users(_: AdminSuper, db: DBSession):
    from app.modules.admin.models import AdminUser

    rows = (await db.execute(
        select(AdminUser).order_by(AdminUser.is_active.desc(), AdminUser.email.asc())
    )).scalars().all()
    return [_admin_user_dict(row) for row in rows]


@router.patch("/admins/{admin_id}", response_model=AdminUserOut)
async def update_admin_user(
    admin_id: uuid.UUID,
    body: UpdateAdminUserRequest,
    current_admin: AdminSuper,
    db: DBSession,
):
    from app.modules.admin.models import AdminUser

    target = await db.get(AdminUser, admin_id)
    if target is None:
        raise HTTPException(status_code=404, detail={"error": "ADMIN_NOT_FOUND"})
    if body.role is not None and body.role not in ADMIN_ROLES:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_ADMIN_ROLE",
            "message": f"role must be one of: {sorted(ADMIN_ROLES)}",
        })
    if target.id == current_admin.admin_id:
        if body.is_active is False:
            raise HTTPException(status_code=409, detail={
                "error": "SELF_DEACTIVATION_BLOCKED",
                "message": "A super admin cannot deactivate their own account.",
            })
        if body.role is not None and body.role != target.role:
            raise HTTPException(status_code=409, detail={
                "error": "SELF_ROLE_CHANGE_BLOCKED",
                "message": "A super admin cannot change their own role.",
            })

    before = _admin_user_dict(target)
    if body.name is not None:
        target.name = body.name.strip()
    if body.role is not None:
        target.role = body.role
    if body.is_active is not None:
        target.is_active = body.is_active
    after = _admin_user_dict(target)

    await _record_super_admin_action(
        db,
        admin=current_admin,
        action="admin_user.updated",
        entity_type="admin_user",
        entity_id=str(target.id),
        before_state=before,
        after_state=after,
        reason=body.reason,
    )
    await db.commit()
    await db.refresh(target)
    return _admin_user_dict(target)


@router.post("/admins/{admin_id}/reset-password", response_model=ResetAdminPasswordResponse)
async def reset_admin_password(
    admin_id: uuid.UUID,
    body: ResetAdminPasswordRequest,
    current_admin: AdminSuper,
    db: DBSession,
):
    from app.modules.admin.models import AdminRefreshToken, AdminUser

    target = await db.get(AdminUser, admin_id)
    if target is None:
        raise HTTPException(status_code=404, detail={"error": "ADMIN_NOT_FOUND"})
    if not target.is_active:
        raise HTTPException(status_code=409, detail={
            "error": "ADMIN_INACTIVE",
            "message": "Reactivate the admin account before resetting its password.",
        })
    if target.id == current_admin.admin_id:
        raise HTTPException(status_code=409, detail={
            "error": "SELF_PASSWORD_RESET_BLOCKED",
            "message": "Use the normal password-change flow for your own account.",
        })

    before = _admin_user_dict(target)
    temp_password = f"Owmee-{secrets.token_urlsafe(14)}"
    target.password_hash = bcrypt.hashpw(temp_password.encode(), bcrypt.gensalt()).decode()
    now = datetime.now(timezone.utc)
    await db.execute(
        update(AdminRefreshToken)
        .where(
            AdminRefreshToken.admin_id == target.id,
            AdminRefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    after = {**_admin_user_dict(target), "password_reset_at": now.isoformat()}

    await _record_super_admin_action(
        db,
        admin=current_admin,
        action="admin_user.password_reset",
        entity_type="admin_user",
        entity_id=str(target.id),
        before_state=before,
        after_state=after,
        reason=body.reason,
    )
    await db.commit()
    return ResetAdminPasswordResponse(
        admin_id=str(target.id),
        temp_password=temp_password,
        message="Share this temporary password out-of-band and rotate it after first login.",
    )
