"""Add product detail columns to listings — brand, model, storage, RAM, color, etc.

Revision ID: 0011_listing_details
Revises: 0010_user_profile_address
Create Date: 2026-04-16 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011_listing_details"
down_revision = "0010_user_profile_address"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    existing = [c["name"] for c in inspector.get_columns("listings")]
    def safe_add(table, col):
        if col.name not in existing:
            op.add_column(table, col)
        else:
            print(f"  SKIP: {col.name} already exists")

    # Product identification
    safe_add("listings", sa.Column("brand", sa.String(100), nullable=True))
    safe_add("listings", sa.Column("model", sa.String(200), nullable=True))
    safe_add("listings", sa.Column("storage", sa.String(20), nullable=True))       # e.g. "128GB"
    safe_add("listings", sa.Column("ram", sa.String(20), nullable=True))            # e.g. "8GB"
    safe_add("listings", sa.Column("color", sa.String(50), nullable=True))
    safe_add("listings", sa.Column("processor", sa.String(100), nullable=True))     # laptops
    safe_add("listings", sa.Column("screen_size", sa.String(20), nullable=True))    # e.g. "15.6 inch"
    safe_add("listings", sa.Column("purchase_year", sa.Integer, nullable=True))

    # Detailed condition
    safe_add("listings", sa.Column("screen_condition", sa.String(30), nullable=True))  # flawless/minor_scratches/cracked
    safe_add("listings", sa.Column("body_condition", sa.String(30), nullable=True))    # flawless/minor_dents/major_damage
    safe_add("listings", sa.Column("defects", postgresql.JSONB, nullable=True))        # ["dead_pixels", "speaker_issue"]

    # Original price for discount display
    safe_add("listings", sa.Column("original_price", sa.Numeric(12, 2), nullable=True))

    # Serial number (laptops/tablets)
    safe_add("listings", sa.Column("serial_number", sa.String(50), nullable=True))


def downgrade() -> None:
    for col in ["brand", "model", "storage", "ram", "color", "processor",
                "screen_size", "purchase_year", "screen_condition", "body_condition",
                "defects", "original_price", "serial_number"]:
        op.drop_column("listings", col)
