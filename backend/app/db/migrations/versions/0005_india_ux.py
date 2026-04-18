"""india_ux — all review gaps addressed

Revision ID: 0005_india_ux
Revises: 0004_ui_gaps
Create Date: 2025-01-05

Adds:
  offers.offer_note              — buyer context with offer ("I can pick up today")
  transactions.agreed_meetup_at  — agreed meetup time slot
  transactions.meetup_deadline   — 30-min cancel window starts here
  transactions.seller_responded_at
  transactions.seller_response_deadline  — 4h ghosting escalation
  transactions.payment_method    — upi | cash
  transactions.rate_available_at — 2h delay after deal complete
  transactions.cancelled_at_meetup_at
  ratings.revealed_at            — blind reveal: both-rated or 7-day fallback
  users.last_seen_at             — "new since last visit" feed
  notification_preferences table — per-user, per-bucket prefs
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005_india_ux"
down_revision = "0004_ui_gaps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # offers
    op.add_column("offers", sa.Column("offer_note", sa.String(200), nullable=True))

    # transactions
    op.add_column("transactions", sa.Column("payment_method", sa.String(10), nullable=False, server_default="upi"))
    op.add_column("transactions", sa.Column("agreed_meetup_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("meetup_deadline", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("seller_response_deadline", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("seller_responded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("rate_available_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("cancelled_at_meetup_at", sa.DateTime(timezone=True), nullable=True))

    # ratings — blind reveal
    op.add_column("ratings", sa.Column("revealed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ratings", sa.Column("item_as_described", sa.String(10), nullable=True))
    # item_as_described: yes | mostly | no

    # users — last_seen_at for "new since your visit"
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))

    # notification_preferences
    op.create_table(
        "notification_preferences",
        sa.Column("id", postgresql.UUID(as_uuid=True),
                  primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("transactions_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("messages_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("promotions_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_notif_prefs_user", "notification_preferences", ["user_id"])


def downgrade() -> None:
    op.drop_table("notification_preferences")
    op.drop_column("users", "last_seen_at")
    op.drop_column("ratings", "item_as_described")
    op.drop_column("ratings", "revealed_at")
    op.drop_column("transactions", "cancelled_at_meetup_at")
    op.drop_column("transactions", "rate_available_at")
    op.drop_column("transactions", "seller_responded_at")
    op.drop_column("transactions", "seller_response_deadline")
    op.drop_column("transactions", "meetup_deadline")
    op.drop_column("transactions", "agreed_meetup_at")
    op.drop_column("transactions", "payment_method")
    op.drop_column("offers", "offer_note")
