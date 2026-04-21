"""Sprint 6a — KYC as badge + ranking boost

Adds `seller_kyc_verified_at_listing_time` to listings (snapshot at creation)
and an index to support verified-first ranking queries.

Backfills existing rows from current user.kyc_status. This is intentionally
a "best-effort" backfill (it reflects the seller's CURRENT state, not the
state at original listing-creation time) because we have no historical
record. Future listings will snapshot correctly.

Revision ID: 0024_kyc_to_badge
Revises: 0023_analytics_events
Create Date: 2026-04-21

Downgrade: drops the column and index. Non-destructive rollback.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0024_kyc_to_badge'
down_revision = '0023_analytics_events'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add the snapshot column with a safe default
    op.add_column(
        'listings',
        sa.Column(
            'seller_kyc_verified_at_listing_time',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('FALSE'),
        ),
    )

    # 2. Backfill from current seller KYC state (best-effort)
    op.execute("""
        UPDATE listings L
        SET seller_kyc_verified_at_listing_time = (
            SELECT (u.kyc_status = 'verified')
            FROM users u
            WHERE u.id = L.seller_id
        )
        WHERE seller_id IS NOT NULL
    """)

    # 3. Partial index for verified-first ranking queries on active listings
    op.create_index(
        'idx_listings_verified_recent',
        'listings',
        ['seller_kyc_verified_at_listing_time', 'created_at'],
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_index('idx_listings_verified_recent', table_name='listings')
    op.drop_column('listings', 'seller_kyc_verified_at_listing_time')
