"""Notification delivery metadata and idempotency.

Revision ID: 0051_notification_ops_core
Revises: 0050_fe_onboarding
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa


revision = "0051_notification_ops_core"
down_revision = "0050_fe_onboarding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notification_events", sa.Column("idempotency_key", sa.String(length=160), nullable=True))
    op.add_column(
        "notification_events",
        sa.Column("push_status", sa.String(length=24), nullable=False, server_default="not_attempted"),
    )
    op.add_column("notification_events", sa.Column("push_provider", sa.String(length=24), nullable=True))
    op.add_column("notification_events", sa.Column("push_attempted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notification_events", sa.Column("push_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notification_events", sa.Column("push_error", sa.String(length=300), nullable=True))
    op.create_unique_constraint(
        "uq_notification_events_idempotency_key",
        "notification_events",
        ["idempotency_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_notification_events_idempotency_key", "notification_events", type_="unique")
    op.drop_column("notification_events", "push_error")
    op.drop_column("notification_events", "push_sent_at")
    op.drop_column("notification_events", "push_attempted_at")
    op.drop_column("notification_events", "push_provider")
    op.drop_column("notification_events", "push_status")
    op.drop_column("notification_events", "idempotency_key")
