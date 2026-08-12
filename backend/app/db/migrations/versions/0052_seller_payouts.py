"""Marketplace seller payouts: ledger, payout accounts, payout records.

Design: docs/OWMEE_SELLER_PAYOUTS.md. Amazon-style protection-window reserve
(payout eligible at completed/auto_completed), Meesho-style clawback netting,
append-only idempotent ledger, manual finance rail v1.

Revision ID: 0052_seller_payouts
Revises: 0051_notification_ops_core
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0052_seller_payouts"
down_revision = "0051_notification_ops_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The payout destination, captured at the KYC payout step. Previously the
    # VPA/account was verified with Digio then discarded — nothing on file to
    # pay into. APIs must only ever serialize masked_display.
    op.create_table(
        "seller_payout_accounts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("uuid_generate_v4()")),
        sa.Column("user_id", UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("account_type", sa.String(20), nullable=False),  # upi | bank
        sa.Column("vpa", sa.String(120), nullable=True),
        sa.Column("account_number", sa.String(34), nullable=True),
        sa.Column("ifsc_code", sa.String(11), nullable=True),
        sa.Column("account_holder_name", sa.String(120), nullable=True),
        sa.Column("masked_display", sa.String(64), nullable=False),
        sa.Column("provider_ref", sa.String(256), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index(
        "uq_seller_payout_accounts_active",
        "seller_payout_accounts",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )

    # One row per money-out event. v1 manual rail records the transfer after
    # finance makes it (status recorded|failed); an API rail adds
    # queued/processing later.
    op.create_table(
        "seller_payouts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("uuid_generate_v4()")),
        sa.Column("seller_id", UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("amount_inr", sa.Numeric(12, 2), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="recorded"),
        sa.Column("method", sa.String(24), nullable=False),  # manual_bank | manual_upi | razorpayx
        sa.Column("payout_account_id", UUID(as_uuid=True),
                  sa.ForeignKey("seller_payout_accounts.id", ondelete="RESTRICT"),
                  nullable=False),
        sa.Column("utr_reference", sa.String(64), nullable=True),
        sa.Column("initiated_by", sa.String(64), nullable=False),  # admin user id
        sa.Column("idempotency_key", sa.String(120), nullable=False, unique=True),
        sa.Column("failure_reason", sa.String(300), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )

    # Append-only marketplace seller ledger. Balances are sums over entries,
    # never mutable columns; every business event posts exactly once via the
    # unique reference_id (sale:{txn}, clawback:{txn}, payout:{payout_id}).
    op.create_table(
        "seller_ledger_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("uuid_generate_v4()")),
        sa.Column("seller_id", UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("entry_type", sa.String(32), nullable=False),
        # sale_credit | refund_clawback | adjustment | payout_debit
        sa.Column("amount_inr", sa.Numeric(12, 2), nullable=False),  # signed
        sa.Column("reference_id", sa.String(120), nullable=False, unique=True),
        sa.Column("transaction_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("payout_id", UUID(as_uuid=True),
                  sa.ForeignKey("seller_payouts.id", ondelete="RESTRICT"),
                  nullable=True),
        sa.Column("memo", sa.String(300), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_seller_ledger_seller_created",
        "seller_ledger_entries",
        ["seller_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_seller_ledger_seller_created", table_name="seller_ledger_entries")
    op.drop_table("seller_ledger_entries")
    op.drop_table("seller_payouts")
    op.drop_index("uq_seller_payout_accounts_active", table_name="seller_payout_accounts")
    op.drop_table("seller_payout_accounts")
