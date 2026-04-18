"""Analytics events — Sprint 4 / Pass 4g.

Structured event log.

Service API:
    from app.modules.analytics import track
    await track(
        db,
        event_name="kyc_completed",
        actor_user_id=user.id,
        properties={"path": "buyer", "flow_duration_seconds": 120},
    )
    # Caller commits.

Design choices:
  - Never raises. A failed analytics write must not break the user-facing flow.
  - Accepts arbitrary JSONB properties — events evolve independently of schema.
  - Events are append-only. No updates, no deletes (except bulk purge via SQL).
  - event_name is a flat namespace — pick them carefully, they become the
    columns in any downstream BI tool.

Canonical event names (document what you emit):
  kyc_started, kyc_completed, kyc_rejected
  offer_created, offer_accepted, offer_rejected, offer_countered
  transaction_created, transaction_confirmed, transaction_completed, transaction_cancelled
  payment_captured, payment_released, payment_refunded
  payout_initiated, payout_released, payout_held
  dispute_opened, dispute_resolved, dispute_escalated
  listing_published, listing_moderation_rejected, listing_sold, listing_expired
  fe_visit_requested, fe_visit_assigned, fe_visit_completed
  admin_action (use action column for specifics)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, String, desc, func, select
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_dependencies import AdminAny
from app.core.dependencies import BasicUser, DBSession
from app.db.session import Base

logger = structlog.get_logger(__name__)


# ── Model ────────────────────────────────────────────────────────────────────

class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_name = Column(String(100), nullable=False, index=True)
    actor_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    actor_type = Column(String(20), nullable=False, default="user")
    entity_type = Column(String(50), nullable=True)
    entity_id = Column(String(100), nullable=True)
    properties = Column(JSONB, nullable=True)
    occurred_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    session_id = Column(String(100), nullable=True)


# ── Service ──────────────────────────────────────────────────────────────────

async def track(
    db: AsyncSession,
    *,
    event_name: str,
    actor_user_id: Optional[uuid.UUID] = None,
    actor_type: str = "user",
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    properties: Optional[dict] = None,
    session_id: Optional[str] = None,
) -> None:
    """Insert an analytics event. Caller commits.

    Never raises — analytics failure must not break the caller's flow.
    """
    try:
        row = AnalyticsEvent(
            event_name=event_name,
            actor_user_id=actor_user_id,
            actor_type=actor_type,
            entity_type=entity_type,
            entity_id=entity_id,
            properties=properties or {},
            session_id=session_id,
        )
        db.add(row)
        await db.flush()
    except Exception as e:
        logger.warning("analytics.track_failed", error=str(e), event_name=event_name)


# ── Schemas ──────────────────────────────────────────────────────────────────

class TrackEventRequest(BaseModel):
    event_name: str = Field(min_length=1, max_length=100)
    properties: Optional[dict] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None


class EventItem(BaseModel):
    id: str
    event_name: str
    actor_user_id: Optional[str] = None
    actor_type: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    properties: Optional[dict] = None
    occurred_at: str
    session_id: Optional[str] = None


class EventsListResponse(BaseModel):
    total: int
    items: list[EventItem]


class EventSummaryItem(BaseModel):
    event_name: str
    count: int
    unique_actors: int
    first_seen: str
    last_seen: str


# ── User-facing ingestion router ─────────────────────────────────────────────
# Lets the mobile app POST client-side events (e.g., screen views, taps).
# Rate-limited by BasicUser dep; server-side events use track() directly.

client_router = APIRouter(tags=["analytics-client"])


@client_router.post("/track", status_code=202)
async def client_track(
    body: TrackEventRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Client-side event ingestion. Mobile calls this for screen views,
    key taps, etc. Server-side events use track() directly."""
    # Lightly validate event_name shape — don't let clients flood with random names
    if not body.event_name.replace("_", "").replace(".", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail={
            "error": "INVALID_EVENT_NAME",
            "message": "event_name must be alphanumeric with underscores/dots/hyphens only"})
    # Whitelist prefixes to prevent namespace pollution
    allowed_prefixes = ("client.", "ui.", "screen.")
    if not any(body.event_name.startswith(p) for p in allowed_prefixes):
        raise HTTPException(status_code=400, detail={
            "error": "EVENT_NAME_UNAUTHORIZED",
            "message": f"Client events must start with one of: {allowed_prefixes}"})

    await track(
        db,
        event_name=body.event_name,
        actor_user_id=current_user.id,
        actor_type="user",
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        properties=body.properties,
    )
    await db.commit()
    return {"accepted": True}


# ── Admin query router ───────────────────────────────────────────────────────

admin_router = APIRouter(tags=["admin-analytics"])


@admin_router.get("/events", response_model=EventsListResponse)
async def list_events(
    _: AdminAny,
    db: DBSession,
    event_name: Optional[str] = Query(None),
    actor_type: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    since_days: int = Query(7, ge=1, le=365),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    since = datetime.now(timezone.utc) - timedelta(days=since_days)
    q = select(AnalyticsEvent).where(AnalyticsEvent.occurred_at >= since)
    count_q = select(func.count(AnalyticsEvent.id)).where(AnalyticsEvent.occurred_at >= since)

    if event_name:
        q = q.where(AnalyticsEvent.event_name == event_name)
        count_q = count_q.where(AnalyticsEvent.event_name == event_name)
    if actor_type:
        q = q.where(AnalyticsEvent.actor_type == actor_type)
        count_q = count_q.where(AnalyticsEvent.actor_type == actor_type)
    if entity_type:
        q = q.where(AnalyticsEvent.entity_type == entity_type)
        count_q = count_q.where(AnalyticsEvent.entity_type == entity_type)

    total = (await db.execute(count_q)).scalar_one()
    q = q.order_by(desc(AnalyticsEvent.occurred_at)).limit(limit).offset(offset)
    rows = list((await db.execute(q)).scalars().all())

    return EventsListResponse(
        total=total,
        items=[EventItem(
            id=str(r.id),
            event_name=r.event_name,
            actor_user_id=str(r.actor_user_id) if r.actor_user_id else None,
            actor_type=r.actor_type,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            properties=r.properties or {},
            occurred_at=r.occurred_at.isoformat(),
            session_id=r.session_id,
        ) for r in rows]
    )


@admin_router.get("/summary")
async def events_summary(
    _: AdminAny,
    db: DBSession,
    since_days: int = Query(7, ge=1, le=365),
):
    """Aggregated counts per event_name over the window."""
    since = datetime.now(timezone.utc) - timedelta(days=since_days)
    q = (
        select(
            AnalyticsEvent.event_name,
            func.count(AnalyticsEvent.id).label("count"),
            func.count(func.distinct(AnalyticsEvent.actor_user_id)).label("unique_actors"),
            func.min(AnalyticsEvent.occurred_at).label("first"),
            func.max(AnalyticsEvent.occurred_at).label("last"),
        )
        .where(AnalyticsEvent.occurred_at >= since)
        .group_by(AnalyticsEvent.event_name)
        .order_by(desc(func.count(AnalyticsEvent.id)))
    )
    rows = list((await db.execute(q)).all())
    return {
        "since": since.isoformat(),
        "items": [
            {
                "event_name": r[0],
                "count": int(r[1]),
                "unique_actors": int(r[2] or 0),
                "first_seen": r[3].isoformat() if r[3] else None,
                "last_seen": r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ],
    }
