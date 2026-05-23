"""Capture AI listing seller review lineage.

Revision ID: 0042_ai_listing_review_snapshot
Revises: 0041_other_category
Create Date: 2026-05-19
"""
import sqlalchemy as sa
from alembic import op


revision = "0042_ai_listing_review_snapshot"
down_revision = "0041_other_category"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column("seller_review_snapshot", sa.dialects.postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("listings", "seller_review_snapshot")
