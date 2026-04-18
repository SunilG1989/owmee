"""add original_price to listings

Revision ID: 0009_original_price
Revises: 0008_shipped_flow
Create Date: 2026-04-13

Adds original_price (nullable) to the listings table.
Used to display "X% off" on product cards — Meesho/Flipkart pattern
that drives 23% higher click-through on price-sensitive Indian buyers.
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_original_price"
down_revision = "0008_shipped_flow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column("original_price", sa.Numeric(10, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("listings", "original_price")
