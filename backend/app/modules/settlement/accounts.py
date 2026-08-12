"""Seller payout destination storage.

The KYC payout step verifies the account with the KYC partner; this module
persists WHAT was verified so a payout can actually be made to it later.
(Previously the VPA/account number was verified and then discarded — only
the partner's opaque ref survived, so even a manual payout had nothing on
file to pay into.)
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.settlement.models import SellerPayoutAccount

logger = structlog.get_logger()


def mask_payout_destination(account_type: str, account_value: str, ifsc_code: str | None = None) -> str:
    """Human-recognizable but non-sensitive display form. This is the ONLY
    form any API response may carry."""
    value = (account_value or "").strip()
    if account_type == "upi":
        if "@" in value:
            local, _, handle = value.partition("@")
            keep = local[:2] if len(local) > 2 else local[:1]
            return f"{keep}***@{handle}"
        return f"{value[:2]}***"
    last4 = value[-4:] if len(value) >= 4 else value
    suffix = f" · {ifsc_code}" if ifsc_code else ""
    return f"••••{last4}{suffix}"


async def record_verified_payout_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    account_type: str,
    account_value: str,
    ifsc_code: str | None,
    provider_ref: str | None,
) -> SellerPayoutAccount:
    """Store the verified destination as the seller's single active payout
    account. Re-verification replaces (deactivates) the previous one so the
    partial-unique active index holds. Caller commits."""
    now = datetime.now(timezone.utc)

    existing_active = (await db.execute(
        select(SellerPayoutAccount).where(
            SellerPayoutAccount.user_id == user_id,
            SellerPayoutAccount.is_active.is_(True),
        )
    )).scalars().all()
    for account in existing_active:
        account.is_active = False
        account.deactivated_at = now

    account = SellerPayoutAccount(
        user_id=user_id,
        account_type=account_type,
        vpa=account_value if account_type == "upi" else None,
        account_number=account_value if account_type == "bank" else None,
        ifsc_code=ifsc_code if account_type == "bank" else None,
        masked_display=mask_payout_destination(account_type, account_value, ifsc_code),
        provider_ref=provider_ref,
        verified_at=now,
        is_active=True,
    )
    db.add(account)
    await db.flush()
    logger.info(
        "payout_account.recorded",
        user_id=str(user_id),
        account_type=account_type,
        masked=account.masked_display,
    )
    return account


async def active_payout_account(
    db: AsyncSession, user_id: UUID
) -> SellerPayoutAccount | None:
    return (await db.execute(
        select(SellerPayoutAccount).where(
            SellerPayoutAccount.user_id == user_id,
            SellerPayoutAccount.is_active.is_(True),
        )
    )).scalar_one_or_none()
