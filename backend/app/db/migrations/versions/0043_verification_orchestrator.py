"""Add verification orchestrator tables.

Revision ID: 0043_verification_orchestrator
Revises: 0042_ai_listing_review_snapshot
Create Date: 2026-05-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0043_verification_orchestrator"
down_revision = "0042_ai_listing_review_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "verification_checks",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("uuid_generate_v4()"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("check_type", sa.String(length=40), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("provider_ref", sa.String(length=256), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("risk_band", sa.String(length=20), nullable=True),
        sa.Column("applies_to", sa.String(length=40), nullable=True),
        sa.Column("idempotency_key", sa.String(length=160), nullable=True),
        sa.Column("input_fingerprint", sa.String(length=128), nullable=True),
        sa.Column("reason_codes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("idempotency_key", name="uq_verification_checks_idempotency_key"),
    )
    op.create_index("ix_verification_checks_user_id", "verification_checks", ["user_id"])
    op.create_index("ix_verification_checks_check_type", "verification_checks", ["check_type"])
    op.create_index("ix_verification_checks_status", "verification_checks", ["status"])
    op.create_index(
        "ix_verification_checks_user_type_created",
        "verification_checks",
        ["user_id", "check_type", "created_at"],
    )

    op.create_table(
        "risk_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("uuid_generate_v4()"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("applies_to", sa.String(length=40), nullable=False, server_default="global"),
        sa.Column("decision", sa.String(length=30), nullable=False),
        sa.Column("source_check_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("risk_band", sa.String(length=20), nullable=True),
        sa.Column("reason_codes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["source_check_id"], ["verification_checks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_risk_decisions_user_id", "risk_decisions", ["user_id"])
    op.create_index("ix_risk_decisions_applies_to", "risk_decisions", ["applies_to"])
    op.create_index("ix_risk_decisions_decision", "risk_decisions", ["decision"])
    op.create_index("ix_risk_decisions_source_check_id", "risk_decisions", ["source_check_id"])
    op.create_index(
        "ix_risk_decisions_user_action_created",
        "risk_decisions",
        ["user_id", "applies_to", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_risk_decisions_user_action_created", table_name="risk_decisions")
    op.drop_index("ix_risk_decisions_source_check_id", table_name="risk_decisions")
    op.drop_index("ix_risk_decisions_decision", table_name="risk_decisions")
    op.drop_index("ix_risk_decisions_applies_to", table_name="risk_decisions")
    op.drop_index("ix_risk_decisions_user_id", table_name="risk_decisions")
    op.drop_table("risk_decisions")

    op.drop_index("ix_verification_checks_user_type_created", table_name="verification_checks")
    op.drop_index("ix_verification_checks_status", table_name="verification_checks")
    op.drop_index("ix_verification_checks_check_type", table_name="verification_checks")
    op.drop_index("ix_verification_checks_user_id", table_name="verification_checks")
    op.drop_table("verification_checks")
