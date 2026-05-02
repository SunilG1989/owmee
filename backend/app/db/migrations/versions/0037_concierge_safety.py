"""Concierge Phase 5: chain-of-custody + issues + NPS + transit-damage protection.

Why
---
Master spec section 8 (the trust safety net). Five additions, all in one
migration so a Phase 5 deploy lands the safety surface atomically:

1. fe_visits.handover_photo_r2_key — group photo of all items the
   specialist takes at visit close. Optional (handover_skipped column
   tracks the "agreed verbally" path).
2. fe_visits.handover_skipped — boolean, true when the seller opted out
   of the photo.
3. fe_visits.seller_handover_confirmed_at — timestamp when the seller
   tapped "items received by Owmee."
4. fe_visit_issues table — reports raised by the specialist or seller
   ("item damaged", "safety concern", etc.). admin_resolution columns
   for ops follow-through.
5. transactions.trust_fund_payout_amount_inr — when admin resolves a
   dispute as "transit damage, not seller's fault," seller still gets
   paid; this column tracks the trust-fund liability finance ops
   manually settles each month.
   transactions.seller_protection_reason — text label for why the
   trust fund kicked in.
   transactions.seller_protection_resolved_at — timestamp.

All NULLABLE so existing rows are valid by default.

Revision ID: 0037_concierge_safety
Revises: 0036_listing_visit_link
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "0037_concierge_safety"
down_revision = "0036_listing_visit_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── fe_visits handover columns ─────────────────────────────────────
    op.add_column(
        "fe_visits",
        sa.Column("handover_photo_r2_key", sa.String(500), nullable=True),
    )
    op.add_column(
        "fe_visits",
        sa.Column(
            "handover_skipped",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "fe_visits",
        sa.Column(
            "seller_handover_confirmed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # ── fe_visit_issues ────────────────────────────────────────────────
    op.create_table(
        "fe_visit_issues",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "visit_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("fe_visits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        # Set of reasons the specialist or seller can pick. Validation is
        # at API layer; not enforced via CHECK constraint.
        sa.Column("category", sa.String(50), nullable=False),
        # low | medium | high | urgent. Auto-set by category at insert time.
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "photo_urls",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column("admin_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("admin_resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("admin_resolution_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_fe_visit_issues_visit_id",
        "fe_visit_issues",
        ["visit_id"],
    )
    op.create_index(
        "ix_fe_visit_issues_severity_unresolved",
        "fe_visit_issues",
        ["severity"],
        postgresql_where=sa.text("admin_resolved_at IS NULL"),
    )

    # ── fe_visit_nps ───────────────────────────────────────────────────
    op.create_table(
        "fe_visit_nps",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "visit_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("fe_visits.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "seller_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "specialist_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("nps_score", sa.SmallInteger(), nullable=False),
        sa.Column("free_text", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_fe_visit_nps_specialist_user_id",
        "fe_visit_nps",
        ["specialist_user_id"],
    )

    # ── transactions trust-fund columns ────────────────────────────────
    op.add_column(
        "transactions",
        sa.Column(
            "trust_fund_payout_amount_inr",
            sa.Numeric(10, 2),
            nullable=True,
            comment="Master spec 8.3: amount Owmee absorbs to protect "
                    "seller from transit damage. Manually settled monthly.",
        ),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "seller_protection_reason",
            sa.String(80),
            nullable=True,
        ),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "seller_protection_resolved_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("transactions", "seller_protection_resolved_at")
    op.drop_column("transactions", "seller_protection_reason")
    op.drop_column("transactions", "trust_fund_payout_amount_inr")

    op.drop_index("ix_fe_visit_nps_specialist_user_id", table_name="fe_visit_nps")
    op.drop_table("fe_visit_nps")

    op.drop_index("ix_fe_visit_issues_severity_unresolved", table_name="fe_visit_issues")
    op.drop_index("ix_fe_visit_issues_visit_id", table_name="fe_visit_issues")
    op.drop_table("fe_visit_issues")

    op.drop_column("fe_visits", "seller_handover_confirmed_at")
    op.drop_column("fe_visits", "handover_skipped")
    op.drop_column("fe_visits", "handover_photo_r2_key")
