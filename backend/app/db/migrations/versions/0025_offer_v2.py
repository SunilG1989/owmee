"""Sprint 6b — Offer v2 (chat removal + structured negotiation)

Adds three columns to the offers table that drive the v2 mechanic:
  - update_count:        how many times the buyer has revised the price
                         (capped at 3 per Sprint 6 brief §2.4)
  - lockout_until:       7-day cooldown set on rejected/expired offers;
                         prevents the same buyer making a new offer on
                         the same listing until the timestamp passes.
  - counter_expires_at:  48-hour expiry set when seller counters; if the
                         buyer doesn't accept/reject by then, the offer
                         dies and lockout_until is set.

No table drops. The chat_channels / chat_channel_id artefacts referenced
by the original Sprint 6 brief never made it into a migration in this
repo (chat lived only in app code). Removing app/modules/chat/ is a
code-level change handled in the same commit; nothing to do at the SQL
level here.

Revision ID: 0025_offer_v2
Revises: 0024_kyc_to_badge
Create Date: 2026-04-27

Downgrade: drops the three columns. Non-destructive.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0025_offer_v2'
down_revision = '0024_kyc_to_badge'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. update_count — how many price revisions buyer has done. Capped at 3.
    op.add_column(
        'offers',
        sa.Column(
            'update_count',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ),
    )

    # 2. lockout_until — 7-day cooldown set on rejected/expired offers.
    #    NULL means no active lockout.
    op.add_column(
        'offers',
        sa.Column('lockout_until', sa.DateTime(timezone=True), nullable=True),
    )

    # 3. counter_expires_at — 48-hour clock when seller counters.
    #    NULL until seller counters.
    op.add_column(
        'offers',
        sa.Column('counter_expires_at', sa.DateTime(timezone=True), nullable=True),
    )

    # Index supports the lockout lookup at make-offer time:
    # SELECT max(lockout_until) FROM offers WHERE buyer_id = ? AND listing_id = ?
    op.create_index(
        'idx_offers_lockout_lookup',
        'offers',
        ['buyer_id', 'listing_id', 'lockout_until'],
    )


def downgrade() -> None:
    op.drop_index('idx_offers_lockout_lookup', table_name='offers')
    op.drop_column('offers', 'counter_expires_at')
    op.drop_column('offers', 'lockout_until')
    op.drop_column('offers', 'update_count')
