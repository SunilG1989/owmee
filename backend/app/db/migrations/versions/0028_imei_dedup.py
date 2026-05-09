"""IMEI duplicate detection — unique partial index on active listings.

Sprint trust pillar: smartphones are the launch wedge category and stolen-
IMEI relisting is the most common scam vector on Indian C2C platforms.

The constraint is a *partial* unique index — only enforced for listings
that are still in the marketplace (active / reserved / sold). Removed or
draft listings can keep their IMEI rows around without blocking new
honest listings of the same item from a new owner.

Verified at apply time: zero existing duplicates on either column.

Revision ID: 0028_imei_dedup
Revises: 0027_pricing_model
Create Date: 2026-05-01
"""
from alembic import op


revision = "0028_imei_dedup"
down_revision = "0027_pricing_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS imei_1 VARCHAR(20)")
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS imei_2 VARCHAR(20)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_listings_imei_1_active
        ON listings (imei_1)
        WHERE imei_1 IS NOT NULL
          AND status IN ('active', 'reserved', 'sold')
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_listings_imei_2_active
        ON listings (imei_2)
        WHERE imei_2 IS NOT NULL
          AND status IN ('active', 'reserved', 'sold')
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_listings_imei_2_active")
    op.execute("DROP INDEX IF EXISTS uq_listings_imei_1_active")
