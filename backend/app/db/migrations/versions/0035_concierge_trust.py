"""Concierge Phase 2: arrival verification code + confirmation timestamp.

Why
---
The "trust theater" between booking and visit (master spec section 5)
ends with a mutual-verification moment at the door:
  - Specialist taps "Arrived" in the FE app, sees the 4-digit code,
    reads it to the seller.
  - Seller receives N6 push, opens the verify screen, taps either
    "✓ Vikram told me this code" or "⚠️ Code didn't match."

The code is generated at visit-request time (random 4-digit, zero-padded)
so the value is stable across the entire flow even if status moves
backward (rare, but happens). Storing the seller's confirmation timestamp
gives ops auditable history if a dispute later mentions the door visit.

Revision ID: 0035_concierge_trust
Revises: 0034_concierge_visit_fields
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "0035_concierge_trust"
down_revision = "0034_concierge_visit_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fe_visits",
        sa.Column(
            "arrival_verification_code",
            sa.String(4),
            nullable=True,
            comment="4-digit code shared between specialist and seller at the door",
        ),
    )
    op.add_column(
        "fe_visits",
        sa.Column(
            "arrival_confirmed_by_seller_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the seller tapped 'code matched' in the verify screen",
        ),
    )


def downgrade() -> None:
    op.drop_column("fe_visits", "arrival_confirmed_by_seller_at")
    op.drop_column("fe_visits", "arrival_verification_code")
