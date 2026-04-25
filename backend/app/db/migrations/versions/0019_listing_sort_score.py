"""Add discount_pct generated column and feed indexes

Revision ID: 0019_listing_sort_score
Revises: 0018_community_launch
Create Date: 2026-04-25

This migration adds a generated column on listings.discount_pct that Postgres
auto-computes from (original_price - price) / original_price. Indexed for
fast retrieval in the blockbuster deals feed.

Also adds an index on (status, created_at DESC) for the explore feed query.

Idempotent — uses IF NOT EXISTS everywhere. Safe to re-run.
"""
from alembic import op


revision = "0019_listing_sort_score"
down_revision = "0018_community_launch"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE listings
        ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2)
        GENERATED ALWAYS AS (
            CASE
                WHEN original_price IS NOT NULL
                     AND original_price > 0
                     AND price < original_price
                THEN ROUND(((original_price - price) * 100.0 / original_price)::numeric, 2)
                ELSE NULL
            END
        ) STORED
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_listings_discount_pct
        ON listings (discount_pct DESC NULLS LAST)
        WHERE status = 'active' AND discount_pct IS NOT NULL
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_listings_active_created
        ON listings (status, created_at DESC)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_listings_active_created")
    op.execute("DROP INDEX IF EXISTS ix_listings_discount_pct")
    op.execute("ALTER TABLE listings DROP COLUMN IF EXISTS discount_pct")
