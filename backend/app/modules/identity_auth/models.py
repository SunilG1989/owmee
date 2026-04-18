import uuid
from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Integer, SmallInteger,
    String, Text, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.db.session import Base, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number = Column(String(20), nullable=False, unique=True)  # encrypted
    phone_verified = Column(Boolean, nullable=False, default=False)
    kyc_status = Column(String(30), nullable=False, default="not_started")
    # not_started | in_progress | pending_review | verified | rejected | re_verification_required
    kyc_version = Column(Integer, nullable=False, default=0)
    tier = Column(String(20), nullable=False, default="basic")
    # basic | verified
    trust_score = Column(Integer, nullable=False, default=50)
    is_active = Column(Boolean, nullable=False, default=True)
    is_restricted = Column(Boolean, nullable=False, default=False)
    last_seen_at = Column(DateTime(timezone=True))  # For "new since your last visit" feed

    # Sprint 1: Profile + address fields
    name = Column(String(200), nullable=True)
    email = Column(String(320), nullable=True)
    address_house = Column(String(500), nullable=True)
    address_street = Column(String(500), nullable=True)
    address_locality = Column(String(200), nullable=True)
    address_city = Column(String(100), nullable=True)
    address_pincode = Column(String(10), nullable=True)
    address_state = Column(String(100), nullable=True)

    num_kids = Column(SmallInteger)                   # Parent profile for kids category trust
    kids_age_range = Column(String(20))               # e.g. "3-8 years"

    # ── Sprint 4 / v3: tri-state eligibility model ────────────────────────────
    # Access state machine
    auth_state = Column(String(32), nullable=False, default="guest")
    # guest | otp_verified | suspended

    # Buyer eligibility flag — True once full buyer KYC is complete
    buyer_eligible = Column(Boolean, nullable=False, default=False)

    # Seller tier state machine — drives listing eligibility + TDS rate
    seller_tier = Column(String(32), nullable=False, default="not_eligible")
    # not_eligible | lite | full | restricted

    # TDS 194-O threshold tracker — India FY (Apr-Mar). Stored in paise.
    fy_cumulative_payout_paise = Column(BigInteger, nullable=False, default=0)
    fy_cumulative_payout_fy_start = Column(Date, nullable=True)
    tier_upgrade_prompted_at = Column(DateTime(timezone=True), nullable=True)

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    devices = relationship("Device", back_populates="user", cascade="all, delete-orphan")
    auth_events = relationship("AuthEvent", back_populates="user", cascade="all, delete-orphan")
    tier_events = relationship(
        "SellerTierEvent",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="noload",
    )


class Session(Base, TimestampMixin):
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    refresh_token_hash = Column(String(128), nullable=False, unique=True)
    device_fingerprint = Column(String(256))
    ip_address = Column(String(45))
    user_agent = Column(Text)
    is_revoked = Column(Boolean, nullable=False, default=False)
    revoked_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="sessions")


class Device(Base, TimestampMixin):
    __tablename__ = "devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id = Column(String(256), nullable=False)
    os = Column(String(50))
    os_version = Column(String(50))
    app_version = Column(String(20))
    model = Column(String(100))
    fcm_token = Column(Text)
    apns_token = Column(Text)

    user = relationship("User", back_populates="devices")


class AuthEvent(Base):
    """Immutable audit trail for auth events."""
    __tablename__ = "auth_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)
    # otp_sent | otp_verified | otp_failed | session_created | session_revoked | phone_change_initiated | phone_change_completed | phone_change_abandoned
    idempotency_key = Column(String(128), unique=True)
    ip_address = Column(String(45))
    device_fingerprint = Column(String(256))
    metadata_ = Column("metadata", JSONB)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    user = relationship("User", back_populates="auth_events")


class PhoneChangeRequest(Base, TimestampMixin):
    __tablename__ = "phone_change_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    old_phone_masked = Column(String(20), nullable=False)
    new_phone_masked = Column(String(20), nullable=False)
    status = Column(String(30), nullable=False, default="pending")
    # pending | completed | abandoned | locked
    completed_at = Column(DateTime(timezone=True))
    abandoned_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True), nullable=False)


# ── Sprint 4 / v3 ────────────────────────────────────────────────────────────

class SellerTierEvent(Base):
    """Immutable audit log of seller_tier transitions."""
    __tablename__ = "seller_tier_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_tier = Column(String(32), nullable=False)
    to_tier = Column(String(32), nullable=False)
    reason = Column(String(64), nullable=False)
    # aadhaar_completed | pan_liveness_completed | admin_downgrade | fraud_restriction |
    # tds_threshold_upgrade | admin_restore | manual_admin_change
    triggered_by = Column(String(64), nullable=False, default="system")
    # system | user:{uuid} | admin:{uuid} | workflow:{workflow_id}
    idempotency_key = Column(String(128), unique=True, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    user = relationship("User", back_populates="tier_events")
