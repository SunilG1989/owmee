"""Sprint 8 Phase 2 — listing drafts + AI-assisted listing columns

Revision ID: 0021_ai_phase2
Revises: 0020_user_location
Create Date: 2026-04-25

What this adds:
    - listing_drafts table: server-side draft state for the AI-assisted
      listing flow. Each draft holds the photo URLs, the AI's structured
      response (category/brand/model guess, price, comparables), and a
      24-hour TTL.
    - listings.verification_status: 'pending' | 'verified' | 'failed'
      (CEIR check outcome — populated after IMEI capture for smartphones)
    - listings.imei_1, listings.imei_2: plain IMEI capture for CEIR check
      and seller display. (imei_hash already exists from Sprint 1 for
      fraud lookups; these are the human-visible values.)
    - listings.listing_state: parallel to listings.status, expresses the
      Sprint 8 Phase 2 transaction lifecycle.
        draft_ai | pending_buyer | buyer_committed | pickup_scheduled
        | pickup_done | inspection_passed | delivered | payout_eligible
        | payout_done
      We add a new column rather than overload `status` because the
      existing `status` field is read by listings/router.py and feed
      ranking. listing_state is the new source of truth for the AI flow.
    - listings.video_url: optional 15-sec product video URL (R2 key)
      for items with suggested price >= 5000.

All operations use IF NOT EXISTS / IF EXISTS so re-running is safe.
"""
from alembic import op


revision = "0021_ai_phase2"
down_revision = "0020_user_location"
branch_labels = None
depends_on = None


def upgrade():
    # ── listing_drafts table ───────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS listing_drafts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            photo_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            ai_response JSONB,
            suggested_price NUMERIC(12, 2),
            comparables_count INTEGER NOT NULL DEFAULT 0,
            ai_model VARCHAR(64),
            ai_cost_usd NUMERIC(8, 4),
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_listing_drafts_user_created
        ON listing_drafts (user_id, created_at DESC)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_listing_drafts_expires
        ON listing_drafts (expires_at)
    """)

    # ── listings: AI Phase 2 columns ───────────────────────────────────────
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20)")
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS imei_1 VARCHAR(20)")
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS imei_2 VARCHAR(20)")
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS listing_state VARCHAR(32)")
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS video_url VARCHAR(500)")
    op.execute("ALTER TABLE listings ADD COLUMN IF NOT EXISTS ai_draft_id UUID")

    # Index on listing_state for ops queries (find all pending_buyer, etc.)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_listings_listing_state
        ON listings (listing_state)
        WHERE listing_state IS NOT NULL
    """)

    # Optional FK back to draft for traceability (no cascade — keep draft history)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_listings_ai_draft'
            ) THEN
                ALTER TABLE listings
                ADD CONSTRAINT fk_listings_ai_draft
                FOREIGN KEY (ai_draft_id) REFERENCES listing_drafts(id)
                ON DELETE SET NULL;
            END IF;
        END $$;
    """)


def downgrade():
    op.execute("ALTER TABLE listings DROP CONSTRAINT IF EXISTS fk_listings_ai_draft")
    op.execute("DROP INDEX IF EXISTS ix_listings_listing_state")
    op.execute("ALTER TABLE listings DROP COLUMN IF EXISTS ai_draft_id")
    op.execute("ALTER TABLE listings DROP COLUMN IF EXISTS video_url")
    op.execute("ALTER TABLE listings DROP COLUMN IF EXISTS listing_state")
    op.execute("ALTER TABLE listings DROP COLUMN IF EXISTS imei_2")
    op.execute("ALTER TABLE listings DROP COLUMN IF EXISTS imei_1")
    op.execute("ALTER TABLE listings DROP COLUMN IF EXISTS verification_status")
    op.execute("DROP INDEX IF EXISTS ix_listing_drafts_expires")
    op.execute("DROP INDEX IF EXISTS ix_listing_drafts_user_created")
    op.execute("DROP TABLE IF EXISTS listing_drafts")
