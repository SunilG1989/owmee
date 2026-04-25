"""Sprint 7 / Phase 1: Community launch infrastructure

Revision ID: 0018_community_launch
Revises: 0017_listing_source_reviewed_by
Create Date: 2026-04-22

Company B (hyperlocal community resale) launch foundation.

Adds:
  - communities              : apartment complexes, schools, neighborhoods
  - community_verifications  : manual-proof upload review queue
  - safe_meetup_points       : per-community safe pickup spots (e.g., society gate)

Adds on users:
  - community_id             : FK to communities, null until verified
  - community_verified_at    : timestamp
  - community_verified_by    : referral | manual | founder
  - referral_code            : 6-char unique code, generated lazily
  - referred_by_user_id      : FK to users, null if direct

Adds on listings:
  - community_id             : denormalized from seller at publish time,
                               drives community-scoped browse filter

All new columns are nullable / have safe defaults, so existing rows
continue to work. Community filter is enforced at query-layer only when
the requesting user HAS a community; global browse is preserved for
admins and for pre-launch data.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0018_community_launch"
down_revision = "0024_kyc_to_badge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── communities ────────────────────────────────────────────────────────
    op.create_table(
        "communities",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("name", sa.String(length=200), nullable=False, unique=True),
        sa.Column("slug", sa.String(length=100), nullable=False, unique=True),
        sa.Column(
            "type",
            sa.String(length=32),
            nullable=False,
            server_default="apartment",
        ),
        # apartment | school | neighborhood | office
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("state", sa.String(length=100), nullable=True),
        sa.Column("pincode", sa.String(length=10), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "member_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_communities_city", "communities", ["city"])
    op.create_index("ix_communities_active", "communities", ["is_active"])

    # ── users: new columns ─────────────────────────────────────────────────
    op.add_column(
        "users",
        sa.Column(
            "community_id",
            UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_users_community_id", "users", ["community_id"])

    op.add_column(
        "users",
        sa.Column(
            "community_verified_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "community_verified_by",
            sa.String(length=16),
            nullable=True,
        ),
        # referral | manual | founder | null
    )
    op.add_column(
        "users",
        sa.Column(
            "referral_code",
            sa.String(length=8),
            nullable=True,
            unique=True,
        ),
    )
    op.create_index("ix_users_referral_code", "users", ["referral_code"])

    op.add_column(
        "users",
        sa.Column(
            "referred_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # ── community_verifications ─────────────────────────────────────────────
    op.create_table(
        "community_verifications",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "community_id",
            UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "requested_community_name",
            sa.String(length=200),
            nullable=True,
        ),
        sa.Column("proof_r2_key", sa.String(length=500), nullable=True),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        # pending | approved | rejected
        sa.Column("reviewed_by_admin_id", UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_community_verifications_status",
        "community_verifications",
        ["status", "created_at"],
    )

    # ── safe_meetup_points ──────────────────────────────────────────────────
    op.create_table(
        "safe_meetup_points",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "community_id",
            UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )

    # ── listings: community_id denormalized from seller ────────────────────
    op.add_column(
        "listings",
        sa.Column(
            "community_id",
            UUID(as_uuid=True),
            sa.ForeignKey("communities.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_listings_community_id", "listings", ["community_id"])


def downgrade() -> None:
    op.drop_index("ix_listings_community_id", table_name="listings")
    op.drop_column("listings", "community_id")

    op.drop_table("safe_meetup_points")

    op.drop_index(
        "ix_community_verifications_status", table_name="community_verifications"
    )
    op.drop_table("community_verifications")

    op.drop_column("users", "referred_by_user_id")
    op.drop_index("ix_users_referral_code", table_name="users")
    op.drop_column("users", "referral_code")
    op.drop_column("users", "community_verified_by")
    op.drop_column("users", "community_verified_at")
    op.drop_index("ix_users_community_id", table_name="users")
    op.drop_column("users", "community_id")

    op.drop_index("ix_communities_active", table_name="communities")
    op.drop_index("ix_communities_city", table_name="communities")
    op.drop_table("communities")
