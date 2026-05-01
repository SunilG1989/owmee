"""Add ON DELETE CASCADE to FKs in the offer/transaction graph.

Before this migration, deleting a Listing would leave orphaned
ListingSnapshot rows pointing at it; deleting an Offer would leave
orphaned Reservation rows; deleting a ListingSnapshot would leave
orphaned Transaction rows. The application layer never deletes any
of these in normal operation, but admin tools and test fixtures do —
and the resulting orphans break ON DELETE checks and cause silent
referential drift.

Verified at apply time (2026-05-01) that no orphans exist on the dev
DB, so dropping and recreating the constraints is safe.

Revision ID: 0026_fk_cascades
Revises: 0025_offer_v2
Create Date: 2026-05-01
"""
from alembic import op


revision = "0026_fk_cascades"
down_revision = "0025_offer_v2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # reservations.offer_id → offers.id
    op.drop_constraint("reservations_offer_id_fkey", "reservations", type_="foreignkey")
    op.create_foreign_key(
        "reservations_offer_id_fkey",
        "reservations", "offers",
        ["offer_id"], ["id"],
        ondelete="CASCADE",
    )

    # transactions.listing_snapshot_id → listing_snapshots.id
    op.drop_constraint("transactions_listing_snapshot_id_fkey", "transactions", type_="foreignkey")
    op.create_foreign_key(
        "transactions_listing_snapshot_id_fkey",
        "transactions", "listing_snapshots",
        ["listing_snapshot_id"], ["id"],
        ondelete="CASCADE",
    )

    # listing_snapshots.listing_id → listings.id
    op.drop_constraint("listing_snapshots_listing_id_fkey", "listing_snapshots", type_="foreignkey")
    op.create_foreign_key(
        "listing_snapshots_listing_id_fkey",
        "listing_snapshots", "listings",
        ["listing_id"], ["id"],
        ondelete="CASCADE",
    )

    # transactions.reservation_id → reservations.id
    op.drop_constraint("transactions_reservation_id_fkey", "transactions", type_="foreignkey")
    op.create_foreign_key(
        "transactions_reservation_id_fkey",
        "transactions", "reservations",
        ["reservation_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    for tbl, name, src, dest_tbl, dest_col in [
        ("reservations", "reservations_offer_id_fkey", "offer_id", "offers", "id"),
        ("transactions", "transactions_listing_snapshot_id_fkey", "listing_snapshot_id", "listing_snapshots", "id"),
        ("listing_snapshots", "listing_snapshots_listing_id_fkey", "listing_id", "listings", "id"),
        ("transactions", "transactions_reservation_id_fkey", "reservation_id", "reservations", "id"),
    ]:
        op.drop_constraint(name, tbl, type_="foreignkey")
        op.create_foreign_key(name, tbl, dest_tbl, [src], [dest_col])
