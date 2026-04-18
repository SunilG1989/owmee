import uuid
from sqlalchemy import Column, DateTime, ForeignKey, String, Boolean, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db.session import Base, TimestampMixin


class AdminUser(Base, TimestampMixin):
    __tablename__ = "admin_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(254), nullable=False, unique=True)
    name = Column(String(200), nullable=False)
    role = Column(String(30), nullable=False)
    # L1_AGENT | L2_REVIEWER | FINANCE_OPS | RISK_ANALYST | SUPER_ADMIN
    password_hash = Column(String(256), nullable=False)
    mfa_secret = Column(String(64))
    mfa_enabled = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    last_login_at = Column(DateTime(timezone=True))


class AdminAuditLog(Base):
    """Immutable append-only audit log for all admin actions."""
    __tablename__ = "admin_audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_user_id = Column(UUID(as_uuid=True), ForeignKey("admin_users.id"), nullable=False, index=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(String(100))
    before_state = Column(JSONB)
    after_state = Column(JSONB)
    reviewer_notes = Column(String(500))
    ip_address = Column(String(45))
    mfa_verified = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class SuperAdminAction(Base):
    """Double-log for SUPER_ADMIN destructive actions — never queryable via admin UI."""
    __tablename__ = "super_admin_actions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    audit_log_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    admin_user_id = Column(UUID(as_uuid=True), nullable=False)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(String(100))
    full_state_snapshot = Column(JSONB)
    mfa_verified = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

# ── Sprint 4 / Pass 4a: admin refresh tokens ─────────────────────────────────

class AdminRefreshToken(Base):
    __tablename__ = "admin_refresh_tokens"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("uuid_generate_v4()"),
    )
    admin_id = Column(
        UUID(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash = Column(String(128), nullable=False, unique=True, index=True)
    issued_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    rotated_to_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
