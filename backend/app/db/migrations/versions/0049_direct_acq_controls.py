"""Direct acquisition fraud-control gates.

Revision ID: 0049_direct_acq_controls
Revises: 0048_direct_acq
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0049_direct_acq_controls"
down_revision = "0048_direct_acq"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("direct_acquisition_bookings", sa.Column("arrival_otp_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("arrival_otp_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("direct_acquisition_bookings", sa.Column("final_acceptance_otp_hash", sa.String(length=128), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("final_acceptance_otp_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("final_acceptance_otp_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("direct_acquisition_bookings", sa.Column("fe_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("fe_arrived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("fe_start_location", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("direct_acquisition_bookings", sa.Column("fe_arrival_location", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("direct_acquisition_bookings", sa.Column("seller_verified_location", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("direct_acquisition_bookings", sa.Column("seller_final_acceptance_location", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("direct_acquisition_bookings", sa.Column("payout_ready_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("payout_ready_by_fe_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("field_executives.id", ondelete="SET NULL"), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("payout_status", sa.String(length=32), nullable=False, server_default="not_started"))
    op.add_column("direct_acquisition_bookings", sa.Column("payout_reference_id", sa.String(length=100), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("payout_processed_by_admin_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("payout_failure_reason", sa.Text(), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("warehouse_received_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("warehouse_received_by_admin_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("warehouse_receipt_code", sa.String(length=80), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("warehouse_receipt_notes", sa.Text(), nullable=True))
    op.add_column("direct_acquisition_bookings", sa.Column("risk_flags", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")))

    op.add_column("acquisition_items", sa.Column("qc_evidence_manifest", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("acquisition_items", sa.Column("reject_evidence_photos", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.add_column("acquisition_items", sa.Column("custody_seal_code", sa.String(length=80), nullable=True))
    op.add_column("acquisition_items", sa.Column("warehouse_status", sa.String(length=32), nullable=False, server_default="pending"))
    op.add_column("acquisition_items", sa.Column("warehouse_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("acquisition_items", "warehouse_notes")
    op.drop_column("acquisition_items", "warehouse_status")
    op.drop_column("acquisition_items", "custody_seal_code")
    op.drop_column("acquisition_items", "reject_evidence_photos")
    op.drop_column("acquisition_items", "qc_evidence_manifest")

    op.drop_column("direct_acquisition_bookings", "risk_flags")
    op.drop_column("direct_acquisition_bookings", "warehouse_receipt_notes")
    op.drop_column("direct_acquisition_bookings", "warehouse_receipt_code")
    op.drop_column("direct_acquisition_bookings", "warehouse_received_by_admin_id")
    op.drop_column("direct_acquisition_bookings", "warehouse_received_at")
    op.drop_column("direct_acquisition_bookings", "payout_failure_reason")
    op.drop_column("direct_acquisition_bookings", "payout_processed_by_admin_id")
    op.drop_column("direct_acquisition_bookings", "payout_reference_id")
    op.drop_column("direct_acquisition_bookings", "payout_status")
    op.drop_column("direct_acquisition_bookings", "payout_ready_by_fe_id")
    op.drop_column("direct_acquisition_bookings", "payout_ready_at")
    op.drop_column("direct_acquisition_bookings", "seller_final_acceptance_location")
    op.drop_column("direct_acquisition_bookings", "seller_verified_location")
    op.drop_column("direct_acquisition_bookings", "fe_arrival_location")
    op.drop_column("direct_acquisition_bookings", "fe_start_location")
    op.drop_column("direct_acquisition_bookings", "fe_arrived_at")
    op.drop_column("direct_acquisition_bookings", "fe_started_at")
    op.drop_column("direct_acquisition_bookings", "final_acceptance_otp_attempts")
    op.drop_column("direct_acquisition_bookings", "final_acceptance_otp_expires_at")
    op.drop_column("direct_acquisition_bookings", "final_acceptance_otp_hash")
    op.drop_column("direct_acquisition_bookings", "arrival_otp_attempts")
    op.drop_column("direct_acquisition_bookings", "arrival_otp_expires_at")
