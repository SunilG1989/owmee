"""
transactions/models.py

Offer, Reservation, Transaction, PaymentLink are now in offers/models.py.
This module retains only TDS ledger and reconciliation — financial audit tables
that belong to the transactions domain but are not part of the offer flow.
"""
import uuid
from sqlalchemy import Column, DateTime, Numeric, String, Boolean, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.db.session import Base, TimestampMixin


class TDSAnnualLedger(Base, TimestampMixin):
    __tablename__ = "tds_annual_ledger"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    financial_year = Column(String(7), nullable=False)   # e.g. "2024-25"
    cumulative_paid = Column(Numeric(14, 2), nullable=False, default=0)
    tds_withheld = Column(Numeric(14, 2), nullable=False, default=0)
    threshold = Column(Numeric(14, 2), nullable=False, default=500000)
    pan_available = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class ReconciliationRun(Base):
    __tablename__ = "reconciliation_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_date = Column(String(10), nullable=False, unique=True)
    status = Column(String(20), nullable=False, default="running")
    total_transactions = Column(String(10))
    matched = Column(String(10))
    mismatches = Column(String(10))
    result_summary = Column(JSONB)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    completed_at = Column(DateTime(timezone=True))
