"""Pricing model rewrite — drop platform fee, add delivery fee.

Owmee V1 launch decision: zero platform fee. Sellers receive (agreed_price -
TDS). Buyers pay (agreed_price + delivery_fee), where delivery_fee is ₹100
for small-appliances category and ₹0 for everything else.

Schema changes:
- Add transactions.delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0.
- platform_fee + gst_on_fee columns are kept for now (zero-valued by code)
  so we don't have to touch every reporting query simultaneously. Drop in
  a followup migration once those queries are audited.

Revision ID: 0027_pricing_model
Revises: 0026_fk_cascades
Create Date: 2026-05-01
"""
from alembic import op
import sqlalchemy as sa


revision = "0027_pricing_model"
down_revision = "0026_fk_cascades"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "delivery_fee",
            sa.Numeric(10, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("transactions", "delivery_fee")
