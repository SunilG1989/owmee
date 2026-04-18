"""sprint3: user_blocks table

Revision ID: 0012_user_blocks
Revises: 0011_listing_product_details
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = '0012_user_blocks'
down_revision = '0011_listing_details'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_blocks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('blocker_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('blocked_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('blocker_id', 'blocked_id', name='uq_user_blocks_pair'),
    )


def downgrade() -> None:
    op.drop_table('user_blocks')
