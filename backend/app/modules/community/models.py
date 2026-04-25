"""
Community ORM models — Sprint 7 / Phase 1.

Community              : apartment/school/neighborhood membership unit
CommunityVerification  : manual-proof review queue row
SafeMeetupPoint        : per-community approved pickup spot
"""
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.session import Base, TimestampMixin


class Community(Base, TimestampMixin):
    __tablename__ = "communities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False, unique=True)
    slug = Column(String(100), nullable=False, unique=True)
    type = Column(String(32), nullable=False, default="apartment")
    # apartment | school | neighborhood | office
    city = Column(String(100), nullable=False)
    state = Column(String(100), nullable=True)
    pincode = Column(String(10), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    member_count = Column(Integer, nullable=False, default=0)

    safe_meetup_points = relationship(
        "SafeMeetupPoint",
        back_populates="community",
        cascade="all, delete-orphan",
    )


class CommunityVerification(Base, TimestampMixin):
    __tablename__ = "community_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    community_id = Column(
        UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="SET NULL"),
        nullable=True,
    )
    requested_community_name = Column(String(200), nullable=True)
    proof_r2_key = Column(String(500), nullable=True)

    status = Column(String(20), nullable=False, default="pending")
    # pending | approved | rejected

    reviewed_by_admin_id = Column(UUID(as_uuid=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)


class SafeMeetupPoint(Base, TimestampMixin):
    __tablename__ = "safe_meetup_points"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    community_id = Column(
        UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(200), nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)

    community = relationship("Community", back_populates="safe_meetup_points")
