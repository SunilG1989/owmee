from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.session import Base, TimestampMixin


class DirectAcquisitionBooking(Base, TimestampMixin):
    __tablename__ = "direct_acquisition_bookings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    booking_code = Column(String(24), nullable=False, unique=True, index=True)
    seller_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # MVP seller account surrogate. When a dedicated seller_accounts table lands,
    # this remains the stable linked account id for the acquisition ledger.
    seller_account_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    pickup_address_id = Column(UUID(as_uuid=True), ForeignKey("user_addresses.id", ondelete="RESTRICT"), nullable=False)
    pickup_address_snapshot = Column(JSONB, nullable=False)
    pickup_locality = Column(String(200), nullable=False)
    pickup_pincode = Column(String(20), nullable=False)
    slot_start = Column(DateTime(timezone=True), nullable=False)
    slot_end = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(48), nullable=False, default="pending_fe_assignment", index=True)
    assigned_fe_id = Column(UUID(as_uuid=True), ForeignKey("field_executives.id", ondelete="SET NULL"), nullable=True, index=True)
    assignment_method = Column(String(24), nullable=True)
    seller_otp_hash = Column(String(128), nullable=False)
    seller_phone_verified = Column(Boolean, nullable=False, default=True)
    seller_ownership_declaration = Column(Boolean, nullable=False, default=False)
    serviceable_area = Column(Boolean, nullable=False, default=True)
    estimated_visit_duration_minutes = Column(Integer, nullable=False, default=30)
    route_cluster_id = Column(String(64), nullable=True)
    assignment_priority = Column(String(32), nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    estimated_total_offer_inr = Column(Integer, nullable=False, default=0)
    final_total_payout_inr = Column(Integer, nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    seller_final_accepted_at = Column(DateTime(timezone=True), nullable=True)
    payout_initiated_at = Column(DateTime(timezone=True), nullable=True)
    payout_completed_at = Column(DateTime(timezone=True), nullable=True)
    handover_completed_at = Column(DateTime(timezone=True), nullable=True)
    warehouse_inbound_id = Column(String(64), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    cancellation_reason = Column(String(64), nullable=True)

    items = relationship("AcquisitionItem", back_populates="booking", cascade="all, delete-orphan")


class AcquisitionItem(Base, TimestampMixin):
    __tablename__ = "acquisition_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    booking_id = Column(
        UUID(as_uuid=True),
        ForeignKey("direct_acquisition_bookings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    draft_listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True)
    category = Column(String(24), nullable=False)
    item_type = Column(String(120), nullable=False)
    item_title = Column(String(200), nullable=False)
    seller_photos = Column(JSONB, nullable=False, default=list)
    pickup_photos = Column(JSONB, nullable=False, default=list)
    seller_check_answers = Column(JSONB, nullable=False, default=dict)
    ai_detected_type = Column(String(120), nullable=False)
    policy_status = Column(String(32), nullable=False, default="allowed")
    direct_eligibility_status = Column(String(32), nullable=False, default="eligible")
    blocked_item_warnings = Column(JSONB, nullable=False, default=list)
    qc_checklist_template_id = Column(String(80), nullable=False)
    required_pickup_photos = Column(JSONB, nullable=False, default=list)
    owmee_suggested_offer_inr = Column(Integer, nullable=False)
    offer_valid_until = Column(DateTime(timezone=True), nullable=False)
    max_fe_auto_increase_allowed = Column(Numeric(5, 2), nullable=False, default=10)
    fe_final_offer_inr = Column(Integer, nullable=True)
    price_change_percent = Column(Numeric(7, 2), nullable=True)
    price_change_reason_code = Column(String(80), nullable=True)
    price_change_evidence_photos = Column(JSONB, nullable=False, default=list)
    approval_required = Column(Boolean, nullable=False, default=False)
    approval_status = Column(String(32), nullable=False, default="not_required")
    qc_status = Column(String(32), nullable=False, default="pending")
    qc_answers = Column(JSONB, nullable=False, default=dict)
    qc_notes = Column(Text, nullable=True)
    item_status = Column(String(40), nullable=False, default="pending_qc", index=True)

    booking = relationship("DirectAcquisitionBooking", back_populates="items")


class PriceOverrideApproval(Base, TimestampMixin):
    __tablename__ = "price_override_approvals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    booking_id = Column(UUID(as_uuid=True), ForeignKey("direct_acquisition_bookings.id", ondelete="CASCADE"), nullable=False, index=True)
    acquisition_item_id = Column(UUID(as_uuid=True), ForeignKey("acquisition_items.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by_fe_id = Column(UUID(as_uuid=True), ForeignKey("field_executives.id", ondelete="RESTRICT"), nullable=False)
    base_offer_inr = Column(Integer, nullable=False)
    requested_offer_inr = Column(Integer, nullable=False)
    change_percent = Column(Numeric(7, 2), nullable=False)
    reason_code = Column(String(80), nullable=False)
    evidence_photos = Column(JSONB, nullable=False, default=list)
    status = Column(String(32), nullable=False, default="pending", index=True)
    approved_by_admin_id = Column(UUID(as_uuid=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class SellerAccountLedgerEntry(Base, TimestampMixin):
    __tablename__ = "seller_account_ledger_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("uuid_generate_v4()"))
    seller_account_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    booking_id = Column(UUID(as_uuid=True), ForeignKey("direct_acquisition_bookings.id", ondelete="RESTRICT"), nullable=False, index=True)
    amount_inr = Column(Integer, nullable=False)
    entry_type = Column(String(48), nullable=False, default="acquisition_payout_credit")
    status = Column(String(24), nullable=False, default="pending", index=True)
    reference_id = Column(String(100), nullable=False, unique=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)

