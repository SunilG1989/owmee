"""Sprint 4 / Pass 3: fe_visits.category_id + listings.kids_safety_checklist

Revision ID: 0018_fe_category_and_kids_checklist
Revises: 0017_listing_source_reviewed_by
Create Date: 2026-04-17

Two additive columns:
  - fe_visits.category_id — admin sets this at assign time so the FE doesn't
    need to pick category inside FeCaptureScreen (drops the "pending" alert)
  - listings.kids_safety_checklist — JSONB of {key: bool} for kids items

Both nullable and additive; pre-Pass-3 rows are unaffected.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "0018_fe_cat_kids_checklist"
down_revision = "0017_listing_source_reviewed_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fe_visits",
        sa.Column(
            "category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_fe_visits_category_id",
        "fe_visits",
        ["category_id"],
    )

    op.add_column(
        "listings",
        sa.Column("kids_safety_checklist", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("listings", "kids_safety_checklist")
    op.drop_index("ix_fe_visits_category_id", table_name="fe_visits")
    op.drop_column("fe_visits", "category_id")
