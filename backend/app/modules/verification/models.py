from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.session import Base, TimestampMixin


class VerificationCheck(Base, TimestampMixin):
    """Provider-neutral record of a verification/risk check.

    Examples:
    - phone_otp via MSG91
    - bureau_fraud via Bureau
    - aadhaar / pan / liveness / payout via a KYC provider

    Store provider references and scrubbed metadata only. Do not store raw
    Aadhaar, full PAN, OTPs, or full bank account numbers here.
    """

    __tablename__ = "verification_checks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    check_type = Column(String(40), nullable=False, index=True)
    provider = Column(String(40), nullable=False)
    provider_ref = Column(String(256), nullable=True)
    status = Column(String(30), nullable=False, default="pending", index=True)
    # pending | passed | failed | manual_review | expired | error
    risk_band = Column(String(20), nullable=True)
    # low | medium | high | unknown
    applies_to = Column(String(40), nullable=True)
    # signup | publish_listing | buy | payout | phone_change | global | null
    idempotency_key = Column(String(160), nullable=True, unique=True)
    input_fingerprint = Column(String(128), nullable=True)
    reason_codes = Column(JSONB, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    decisions = relationship("RiskDecision", back_populates="source_check")


class RiskDecision(Base, TimestampMixin):
    """Owmee's action policy decision derived from verification checks.

    This is the product-facing result. Screens/routes should not interpret raw
    Bureau/KYC payloads; they should consume decisions like allow, step_up,
    manual_review, or block.
    """

    __tablename__ = "risk_decisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    applies_to = Column(String(40), nullable=False, default="global", index=True)
    decision = Column(String(30), nullable=False, index=True)
    # allow | step_up | manual_review | block
    source_check_id = Column(
        UUID(as_uuid=True),
        ForeignKey("verification_checks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    risk_band = Column(String(20), nullable=True)
    reason_codes = Column(JSONB, nullable=True)
    message = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    valid_until = Column(DateTime(timezone=True), nullable=True)

    source_check = relationship("VerificationCheck", back_populates="decisions")
