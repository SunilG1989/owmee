"""Concierge Phase 4: link listings back to the FE visit that created them.

Why
---
The "My Concierge" timeline (master spec section 7) groups items under
the visit that produced them. Today there's no such pointer — listings
were created by submit-listing without retaining a foreign key to
fe_visits. Phase 4 adds it.

`fe_visits.listing_id` already exists as a "last-listing-pointer" on
the visit row, but that's a 1:1 — for multi-item visits we need the
inverse: every listing knows its parent visit. ON DELETE SET NULL so a
deleted visit doesn't cascade into the listing inventory (audit trail
matters; we'd rather have an orphaned listing than a missing row).

Backfill
--------
Best-effort match: for each listing with `listing_source = 'fe_assisted'`
and `fe_visit_id` set on the listing row already (some path was setting
this column directly), copy that into the new column. For listings
without that pointer, leave NULL — Phase 4's MyConciergeScreen handles
NULL gracefully (those items just don't appear under any visit card).

Revision ID: 0036_listing_visit_link
Revises: 0035_concierge_trust
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "0036_listing_visit_link"
down_revision = "0035_concierge_trust"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listings",
        sa.Column(
            "created_via_fe_visit_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("fe_visits.id", ondelete="SET NULL"),
            nullable=True,
            comment="FE visit that produced this listing (Concierge Phase 4)",
        ),
    )
    op.create_index(
        "ix_listings_created_via_fe_visit_id",
        "listings",
        ["created_via_fe_visit_id"],
    )

    # Best-effort backfill: copy from the existing fe_visit_id column on
    # listings (set by the FE submit path before Phase 3) into the new
    # column. NULL where unknown — those listings just won't group
    # under a visit on the timeline.
    op.execute(
        """
        UPDATE listings
        SET created_via_fe_visit_id = fe_visit_id
        WHERE fe_visit_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_listings_created_via_fe_visit_id", table_name="listings")
    op.drop_column("listings", "created_via_fe_visit_id")
