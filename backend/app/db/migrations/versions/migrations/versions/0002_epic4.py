"""epic4 — offers counter_offer ratings wishlists payment_links

Revision ID: 0002_epic4
Revises: 0001_initial
Create Date: 2025-01-02 00:00:00

Adds:
  offers.counter_price, counter_offered_at  (counter-offer support)
  transactions.buyer_confirmed_at already exists — add payout_flagged_at
  ratings table
  wishlists table
  payment_links table (Razorpay payment link per transaction)
  notification_events table
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_epic4"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── offers: add counter-offer columns ─────────────────────────────────────
    op.add_column("offers", sa.Column("counter_price", sa.Numeric(10, 2), nullable=True))
    op.add_column("offers", sa.Column("counter_offered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("offers", sa.Column("parent_offer_id", postgresql.UUID(as_uuid=True), nullable=True))
    # parent_offer_id links a counter-offer back to the original offer

    # ── transactions: add payout tracking ─────────────────────────────────────
    op.add_column("transactions", sa.Column("payout_flagged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("payout_released_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("confirmation_deadline", sa.DateTime(timezone=True), nullable=True))

    # ── payment_links ──────────────────────────────────────────────────────────
    op.create_table(
        "payment_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("transactions.id"), nullable=False, index=True),
        sa.Column("razorpay_link_id", sa.String(128), unique=True),
        sa.Column("short_url", sa.String(500)),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("status", sa.String(30), nullable=False, server_default="created"),
        # created | sent | paid | cancelled | expired
        sa.Column("idempotency_key", sa.String(128), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("razorpay_payment_id", sa.String(128)),
        sa.Column("webhook_payload", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # ── ratings ────────────────────────────────────────────────────────────────
    op.create_table(
        "ratings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("transactions.id"), nullable=False),
        sa.Column("rater_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("ratee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),  # buyer | seller
        sa.Column("stars", sa.Integer, nullable=False),    # 1-5
        sa.Column("comment", sa.String(500)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_ratings_transaction_id", "ratings", ["transaction_id"])
    op.create_index("ix_ratings_ratee_id", "ratings", ["ratee_id"])
    # One rating per rater per transaction
    op.create_index("ix_ratings_unique", "ratings", ["transaction_id", "rater_id"], unique=True)

    # ── wishlists ──────────────────────────────────────────────────────────────
    op.create_table(
        "wishlists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_wishlists_user_id", "wishlists", ["user_id"])
    op.create_index("ix_wishlists_unique", "wishlists", ["user_id", "listing_id"], unique=True)

    # ── notification_events ────────────────────────────────────────────────────
    op.create_table(
        "notification_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("event_type", sa.String(60), nullable=False),
        # offer_received | offer_accepted | offer_rejected | offer_countered
        # payment_link_sent | payment_confirmed | deal_confirmed | deal_auto_confirmed
        # payout_flagged | rating_received
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("body", sa.String(300), nullable=False),
        sa.Column("entity_type", sa.String(30)),   # offer | transaction | listing
        sa.Column("entity_id", sa.String(100)),
        sa.Column("is_read", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("notification_events")
    op.drop_table("wishlists")
    op.drop_table("ratings")
    op.drop_table("payment_links")
    op.drop_column("transactions", "confirmation_deadline")
    op.drop_column("transactions", "payout_released_at")
    op.drop_column("transactions", "payout_flagged_at")
    op.drop_column("offers", "parent_offer_id")
    op.drop_column("offers", "counter_offered_at")
    op.drop_column("offers", "counter_price")
