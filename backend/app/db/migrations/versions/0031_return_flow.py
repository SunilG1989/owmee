"""Sprint trust pillar — buyer return flow.

V1 scope decisions
------------------
- One return per transaction. If a buyer wants to return again after a
  rejected return, ops opens a new transaction by hand. (No multi-return
  cycles to keep schema flat.)
- Return window = 7 days post-delivery. Enforced in the service, not as
  a DB constraint, so we can extend per-category later without migrating.
- Approved-return → FE picks up from buyer → returns to hub → refund
  fires automatically once received. Seller doesn't pay a fee for
  fulfilling a justified return; FE pickup cost is on Owmee.

Fields on transactions
----------------------
  return_status         'none' | 'requested' | 'approved' | 'rejected'
                        | 'pickup_scheduled' | 'picked_up' | 'completed'
  return_reason         category — one of item_not_as_described |
                        damaged_in_transit | wrong_item | other
  return_description    buyer's free text (max 1000)
  return_requested_at   when the buyer hit submit
  return_decision_at    when admin approved or rejected
  return_decision_by    admin id (logged for audit)
  return_decision_note  admin note (visible to buyer + seller)
  return_pickup_fe_id   FE assigned to pick up returned item
  return_picked_up_at
  return_completed_at   when refund fired + return loop closed

Indexes
-------
  idx_txn_return_pending — drives /admin/returns queue
  idx_txn_return_pickup_fe — drives FE my return-pickups list

Revision: 0031_return_flow
Down-rev: 0030_refund_fields
"""
from alembic import op
import sqlalchemy as sa


revision = "0031_return_flow"
down_revision = "0030_refund_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column(
        "return_status", sa.String(20), nullable=False,
        server_default=sa.text("'none'"),
    ))
    op.add_column("transactions", sa.Column("return_reason", sa.String(50), nullable=True))
    op.add_column("transactions", sa.Column("return_description", sa.String(1000), nullable=True))
    op.add_column("transactions", sa.Column("return_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("return_decision_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("return_decision_by", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("transactions", sa.Column("return_decision_note", sa.String(500), nullable=True))
    op.add_column("transactions", sa.Column("return_pickup_fe_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("transactions", sa.Column("return_picked_up_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("transactions", sa.Column("return_completed_at", sa.DateTime(timezone=True), nullable=True))

    op.create_index(
        "idx_txn_return_pending",
        "transactions",
        ["return_status", "return_requested_at"],
        postgresql_where=sa.text("return_status IN ('requested', 'approved', 'pickup_scheduled')"),
    )
    op.create_index(
        "idx_txn_return_pickup_fe",
        "transactions",
        ["return_pickup_fe_id"],
        postgresql_where=sa.text("return_status = 'pickup_scheduled'"),
    )

    op.create_foreign_key(
        "fk_txn_return_pickup_fe", "transactions", "users",
        ["return_pickup_fe_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_txn_return_pickup_fe", "transactions", type_="foreignkey")
    op.drop_index("idx_txn_return_pickup_fe", table_name="transactions")
    op.drop_index("idx_txn_return_pending", table_name="transactions")
    for col in (
        "return_completed_at", "return_picked_up_at", "return_pickup_fe_id",
        "return_decision_note", "return_decision_by", "return_decision_at",
        "return_requested_at", "return_description", "return_reason",
        "return_status",
    ):
        op.drop_column("transactions", col)
