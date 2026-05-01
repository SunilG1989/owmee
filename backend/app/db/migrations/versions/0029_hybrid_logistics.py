"""Sprint 6c — hybrid logistics columns + indexes.

Adds the columns that drive the post-purchase logistics flow:

  payment_captured
    → fe_pickup_scheduled        (admin/auto-routing assigns pickup FE)
    → at_hub                     (FE delivers item to hub after inspection)
    → delivery_in_progress       (admin assigns to FE delivery or courier)
    → delivered                  (FE handover OR admin marks courier delivered)
    → completed                  (buyer confirms receipt OR auto-complete)

The whole post-purchase flow stays inside transactions; we don't extend
the legacy shipments table (it carries baggage from the old shipped-flow
prototype). Anywhere we need to be lenient we leave the columns NULL —
hyperlocal V1 pilot is small, ops can drive transitions through the
admin web UI built in phase 3.

New columns
-----------
  pickup_fe_id        UUID NULL        which FE picked up + inspected
  delivery_mode       VARCHAR(16) NULL 'fe' | 'courier'
  delivery_fe_id      UUID NULL        same person as pickup, or different
  courier_name        VARCHAR(40) NULL 'porter' | 'delhivery' | 'self_delivered' | …
  courier_booking_id  VARCHAR(120) NULL Porter booking ID or AWB
  courier_tracking_url VARCHAR(500) NULL public tracking link the buyer can open
  pickup_inspection_photo_keys JSONB NULL list of R2 keys (FE's inspection photos)
  pickup_inspection_passed BOOLEAN NULL true=passed at hub, false=rejected at pickup
  pickup_inspection_notes  TEXT NULL
  delivery_handover_photo_key VARCHAR(500) NULL R2 key for the buyer-handover photo
  buyer_acknowledgment_code VARCHAR(8) NULL 6-digit OTP to confirm delivery
  delivered_at         TIMESTAMPTZ NULL
  at_hub_at            TIMESTAMPTZ NULL    when FE marked item received at hub
  routed_at            TIMESTAMPTZ NULL    when admin chose FE/courier routing

Indexes
-------
  idx_txn_at_hub_unrouted (status, routed_at) — drives admin Hub Dispatch queue
  idx_txn_delivery_fe (delivery_fe_id) — drives FE "My Deliveries" listing
  idx_txn_pickup_fe   (pickup_fe_id)

Revision ID: 0029_hybrid_logistics
Revises: 0028_imei_dedup
Create Date: 2026-05-01
"""
from alembic import op
import sqlalchemy as sa


revision = "0029_hybrid_logistics"
down_revision = "0028_imei_dedup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("pickup_fe_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("transactions", sa.Column("delivery_mode", sa.String(16), nullable=True))
    op.add_column("transactions", sa.Column("delivery_fe_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("transactions", sa.Column("courier_name", sa.String(40), nullable=True))
    op.add_column("transactions", sa.Column("courier_booking_id", sa.String(120), nullable=True))
    op.add_column("transactions", sa.Column("courier_tracking_url", sa.String(500), nullable=True))
    op.add_column("transactions", sa.Column("pickup_inspection_photo_keys", sa.dialects.postgresql.JSONB, nullable=True))
    op.add_column("transactions", sa.Column("pickup_inspection_passed", sa.Boolean, nullable=True))
    op.add_column("transactions", sa.Column("pickup_inspection_notes", sa.Text, nullable=True))
    op.add_column("transactions", sa.Column("delivery_handover_photo_key", sa.String(500), nullable=True))
    op.add_column("transactions", sa.Column("buyer_acknowledgment_code", sa.String(8), nullable=True))
    op.add_column("transactions", sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("at_hub_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("routed_at", sa.DateTime(timezone=True), nullable=True))

    op.create_index(
        "idx_txn_at_hub_unrouted",
        "transactions",
        ["status", "routed_at"],
        postgresql_where=sa.text("status = 'at_hub'"),
    )
    op.create_index("idx_txn_delivery_fe", "transactions", ["delivery_fe_id"])
    op.create_index("idx_txn_pickup_fe", "transactions", ["pickup_fe_id"])

    op.create_foreign_key(
        "fk_txn_pickup_fe", "transactions", "users",
        ["pickup_fe_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_txn_delivery_fe", "transactions", "users",
        ["delivery_fe_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_txn_delivery_fe", "transactions", type_="foreignkey")
    op.drop_constraint("fk_txn_pickup_fe", "transactions", type_="foreignkey")
    op.drop_index("idx_txn_pickup_fe", table_name="transactions")
    op.drop_index("idx_txn_delivery_fe", table_name="transactions")
    op.drop_index("idx_txn_at_hub_unrouted", table_name="transactions")
    for col in (
        "routed_at", "at_hub_at", "delivered_at",
        "buyer_acknowledgment_code", "delivery_handover_photo_key",
        "pickup_inspection_notes", "pickup_inspection_passed",
        "pickup_inspection_photo_keys", "courier_tracking_url",
        "courier_booking_id", "courier_name",
        "delivery_fe_id", "delivery_mode", "pickup_fe_id",
    ):
        op.drop_column("transactions", col)
