"""Transaction readiness and address snapshots.

Revision ID: 0044_transaction_readiness_snapshots
Revises: 0043_verification_orchestrator
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0044_transaction_readiness_snapshots"
down_revision = "0043_verification_orchestrator"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Alembic's default version table can be VARCHAR(32), but this revision id
    # is longer. Widen before Alembic records this migration as applied.
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)")

    op.alter_column(
        "transactions",
        "refund_initiated_by",
        existing_type=sa.String(length=20),
        type_=sa.String(length=40),
        existing_nullable=True,
    )
    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS buyer_delivery_address_snapshot JSONB")
    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS seller_pickup_address_snapshot JSONB")
    op.execute("""
        ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS seller_readiness_status VARCHAR(24) NOT NULL DEFAULT 'pending'
    """)
    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS seller_readiness_reason VARCHAR(80)")
    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS seller_pickup_slot_start TIMESTAMPTZ")
    op.execute("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS seller_pickup_slot_end TIMESTAMPTZ")

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_txn_payment_seller_readiness
        ON transactions (status, seller_readiness_status)
        WHERE status = 'payment_captured'
    """)


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
