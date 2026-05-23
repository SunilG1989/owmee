"""Transaction readiness and address snapshots.

Revision ID: 0044_transaction_readiness_snapshots
Revises: 0043_verification_orchestrator
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0044_transaction_readiness_snapshots"
down_revision = "0043_verification_orchestrator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "transactions",
        "refund_initiated_by",
        existing_type=sa.String(length=20),
        type_=sa.String(length=40),
        existing_nullable=True,
    )
    op.add_column(
        "transactions",
        sa.Column("buyer_delivery_address_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "transactions",
        sa.Column("seller_pickup_address_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "seller_readiness_status",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )
    op.add_column("transactions", sa.Column("seller_readiness_reason", sa.String(length=80), nullable=True))
    op.add_column("transactions", sa.Column("seller_pickup_slot_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("seller_pickup_slot_end", sa.DateTime(timezone=True), nullable=True))

    op.create_index(
        "idx_txn_payment_seller_readiness",
        "transactions",
        ["status", "seller_readiness_status"],
        postgresql_where=sa.text("status = 'payment_captured'"),
    )


def downgrade() -> None:
    op.drop_index("idx_txn_payment_seller_readiness", table_name="transactions")
    op.drop_column("transactions", "seller_pickup_slot_end")
    op.drop_column("transactions", "seller_pickup_slot_start")
    op.drop_column("transactions", "seller_readiness_reason")
    op.drop_column("transactions", "seller_readiness_status")
    op.drop_column("transactions", "seller_pickup_address_snapshot")
    op.drop_column("transactions", "buyer_delivery_address_snapshot")
    op.alter_column(
        "transactions",
        "refund_initiated_by",
        existing_type=sa.String(length=40),
        type_=sa.String(length=20),
        existing_nullable=True,
    )
