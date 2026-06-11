"""Add read-path performance indexes (and fix phantom index declarations).

From the performance audit: the hot read paths (feed/browse, seller offers,
notifications, completed-deal aggregates) were seq-scanning because the
supporting indexes didn't exist. Several were even declared `index=True` on the
models but never created by the hand-written 0001 migration ("phantom indexes")
— this migration creates the real indexes and the models were reconciled so the
new index-parity test (tests/test_index_parity.py) stays green.

Indexes are built CONCURRENTLY (no write-lock) inside an autocommit block, and
IF NOT EXISTS so the migration is idempotent / re-runnable.

Revision ID: 0047_perf_read_path_indexes
Revises: 0046_offer_rating_uniqueness
Create Date: 2026-06-11
"""
from alembic import op


revision = "0047_perf_read_path_indexes"
down_revision = "0046_offer_rating_uniqueness"
branch_labels = None
depends_on = None


# (name, DDL) — DDL uses IF NOT EXISTS so reruns are safe.
_INDEXES = [
    # ── Phantom fixes: declared index=True on the model, never created ───────
    ("ix_transactions_listing_id",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_transactions_listing_id ON transactions (listing_id)"),
    ("ix_reservations_seller_id",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_reservations_seller_id ON reservations (seller_id)"),
    ("ix_super_admin_actions_audit_log_id",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_super_admin_actions_audit_log_id ON super_admin_actions (audit_log_id)"),

    # ── Offers: seller dashboard + expiry sweep ──────────────────────────────
    ("ix_offers_seller_status_created",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_offers_seller_status_created ON offers (seller_id, status, created_at)"),
    ("ix_offers_pending_expiry",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_offers_pending_expiry ON offers (expires_at) WHERE status = 'pending'"),
    ("ix_offers_countered_expiry",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_offers_countered_expiry ON offers (counter_expires_at) WHERE status = 'countered'"),

    # ── Listings: feed/browse by address state + recency/published ───────────
    ("ix_listings_active_state_created",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_listings_active_state_created ON listings (state, created_at) WHERE status = 'active'"),
    ("ix_listings_active_published",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_listings_active_published ON listings (published_at) WHERE status = 'active'"),

    # ── Transactions: completed-deal aggregates + price-suggestion window ─────
    ("ix_txn_completed_seller",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_txn_completed_seller ON transactions (seller_id) WHERE status IN ('completed', 'auto_completed')"),
    ("ix_transactions_completed_at",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_transactions_completed_at ON transactions (completed_at) WHERE status = 'completed'"),

    # ── Notifications: list + unread badge ───────────────────────────────────
    ("ix_notif_user_created",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_notif_user_created ON notification_events (user_id, created_at)"),
    ("ix_notif_user_unread",
     "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_notif_user_unread ON notification_events (user_id) WHERE is_read = false"),
]


def upgrade() -> None:
    # CONCURRENTLY cannot run inside a transaction; autocommit_block exits the
    # migration's transaction for these statements.
    with op.get_context().autocommit_block():
        for _name, ddl in _INDEXES:
            op.execute(ddl)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _ddl in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
