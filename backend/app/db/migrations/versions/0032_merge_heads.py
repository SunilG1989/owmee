"""Merge migration — collapses the two-head fork that's been hanging
around since Concern D was filed in KNOWN_ISSUES.md.

Why
---
The migration tree forked at 0018:
  Chain A: 0018_community_launch
           → 0019_listing_sort_score
           → 0020_user_location
           → 0021_ai_phase2          (head A)

  Chain B: 0018_fe_cat_kids_checklist
           → 0019_admin_refresh
           → 0020_stuck_workflows
           → 0021_fe_earnings
           → 0022_transaction_snapshot
           → 0023_analytics_events
           → 0024_kyc_to_badge
           → 0025_offer_v2
           → 0026_fk_cascades
           → 0027_pricing_model
           → 0028_imei_dedup
           → 0029_hybrid_logistics
           → 0030_refund_fields
           → 0031_return_flow         (head B)

`alembic upgrade head` failed with "Multiple head revisions are
present" because alembic doesn't know which to pick. Fresh deploys
bootstrapping from migrations couldn't get past 0018.

The dev DB has chain B applied directly via psql ALTER statements
(matches the SQL in each chain-B migration); chain A's tip
(0021_ai_phase2) is what alembic_version is stamped at.

What this migration does
------------------------
Pure no-op at the SQL level — both upgrade() and downgrade() do
nothing. The point is the headers below: by listing TWO down_revisions
in a tuple, alembic recognises this as a merge and considers the tree
to have a single head from now on.

Post-deploy: `alembic stamp 0032_merge_heads` once on each environment.
After that `alembic upgrade head` works as expected for any new
migration that lists `0032_merge_heads` as its down_revision.

Revision ID: 0032_merge_heads
Revises: 0021_ai_phase2 + 0031_return_flow
Create Date: 2026-05-01
"""
from alembic import op  # noqa: F401  (imported for symmetry; no ops here)


# revision identifiers, used by Alembic.
revision = "0032_merge_heads"
down_revision = ("0021_ai_phase2", "0031_return_flow")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Intentionally empty — see module docstring.
    pass


def downgrade() -> None:
    # Intentionally empty — re-splitting the heads is what alembic does
    # automatically when this migration is reverted.
    pass
