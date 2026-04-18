"""Sprint 4 / Pass 4g: analytics_events table.

Structured event log for KYC, payment, dispute, transaction, listing
lifecycle events. Replaces ad-hoc structlog.info() calls as the system
of record for analytics.

Revision ID: 0023_analytics_events
Revises: 0022_transaction_snapshot
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa


revision = "0023_analytics_events"
down_revision = "0022_transaction_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analytics_events",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("event_name", sa.String(length=100), nullable=False),
        # event_name: 'kyc_completed' | 'offer_accepted' | 'transaction_created' |
        # 'transaction_completed' | 'dispute_opened' | 'dispute_resolved' |
        # 'listing_published' | 'listing_moderation_rejected' | 'payout_released' | ...
        sa.Column(
            "actor_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("actor_type", sa.String(length=20), nullable=False,
                  server_default="user"),
        # actor_type: 'user' | 'admin' | 'fe' | 'system'
        sa.Column("entity_type", sa.String(length=50), nullable=True),
        sa.Column("entity_id", sa.String(length=100), nullable=True),
        sa.Column("properties", sa.dialects.postgresql.JSONB, nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("session_id", sa.String(length=100), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_analytics_events_event_name", "analytics_events", ["event_name"])
    op.create_index("ix_analytics_events_occurred_at", "analytics_events", ["occurred_at"])
    op.create_index("ix_analytics_events_actor_user_id", "analytics_events", ["actor_user_id"])
    op.create_index("ix_analytics_events_entity", "analytics_events", ["entity_type", "entity_id"])


def downgrade() -> None:
    op.drop_index("ix_analytics_events_entity", table_name="analytics_events")
    op.drop_index("ix_analytics_events_actor_user_id", table_name="analytics_events")
    op.drop_index("ix_analytics_events_occurred_at", table_name="analytics_events")
    op.drop_index("ix_analytics_events_event_name", table_name="analytics_events")
    op.drop_table("analytics_events")
