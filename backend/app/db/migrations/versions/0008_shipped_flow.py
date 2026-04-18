"""Phase 2: shipped transaction flow

Revision ID: 0008_shipped_flow
Revises: 0007_notif_bucket
Create Date: 2026-04-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = '0008_shipped_flow'
down_revision = '0007_notif_bucket'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── Shipments table ──────────────────────────────────────────────────────
    if not conn.dialect.has_table(conn, 'shipments'):
        op.create_table(
            'shipments',
            sa.Column('id', sa.UUID(), nullable=False, primary_key=True,
                      server_default=sa.text('gen_random_uuid()')),
            sa.Column('transaction_id', sa.UUID(), sa.ForeignKey('transactions.id'), nullable=False),
            sa.Column('status', sa.String(30), nullable=False, server_default='pending'),
            sa.Column('logistics_provider', sa.String(50), nullable=True),
            sa.Column('tracking_id', sa.String(200), nullable=True),
            sa.Column('pickup_address', sa.Text, nullable=True),
            sa.Column('delivery_address', sa.Text, nullable=True),
            sa.Column('inspection_passed', sa.Boolean, nullable=True),
            sa.Column('inspection_notes', sa.Text, nullable=True),
            sa.Column('inspection_images', sa.JSON, nullable=True),
            sa.Column('gross_amount', sa.Numeric(12, 2), nullable=True),
            sa.Column('tds_withheld', sa.Numeric(12, 2), nullable=True),
            sa.Column('platform_fee', sa.Numeric(12, 2), nullable=True),
            sa.Column('gst_on_fee', sa.Numeric(12, 2), nullable=True),
            sa.Column('net_payout', sa.Numeric(12, 2), nullable=True),
            sa.Column('pickup_scheduled_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('picked_up_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('buyer_accepted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('dispute_deadline', sa.DateTime(timezone=True), nullable=True),
            sa.Column('payout_eligible_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('payout_released_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text('now()')),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text('now()')),
        )

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_shipments_transaction_id ON shipments (transaction_id)
    """))
    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_shipments_tracking_id ON shipments (tracking_id)
    """))

    # ── Add shipped fields to transactions ───────────────────────────────────
    insp = sa.inspect(conn)
    txn_cols = [c['name'] for c in insp.get_columns('transactions')]
    if 'shipment_id' not in txn_cols:
        op.add_column('transactions', sa.Column('shipment_id', sa.UUID(), nullable=True))
    if 'buyer_acceptance_deadline' not in txn_cols:
        op.add_column('transactions',
                      sa.Column('buyer_acceptance_deadline', sa.DateTime(timezone=True), nullable=True))

    # ── TDS ledger table ─────────────────────────────────────────────────────
    if not conn.dialect.has_table(conn, 'tds_ledger'):
        op.create_table(
            'tds_ledger',
            sa.Column('id', sa.UUID(), nullable=False, primary_key=True,
                      server_default=sa.text('gen_random_uuid()')),
            sa.Column('seller_id', sa.UUID(), nullable=False),
            sa.Column('transaction_id', sa.UUID(), nullable=False),
            sa.Column('financial_year', sa.String(10), nullable=False),
            sa.Column('gross_payout', sa.Numeric(12, 2), nullable=False),
            sa.Column('tds_rate', sa.Numeric(5, 4), nullable=False, server_default='0.01'),
            sa.Column('tds_amount', sa.Numeric(12, 2), nullable=False),
            sa.Column('cumulative_fy_payout', sa.Numeric(12, 2), nullable=False),
            sa.Column('tds_threshold_crossed', sa.Boolean, nullable=False, server_default='false'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                      server_default=sa.text('now()')),
        )

    conn.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_tds_ledger_seller_fy
        ON tds_ledger (seller_id, financial_year)
    """))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(text("DROP INDEX IF EXISTS ix_tds_ledger_seller_fy"))
    conn.execute(text("DROP INDEX IF EXISTS ix_shipments_tracking_id"))
    conn.execute(text("DROP INDEX IF EXISTS ix_shipments_transaction_id"))
    if conn.dialect.has_table(conn, 'tds_ledger'):
        op.drop_table('tds_ledger')
    conn.execute(text("ALTER TABLE transactions DROP COLUMN IF EXISTS buyer_acceptance_deadline"))
    conn.execute(text("ALTER TABLE transactions DROP COLUMN IF EXISTS shipment_id"))
    if conn.dialect.has_table(conn, 'shipments'):
        op.drop_table('shipments')
