"""Add uniqueness backstops for active offers and ratings.

Race fixes from the principal-architect review (H4): the app enforced
"one active offer per (buyer, listing)" and "one rating per (txn, rater)"
with check-then-insert SELECTs that two concurrent requests could both pass.
These DB-level unique indexes make the invariant authoritative.

Revision ID: 0046_offer_rating_uniqueness
Revises: 0045_ai_draft_contracts
Create Date: 2026-06-11
"""
from alembic import op


revision = "0046_offer_rating_uniqueness"
down_revision = "0045_ai_draft_contracts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Pre-clean any pre-existing duplicates so the unique indexes build ──────
    # Retire all-but-the-newest active offer per (buyer, listing).
    op.execute(
        """
        UPDATE offers o
        SET status = 'expired'
        WHERE o.status IN ('pending', 'countered')
          AND EXISTS (
              SELECT 1 FROM offers o2
              WHERE o2.buyer_id = o.buyer_id
                AND o2.listing_id = o.listing_id
                AND o2.status IN ('pending', 'countered')
                AND (o2.created_at, o2.id) > (o.created_at, o.id)
          )
        """
    )
    # Delete all-but-the-earliest rating per (transaction, rater).
    op.execute(
        """
        DELETE FROM ratings r
        USING ratings r2
        WHERE r.transaction_id = r2.transaction_id
          AND r.rater_id = r2.rater_id
          AND (r.created_at, r.id) > (r2.created_at, r2.id)
        """
    )

    # ── Authoritative uniqueness ─────────────────────────────────────────────
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_active_offer_per_buyer_listing
        ON offers (buyer_id, listing_id)
        WHERE status IN ('pending', 'countered')
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_per_txn_rater
        ON ratings (transaction_id, rater_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_rating_per_txn_rater")
    op.execute("DROP INDEX IF EXISTS uq_active_offer_per_buyer_listing")
