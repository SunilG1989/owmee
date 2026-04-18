"""Sprint 4 / Pass 2: field_executives table

Revision ID: 0015_field_executives
Revises: 0014_seller_tier_events
Create Date: 2026-04-17

Creates the field_executives table. A Field Executive IS a User with an
additional profile row — they log in with OTP like any other user. The
field_executives row is what promotes them to the 'fe' role in JWT claims.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0015_field_executives"
down_revision = "0014_seller_tier_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "field_executives",
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
            unique=True,
        ),
        sa.Column(
            "fe_code",
            sa.String(length=16),
            nullable=False,
            unique=True,
        ),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "current_shift",
            sa.String(length=20),
            nullable=False,
            server_default="off",
        ),
        # nullable FK: first admin seeded outside the admin table can provision FEs
        sa.Column(
            "created_by_admin_id",
            UUID(as_uuid=True),
            nullable=True,
        ),
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
        "ix_field_executives_city_active",
        "field_executives",
        ["city", "active"],
    )


def downgrade() -> None:
    op.drop_index("ix_field_executives_city_active", table_name="field_executives")
    op.drop_table("field_executives")
