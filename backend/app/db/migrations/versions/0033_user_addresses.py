"""Add user_addresses table for multi-address support.

Why
---
Today users have one embedded address split across `users.address_*`
columns. That works for "where do you live" but breaks for any flow
that needs:
  - Multiple addresses (Home + Work)
  - GPS coordinates (specialist navigation, FE pickup)
  - Quick reuse across visits / orders without re-typing
  - A label the seller picks ("Home", "Work", "Other")

Concierge specifically can't ship without this — the booking wizard's
Step 3 picks an address by id, and the visit row snapshots the row
into `address_snapshot` JSONB.

Schema (per docs/ADDRESS_LOCATION_PRD.md section 3.1)
-----------------------------------------------------
- One row per saved address, FK→users.id ON DELETE CASCADE
- Required: lat, lng, flat_house_number, label, city, state
- Reverse-geocoded fields (line_1, locality, pincode) editable by user
- `is_default` partial-unique per user — exactly one default at a time
- `source` tracks how the row was created for analytics

Legacy `users.address_*` columns stay (frozen) — they're only read for
backfill (see 0033b) and as a single-address fallback for older flows
until those are migrated.

Revision ID: 0033_user_addresses
Revises: 0032_merge_heads
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "0033_user_addresses"
down_revision = "0032_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_addresses",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Label
        sa.Column("label", sa.String(20), nullable=False),
        sa.Column("custom_label", sa.String(50), nullable=True),
        # GPS
        sa.Column("lat", sa.Numeric(10, 7), nullable=False),
        sa.Column("lng", sa.Numeric(10, 7), nullable=False),
        # User-typed parts
        sa.Column("flat_house_number", sa.String(100), nullable=False),
        sa.Column("building_name", sa.String(200), nullable=True),
        sa.Column("floor", sa.String(20), nullable=True),
        sa.Column("landmark", sa.String(200), nullable=True),
        # Reverse-geocoded (editable)
        sa.Column("address_line_1", sa.String(300), nullable=True),
        sa.Column("locality", sa.String(200), nullable=True),
        sa.Column("city", sa.String(100), nullable=False),
        sa.Column("state", sa.String(100), nullable=False),
        sa.Column("pincode", sa.String(10), nullable=True),
        # Status
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # PRD specified String(20), but the longest current value
        # ('imported_from_profile') is 21 chars. Widening to 30 to give
        # headroom for new source labels without another migration.
        sa.Column(
            "source",
            sa.String(30),
            nullable=False,
            server_default=sa.text("'manual'"),
        ),
        # Timestamps (matches TimestampMixin convention)
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
        "ix_user_addresses_user_id",
        "user_addresses",
        ["user_id"],
    )

    # Partial unique: exactly one default per user.
    op.execute(
        "CREATE UNIQUE INDEX ux_user_addresses_default_per_user "
        "ON user_addresses(user_id) WHERE is_default = true"
    )

    op.create_index(
        "ix_user_addresses_city",
        "user_addresses",
        ["city"],
    )

    op.create_index(
        "ix_user_addresses_pincode",
        "user_addresses",
        ["pincode"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_addresses_pincode", table_name="user_addresses")
    op.drop_index("ix_user_addresses_city", table_name="user_addresses")
    op.execute("DROP INDEX IF EXISTS ux_user_addresses_default_per_user")
    op.drop_index("ix_user_addresses_user_id", table_name="user_addresses")
    op.drop_table("user_addresses")
