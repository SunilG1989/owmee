"""Sprint 4: seller_tier_events audit log

Revision ID: 0014_seller_tier_events
Revises: 0013_tri_state_user
Create Date: 2026-04-16

Immutable audit trail for seller_tier transitions.
Matches the same UUID/JSONB/metadata_ pattern as kyc_events and auth_events.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0014_seller_tier_events"
down_revision = "0013_tri_state_user"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "seller_tier_events",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_tier", sa.String(length=32), nullable=False),
        sa.Column("to_tier", sa.String(length=32), nullable=False),
        sa.Column(
            "reason",
            sa.String(length=64),
            nullable=False,
        ),
        sa.Column(
            "triggered_by",
            sa.String(length=64),
            nullable=False,
            server_default="system",
        ),
        sa.Column(
            "idempotency_key",
            sa.String(length=128),
            nullable=True,
            unique=True,
        ),
        # Note: column renamed on the Python side to metadata_ to avoid
        # SQLAlchemy's reserved `metadata` attribute on DeclarativeBase
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_seller_tier_events_user_id",
        "seller_tier_events",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_seller_tier_events_user_id",
        table_name="seller_tier_events",
    )
    op.drop_table("seller_tier_events")
