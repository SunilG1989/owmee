"""Stuck workflow surfacing — Sprint 4 / Pass 4b.

Design:
  - Single module that owns the stuck_workflow_alerts table.
  - Temporal activities (and other systems) call report_stuck() to upsert
    a row by workflow_id.
  - Admin console reads via GET /v1/admin/stuck-workflows/.
  - Admin marks resolved via POST /v1/admin/stuck-workflows/{id}/resolve.

Intentionally NOT a Temporal activity itself — pure SQL so it stays fast and
doesn't nest activities. Any Temporal activity that detects a stuck state
imports this module's report_stuck() and calls it synchronously.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    String,
    func,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_dependencies import AdminUser, AdminAny
from app.core.dependencies import DBSession
from app.db.session import Base

logger = structlog.get_logger(__name__)


# ── Model ────────────────────────────────────────────────────────────────────

class StuckWorkflowAlert(Base):
    __tablename__ = "stuck_workflow_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_type = Column(String(100), nullable=False)
    workflow_id = Column(String(200), nullable=False, unique=True, index=True)
    entity_type = Column(String(50), nullable=True)
    entity_id = Column(String(100), nullable=True)
    reason = Column(String(100), nullable=False)
    severity = Column(String(20), nullable=False, default="warning")
    description = Column(String(500), nullable=True)
    metadata_json = Column(JSONB, nullable=True)
    first_seen_at = Column(DateTime(timezone=True), nullable=False,
                           default=lambda: datetime.now(timezone.utc))
    last_seen_at = Column(DateTime(timezone=True), nullable=False,
                          default=lambda: datetime.now(timezone.utc))
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_admin_id = Column(UUID(as_uuid=True), nullable=True)
    resolution_note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False,
                        default=lambda: datetime.now(timezone.utc))


# ── Service: called by workflow activities to report stuck state ─────────────

async def report_stuck(
    db: AsyncSession,
    *,
    workflow_type: str,
    workflow_id: str,
    reason: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    severity: str = "warning",
    description: Optional[str] = None,
    metadata_json: Optional[dict] = None,
) -> StuckWorkflowAlert:
    """Upsert by workflow_id. If the workflow was previously resolved and now
    stuck again, we re-open (clear resolved_at) and bump last_seen_at.
    Caller must commit the session.
    """
    now = datetime.now(timezone.utc)
    res = await db.execute(
        select(StuckWorkflowAlert).where(StuckWorkflowAlert.workflow_id == workflow_id)
    )
    row = res.scalar_one_or_none()

    if row is None:
        row = StuckWorkflowAlert(
            workflow_type=workflow_type,
            workflow_id=workflow_id,
            entity_type=entity_type,
            entity_id=entity_id,
            reason=reason,
            severity=severity,
            description=description,
            metadata_json=metadata_json or {},
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(row)
        logger.info(
            "stuck_workflow.reported",
            workflow_type=workflow_type, workflow_id=workflow_id, reason=reason,
        )
    else:
        row.last_seen_at = now
        row.reason = reason
        row.severity = severity
        if description:
            row.description = description
        if metadata_json:
            row.metadata_json = metadata_json
        # Re-open if previously resolved
        if row.resolved_at is not None:
            logger.info(
                "stuck_workflow.re_opened",
                workflow_id=workflow_id, previously_resolved_at=row.resolved_at.isoformat(),
            )
            row.resolved_at = None
            row.resolved_by_admin_id = None
            row.resolution_note = None
    return row


# ── Schemas for admin API ────────────────────────────────────────────────────

class StuckWorkflowOut(BaseModel):
    id: str
    workflow_type: str
    workflow_id: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    reason: str
    severity: str
    description: Optional[str] = None
    metadata_json: Optional[dict] = None
    first_seen_at: str
    last_seen_at: str
    resolved_at: Optional[str] = None
    resolved_by_admin_id: Optional[str] = None
    resolution_note: Optional[str] = None


class StuckWorkflowListResponse(BaseModel):
    total_open: int
    total_resolved_last_7d: int
    items: list[StuckWorkflowOut]


class ResolveStuckRequest(BaseModel):
    note: str = Field(min_length=1, max_length=500)


# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(tags=["admin-stuck-workflows"])


def _serialize(row: StuckWorkflowAlert) -> StuckWorkflowOut:
    return StuckWorkflowOut(
        id=str(row.id),
        workflow_type=row.workflow_type,
        workflow_id=row.workflow_id,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        reason=row.reason,
        severity=row.severity,
        description=row.description,
        metadata_json=row.metadata_json or {},
        first_seen_at=row.first_seen_at.isoformat(),
        last_seen_at=row.last_seen_at.isoformat(),
        resolved_at=row.resolved_at.isoformat() if row.resolved_at else None,
        resolved_by_admin_id=(
            str(row.resolved_by_admin_id) if row.resolved_by_admin_id else None
        ),
        resolution_note=row.resolution_note,
    )


@router.get("/", response_model=StuckWorkflowListResponse)
async def list_stuck_workflows(
    _: AdminAny,
    db: DBSession,
    status_filter: str = Query("open", pattern="^(open|resolved|all)$"),
    limit: int = Query(100, ge=1, le=500),
):
    q = select(StuckWorkflowAlert)
    if status_filter == "open":
        q = q.where(StuckWorkflowAlert.resolved_at.is_(None))
    elif status_filter == "resolved":
        q = q.where(StuckWorkflowAlert.resolved_at.is_not(None))
    q = q.order_by(StuckWorkflowAlert.first_seen_at.desc()).limit(limit)
    res = await db.execute(q)
    rows = list(res.scalars().all())

    # Counts for dashboard badge
    open_count_res = await db.execute(
        select(func.count(StuckWorkflowAlert.id)).where(
            StuckWorkflowAlert.resolved_at.is_(None)
        )
    )
    open_count = open_count_res.scalar_one()

    seven_days_ago = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    from datetime import timedelta
    seven_days_ago = seven_days_ago - timedelta(days=7)
    resolved_count_res = await db.execute(
        select(func.count(StuckWorkflowAlert.id)).where(
            StuckWorkflowAlert.resolved_at.is_not(None),
            StuckWorkflowAlert.resolved_at >= seven_days_ago,
        )
    )
    resolved_count = resolved_count_res.scalar_one()

    return StuckWorkflowListResponse(
        total_open=open_count,
        total_resolved_last_7d=resolved_count,
        items=[_serialize(r) for r in rows],
    )


@router.get("/summary")
async def stuck_workflow_summary(_: AdminAny, db: DBSession):
    """Tiny summary endpoint for the admin sidebar badge. Cheap; called often."""
    res = await db.execute(
        select(
            func.count(StuckWorkflowAlert.id),
            func.count(StuckWorkflowAlert.id).filter(
                StuckWorkflowAlert.severity == "critical",
                StuckWorkflowAlert.resolved_at.is_(None),
            ),
        ).where(StuckWorkflowAlert.resolved_at.is_(None))
    )
    total_open, critical_open = res.one()
    return {"total_open": total_open, "critical_open": critical_open}


@router.post("/{alert_id}/resolve", response_model=StuckWorkflowOut)
async def resolve_stuck_workflow(
    alert_id: str,
    body: ResolveStuckRequest,
    current_admin: AdminUser,
    db: DBSession,
):
    try:
        uid = uuid.UUID(alert_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_ID", "message": "alert_id must be a UUID"})

    res = await db.execute(
        select(StuckWorkflowAlert).where(StuckWorkflowAlert.id == uid)
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail={
            "error": "NOT_FOUND", "message": "Alert not found"})

    if row.resolved_at is not None:
        raise HTTPException(status_code=409, detail={
            "error": "ALREADY_RESOLVED",
            "message": "Alert already resolved.",
            "resolved_at": row.resolved_at.isoformat(),
        })

    row.resolved_at = datetime.now(timezone.utc)
    row.resolved_by_admin_id = current_admin.admin_id
    row.resolution_note = body.note
    await db.commit()
    await db.refresh(row)

    logger.info(
        "stuck_workflow.resolved",
        alert_id=alert_id, admin_id=str(current_admin.admin_id),
        workflow_id=row.workflow_id,
    )
    return _serialize(row)


# Dev-only endpoint to simulate a stuck workflow (used by QA)
class DevReportStuckRequest(BaseModel):
    workflow_type: str
    workflow_id: str
    reason: str
    severity: str = "warning"
    description: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None


@router.post("/dev/report")
async def dev_report_stuck(
    body: DevReportStuckRequest,
    _: AdminUser,
    db: DBSession,
):
    """Dev-only: simulate a stuck workflow report. QA uses this to seed data."""
    from app.core.settings import settings
    if settings.is_production:
        raise HTTPException(status_code=403, detail={
            "error": "DEV_ONLY", "message": "Not available in production."})

    row = await report_stuck(
        db,
        workflow_type=body.workflow_type,
        workflow_id=body.workflow_id,
        reason=body.reason,
        severity=body.severity,
        description=body.description,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
    )
    await db.commit()
    await db.refresh(row)
    return _serialize(row)
