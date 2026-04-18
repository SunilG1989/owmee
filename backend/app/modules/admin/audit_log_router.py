"""Admin audit log viewer + service — Sprint 4 / Pass 4f.

The admin_audit_log table + AdminAuditLog model already exist (from Pass 3).
This module adds:
  - log_admin_action() service helper — call from any admin endpoint
    that mutates business state. Append-only; never deletes or updates rows.
  - Admin API to list / filter / paginate the log.

The table is queryable from the admin web console; rows are never exposed
to consumer users or FEs. Super-admin destructive actions also write to
super_admin_actions (that table is untouched here — already Pass 3 behavior).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_dependencies import AdminAny
from app.core.dependencies import DBSession

logger = structlog.get_logger(__name__)


# ── Service ──────────────────────────────────────────────────────────────────

async def log_admin_action(
    db: AsyncSession,
    *,
    admin_id: uuid.UUID,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    before_state: Optional[dict] = None,
    after_state: Optional[dict] = None,
    reviewer_notes: Optional[str] = None,
    ip_address: Optional[str] = None,
    mfa_verified: bool = False,
) -> None:
    """Append a row to admin_audit_log. Caller is responsible for commit().

    Never raises — logging failure must not break the user-facing action.
    """
    try:
        from app.modules.admin.models import AdminAuditLog
        row = AdminAuditLog(
            admin_user_id=admin_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before_state=before_state or {},
            after_state=after_state or {},
            reviewer_notes=reviewer_notes,
            ip_address=ip_address,
            mfa_verified=mfa_verified,
        )
        db.add(row)
        await db.flush()
    except Exception as e:
        # Never fail the actual admin action because logging failed
        logger.warning("audit_log.write_failed", error=str(e), action=action)


# ── Schemas ──────────────────────────────────────────────────────────────────

class AuditLogItem(BaseModel):
    id: str
    admin_user_id: str
    admin_email: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    before_state: Optional[dict] = None
    after_state: Optional[dict] = None
    reviewer_notes: Optional[str] = None
    ip_address: Optional[str] = None
    mfa_verified: bool
    created_at: str


class AuditLogResponse(BaseModel):
    total: int
    items: list[AuditLogItem]


# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(tags=["admin-audit-log"])


@router.get("/", response_model=AuditLogResponse)
async def list_audit_log(
    _: AdminAny,
    db: DBSession,
    action: Optional[str] = Query(None, description="Filter by action name"),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    admin_id: Optional[str] = Query(None, description="Filter by admin user id"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    from app.modules.admin.models import AdminAuditLog, AdminUser

    q = select(AdminAuditLog, AdminUser.email).outerjoin(
        AdminUser, AdminUser.id == AdminAuditLog.admin_user_id
    )

    if action:
        q = q.where(AdminAuditLog.action == action)
    if entity_type:
        q = q.where(AdminAuditLog.entity_type == entity_type)
    if entity_id:
        q = q.where(AdminAuditLog.entity_id == entity_id)
    if admin_id:
        try:
            admin_uid = uuid.UUID(admin_id)
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "error": "INVALID_ADMIN_ID", "message": "admin_id must be a UUID"})
        q = q.where(AdminAuditLog.admin_user_id == admin_uid)

    # Total count with same filters
    count_q = select(func.count(AdminAuditLog.id))
    if action: count_q = count_q.where(AdminAuditLog.action == action)
    if entity_type: count_q = count_q.where(AdminAuditLog.entity_type == entity_type)
    if entity_id: count_q = count_q.where(AdminAuditLog.entity_id == entity_id)
    if admin_id: count_q = count_q.where(AdminAuditLog.admin_user_id == admin_uid)
    total = (await db.execute(count_q)).scalar_one()

    q = q.order_by(AdminAuditLog.created_at.desc()).limit(limit).offset(offset)
    res = await db.execute(q)
    rows = list(res.all())

    items = []
    for row, email in rows:
        items.append(AuditLogItem(
            id=str(row.id),
            admin_user_id=str(row.admin_user_id),
            admin_email=email,
            action=row.action,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            before_state=row.before_state or {},
            after_state=row.after_state or {},
            reviewer_notes=row.reviewer_notes,
            ip_address=row.ip_address,
            mfa_verified=bool(row.mfa_verified),
            created_at=row.created_at.isoformat(),
        ))

    return AuditLogResponse(total=total, items=items)


@router.get("/actions")
async def list_known_actions(_: AdminAny, db: DBSession):
    """Return the distinct action values in the log — useful for building
    filter dropdowns in the admin UI."""
    from app.modules.admin.models import AdminAuditLog
    res = await db.execute(
        select(AdminAuditLog.action, func.count(AdminAuditLog.id))
        .group_by(AdminAuditLog.action)
        .order_by(func.count(AdminAuditLog.id).desc())
        .limit(100)
    )
    return {"actions": [{"action": a, "count": c} for a, c in res.all()]}


# Dev endpoint — writes a test audit log entry (QA uses this)
class DevLogRequest(BaseModel):
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    reviewer_notes: Optional[str] = None


@router.post("/dev/log")
async def dev_log_action(
    body: DevLogRequest,
    current_admin: AdminAny,
    db: DBSession,
):
    """Dev-only: write a synthetic audit row. QA uses this to populate the log."""
    from app.core.settings import settings
    if settings.is_production:
        raise HTTPException(status_code=403, detail={
            "error": "DEV_ONLY", "message": "Not available in production."})

    await log_admin_action(
        db,
        admin_id=current_admin.admin_id,
        action=body.action,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        reviewer_notes=body.reviewer_notes,
        after_state={"source": "dev-endpoint"},
    )
    await db.commit()
    return {"logged": True, "action": body.action}
