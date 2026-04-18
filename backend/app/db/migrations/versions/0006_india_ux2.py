"""india_ux2 — remaining India UX gaps

Revision ID: 0006_india_ux2
Revises: 0005_india_ux
Create Date: 2025-01-06

Adds:
  listings.is_negotiable     — price negotiable vs fixed (Indian bargaining culture)
  users.num_kids             — parent profile for kids category trust
  users.kids_age_range       — e.g. "3-8" for parent-to-parent trust
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_india_ux2"
down_revision = "0005_india_ux"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("listings",
        sa.Column("is_negotiable", sa.Boolean, nullable=False, server_default="true"))
    op.add_column("users",
        sa.Column("num_kids", sa.SmallInteger, nullable=True))
    op.add_column("users",
        sa.Column("kids_age_range", sa.String(20), nullable=True))  # e.g. "3-8"


def downgrade() -> None:
    op.drop_column("listings", "is_negotiable")
    op.drop_column("users", "kids_age_range")
    op.drop_column("users", "num_kids")
