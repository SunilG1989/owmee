"""
Field Executive ORM models — Sprint 4 / Pass 3.

FieldExecutive  : profile row attached to a User
FEVisit         : unit of work, goes requested -> scheduled -> in_progress -> terminal

Pass 3: added `category_id` column, set at admin-assignment time. Pre-setting the
category removes the "category selection pending" alert in FeCaptureScreen and
lets the FE upload photos before the listing exists.
"""
import uuid

from sqlalchemy import (
    Boolean,
    Integer,
    Column,
    DateTime,
    ForeignKey,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.session import Base, TimestampMixin


class FieldExecutive(Base, TimestampMixin):
    __tablename__ = "field_executives"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    fe_code = Column(String(16), nullable=False, unique=True)
    city = Column(String(100), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    current_shift = Column(String(20), nullable=False, default="off")
    # morning | afternoon | evening | off
    created_by_admin_id = Column(UUID(as_uuid=True), nullable=True)

    visits = relationship(
        "FEVisit",
        back_populates="fe",
        foreign_keys="FEVisit.fe_id",
    )


class FEVisit(Base, TimestampMixin):
    __tablename__ = "fe_visits"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    fe_id = Column(
        UUID(as_uuid=True),
        ForeignKey("field_executives.id", ondelete="SET NULL"),
        nullable=True,
    )
    seller_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    requested_slot_start = Column(DateTime(timezone=True), nullable=False)
    requested_slot_end = Column(DateTime(timezone=True), nullable=False)
    scheduled_slot_start = Column(DateTime(timezone=True), nullable=True)
    scheduled_slot_end = Column(DateTime(timezone=True), nullable=True)

    address_snapshot = Column(JSONB, nullable=False)
    category_hint = Column(String(100), nullable=False)
    item_notes = Column(Text, nullable=True)
    # Concierge Phase 1 (master spec section 4.5): six-value subset of
    # phone | laptop | audio | appliance | kids | multiple. Validated at
    # the API layer (ALLOWED_TAGS), not the DB.
    notes_tags = Column(JSONB, nullable=False, default=list)

    # Concierge Phase 2 (master spec section 5.4): mutual at-door
    # verification. Generated at visit-request time, shown to specialist
    # when they tap "Arrived" and to seller via N6 push. Confirm timestamp
    # tracks the seller's "code matched" tap.
    arrival_verification_code = Column(String(4), nullable=True)
    arrival_confirmed_by_seller_at = Column(DateTime(timezone=True), nullable=True)

    # Concierge Phase 5 (master spec section 8.1): chain-of-custody
    # capture at visit close. The specialist takes a group photo of all
    # items and the seller confirms receipt. Both can be skipped — handover
    # _skipped tracks the verbal-agreement path.
    handover_photo_r2_key = Column(String(500), nullable=True)
    handover_skipped = Column(Boolean, nullable=False, default=False)
    seller_handover_confirmed_at = Column(DateTime(timezone=True), nullable=True)

    # Sprint 4 / Pass 3: category locked at admin assignment so FeCaptureScreen
    # can upload photos and submit the listing without a runtime picker hack.
    category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    status = Column(String(32), nullable=False, default="requested")
    # requested | scheduled | in_progress | completed | postponed | cancelled | no_show

    outcome = Column(String(32), nullable=True)
    # listed | rejected_item | seller_missing_verification | pickup_not_ready | postponed

    outcome_reason = Column(Text, nullable=True)

    listing_id = Column(
        UUID(as_uuid=True),
        ForeignKey("listings.id", ondelete="SET NULL"),
        nullable=True,
    )
    workflow_id = Column(String(128), nullable=True)

    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    fe = relationship(
        "FieldExecutive",
        back_populates="visits",
        foreign_keys=[fe_id],
    )


# ── Concierge Phase 5: trust safety net (master spec section 8) ─────────────


class FEVisitIssue(Base, TimestampMixin):
    """Issue raised by specialist (FE app Report Issue) or seller
    (e.g. arrival code mismatch).

    severity drives admin alerting:
        urgent — admin web shows top-of-page banner; optional Slack ping
        high   — daily-digest review
        medium — weekly review
        low    — review on next periodic sweep
    """
    __tablename__ = "fe_visit_issues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visit_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fe_visits.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reporter_user_id = Column(UUID(as_uuid=True), nullable=False)
    category = Column(String(50), nullable=False)
    # 'item_damage' | 'seller_backout' | 'address_mismatch' |
    # 'seller_absent' | 'safety_concern' | 'other'
    severity = Column(String(20), nullable=False)
    # 'low' | 'medium' | 'high' | 'urgent'
    description = Column(Text, nullable=True)
    photo_urls = Column(JSONB, nullable=False, default=list)
    admin_notified_at = Column(DateTime(timezone=True), nullable=True)
    admin_resolved_at = Column(DateTime(timezone=True), nullable=True)
    admin_resolution_notes = Column(Text, nullable=True)


class FEVisitNps(Base):
    """Seller's 1-question NPS for the visit, captured after payout."""
    __tablename__ = "fe_visit_nps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    visit_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fe_visits.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    seller_user_id = Column(UUID(as_uuid=True), nullable=False)
    specialist_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    nps_score = Column(SmallInteger, nullable=False)
    free_text = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


# ── Sprint 4 / Pass 4c: per-visit FE earnings ────────────────────────────────

class FEEarning(Base):
    __tablename__ = "fe_earnings"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("uuid_generate_v4()"),
    )
    fe_id = Column(
        UUID(as_uuid=True),
        ForeignKey("field_executives.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    visit_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fe_visits.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )
    amount_paise = Column(Integer, nullable=False)
    outcome = Column(String(50), nullable=False)
    earned_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        index=True,
    )
    payout_id = Column(UUID(as_uuid=True), nullable=True)
    payout_status = Column(String(30), nullable=False, server_default="pending")
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
