"""Buyer order notes (gate code / parking / leave-with-security).

Why
---
P0.2 added a delivery-instructions field to mobile CheckoutScreen but
the data was being kept in FE state and dropped at Pay. The FE delivery
agent shows up with no idea about gate codes, parking, or "leave with
security" — defeats the purpose. Add a column on Transaction and pipe
the FE field through Orders.buyNow().

Revision ID: 0039_order_notes
Revises: 0038b_backfill_address_contact
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "0039_order_notes"
down_revision = "0038b_backfill_address_contact"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "order_notes",
            sa.String(500),
            nullable=True,
            comment="Buyer-provided delivery instructions captured at "
                    "checkout. Surfaced to the FE delivery agent.",
        ),
    )


def downgrade() -> None:
    op.drop_column("transactions", "order_notes")
