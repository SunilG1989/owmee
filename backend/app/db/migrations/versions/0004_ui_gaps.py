"""ui_gaps — listing metadata for UI v3

Revision ID: 0004_ui_gaps
Revises: 0003_epic5_6
Create Date: 2025-01-04 00:00:00

Adds to listings:
  accessories       — text, what's included (box, charger, warranty card, etc.)
  warranty_info     — text, warranty status
  battery_health    — smallint 0-100, for phones/laptops
  age_suitability   — text, for kids items (e.g. "3-6 years")
  hygiene_status    — text, for kids items (cleaned/sanitised/not cleaned)
  is_kids_item      — boolean flag
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_ui_gaps"
down_revision = "0003_epic5_6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("listings", sa.Column("accessories", sa.String(300), nullable=True))
    op.add_column("listings", sa.Column("warranty_info", sa.String(200), nullable=True))
    op.add_column("listings", sa.Column("battery_health", sa.SmallInteger, nullable=True))
    op.add_column("listings", sa.Column("age_suitability", sa.String(50), nullable=True))
    op.add_column("listings", sa.Column("hygiene_status", sa.String(50), nullable=True))
    op.add_column("listings", sa.Column("is_kids_item", sa.Boolean, nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("listings", "is_kids_item")
    op.drop_column("listings", "hygiene_status")
    op.drop_column("listings", "age_suitability")
    op.drop_column("listings", "battery_health")
    op.drop_column("listings", "warranty_info")
    op.drop_column("listings", "accessories")
