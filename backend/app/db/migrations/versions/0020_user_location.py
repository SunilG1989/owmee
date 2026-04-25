"""Add user location fields and history table

Revision ID: 0020_user_location
Revises: 0019_listing_sort_score
Create Date: 2026-04-25
"""
from alembic import op


revision = "0020_user_location"
down_revision = "0019_listing_sort_score"
branch_labels = None
depends_on = None


def upgrade():
    # Coordinate columns
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS location_display_name VARCHAR(120)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode VARCHAR(10)")

    # Address columns may not exist yet — add defensively. If they exist
    # from earlier migrations (e.g. 0010_user_profile_address), these are no-ops.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(80)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(80)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS address_full TEXT")

    # Indexes — safe now that columns are guaranteed
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_state ON users (state)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_users_lat_lng ON users (lat, lng)")

    # Audit history of location changes
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_location_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            lat DOUBLE PRECISION NOT NULL,
            lng DOUBLE PRECISION NOT NULL,
            display_name VARCHAR(120),
            full_address TEXT,
            city VARCHAR(80),
            state VARCHAR(80),
            pincode VARCHAR(10),
            source VARCHAR(20) NOT NULL DEFAULT 'gps',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_user_loc_history_user
        ON user_location_history (user_id, created_at DESC)
    """)


def downgrade():
    op.execute("DROP TABLE IF EXISTS user_location_history")
    op.execute("DROP INDEX IF EXISTS ix_users_lat_lng")
    op.execute("DROP INDEX IF EXISTS ix_users_state")
    # We don't drop city/state/address_full because earlier migrations may
    # legitimately own them. Only drop columns this migration definitively
    # added that no prior migration would have.
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS pincode")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS location_display_name")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS lng")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS lat")
