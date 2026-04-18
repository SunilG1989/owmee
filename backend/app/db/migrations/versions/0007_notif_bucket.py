"""
0007: add notification_bucket to notification_events
Missing column that should have been in 0002.
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_notif_bucket"
down_revision = "0006_india_ux2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add missing notification_bucket to notification_events
    op.add_column(
        "notification_events",
        sa.Column(
            "notification_bucket",
            sa.String(20),
            nullable=False,
            server_default="transaction",
        ),
    )
    # Add seller_ghosting_flagged_at to transactions (in model but missing from migrations)
    op.add_column(
        "transactions",
        sa.Column("seller_ghosting_flagged_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notification_events", "notification_bucket")
    op.drop_column("transactions", "seller_ghosting_flagged_at")
