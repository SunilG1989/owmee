"""add user profile and address fields

Revision ID: 0010_user_profile_address
Revises: 0009_original_price
Create Date: 2026-04-15

Adds name, email, and full delivery address to users table.
All nullable to not break existing users.
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_user_profile_address"
down_revision = "0009_original_price"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("name", sa.String(200), nullable=True))
    op.add_column("users", sa.Column("email", sa.String(320), nullable=True))
    op.add_column("users", sa.Column("address_house", sa.String(500), nullable=True))
    op.add_column("users", sa.Column("address_street", sa.String(500), nullable=True))
    op.add_column("users", sa.Column("address_locality", sa.String(200), nullable=True))
    op.add_column("users", sa.Column("address_city", sa.String(100), nullable=True))
    op.add_column("users", sa.Column("address_pincode", sa.String(10), nullable=True))
    op.add_column("users", sa.Column("address_state", sa.String(100), nullable=True))

    # Index on city + pincode for geo queries
    op.create_index("ix_users_city", "users", ["address_city"])
    op.create_index("ix_users_pincode", "users", ["address_pincode"])


def downgrade() -> None:
    op.drop_index("ix_users_pincode")
    op.drop_index("ix_users_city")
    op.drop_column("users", "address_state")
    op.drop_column("users", "address_pincode")
    op.drop_column("users", "address_city")
    op.drop_column("users", "address_locality")
    op.drop_column("users", "address_street")
    op.drop_column("users", "address_house")
    op.drop_column("users", "email")
    op.drop_column("users", "name")
