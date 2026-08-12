"""Marketplace seller settlement models.

Design: docs/OWMEE_SELLER_PAYOUTS.md. The ledger is append-only and
idempotent (unique reference_id per business event); balances are always
sums over entries, never mutable columns. Distinct from the Owmee Direct
`seller_account_ledger_entries` table, which belongs to the acquisition flow.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base, TimestampMixin


ENTRY_SALE_CREDIT = "sale_credit"
ENTRY_REFUND_CLAWBACK = "refund_clawback"
ENTRY_ADJUSTMENT = "adjustment"
ENTRY_PAYOUT_DEBIT = "payout_debit"

PAYOUT_STATUS_RECORDED = "recorded"
PAYOUT_STATUS_FAILED = "failed"


class SellerPayoutAccount(Base, TimestampMixin):
    """The seller's payout destination, captured at the KYC payout step.

    APIs must only ever serialize ``masked_display`` — never the raw
    vpa/account_number.
    """

    __tablename__ = "seller_payout_accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("uuid_generate_v4()"))
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    account_type = Column(String(20), nullable=False)  # upi | bank
    vpa = Column(String(120))
    account_number = Column(String(34))
    ifsc_code = Column(String(11))
    account_holder_name = Column(String(120))
    masked_display = Column(String(64), nullable=False)
    provider_ref = Column(String(256))
    verified_at = Column(DateTime(timezone=True))
    is_active = Column(Boolean, nullable=False, default=True)
    deactivated_at = Column(DateTime(timezone=True))


class SellerPayout(Base, TimestampMixin):
    __tablename__ = "seller_payouts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("uuid_generate_v4()"))
    seller_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    amount_inr = Column(Numeric(12, 2), nullable=False)
    status = Column(String(24), nullable=False, default=PAYOUT_STATUS_RECORDED)
    method = Column(String(24), nullable=False)  # manual_bank | manual_upi | razorpayx
    payout_account_id = Column(UUID(as_uuid=True),
                               ForeignKey("seller_payout_accounts.id", ondelete="RESTRICT"),
                               nullable=False)
    utr_reference = Column(String(64))
    initiated_by = Column(String(64), nullable=False)
    idempotency_key = Column(String(120), nullable=False, unique=True)
    failure_reason = Column(String(300))
    paid_at = Column(DateTime(timezone=True))


class SellerLedgerEntry(Base):
    __tablename__ = "seller_ledger_entries"
    __table_args__ = (
        Index("ix_seller_ledger_seller_created", "seller_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                server_default=text("uuid_generate_v4()"))
    seller_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    entry_type = Column(String(32), nullable=False)
    amount_inr = Column(Numeric(12, 2), nullable=False)  # signed
    reference_id = Column(String(120), nullable=False, unique=True)
    transaction_id = Column(UUID(as_uuid=True), index=True)
    payout_id = Column(UUID(as_uuid=True),
                       ForeignKey("seller_payouts.id", ondelete="RESTRICT"))
    memo = Column(String(300))
    created_by = Column(String(64), nullable=False, default="system")
    created_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=text("now()"))
