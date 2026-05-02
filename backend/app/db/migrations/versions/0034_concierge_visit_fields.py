"""Concierge Phase 1: notes_tags column on fe_visits.

Why
---
The simplified one-screen booking flow (master spec section 4) collects
two required fields (address + slot) and one optional notes field with
six quick-tag chips above a free-text textarea. The textarea writes to
the existing `item_notes` column (renamed `notes` in the API). The tags
need a place to live — that's this column.

Schema choice — JSON, not a join table or comma-separated string:
  - We're talking about ~6 string values per row, never queried for
    aggregates at pilot scale. JSON is a tiny payload and the FE app
    reads it as-is into the briefing screen.
  - Validation lives in the API layer (`ALLOWED_TAGS`) — no need to
    enforce in DB.

Explicitly NOT added (per the booking-simplification addendum that the
master spec absorbed):
  - item_count_estimate
  - estimated_total_value_inr
  - multi_category
The 3-step wizard those fields supported has been replaced by free-text
notes + tags.

Revision ID: 0034_concierge_visit_fields
Revises: 0033b_backfill_addresses
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "0034_concierge_visit_fields"
down_revision = "0033b_backfill_addresses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fe_visits",
        sa.Column(
            "notes_tags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
            comment="Quick tags from booking: subset of "
                    "['phone', 'laptop', 'audio', 'appliance', 'kids', 'multiple']",
        ),
    )


def downgrade() -> None:
    op.drop_column("fe_visits", "notes_tags")
