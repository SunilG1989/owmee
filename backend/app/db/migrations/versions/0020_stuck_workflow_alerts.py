"""Sprint 4 / Pass 4b: stuck_workflow_alerts table.

When a Temporal workflow enters waiting_for_manual_intervention or times out
past its SLO, an activity writes a row here so ops can see the backlog in
the admin console.

Revision ID: 0020_stuck_workflows
Revises: 0019_admin_refresh
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa


revision = "0020_stuck_workflows"
down_revision = "0019_admin_refresh"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stuck_workflow_alerts",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("workflow_type", sa.String(length=100), nullable=False),
        sa.Column("workflow_id", sa.String(length=200), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=True),
        sa.Column("entity_id", sa.String(length=100), nullable=True),
        sa.Column("reason", sa.String(length=100), nullable=False),
        # reason: 'waiting_for_manual_intervention' | 'timeout' | 'external_callback_missing' | 'partner_outage'
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="warning"),
        # severity: 'info' | 'warning' | 'critical'
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("metadata_json", sa.dialects.postgresql.JSONB, nullable=True),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by_admin_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("resolution_note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    # One row per workflow — re-alerts update the existing row
    op.create_index(
        "ix_stuck_workflow_alerts_workflow_id",
        "stuck_workflow_alerts",
        ["workflow_id"],
        unique=True,
    )
    op.create_index(
        "ix_stuck_workflow_alerts_resolved_at",
        "stuck_workflow_alerts",
        ["resolved_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_stuck_workflow_alerts_resolved_at", table_name="stuck_workflow_alerts")
    op.drop_index("ix_stuck_workflow_alerts_workflow_id", table_name="stuck_workflow_alerts")
    op.drop_table("stuck_workflow_alerts")
