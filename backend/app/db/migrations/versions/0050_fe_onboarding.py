"""FE onboarding lifecycle controls.

Revision ID: 0050_fe_onboarding
Revises: 0049_direct_acq_controls
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0050_fe_onboarding"
down_revision = "0049_direct_acq_controls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("field_executives", sa.Column("onboarding_status", sa.String(length=32), nullable=False, server_default="active"))
    op.add_column("field_executives", sa.Column("verification_status", sa.String(length=32), nullable=False, server_default="approved"))
    op.add_column("field_executives", sa.Column("training_status", sa.String(length=32), nullable=False, server_default="certified"))
    op.add_column("field_executives", sa.Column("device_status", sa.String(length=32), nullable=False, server_default="approved"))
    op.add_column("field_executives", sa.Column("employment_type", sa.String(length=32), nullable=False, server_default="contractor"))
    op.add_column("field_executives", sa.Column("vendor_name", sa.String(length=120), nullable=True))
    op.add_column("field_executives", sa.Column("manager_admin_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("field_executives", sa.Column("service_zones", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[\"legacy\"]'::jsonb")))
    op.add_column("field_executives", sa.Column("category_certifications", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[\"*\"]'::jsonb")))
    op.add_column("field_executives", sa.Column("languages", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")))
    op.add_column("field_executives", sa.Column("daily_capacity", sa.Integer(), nullable=False, server_default="4"))
    op.add_column("field_executives", sa.Column("profile_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("field_executives", sa.Column("onboarding_checklist", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("field_executives", sa.Column("device_binding", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("field_executives", sa.Column("risk_metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("field_executives", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("certified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("device_approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("shift_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("field_executives", sa.Column("shift_location", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("field_executives", sa.Column("suspended_reason", sa.Text(), nullable=True))
    op.add_column("field_executives", sa.Column("admin_notes", sa.Text(), nullable=True))
    op.create_index("ix_field_executives_onboarding_status", "field_executives", ["onboarding_status"])


def downgrade() -> None:
    op.drop_index("ix_field_executives_onboarding_status", table_name="field_executives")
    op.drop_column("field_executives", "admin_notes")
    op.drop_column("field_executives", "suspended_reason")
    op.drop_column("field_executives", "shift_location")
    op.drop_column("field_executives", "shift_started_at")
    op.drop_column("field_executives", "last_seen_at")
    op.drop_column("field_executives", "rejected_at")
    op.drop_column("field_executives", "deactivated_at")
    op.drop_column("field_executives", "suspended_at")
    op.drop_column("field_executives", "activated_at")
    op.drop_column("field_executives", "device_approved_at")
    op.drop_column("field_executives", "certified_at")
    op.drop_column("field_executives", "verified_at")
    op.drop_column("field_executives", "risk_metrics")
    op.drop_column("field_executives", "device_binding")
    op.drop_column("field_executives", "onboarding_checklist")
    op.drop_column("field_executives", "profile_snapshot")
    op.drop_column("field_executives", "daily_capacity")
    op.drop_column("field_executives", "languages")
    op.drop_column("field_executives", "category_certifications")
    op.drop_column("field_executives", "service_zones")
    op.drop_column("field_executives", "manager_admin_id")
    op.drop_column("field_executives", "vendor_name")
    op.drop_column("field_executives", "employment_type")
    op.drop_column("field_executives", "device_status")
    op.drop_column("field_executives", "training_status")
    op.drop_column("field_executives", "verification_status")
    op.drop_column("field_executives", "onboarding_status")
