"""Sprint 4 / Pass 4e: listing_snapshot JSONB on transactions.

Freezes the listing state at transaction creation time. Disputes and
transaction history reference the snapshot, not the live listing, so
seller edits after reservation don't alter what was agreed to.

Design: additive, nullable. Existing transactions have NULL snapshots;
new transactions get snapshots populated by freeze_snapshot() service.
If the snapshot hook ever fails, transaction still proceeds — snapshot
stays NULL and admin can backfill via /v1/admin/transactions/{id}/freeze-snapshot.

Revision ID: 0022_transaction_snapshot
Revises: 0021_fe_earnings
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa


revision = "0022_transaction_snapshot"
down_revision = "0021_fe_earnings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "listing_snapshot",
            sa.dialects.postgresql.JSONB,
            nullable=True,
        ),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "snapshot_frozen_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("transactions", "snapshot_frozen_at")
    op.drop_column("transactions", "listing_snapshot")
