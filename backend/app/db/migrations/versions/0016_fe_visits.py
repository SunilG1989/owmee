"""Sprint 4 / Pass 2: fe_visits table

Revision ID: 0016_fe_visits
Revises: 0015_field_executives
Create Date: 2026-04-17

A visit is the core unit of work for an FE. Seller creates a 'requested' row;
admin assigns an FE + scheduled slot; FE transitions to 'in_progress' on start
and to a terminal state on completion. `listing_id` is set only on outcome=listed.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0016_fe_visits"
down_revision = "0015_field_executives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fe_visits",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "fe_id",
            UUID(as_uuid=True),
            sa.ForeignKey("field_executives.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "seller_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_slot_start",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "requested_slot_end",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "scheduled_slot_start",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "scheduled_slot_end",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "address_snapshot",
            JSONB,
            nullable=False,
        ),
        sa.Column("category_hint", sa.String(length=100), nullable=False),
        sa.Column("item_notes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="requested",
        ),
        # requested | scheduled | in_progress | completed | postponed | cancelled | no_show
        sa.Column("outcome", sa.String(length=32), nullable=True),
        # listed | rejected_item | seller_missing_verification | pickup_not_ready | postponed
        sa.Column("outcome_reason", sa.Text(), nullable=True),
        sa.Column(
            "listing_id",
            UUID(as_uuid=True),
            sa.ForeignKey("listings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("workflow_id", sa.String(length=128), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_fe_visits_seller_status",
        "fe_visits",
        ["seller_id", "status"],
    )
    op.create_index(
        "ix_fe_visits_fe_status",
        "fe_visits",
        ["fe_id", "status"],
    )
    op.create_index(
        "ix_fe_visits_status_created",
        "fe_visits",
        ["status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_fe_visits_status_created", table_name="fe_visits")
    op.drop_index("ix_fe_visits_fe_status", table_name="fe_visits")
    op.drop_index("ix_fe_visits_seller_status", table_name="fe_visits")
    op.drop_table("fe_visits")
