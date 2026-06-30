import uuid
from sqlalchemy import (
    Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Boolean,
    Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.db.session import Base, TimestampMixin


class Offer(Base, TimestampMixin):
    __tablename__ = "offers"
    __table_args__ = (
        # At most one live offer per (buyer, listing). Backstops the
        # check-then-insert race in make_offer at the DB level so two
        # concurrent requests can't both create an active offer.
        Index(
            "uq_active_offer_per_buyer_listing",
            "buyer_id", "listing_id",
            unique=True,
            postgresql_where=text("status IN ('pending', 'countered')"),
        ),
        # Seller offers list / dashboard: WHERE seller_id=? [AND status=?]
        # ORDER BY created_at. Replaces the single-column seller_id index the
        # model previously declared (but which migration 0001 never created).
        Index("ix_offers_seller_status_created", "seller_id", "status", "created_at"),
        # Expiry sweep (expire_stale_offers) scans only live offers.
        Index("ix_offers_pending_expiry", "expires_at", postgresql_where=text("status = 'pending'")),
        Index("ix_offers_countered_expiry", "counter_expires_at", postgresql_where=text("status = 'countered'")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    buyer_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # seller_id is covered by ix_offers_seller_status_created above (composite),
    # so no single-column index here.
    seller_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    offered_price = Column(Numeric(10, 2), nullable=False)
    counter_price = Column(Numeric(10, 2))
    counter_offered_at = Column(DateTime(timezone=True))
    parent_offer_id = Column(UUID(as_uuid=True), nullable=True)
    offer_note = Column(String(200))  # Legacy no-op; direct buyer-seller notes are not supported.
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
    __table_args__ = (
        # Seller payout/dashboard aggregates over completed deals; partial keeps
        # it tiny vs the full transactions table.
        Index(
            "ix_txn_completed_seller", "seller_id",
            postgresql_where=text("status IN ('completed', 'auto_completed')"),
        ),
        # FE price-suggestion query filters completed txns by a recency window.
        Index(
            "ix_transactions_completed_at", "completed_at",
            postgresql_where=text("status = 'completed'"),
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # reservation_id is UNIQUE, which already creates a backing index
    # (transactions_reservation_id_key) — no separate index=True needed.
    reservation_id = Column(UUID(as_uuid=True), ForeignKey("reservations.id"), nullable=False, unique=True)
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
    # at_hub | delivery_in_progress | delivered | awaiting_confirmation
    # completed | auto_completed | cancelled | refunded | disputed
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
    seller_readiness_status = Column(
        String(24), nullable=False, default="pending", server_default=text("'pending'")
    )
    seller_readiness_reason = Column(String(80))
    seller_pickup_slot_start = Column(DateTime(timezone=True))
    seller_pickup_slot_end = Column(DateTime(timezone=True))
    buyer_delivery_address_snapshot = Column(JSONB, nullable=True)
    seller_pickup_address_snapshot = Column(JSONB, nullable=True)

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
    refund_initiated_by = Column(String(40))                       # system_pickup_rejected | system_seller_unavailable | admin | buyer
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
    __table_args__ = (
        # One rating per rater per transaction. Backstops the check-then-insert
        # race in submit_rating so a buyer/seller can't double-rate (and double
        # the trust-score effect) under concurrency.
        Index("uq_rating_per_txn_rater", "transaction_id", "rater_id", unique=True),
    )

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
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_notification_events_idempotency_key"),
        # Notifications list: WHERE user_id=? ORDER BY created_at DESC LIMIT 50.
        Index("ix_notif_user_created", "user_id", "created_at"),
        # Unread badge count: WHERE user_id=? AND is_read=false.
        Index("ix_notif_user_unread", "user_id", postgresql_where=text("is_read = false")),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(60), nullable=False)
    # Buckets: transaction | promotion. Legacy rows may still contain "message".
    notification_bucket = Column(String(20), nullable=False, default="transaction")
    idempotency_key = Column(String(160), nullable=True)
    title = Column(String(100), nullable=False)
    body = Column(String(300), nullable=False)
    entity_type = Column(String(30))
    entity_id = Column(String(100))
    push_status = Column(String(24), nullable=False, default="not_attempted")
    push_provider = Column(String(24), nullable=True)
    push_attempted_at = Column(DateTime(timezone=True), nullable=True)
    push_sent_at = Column(DateTime(timezone=True), nullable=True)
    push_error = Column(String(300), nullable=True)
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
