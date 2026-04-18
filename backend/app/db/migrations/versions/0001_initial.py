"""initial schema — Phase 1 tables

Revision ID: 0001_initial
Revises:
Create Date: 2025-01-01 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users ──────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("phone_number", sa.String(20), nullable=False, unique=True),
        sa.Column("phone_verified", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("kyc_status", sa.String(30), nullable=False, server_default="not_started"),
        sa.Column("kyc_version", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tier", sa.String(20), nullable=False, server_default="basic"),
        sa.Column("trust_score", sa.Integer, nullable=False, server_default="50"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("is_restricted", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_users_phone_number", "users", ["phone_number"])

    # ── sessions ───────────────────────────────────────────────────────────────
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("refresh_token_hash", sa.String(128), nullable=False, unique=True),
        sa.Column("device_fingerprint", sa.String(256)),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("user_agent", sa.Text),
        sa.Column("is_revoked", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    # ── devices ────────────────────────────────────────────────────────────────
    op.create_table(
        "devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", sa.String(256), nullable=False),
        sa.Column("os", sa.String(50)),
        sa.Column("os_version", sa.String(50)),
        sa.Column("app_version", sa.String(20)),
        sa.Column("model", sa.String(100)),
        sa.Column("fcm_token", sa.Text),
        sa.Column("apns_token", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_devices_user_id", "devices", ["user_id"])

    # ── auth_events ────────────────────────────────────────────────────────────
    op.create_table(
        "auth_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("idempotency_key", sa.String(128), unique=True),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("device_fingerprint", sa.String(256)),
        sa.Column("metadata", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_auth_events_user_id", "auth_events", ["user_id"])

    # ── phone_change_requests ──────────────────────────────────────────────────
    op.create_table(
        "phone_change_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("old_phone_masked", sa.String(20), nullable=False),
        sa.Column("new_phone_masked", sa.String(20), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("abandoned_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_phone_change_requests_user_id", "phone_change_requests", ["user_id"])

    # ── kyc_verifications ──────────────────────────────────────────────────────
    op.create_table(
        "kyc_verifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("aadhaar_partner_ref", sa.String(256)),
        sa.Column("aadhaar_verified", sa.Boolean, server_default="false"),
        sa.Column("aadhaar_name_masked", sa.String(10)),
        sa.Column("aadhaar_dob", sa.String(10)),
        sa.Column("aadhaar_gender", sa.String(1)),
        sa.Column("aadhaar_state_ut", sa.String(50)),
        sa.Column("aadhaar_minor", sa.Boolean, server_default="false"),
        sa.Column("pan_number_masked", sa.String(10)),
        sa.Column("pan_verified", sa.Boolean, server_default="false"),
        sa.Column("pan_aadhaar_linked", sa.Boolean, server_default="false"),
        sa.Column("pan_name", sa.String(200)),
        sa.Column("name_match_score", sa.String(6)),
        sa.Column("name_match_result", sa.String(20)),
        sa.Column("liveness_partner_ref", sa.String(256)),
        sa.Column("liveness_verified", sa.Boolean, server_default="false"),
        sa.Column("payout_account_type", sa.String(20)),
        sa.Column("payout_account_ref", sa.String(256)),
        sa.Column("payout_verified", sa.Boolean, server_default="false"),
        sa.Column("kyc_status", sa.String(30), nullable=False, server_default="not_started"),
        sa.Column("rejection_reason", sa.String(100)),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True)),
        sa.Column("reviewer_notes", sa.Text),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_kyc_verifications_user_id", "kyc_verifications", ["user_id"])

    # ── kyc_events ─────────────────────────────────────────────────────────────
    op.create_table(
        "kyc_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("verification_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("kyc_verifications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("step", sa.String(40)),
        sa.Column("result", sa.String(20)),
        sa.Column("payload", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_kyc_events_verification_id", "kyc_events", ["verification_id"])
    op.create_index("ix_kyc_events_user_id", "kyc_events", ["user_id"])

    # ── consent_events ─────────────────────────────────────────────────────────
    op.create_table(
        "consent_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("verification_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("kyc_verifications.id"), nullable=True),
        sa.Column("consent_type", sa.String(40), nullable=False),
        sa.Column("consent_version", sa.String(10), nullable=False, server_default="v1.0"),
        sa.Column("action", sa.String(10), nullable=False),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_consent_events_user_id", "consent_events", ["user_id"])

    # ── categories (includes all columns upfront — no add_column needed) ───────
    op.create_table(
        "categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("imei_required", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("shipping_eligible", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("local_eligible", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # ── listings (geo_point added via raw DDL after table creation) ────────────
    op.create_table(
        "listings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("price", sa.Numeric(10, 2), nullable=False),
        sa.Column("condition", sa.String(20), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="draft"),
        sa.Column("moderation_status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("moderation_flag", sa.String(100)),
        sa.Column("image_urls", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("thumbnail_url", sa.String(500)),
        sa.Column("imei_hash", sa.String(128)),
        sa.Column("ml_price_suggestion", sa.Numeric(10, 2)),
        sa.Column("ml_price_range_low", sa.Numeric(10, 2)),
        sa.Column("ml_price_range_high", sa.Numeric(10, 2)),
        sa.Column("locality", sa.String(200)),
        sa.Column("city", sa.String(100)),
        sa.Column("state", sa.String(100)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("view_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    # Add PostGIS GEOGRAPHY column and index via raw DDL
    op.execute("ALTER TABLE listings ADD COLUMN geo_point GEOGRAPHY(POINT, 4326)")
    op.execute("CREATE INDEX ix_listings_geo_point ON listings USING GIST(geo_point)")
    op.create_index("ix_listings_seller_id", "listings", ["seller_id"])
    op.create_index("ix_listings_status", "listings", ["status"])
    op.create_index("ix_listings_city", "listings", ["city"])

    # ── listing_images ─────────────────────────────────────────────────────────
    op.create_table(
        "listing_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("r2_key", sa.String(500), nullable=False),
        sa.Column("r2_key_thumb", sa.String(500)),
        sa.Column("r2_key_medium", sa.String(500)),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_primary", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("moderation_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_listing_images_listing_id", "listing_images", ["listing_id"])

    # ── listing_snapshots ──────────────────────────────────────────────────────
    op.create_table(
        "listing_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id"), nullable=False),
        sa.Column("reservation_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("snapshot_data", postgresql.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_listing_snapshots_listing_id", "listing_snapshots", ["listing_id"])
    op.create_index("ix_listing_snapshots_reservation_id", "listing_snapshots", ["reservation_id"])

    # ── offers ─────────────────────────────────────────────────────────────────
    op.create_table(
        "offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("buyer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("offered_price", sa.Numeric(10, 2), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("reject_reason", sa.String(100)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_offers_listing_id", "offers", ["listing_id"])
    op.create_index("ix_offers_buyer_id", "offers", ["buyer_id"])

    # ── reservations ───────────────────────────────────────────────────────────
    op.create_table(
        "reservations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("offer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("offers.id"), nullable=False, unique=True),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("buyer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agreed_price", sa.Numeric(10, 2), nullable=False),
        sa.Column("upi_collect_ref", sa.String(256)),
        sa.Column("upi_collect_status", sa.String(30), server_default="pending"),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_reservations_listing_id", "reservations", ["listing_id"])
    op.create_index("ix_reservations_buyer_id", "reservations", ["buyer_id"])

    # ── transactions ───────────────────────────────────────────────────────────
    op.create_table(
        "transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("reservation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("reservations.id"), nullable=False, unique=True),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("buyer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("listing_snapshot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listing_snapshots.id"), nullable=False),
        sa.Column("transaction_type", sa.String(20), nullable=False),
        sa.Column("gross_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("platform_fee", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("gst_on_fee", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("tds_withheld", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("partial_refund", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("net_payout", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(40), nullable=False, server_default="pending"),
        sa.Column("workflow_id", sa.String(256)),
        sa.Column("dispute_id", postgresql.UUID(as_uuid=True)),
        sa.Column("buyer_confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("seller_confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("auto_completed_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_reason", sa.String(100)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_transactions_buyer_id", "transactions", ["buyer_id"])
    op.create_index("ix_transactions_seller_id", "transactions", ["seller_id"])
    op.create_index("ix_transactions_status", "transactions", ["status"])

    # ── payment_intents ────────────────────────────────────────────────────────
    op.create_table(
        "payment_intents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("transactions.id"), nullable=False),
        sa.Column("pa_order_id", sa.String(256), unique=True),
        sa.Column("idempotency_key", sa.String(128), unique=True, nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("method", sa.String(20), server_default="upi"),
        sa.Column("status", sa.String(30), nullable=False, server_default="created"),
        sa.Column("pa_response", postgresql.JSONB),
        sa.Column("captured_at", sa.DateTime(timezone=True)),
        sa.Column("failed_at", sa.DateTime(timezone=True)),
        sa.Column("refunded_at", sa.DateTime(timezone=True)),
        sa.Column("refund_amount", sa.Numeric(10, 2)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_payment_intents_transaction_id", "payment_intents", ["transaction_id"])

    # ── tds_annual_ledger ──────────────────────────────────────────────────────
    op.create_table(
        "tds_annual_ledger",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("financial_year", sa.String(7), nullable=False),
        sa.Column("cumulative_paid", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("tds_withheld", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("threshold", sa.Numeric(14, 2), nullable=False, server_default="500000"),
        sa.Column("pan_available", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_tds_ledger_seller_fy", "tds_annual_ledger", ["seller_id", "financial_year"], unique=True)

    # ── reconciliation_runs ────────────────────────────────────────────────────
    op.create_table(
        "reconciliation_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("run_date", sa.String(10), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("total_transactions", sa.String(10)),
        sa.Column("matched", sa.String(10)),
        sa.Column("mismatches", sa.String(10)),
        sa.Column("result_summary", postgresql.JSONB),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )

    # ── admin_users ────────────────────────────────────────────────────────────
    op.create_table(
        "admin_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column("mfa_secret", sa.String(64)),
        sa.Column("mfa_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # ── admin_audit_log ────────────────────────────────────────────────────────
    op.create_table(
        "admin_audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("admin_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("admin_users.id"), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(50)),
        sa.Column("entity_id", sa.String(100)),
        sa.Column("before_state", postgresql.JSONB),
        sa.Column("after_state", postgresql.JSONB),
        sa.Column("reviewer_notes", sa.String(500)),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("mfa_verified", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_admin_audit_log_admin_user_id", "admin_audit_log", ["admin_user_id"])
    op.create_index("ix_admin_audit_log_entity", "admin_audit_log", ["entity_type", "entity_id"])

    # ── super_admin_actions ────────────────────────────────────────────────────
    op.create_table(
        "super_admin_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("audit_log_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("admin_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(50)),
        sa.Column("entity_id", sa.String(100)),
        sa.Column("full_state_snapshot", postgresql.JSONB),
        sa.Column("mfa_verified", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # ── Seed MVP categories ────────────────────────────────────────────────────
    op.execute("""
        INSERT INTO categories (id, name, slug, shipping_eligible, local_eligible, imei_required, sort_order)
        VALUES
          (uuid_generate_v4(), 'Smartphones',     'smartphones',      true,  true, true,  1),
          (uuid_generate_v4(), 'Laptops',          'laptops',          true,  true, false, 2),
          (uuid_generate_v4(), 'Tablets',          'tablets',          true,  true, false, 3),
          (uuid_generate_v4(), 'Small Appliances', 'small-appliances', false, true, false, 4),
          (uuid_generate_v4(), 'Kids & Utility',   'kids-utility',     false, true, false, 5)
    """)


def downgrade() -> None:
    op.drop_table("super_admin_actions")
    op.drop_table("admin_audit_log")
    op.drop_table("admin_users")
    op.drop_table("reconciliation_runs")
    op.drop_table("tds_annual_ledger")
    op.drop_table("payment_intents")
    op.drop_table("transactions")
    op.drop_table("reservations")
    op.drop_table("offers")
    op.drop_table("listing_snapshots")
    op.drop_table("listing_images")
    op.drop_table("listings")
    op.drop_table("categories")
    op.drop_table("consent_events")
    op.drop_table("kyc_events")
    op.drop_table("kyc_verifications")
    op.drop_table("phone_change_requests")
    op.drop_table("auth_events")
    op.drop_table("devices")
    op.drop_table("sessions")
    op.drop_table("users")
