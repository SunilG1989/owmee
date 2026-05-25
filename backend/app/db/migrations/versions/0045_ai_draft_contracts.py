"""Add durable AI draft contracts and artifacts.

Revision ID: 0045_ai_draft_contracts
Revises: 0044_transaction_readiness_snapshots
Create Date: 2026-05-23
"""
from alembic import op


revision = "0045_ai_draft_contracts"
down_revision = "0044_transaction_readiness_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS category_slug VARCHAR(80)")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS category_schema_version INTEGER NOT NULL DEFAULT 1")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS draft_revision INTEGER NOT NULL DEFAULT 1")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS image_set_hash VARCHAR(128)")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS safety_status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS core_analysis_status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS category_enrichment_status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS pricing_status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS copy_status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS seller_review_status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS publish_blockers JSONB NOT NULL DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS required_actions JSONB NOT NULL DEFAULT '[]'::jsonb")

    op.execute("""
        CREATE TABLE IF NOT EXISTS ai_draft_images (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            draft_id UUID NOT NULL REFERENCES listing_drafts(id) ON DELETE CASCADE,
            image_index INTEGER NOT NULL,
            original_key TEXT,
            display_key TEXT,
            thumbnail_key TEXT,
            mime_type VARCHAR(80),
            sha256_hash VARCHAR(64),
            perceptual_hash VARCHAR(128),
            width INTEGER,
            height INTEGER,
            byte_size INTEGER,
            quality_score NUMERIC(5, 2),
            blur_score NUMERIC(8, 3),
            is_duplicate BOOLEAN NOT NULL DEFAULT false,
            role VARCHAR(40) NOT NULL DEFAULT 'unknown',
            safety_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
            private_info_detected BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (draft_id, image_index)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS ai_analysis_artifacts (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            draft_id UUID NOT NULL REFERENCES listing_drafts(id) ON DELETE CASCADE,
            stage VARCHAR(80) NOT NULL,
            status VARCHAR(40) NOT NULL,
            input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            provider VARCHAR(60),
            model VARCHAR(120),
            prompt_version VARCHAR(80),
            schema_version INTEGER NOT NULL DEFAULT 1,
            category_schema_version INTEGER NOT NULL DEFAULT 1,
            latency_ms INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            cached_tokens INTEGER,
            retry_count INTEGER NOT NULL DEFAULT 0,
            error_code VARCHAR(120),
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS draft_field_values (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            draft_id UUID NOT NULL REFERENCES listing_drafts(id) ON DELETE CASCADE,
            field_key VARCHAR(100) NOT NULL,
            value JSONB,
            source VARCHAR(40) NOT NULL,
            confidence NUMERIC(5, 4),
            evidence VARCHAR(80),
            artifact_id UUID REFERENCES ai_analysis_artifacts(id) ON DELETE SET NULL,
            confirmed_by_seller BOOLEAN NOT NULL DEFAULT false,
            confirmed_at TIMESTAMPTZ,
            is_stale BOOLEAN NOT NULL DEFAULT false,
            stale_reason VARCHAR(120),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (draft_id, field_key)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS draft_category_change_events (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            draft_id UUID NOT NULL REFERENCES listing_drafts(id) ON DELETE CASCADE,
            old_category_slug VARCHAR(80),
            new_category_slug VARCHAR(80),
            changed_by VARCHAR(40) NOT NULL,
            previous_schema_version INTEGER,
            new_schema_version INTEGER NOT NULL DEFAULT 1,
            invalidated_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            preserved_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS category_field_definitions (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            category_slug VARCHAR(80) NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            field_key VARCHAR(100) NOT NULL,
            field_type VARCHAR(40) NOT NULL DEFAULT 'text',
            required_for_publish BOOLEAN NOT NULL DEFAULT false,
            required_for_pricing BOOLEAN NOT NULL DEFAULT false,
            affects_price BOOLEAN NOT NULL DEFAULT false,
            affects_title BOOLEAN NOT NULL DEFAULT false,
            affects_description BOOLEAN NOT NULL DEFAULT false,
            requires_direct_visible_evidence BOOLEAN NOT NULL DEFAULT false,
            seller_confirmation_required BOOLEAN NOT NULL DEFAULT true,
            clear_when_category_changes BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (category_slug, schema_version, field_key)
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_listing_drafts_contract_status
        ON listing_drafts (status, core_analysis_status, pricing_status)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ai_draft_images_draft
        ON ai_draft_images (draft_id, image_index)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ai_analysis_artifacts_draft_stage
        ON ai_analysis_artifacts (draft_id, stage, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_draft_field_values_draft_stale
        ON draft_field_values (draft_id, is_stale)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_draft_field_values_draft_stale")
    op.execute("DROP INDEX IF EXISTS ix_ai_analysis_artifacts_draft_stage")
    op.execute("DROP INDEX IF EXISTS ix_ai_draft_images_draft")
    op.execute("DROP INDEX IF EXISTS ix_listing_drafts_contract_status")
    op.execute("DROP TABLE IF EXISTS category_field_definitions")
    op.execute("DROP TABLE IF EXISTS draft_category_change_events")
    op.execute("DROP TABLE IF EXISTS draft_field_values")
    op.execute("DROP TABLE IF EXISTS ai_analysis_artifacts")
    op.execute("DROP TABLE IF EXISTS ai_draft_images")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS required_actions")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS publish_blockers")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS seller_review_status")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS copy_status")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS pricing_status")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS category_enrichment_status")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS core_analysis_status")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS safety_status")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS image_set_hash")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS draft_revision")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS category_schema_version")
    op.execute("ALTER TABLE listing_drafts DROP COLUMN IF EXISTS category_slug")
