"""Sprint 4: tri-state user model (auth_state, buyer_eligible, seller_tier)

Revision ID: 0013_tri_state_user
Revises: 0012_user_blocks
Create Date: 2026-04-16

Adds three orthogonal state fields to replace the single `kyc_status`/`tier`
pair used in Sprint 3:

    auth_state        VARCHAR(32)  — guest | otp_verified | suspended
    buyer_eligible    BOOLEAN      — true once buyer KYC is complete
    seller_tier       VARCHAR(32)  — not_eligible | lite | full | restricted

Existing `kyc_status` and `tier` columns are preserved for backward
compatibility; code that still reads them continues to work.

Data migration maps Sprint 3 state to the new tri-state:
  - phone_verified=True              -> auth_state='otp_verified'
  - is_restricted=True               -> auth_state='suspended'
                                        seller_tier='restricted'
  - tier='verified' (full KYC done)  -> buyer_eligible=True, seller_tier='full'
  - everyone else                    -> defaults (not_eligible / False)
"""
from alembic import op
import sqlalchemy as sa


revision = "0013_tri_state_user"
down_revision = "0012_user_blocks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Add new columns with temporary server defaults so existing rows get values ──
    op.add_column(
        "users",
        sa.Column(
            "auth_state",
            sa.String(length=32),
            nullable=False,
            server_default="guest",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "buyer_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "seller_tier",
            sa.String(length=32),
            nullable=False,
            server_default="not_eligible",
        ),
    )
    # TDS threshold tracker (Section 194-O) — paise to avoid float drift
    op.add_column(
        "users",
        sa.Column(
            "fy_cumulative_payout_paise",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "fy_cumulative_payout_fy_start",
            sa.Date(),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "tier_upgrade_prompted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # ── Data migration: map Sprint 3 state -> tri-state ─────────────────────────
    # Everyone who has completed phone OTP -> otp_verified
    op.execute(
        """
        UPDATE users
        SET auth_state = 'otp_verified'
        WHERE phone_verified = true
          AND COALESCE(is_restricted, false) = false
        """
    )
    # Restricted users -> suspended + restricted seller
    op.execute(
        """
        UPDATE users
        SET auth_state = 'suspended',
            seller_tier = 'restricted'
        WHERE is_restricted = true
        """
    )
    # Fully verified Sprint 3 users -> buyer_eligible + seller_tier=full
    # (they completed the full Sprint 3 KYC stack: Aadhaar+PAN+liveness+payout)
    op.execute(
        """
        UPDATE users
        SET buyer_eligible = true,
            seller_tier = 'full'
        WHERE tier = 'verified'
          AND kyc_status = 'verified'
          AND COALESCE(is_restricted, false) = false
        """
    )

    # ── Indexes for common eligibility queries ──────────────────────────────────
    op.create_index("ix_users_seller_tier", "users", ["seller_tier"])
    op.create_index("ix_users_auth_state", "users", ["auth_state"])

    # ── Drop server defaults; app layer enforces from now on ────────────────────
    op.alter_column("users", "auth_state", server_default=None)
    op.alter_column("users", "buyer_eligible", server_default=None)
    op.alter_column("users", "seller_tier", server_default=None)
    op.alter_column("users", "fy_cumulative_payout_paise", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_users_auth_state", table_name="users")
    op.drop_index("ix_users_seller_tier", table_name="users")
    op.drop_column("users", "tier_upgrade_prompted_at")
    op.drop_column("users", "fy_cumulative_payout_fy_start")
    op.drop_column("users", "fy_cumulative_payout_paise")
    op.drop_column("users", "seller_tier")
    op.drop_column("users", "buyer_eligible")
    op.drop_column("users", "auth_state")
