"""Sprint 4 / Pass 4a: admin_refresh_tokens table for silent token refresh.

Adds a table to store hashed refresh tokens per admin user, with revocation
support. Access tokens remain stateless (JWT), refresh tokens are stored
server-side so they can be revoked and rotated safely.

Revision ID: 0019_admin_refresh
Revises: 0018_fe_cat_kids_checklist
Create Date: 2026-04-18
"""
from alembic import op
import sqlalchemy as sa


revision = "0019_admin_refresh"
down_revision = "0018_fe_cat_kids_checklist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_refresh_tokens",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "admin_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rotated_to_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["admin_id"], ["admin_users.id"], ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_admin_refresh_tokens_admin_id",
        "admin_refresh_tokens",
        ["admin_id"],
    )
    op.create_index(
        "ix_admin_refresh_tokens_token_hash",
        "admin_refresh_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_admin_refresh_tokens_token_hash", table_name="admin_refresh_tokens")
    op.drop_index("ix_admin_refresh_tokens_admin_id", table_name="admin_refresh_tokens")
    op.drop_table("admin_refresh_tokens")
