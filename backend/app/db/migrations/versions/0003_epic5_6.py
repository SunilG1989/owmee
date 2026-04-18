"""epic5_6 — search, seller dashboard, reports, disputes, admin seed

Revision ID: 0003_epic5_6
Revises: 0002_epic4
Create Date: 2025-01-03 00:00:00

Adds:
  listings.search_vector  (tsvector for full-text search)
  listings.view_count already exists — add index
  user_reports table
  disputes table
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_epic5_6"
down_revision = "0002_epic4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Full-text search vector on listings ────────────────────────────────────
    # Add a generated tsvector column for fast keyword search
    op.add_column(
        "listings",
        sa.Column("search_vector", postgresql.TSVECTOR, nullable=True),
    )
    op.execute("""
        UPDATE listings
        SET search_vector = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(city, ''))
        WHERE status = 'active'
    """)
    op.execute("""
        CREATE INDEX ix_listings_search_vector ON listings USING GIN(search_vector)
    """)

    # ── Trigger to keep search_vector up to date on insert/update ─────────────
    op.execute("""
        CREATE OR REPLACE FUNCTION listings_search_vector_trigger()
        RETURNS trigger AS $$
        BEGIN
            NEW.search_vector := to_tsvector('english',
                coalesce(NEW.title, '') || ' ' ||
                coalesce(NEW.description, '') || ' ' ||
                coalesce(NEW.city, '')
            );
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("""
        CREATE TRIGGER listings_search_vector_update
        BEFORE INSERT OR UPDATE OF title, description, city
        ON listings
        FOR EACH ROW EXECUTE FUNCTION listings_search_vector_trigger()
    """)

    # ── user_reports ───────────────────────────────────────────────────────────
    op.create_table(
        "user_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("uuid_generate_v4()")),
        sa.Column("reporter_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reported_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reported_listing_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("listings.id"), nullable=True),
        sa.Column("report_type", sa.String(30), nullable=False),
        # spam | fraud | inappropriate | wrong_category | counterfeit | harassment | other
        sa.Column("description", sa.String(500)),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        # open | under_review | resolved | dismissed
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_note", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_user_reports_reporter_id", "user_reports", ["reporter_id"])
    op.create_index("ix_user_reports_reported_user", "user_reports", ["reported_user_id"])
    op.create_index("ix_user_reports_reported_listing", "user_reports", ["reported_listing_id"])
    op.create_index("ix_user_reports_status", "user_reports", ["status"])

    # ── disputes ───────────────────────────────────────────────────────────────
    op.create_table(
        "disputes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("uuid_generate_v4()")),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("transactions.id"), nullable=False, unique=True),
        sa.Column("raised_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.String(50), nullable=False),
        # item_not_received | item_not_as_described | payment_issue | seller_no_show | other
        sa.Column("description", sa.String(1000), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="opened"),
        # opened | evidence_collection | under_review | resolved | escalated | closed
        sa.Column("resolution", sa.String(30), nullable=True),
        # full_refund | full_release | partial_refund | dismissed
        sa.Column("resolution_note", sa.String(500), nullable=True),
        sa.Column("assigned_to", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("evidence_archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_disputes_transaction_id", "disputes", ["transaction_id"])
    op.create_index("ix_disputes_raised_by", "disputes", ["raised_by"])
    op.create_index("ix_disputes_status", "disputes", ["status"])


def downgrade() -> None:
    op.drop_table("disputes")
    op.drop_table("user_reports")
    op.execute("DROP TRIGGER IF EXISTS listings_search_vector_update ON listings")
    op.execute("DROP FUNCTION IF EXISTS listings_search_vector_trigger()")
    op.execute("DROP INDEX IF EXISTS ix_listings_search_vector")
    op.drop_column("listings", "search_vector")
