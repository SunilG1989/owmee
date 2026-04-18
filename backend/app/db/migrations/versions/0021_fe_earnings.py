"""Sprint 4 / Pass 4c: fe_earnings table.

Tracks per-FE payout-eligible earnings per completed visit. One row per
completed FE visit. Admin dashboard aggregates by (fe_id, month).

Revision ID: 0021_fe_earnings
Revises: 0020_stuck_workflows
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa


revision = "0021_fe_earnings"
down_revision = "0020_stuck_workflows"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fe_earnings",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "fe_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "visit_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        # amount earned from this visit (rupees * 100 = paise, kept as integer)
        sa.Column("amount_paise", sa.Integer, nullable=False),
        sa.Column("outcome", sa.String(length=50), nullable=False),
        # outcome: 'listed' | 'rejected_item' | 'seller_missing_verification' | 'pickup_not_ready'
        sa.Column(
            "earned_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("payout_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payout_status", sa.String(length=30), nullable=False,
                  server_default="pending"),
        # payout_status: 'pending' | 'paid' | 'held'
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["fe_id"], ["field_executives.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["visit_id"], ["fe_visits.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_fe_earnings_fe_id", "fe_earnings", ["fe_id"])
    op.create_index("ix_fe_earnings_earned_at", "fe_earnings", ["earned_at"])
    # One earning per visit
    op.create_index("ix_fe_earnings_visit_id", "fe_earnings", ["visit_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_fe_earnings_visit_id", table_name="fe_earnings")
    op.drop_index("ix_fe_earnings_earned_at", table_name="fe_earnings")
    op.drop_index("ix_fe_earnings_fe_id", table_name="fe_earnings")
    op.drop_table("fe_earnings")
