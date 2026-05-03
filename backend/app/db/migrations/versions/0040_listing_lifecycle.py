"""Seller-side listing lifecycle: deletion + visit-cancel reasons.

Why
---
Sellers need to be able to delete their own listings and cancel their
own concierge visits with proper auditability. C2C marketplace research
(Mercari, eBay, OLX, Quikr) all capture a structured reason at the
moment of deletion / cancel — these feed product analytics ("listings
deleted because of low offers", "visits cancelled because of FE-late")
that are first-class signals for the operations team.

Adds (all nullable, additive only — safe for live rollout):

  listings.deletion_reason  VARCHAR(50)
      Structured key set at soft-delete time. One of:
      'sold_elsewhere' | 'changed_mind' | 'wrong_price' |
      'no_buyers' | 'item_damaged' | 'other'

  listings.deleted_at       TIMESTAMP WITH TIME ZONE
      Wall-clock soft-delete moment. Distinct from `updated_at` so
      ops can detect "this listing was published 30d ago, deleted 2d
      ago, but was status=removed at moderation 28d ago" without
      losing the original publish trail.

  fe_visits.cancellation_reason  VARCHAR(50)
      Mirrors the listings.deletion_reason pattern. Existing
      `outcome_reason` is free-text; this adds a structured analytics
      key. One of:
      'changed_mind' | 'sold_elsewhere' | 'fe_late' | 'schedule_conflict' |
      'no_longer_selling' | 'other'

Revision ID: 0040_listing_lifecycle
Revises: 0039_order_notes
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "0040_listing_lifecycle"
down_revision = "0039_order_notes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column(
            "deletion_reason",
            sa.String(50),
            nullable=True,
            comment="Structured reason captured at soft-delete time. "
                    "Feeds product analytics — never used for moderation.",
        ),
    )
    op.add_column(
        "listings",
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Wall-clock soft-delete timestamp. Set when seller "
                    "removes the listing or admin moderation rejects it.",
        ),
    )
    op.add_column(
        "fe_visits",
        sa.Column(
            "cancellation_reason",
            sa.String(50),
            nullable=True,
            comment="Structured cancel reason. Mirrors listings.deletion_reason.",
        ),
    )


def downgrade() -> None:
    op.drop_column("fe_visits", "cancellation_reason")
    op.drop_column("listings", "deleted_at")
    op.drop_column("listings", "deletion_reason")
