"""Owmee Direct acquisition tables.

Revision ID: 0048_direct_acq
Revises: 0047_perf_read_path_indexes
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0048_direct_acq"
down_revision = "0047_perf_read_path_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "direct_acquisition_bookings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("booking_code", sa.String(length=24), nullable=False),
        sa.Column("seller_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seller_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pickup_address_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_addresses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("pickup_address_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("pickup_locality", sa.String(length=200), nullable=False),
        sa.Column("pickup_pincode", sa.String(length=20), nullable=False),
        sa.Column("slot_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("slot_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=48), nullable=False, server_default="pending_fe_assignment"),
        sa.Column("assigned_fe_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("field_executives.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assignment_method", sa.String(length=24), nullable=True),
        sa.Column("seller_otp_hash", sa.String(length=128), nullable=False),
        sa.Column("seller_phone_verified", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("seller_ownership_declaration", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("serviceable_area", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("estimated_visit_duration_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("route_cluster_id", sa.String(length=64), nullable=True),
        sa.Column("assignment_priority", sa.String(length=32), nullable=True),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated_total_offer_inr", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_total_payout_inr", sa.Integer(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seller_final_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payout_initiated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payout_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handover_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("warehouse_inbound_id", sa.String(length=64), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_direct_acquisition_bookings_booking_code", "direct_acquisition_bookings", ["booking_code"], unique=True)
    op.create_index("ix_direct_acquisition_bookings_seller_user_id", "direct_acquisition_bookings", ["seller_user_id"])
    op.create_index("ix_direct_acquisition_bookings_seller_account_id", "direct_acquisition_bookings", ["seller_account_id"])
    op.create_index("ix_direct_acquisition_bookings_status", "direct_acquisition_bookings", ["status"])
    op.create_index("ix_direct_acquisition_bookings_assigned_fe_id", "direct_acquisition_bookings", ["assigned_fe_id"])

    op.create_table(
        "acquisition_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("direct_acquisition_bookings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("draft_listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("category", sa.String(length=24), nullable=False),
        sa.Column("item_type", sa.String(length=120), nullable=False),
        sa.Column("item_title", sa.String(length=200), nullable=False),
        sa.Column("seller_photos", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("pickup_photos", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("seller_check_answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ai_detected_type", sa.String(length=120), nullable=False),
        sa.Column("policy_status", sa.String(length=32), nullable=False, server_default="allowed"),
        sa.Column("direct_eligibility_status", sa.String(length=32), nullable=False, server_default="eligible"),
        sa.Column("blocked_item_warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("qc_checklist_template_id", sa.String(length=80), nullable=False),
        sa.Column("required_pickup_photos", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("owmee_suggested_offer_inr", sa.Integer(), nullable=False),
        sa.Column("offer_valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("max_fe_auto_increase_allowed", sa.Numeric(5, 2), nullable=False, server_default="10"),
        sa.Column("fe_final_offer_inr", sa.Integer(), nullable=True),
        sa.Column("price_change_percent", sa.Numeric(7, 2), nullable=True),
        sa.Column("price_change_reason_code", sa.String(length=80), nullable=True),
        sa.Column("price_change_evidence_photos", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("approval_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("approval_status", sa.String(length=32), nullable=False, server_default="not_required"),
        sa.Column("qc_status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("qc_answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("qc_notes", sa.Text(), nullable=True),
        sa.Column("item_status", sa.String(length=40), nullable=False, server_default="pending_qc"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_acquisition_items_booking_id", "acquisition_items", ["booking_id"])
    op.create_index("ix_acquisition_items_item_status", "acquisition_items", ["item_status"])

    op.create_table(
        "price_override_approvals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("direct_acquisition_bookings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("acquisition_item_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("acquisition_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requested_by_fe_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("field_executives.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("base_offer_inr", sa.Integer(), nullable=False),
        sa.Column("requested_offer_inr", sa.Integer(), nullable=False),
        sa.Column("change_percent", sa.Numeric(7, 2), nullable=False),
        sa.Column("reason_code", sa.String(length=80), nullable=False),
        sa.Column("evidence_photos", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("approved_by_admin_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_price_override_approvals_booking_id", "price_override_approvals", ["booking_id"])
    op.create_index("ix_price_override_approvals_acquisition_item_id", "price_override_approvals", ["acquisition_item_id"])
    op.create_index("ix_price_override_approvals_status", "price_override_approvals", ["status"])

    op.create_table(
        "seller_account_ledger_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("uuid_generate_v4()"), primary_key=True, nullable=False),
        sa.Column("seller_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("direct_acquisition_bookings.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount_inr", sa.Integer(), nullable=False),
        sa.Column("entry_type", sa.String(length=48), nullable=False, server_default="acquisition_payout_credit"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
        sa.Column("reference_id", sa.String(length=100), nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_seller_account_ledger_entries_seller_account_id", "seller_account_ledger_entries", ["seller_account_id"])
    op.create_index("ix_seller_account_ledger_entries_booking_id", "seller_account_ledger_entries", ["booking_id"])
    op.create_index("ix_seller_account_ledger_entries_status", "seller_account_ledger_entries", ["status"])
    op.create_index("uq_seller_account_ledger_entries_reference_id", "seller_account_ledger_entries", ["reference_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_seller_account_ledger_entries_reference_id", table_name="seller_account_ledger_entries")
    op.drop_index("ix_seller_account_ledger_entries_status", table_name="seller_account_ledger_entries")
    op.drop_index("ix_seller_account_ledger_entries_booking_id", table_name="seller_account_ledger_entries")
    op.drop_index("ix_seller_account_ledger_entries_seller_account_id", table_name="seller_account_ledger_entries")
    op.drop_table("seller_account_ledger_entries")
    op.drop_index("ix_price_override_approvals_status", table_name="price_override_approvals")
    op.drop_index("ix_price_override_approvals_acquisition_item_id", table_name="price_override_approvals")
    op.drop_index("ix_price_override_approvals_booking_id", table_name="price_override_approvals")
    op.drop_table("price_override_approvals")
    op.drop_index("ix_acquisition_items_item_status", table_name="acquisition_items")
    op.drop_index("ix_acquisition_items_booking_id", table_name="acquisition_items")
    op.drop_table("acquisition_items")
    op.drop_index("ix_direct_acquisition_bookings_assigned_fe_id", table_name="direct_acquisition_bookings")
    op.drop_index("ix_direct_acquisition_bookings_status", table_name="direct_acquisition_bookings")
    op.drop_index("ix_direct_acquisition_bookings_seller_account_id", table_name="direct_acquisition_bookings")
    op.drop_index("ix_direct_acquisition_bookings_seller_user_id", table_name="direct_acquisition_bookings")
    op.drop_index("ix_direct_acquisition_bookings_booking_code", table_name="direct_acquisition_bookings")
    op.drop_table("direct_acquisition_bookings")
