"""Sprint 6c — refund tracking columns on transactions.

Why on transactions and not a separate table
--------------------------------------------
At V1 hyperlocal pilot scale the refund state is 1:1 with a transaction
(no partial refunds, no multi-refund cycles). Adding fields keeps the
join graph simple and lets the admin queries stay single-table. If we
ever introduce multi-refund / split refunds we'll factor out a refunds
table; the columns can become a denormalized snapshot of the latest.

The pre-existing `partial_refund` Numeric column stays unchanged — that
was a placeholder; the V1 model uses refund_amount as the canonical field.

Fields
------
  refund_status         'none' | 'requested' | 'processing' | 'completed' | 'failed'
                        default 'none' so existing rows are valid.
  refund_amount         NUMERIC(10,2) NULL — total amount refunded (paise)
  refund_reason         VARCHAR(200) — admin/system reason
  refund_initiated_at   TIMESTAMPTZ — when initiate_refund() was called
  refund_completed_at   TIMESTAMPTZ — when payment partner confirmed
  refund_initiated_by   VARCHAR(20) — 'system_pickup_rejected' | 'admin' | 'buyer'
  razorpay_refund_id    VARCHAR(120) — Razorpay's id for idempotent retries

Index
-----
  idx_txn_refund_pending — drives /admin/refunds queue without scanning
  the whole table.

Revision: 0030_refund_fields
Down-rev: 0029_hybrid_logistics
"""
from alembic import op
import sqlalchemy as sa


revision = "0030_refund_fields"
down_revision = "0029_hybrid_logistics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column(
        "refund_status", sa.String(20), nullable=False,
        server_default=sa.text("'none'"),
    ))
    op.add_column("transactions", sa.Column("refund_amount", sa.Numeric(10, 2), nullable=True))
    op.add_column("transactions", sa.Column("refund_reason", sa.String(200), nullable=True))
    op.add_column("transactions", sa.Column("refund_initiated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("refund_completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("refund_initiated_by", sa.String(20), nullable=True))
    op.add_column("transactions", sa.Column("razorpay_refund_id", sa.String(120), nullable=True))

    op.create_index(
        "idx_txn_refund_pending",
        "transactions",
        ["refund_status", "refund_initiated_at"],
        postgresql_where=sa.text("refund_status IN ('requested', 'processing')"),
    )


def downgrade() -> None:
    op.drop_index("idx_txn_refund_pending", table_name="transactions")
    for col in (
        "razorpay_refund_id", "refund_initiated_by",
        "refund_completed_at", "refund_initiated_at",
        "refund_reason", "refund_amount", "refund_status",
    ):
        op.drop_column("transactions", col)
