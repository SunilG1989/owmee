"""P0 + P1 trust-floor + listing-quality columns.

Why
---
Mobile shipped P0 (trust floor) + P1 (listing quality) changes that
require new BE columns. One migration so the deploy lands atomically.

P0 — Trust floor:
- user_addresses.full_name + phone_number      (per-address contact)
- transactions.condition_confirmed_at          (handover-inspection beacon)
- transactions.return_photo_keys (JSON list)   (return-evidence photos)
- disputes.photo_keys (JSON list)              (dispute-evidence photos)

P1 — Listing quality (Cashify floor):
- listings.has_box, has_bill, has_charger, has_earphones (Y/N includes)
- listings.min_acceptable_price                (hidden reserve)
- listings.water_damage_history                (Y/N disclosure)
- listings.seller_functional_attestation       (sign-off)

All columns NULLABLE so existing rows are valid; mobile router
enforces required-at-write where the FE schema demands.

Revision ID: 0038_p0_p1_trust_floor
Revises: 0037_concierge_safety
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "0038_p0_p1_trust_floor"
down_revision = "0037_concierge_safety"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── user_addresses: per-address recipient contact ─────────────────
    op.add_column(
        "user_addresses",
        sa.Column("full_name", sa.String(200), nullable=True),
    )
    op.add_column(
        "user_addresses",
        sa.Column("phone_number", sa.String(20), nullable=True),
    )

    # ── transactions: condition-confirmed beacon + return photos ──────
    op.add_column(
        "transactions",
        sa.Column(
            "condition_confirmed_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Set when buyer taps the in-app inspection-confirm "
                    "checkbox before reading the handover ack code. P0.5.",
        ),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "return_photo_keys",
            sa.JSON(),
            nullable=True,
            comment="R2 keys for buyer-uploaded return-evidence photos. P0.4.",
        ),
    )

    # ── disputes: evidence photos ─────────────────────────────────────
    op.add_column(
        "disputes",
        sa.Column(
            "photo_keys",
            sa.JSON(),
            nullable=True,
            comment="R2 keys for buyer-uploaded dispute-evidence photos. P0.4.",
        ),
    )

    # ── listings: P1 quality fields ──────────────────────────────────
    op.add_column("listings", sa.Column("has_box", sa.Boolean(), nullable=True))
    op.add_column("listings", sa.Column("has_bill", sa.Boolean(), nullable=True))
    op.add_column("listings", sa.Column("has_charger", sa.Boolean(), nullable=True))
    op.add_column("listings", sa.Column("has_earphones", sa.Boolean(), nullable=True))
    op.add_column(
        "listings",
        sa.Column(
            "min_acceptable_price",
            sa.Numeric(10, 2),
            nullable=True,
            comment="Hidden reserve floor for negotiable listings; auto-decline "
                    "below. Buyer never sees the value.",
        ),
    )
    op.add_column(
        "listings",
        sa.Column("water_damage_history", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "listings",
        sa.Column(
            "seller_functional_attestation",
            sa.Boolean(),
            nullable=True,
            comment="Seller affirmation that anything not flagged in defects "
                    "works as expected. Required to publish electronics.",
        ),
    )


def downgrade() -> None:
    op.drop_column("listings", "seller_functional_attestation")
    op.drop_column("listings", "water_damage_history")
    op.drop_column("listings", "min_acceptable_price")
    op.drop_column("listings", "has_earphones")
    op.drop_column("listings", "has_charger")
    op.drop_column("listings", "has_bill")
    op.drop_column("listings", "has_box")

    op.drop_column("disputes", "photo_keys")

    op.drop_column("transactions", "return_photo_keys")
    op.drop_column("transactions", "condition_confirmed_at")

    op.drop_column("user_addresses", "phone_number")
    op.drop_column("user_addresses", "full_name")
