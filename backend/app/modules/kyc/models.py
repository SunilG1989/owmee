import uuid
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.db.session import Base, TimestampMixin


class KYCVerification(Base, TimestampMixin):
    __tablename__ = "kyc_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    # Aadhaar — NEVER store Aadhaar number
    aadhaar_partner_ref = Column(String(256))          # opaque partner reference only
    aadhaar_verified = Column(Boolean, default=False)
    aadhaar_name_masked = Column(String(10))            # last 4 chars of name only
    aadhaar_dob = Column(String(10))                    # YYYY-MM-DD — confirmed permissible
    aadhaar_gender = Column(String(1))                  # M/F/T
    aadhaar_state_ut = Column(String(50))
    aadhaar_minor = Column(Boolean, default=False)
    # PAN
    pan_number_masked = Column(String(10))              # XXXXX1234X masked
    pan_verified = Column(Boolean, default=False)
    pan_aadhaar_linked = Column(Boolean, default=False)
    pan_name = Column(String(200))
    # Name match
    name_match_score = Column(String(6))                # e.g. "0.91"
    name_match_result = Column(String(20))              # pass | manual_review | reject
    # Liveness
    liveness_partner_ref = Column(String(256))
    liveness_verified = Column(Boolean, default=False)
    # Payout account
    payout_account_type = Column(String(20))            # bank | upi
    payout_account_ref = Column(String(256))            # opaque partner ref
    payout_verified = Column(Boolean, default=False)
    # Overall status
    kyc_status = Column(String(30), nullable=False, default="not_started")
    rejection_reason = Column(String(100))
    reviewer_id = Column(UUID(as_uuid=True))
    reviewer_notes = Column(Text)
    reviewed_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))

    events = relationship("KYCEvent", back_populates="verification", cascade="all, delete-orphan")
    consent_events = relationship("ConsentEvent", back_populates="verification")


class KYCEvent(Base):
    """Immutable event log for KYC state transitions."""
    __tablename__ = "kyc_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    verification_id = Column(UUID(as_uuid=True), ForeignKey("kyc_verifications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    event_type = Column(String(60), nullable=False)
    step = Column(String(40))
    result = Column(String(20))
    payload = Column(JSONB)    # scrubbed of PII before storage — never raw Aadhaar
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    verification = relationship("KYCVerification", back_populates="events")


class ConsentEvent(Base):
    """DPDP Act consent audit trail."""
    __tablename__ = "consent_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    verification_id = Column(UUID(as_uuid=True), ForeignKey("kyc_verifications.id"), nullable=True)
    consent_type = Column(String(40), nullable=False)
    # aadhaar_kyc | pan_kyc | liveness | financial_account | platform_terms
    consent_version = Column(String(10), nullable=False, default="v1.0")
    action = Column(String(10), nullable=False)         # granted | revoked
    ip_address = Column(String(45))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    verification = relationship("KYCVerification", back_populates="consent_events")
