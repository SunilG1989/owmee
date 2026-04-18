"""Sprint 4 / Pass 2: listing provenance fields

Revision ID: 0017_listing_source_reviewed_by
Revises: 0016_fe_visits
Create Date: 2026-04-17

Adds provenance + review chain columns to listings:
  - listing_source  : self_prep | fe_assisted
  - fe_visit_id     : FK to fe_visits(id) when listing_source='fe_assisted'
  - reviewed_by     : none | fe | ops | fe_and_ops
  - ops_reviewed_at : when ops review happened
  - ops_reviewer_id : admin user id who approved

All new columns have safe defaults so existing Sprint 3 listings continue
to work unchanged ('self_prep' / 'none').
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0017_listing_source_reviewed_by"
down_revision = "0016_fe_visits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column(
            "listing_source",
            sa.String(length=32),
            nullable=False,
            server_default="self_prep",
        ),
    )
    op.add_column(
        "listings",
        sa.Column(
            "fe_visit_id",
            UUID(as_uuid=True),
            sa.ForeignKey("fe_visits.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "listings",
        sa.Column(
            "reviewed_by",
            sa.String(length=32),
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column(
        "listings",
        sa.Column(
            "ops_reviewed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "listings",
        sa.Column(
            "ops_reviewer_id",
            UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_listings_fe_visit_id",
        "listings",
        ["fe_visit_id"],
    )
    op.create_index(
        "ix_listings_listing_source",
        "listings",
        ["listing_source"],
    )


def downgrade() -> None:
    op.drop_index("ix_listings_listing_source", table_name="listings")
    op.drop_index("ix_listings_fe_visit_id", table_name="listings")
    op.drop_column("listings", "ops_reviewer_id")
    op.drop_column("listings", "ops_reviewed_at")
    op.drop_column("listings", "reviewed_by")
    op.drop_column("listings", "fe_visit_id")
    op.drop_column("listings", "listing_source")
