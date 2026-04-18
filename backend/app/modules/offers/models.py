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
    tds_withheld = Column(Numeric(10, 2), nullable=False, default=0)
    partial_refund = Column(Numeric(10, 2), nullable=False, default=0)
    net_payout = Column(Numeric(10, 2), nullable=False, default=0)
    status = Column(String(40), nullable=False, default="pending")
    # pending | payment_pending | payment_captured | payment_capture_uncertain
    # awaiting_confirmation | completed | auto_completed
    # cancelled | cancelled_at_meetup | refunded | disputed
    workflow_id = Column(String(256))
    dispute_id = Column(UUID(as_uuid=True))

    # Meetup coordination
    agreed_meetup_at = Column(DateTime(timezone=True))       # Agreed meetup time
    meetup_deadline = Column(DateTime(timezone=True))        # agreed_meetup_at + 30min cancel window
    seller_response_deadline = Column(DateTime(timezone=True))  # payment_captured + 4h
    seller_responded_at = Column(DateTime(timezone=True))    # When seller confirmed meetup

    # Confirmation & completion
    buyer_confirmed_at = Column(DateTime(timezone=True))
    seller_confirmed_at = Column(DateTime(timezone=True))
    confirmation_deadline = Column(DateTime(timezone=True))
    auto_completed_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    cancelled_at_meetup_at = Column(DateTime(timezone=True))  # Cancel at meetup event

    # Payout
    payout_flagged_at = Column(DateTime(timezone=True))
    payout_released_at = Column(DateTime(timezone=True))
    cancelled_at = Column(DateTime(timezone=True))
    cancelled_reason = Column(String(100))

    # Rating gate — 2h delay
    rate_available_at = Column(DateTime(timezone=True))

    # ── Sprint 4 / Pass 4e: frozen listing snapshot at reservation time ─────
    listing_snapshot = Column(JSONB, nullable=True)
    snapshot_frozen_at = Column(DateTime(timezone=True), nullable=True)

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
    # Buckets: transaction | message | promotion
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
    messages_enabled = Column(Boolean, nullable=False, default=True)        # Chat, offers — on by default
    promotions_enabled = Column(Boolean, nullable=False, default=False)     # Nudges, tips — off by default
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
