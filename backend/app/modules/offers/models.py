import uuid
from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Boolean, Text, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.db.session import Base, TimestampMixin


class Offer(Base, TimestampMixin):
    __tablename__ = "offers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    buyer_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    seller_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    offered_price = Column(Numeric(10, 2), nullable=False)
    counter_price = Column(Numeric(10, 2))
    counter_offered_at = Column(DateTime(timezone=True))
    parent_offer_id = Column(UUID(as_uuid=True), nullable=True)
    offer_note = Column(String(200))  # "I can pick up today", "Serious buyer"
    status = Column(String(30), nullable=False, default="pending")
    # pending | countered | accepted | rejected | expired | cancelled | withdrawn
    expires_at = Column(DateTime(timezone=True), nullable=False)
    responded_at = Column(DateTime(timezone=True))
    reject_reason = Column(String(100))
    # Sprint 6b — offer v2 mechanics
    update_count = Column(Integer, nullable=False, default=0, server_default=text("0"))
    lockout_until = Column(DateTime(timezone=True))
    counter_expires_at = Column(DateTime(timezone=True))


class Reservation(Base, TimestampMixin):
    __tablename__ = "reservations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    offer_id = Column(UUID(as_uuid=True), ForeignKey("offers.id"), nullable=False, unique=True)
    listing_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    buyer_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    seller_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    agreed_price = Column(Numeric(10, 2), nullable=False)
    status = Column(String(30), nullable=False, default="pending")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    activated_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))

    transactions = relationship("Transaction", back_populates="reservation")


class Transaction(Base, TimestampMixin):
    __tablename__ = "transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reservation_id = Column(UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=False, unique=True, index=True)
    listing_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    buyer_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    seller_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    listing_snapshot_id = Column(UUID(as_uuid=True), ForeignKey("listing_snapshots.id"), nullable=False)
    transaction_type = Column(String(20), nullable=False, default="local")
    payment_method = Column(String(10), nullable=False, default="upi")  # upi | cash
    gross_amount = Column(Numeric(10, 2), nullable=False)
    platform_fee = Column(Numeric(10, 2), nullable=False, default=0)
    gst_on_fee = Column(Numeric(10, 2), nullable=False, default=0)
    # Sprint pricing-rewrite: ₹100 for small-appliances, ₹0 elsewhere.
    # Buyer pays gross_amount = agreed_price + delivery_fee.
    delivery_fee = Column(Numeric(10, 2), nullable=False, default=0, server_default=text("0"))
    tds_withheld = Column(Numeric(10, 2), nullable=False, default=0)
    partial_refund = Column(Numeric(10, 2), nullable=False, default=0)
    net_payout = Column(Numeric(10, 2), nullable=False, default=0)
    status = Column(String(40), nullable=False, default="pending")
    # pending | payment_pending | payment_captured | payment_capture_uncertain
    # awaiting_confirmation | completed | auto_completed
    # cancelled | refunded | disputed
    workflow_id = Column(String(256))
    dispute_id = Column(UUID(as_uuid=True))
    # Concierge Phase 5 (master spec section 8.3): when admin resolves a
    # dispute as "transit damage, not seller's fault," buyer is refunded
    # AND seller still receives expected payout from the trust fund.
    # Finance ops manually settles the sum of these monthly.
    trust_fund_payout_amount_inr = Column(Numeric(10, 2), nullable=True)
    seller_protection_reason = Column(String(80), nullable=True)
    seller_protection_resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Legacy coordination columns retained for migration compatibility.
    # New flows use managed pickup and delivery; seller_response_deadline
    # is treated as pickup readiness SLA.
    pickup_ready_at = Column("agreed_meetup_at", DateTime(timezone=True))
    pickup_deadline = Column("meetup_deadline", DateTime(timezone=True))
    seller_response_deadline = Column(DateTime(timezone=True))
    seller_responded_at = Column(DateTime(timezone=True))

    # Confirmation & completion
    buyer_confirmed_at = Column(DateTime(timezone=True))
    seller_confirmed_at = Column(DateTime(timezone=True))
    confirmation_deadline = Column(DateTime(timezone=True))
    auto_completed_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    cancelled_at_handoff_at = Column("cancelled_at_meetup_at", DateTime(timezone=True))

    # Payout
    payout_flagged_at = Column(DateTime(timezone=True))
    payout_released_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    cancelled_reason = Column(String(100))

    # Rating gate — 2h delay
    rate_available_at = Column(DateTime(timezone=True))

    # ── Sprint 6c: hybrid logistics ────────────────────────────────────────
    # State machine post-Sprint-6c:
    #   payment_captured → at_hub → delivery_in_progress → delivered → completed
    pickup_fe_id = Column(UUID(as_uuid=True))                     # FE who picked up + inspected
    pickup_inspection_passed = Column(Boolean)                    # True=item OK, False=rejected
    pickup_inspection_notes = Column(Text)
    pickup_inspection_photo_keys = Column(JSONB)                  # list of R2 keys
    at_hub_at = Column(DateTime(timezone=True))
    delivery_mode = Column(String(16))                            # 'fe' | 'courier'
    delivery_fe_id = Column(UUID(as_uuid=True))                   # FE doing delivery (may differ from pickup_fe)
    courier_name = Column(String(40))                             # 'porter' | 'delhivery' | 'self_delivered' | …
    courier_booking_id = Column(String(120))                      # Porter booking ID or AWB
    courier_tracking_url = Column(String(500))                    # public link buyer can open
    delivery_handover_photo_key = Column(String(500))             # R2 key, FE captures at handover
    buyer_acknowledgment_code = Column(String(8))                 # 6-digit OTP for delivery confirmation
    routed_at = Column(DateTime(timezone=True))                   # admin chose FE/courier
    delivered_at = Column(DateTime(timezone=True))

    # ── Sprint refund flow (migration 0030) ────────────────────────────────
    # refund_status: 'none' | 'requested' | 'processing' | 'completed' | 'failed'
    refund_status = Column(String(20), nullable=False, default="none", server_default=text("'none'"))
    refund_amount = Column(Numeric(10, 2))
    refund_reason = Column(String(200))
    refund_initiated_at = Column(DateTime(timezone=True))
    refund_completed_at = Column(DateTime(timezone=True))
    refund_initiated_by = Column(String(20))                       # system_pickup_rejected | admin | buyer
    razorpay_refund_id = Column(String(120))

    # ── Sprint return flow (migration 0031) ────────────────────────────────
    # return_status: 'none' | 'requested' | 'approved' | 'rejected'
    #              | 'pickup_scheduled' | 'picked_up' | 'completed'
    return_status = Column(String(20), nullable=False, default="none", server_default=text("'none'"))
    return_reason = Column(String(50))
    return_description = Column(String(1000))
    return_requested_at = Column(DateTime(timezone=True))
    return_decision_at = Column(DateTime(timezone=True))
    return_decision_by = Column(UUID(as_uuid=True))
    return_decision_note = Column(String(500))
    return_pickup_fe_id = Column(UUID(as_uuid=True))
    return_picked_up_at = Column(DateTime(timezone=True))
    return_completed_at = Column(DateTime(timezone=True))
    # P0.4 (2026-05-03): buyer-uploaded return-evidence photos. JSON list of
    # R2 keys / URIs (current persistence is verbatim until the presigned-URL
    # flow lands; mirrors disputes.photo_keys).
    return_photo_keys = Column(JSONB, nullable=True)

    # ── Sprint 4 / Pass 4e: frozen listing snapshot at reservation time ─────
    listing_snapshot = Column(JSONB, nullable=True)
    snapshot_frozen_at = Column(DateTime(timezone=True), nullable=True)

    # ── P0.5 (2026-05-03): handover-inspection beacon ──────────────────────
    # Set when the buyer taps "Item matches the listing — show my code" in
    # TransactionDetailScreen before reading the 6-digit ack code. Becomes
    # the timestamped record dispute resolution can point at when the buyer
    # later raises a "not as promised" claim.
    condition_confirmed_at = Column(DateTime(timezone=True), nullable=True)

    # ── P0.2 / launch fix (2026-05-03): buyer order notes ──────────────────
    # Free-text delivery instructions captured at checkout (gate code,
    # parking, "leave with security"). Plumbed to the FE delivery agent.
    order_notes = Column(String(500), nullable=True)

    reservation = relationship("Reservation", back_populates="transactions")
    payment_links = relationship("PaymentLink", back_populates="transaction")


class PaymentLink(Base, TimestampMixin):
    __tablename__ = "payment_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=False, index=True)
    razorpay_link_id = Column(String(128), unique=True)
    short_url = Column(String(500))
    amount = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="INR")
    status = Column(String(30), nullable=False, default="created")
    idempotency_key = Column(String(128), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True))
    paid_at = Column(DateTime(timezone=True))
    razorpay_payment_id = Column(String(128))
    webhook_payload = Column(JSONB)

    transaction = relationship("Transaction", back_populates="payment_links")


class Rating(Base):
    __tablename__ = "ratings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id = Column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=False, index=True)
    rater_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    ratee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role = Column(String(10), nullable=False)  # buyer | seller
    stars = Column(Integer, nullable=False)
    comment = Column(String(500))
    item_as_described = Column(String(10))  # yes | mostly | no
    revealed_at = Column(DateTime(timezone=True))  # Blind reveal: set when both rated or 7-day fallback
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class Wishlist(Base):
    __tablename__ = "wishlists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class NotificationEvent(Base):
    __tablename__ = "notification_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(60), nullable=False)
    # Buckets: transaction | promotion. Legacy rows may still contain "message".
    notification_bucket = Column(String(20), nullable=False, default="transaction")
    title = Column(String(100), nullable=False)
    body = Column(String(300), nullable=False)
    entity_type = Column(String(30))
    entity_id = Column(String(100))
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class NotificationPreference(Base):
    """Per-user notification bucket preferences."""
    __tablename__ = "notification_preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    transactions_enabled = Column(Boolean, nullable=False, default=True)   # Payment, deal, dispute — always on
    messages_enabled = Column(Boolean, nullable=False, default=True)        # Legacy no-op: direct messaging is unsupported
    promotions_enabled = Column(Boolean, nullable=False, default=False)     # Nudges, tips — off by default
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
