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
    Column,
    DateTime,
    ForeignKey,
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
