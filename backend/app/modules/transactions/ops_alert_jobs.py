"""Background ops alerts for stuck transaction states.

This sweeper does not mutate transaction state. It surfaces states that need
human action into the existing stuck_workflow_alerts queue and auto-resolves
those alerts once the transaction has progressed.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

import structlog
from sqlalchemy import and_, or_, select

from app.core.settings import settings
from app.db.session import AsyncSessionLocal
from app.modules.offers.models import Transaction
from app.modules.stuck_workflow import StuckWorkflowAlert, report_stuck

logger = structlog.get_logger()


WORKFLOW_TYPE = "transaction_ops"


@dataclass(frozen=True)
class TransactionOpsAlertSpec:
    suffix: str
    reason: str
    severity: str
    description: str


SELLER_READINESS_TIMEOUT = TransactionOpsAlertSpec(
    "seller_readiness",
    "seller_readiness_timeout",
    "critical",
    "Buyer paid, but seller has not confirmed pickup readiness before the SLA.",
)
PICKUP_NOT_ASSIGNED = TransactionOpsAlertSpec(
    "pickup_assignment",
    "pickup_not_assigned",
    "warning",
    "Seller confirmed pickup, but no FE has been assigned within the SLA.",
)
HUB_NOT_DISPATCHED = TransactionOpsAlertSpec(
    "hub_dispatch",
    "hub_dispatch_delayed",
    "warning",
    "Item is in Owmee custody, but has not been routed for buyer delivery within the SLA.",
)
DELIVERY_TOO_LONG = TransactionOpsAlertSpec(
    "delivery",
    "delivery_in_progress_too_long",
    "critical",
    "Delivery is in progress longer than expected and needs ops review.",
)
REFUND_FAILED = TransactionOpsAlertSpec(
    "refund",
    "refund_failed",
    "critical",
    "Refund provider call failed or needs retry from ops.",
)


def _workflow_id(txn_id: UUID, spec: TransactionOpsAlertSpec) -> str:
    return f"txn:{txn_id}:{spec.suffix}"


async def surface_due_transaction_ops_alerts(db, *, now: datetime | None = None, limit: int = 200) -> int:
    now = now or datetime.now(timezone.utc)
    pickup_assignment_cutoff = now - timedelta(minutes=settings.transaction_pickup_assignment_sla_minutes)
    hub_dispatch_cutoff = now - timedelta(minutes=settings.transaction_hub_dispatch_sla_minutes)
    delivery_cutoff = now - timedelta(minutes=settings.transaction_delivery_sla_minutes)

    rows = (await db.execute(
        select(Transaction)
        .where(or_(
            and_(
                Transaction.status == "payment_captured",
                Transaction.seller_readiness_status == "pending",
                Transaction.seller_response_deadline.is_not(None),
                Transaction.seller_response_deadline <= now,
            ),
            and_(
                Transaction.status == "payment_captured",
                Transaction.seller_readiness_status == "confirmed",
                Transaction.pickup_fe_id.is_(None),
                Transaction.pickup_ready_at.is_not(None),
                Transaction.pickup_ready_at <= pickup_assignment_cutoff,
            ),
            and_(
                Transaction.status == "at_hub",
                Transaction.at_hub_at.is_not(None),
                Transaction.routed_at.is_(None),
                Transaction.at_hub_at <= hub_dispatch_cutoff,
            ),
            and_(
                Transaction.status == "delivery_in_progress",
                Transaction.routed_at.is_not(None),
                Transaction.delivered_at.is_(None),
                Transaction.routed_at <= delivery_cutoff,
            ),
            Transaction.refund_status == "failed",
        ))
        .order_by(Transaction.created_at.asc())
        .limit(limit)
    )).scalars().all()

    reported = 0
    for txn in rows:
        for spec in _active_alert_specs(txn, now=now):
            await report_stuck(
                db,
                workflow_type=WORKFLOW_TYPE,
                workflow_id=_workflow_id(txn.id, spec),
                entity_type="transaction",
                entity_id=str(txn.id),
                reason=spec.reason,
                severity=spec.severity,
                description=spec.description,
                metadata_json={
                    "transaction_id": str(txn.id),
                    "status": txn.status,
                    "seller_readiness_status": txn.seller_readiness_status,
                    "refund_status": txn.refund_status,
                    "pickup_fe_id": str(txn.pickup_fe_id) if txn.pickup_fe_id else None,
                    "delivery_fe_id": str(txn.delivery_fe_id) if txn.delivery_fe_id else None,
                },
            )
            reported += 1

    resolved = await _auto_resolve_cleared_alerts(db, now=now)
    if reported or resolved:
        logger.info("transaction_ops.alert_sweep", reported=reported, auto_resolved=resolved)
    return reported


def _active_alert_specs(txn: Transaction, *, now: datetime) -> list[TransactionOpsAlertSpec]:
    specs: list[TransactionOpsAlertSpec] = []
    pickup_assignment_cutoff = now - timedelta(minutes=settings.transaction_pickup_assignment_sla_minutes)
    hub_dispatch_cutoff = now - timedelta(minutes=settings.transaction_hub_dispatch_sla_minutes)
    delivery_cutoff = now - timedelta(minutes=settings.transaction_delivery_sla_minutes)

    if (
        txn.status == "payment_captured"
        and txn.seller_readiness_status == "pending"
        and txn.seller_response_deadline
        and txn.seller_response_deadline <= now
    ):
        specs.append(SELLER_READINESS_TIMEOUT)
    if (
        txn.status == "payment_captured"
        and txn.seller_readiness_status == "confirmed"
        and not txn.pickup_fe_id
        and txn.pickup_ready_at
        and txn.pickup_ready_at <= pickup_assignment_cutoff
    ):
        specs.append(PICKUP_NOT_ASSIGNED)
    if (
        txn.status == "at_hub"
        and txn.at_hub_at
        and not txn.routed_at
        and txn.at_hub_at <= hub_dispatch_cutoff
    ):
        specs.append(HUB_NOT_DISPATCHED)
    if (
        txn.status == "delivery_in_progress"
        and txn.routed_at
        and not txn.delivered_at
        and txn.routed_at <= delivery_cutoff
    ):
        specs.append(DELIVERY_TOO_LONG)
    if txn.refund_status == "failed":
        specs.append(REFUND_FAILED)
    return specs


async def _auto_resolve_cleared_alerts(db, *, now: datetime) -> int:
    rows = (await db.execute(
        select(StuckWorkflowAlert)
        .where(
            StuckWorkflowAlert.workflow_type == WORKFLOW_TYPE,
            StuckWorkflowAlert.resolved_at.is_(None),
        )
        .limit(500)
    )).scalars().all()
    resolved = 0
    for alert in rows:
        txn_id = _transaction_id_from_alert(alert)
        spec = _spec_from_alert(alert)
        if not txn_id or not spec:
            continue
        txn = await db.get(Transaction, txn_id)
        if not txn or spec not in _active_alert_specs(txn, now=now):
            alert.resolved_at = now
            alert.resolution_note = "Auto-resolved after transaction state progressed."
            resolved += 1
    return resolved


def _transaction_id_from_alert(alert: StuckWorkflowAlert) -> UUID | None:
    try:
        return UUID(str(alert.entity_id))
    except (TypeError, ValueError):
        return None


def _spec_from_alert(alert: StuckWorkflowAlert) -> TransactionOpsAlertSpec | None:
    for spec in (
        SELLER_READINESS_TIMEOUT,
        PICKUP_NOT_ASSIGNED,
        HUB_NOT_DISPATCHED,
        DELIVERY_TOO_LONG,
        REFUND_FAILED,
    ):
        if alert.reason == spec.reason:
            return spec
    return None


async def run_transaction_ops_alert_sweeper() -> None:
    interval = max(30, int(settings.transaction_ops_alert_sweeper_interval_seconds or 120))
    logger.info("transaction_ops.sweeper_starting", interval_seconds=interval)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await surface_due_transaction_ops_alerts(db)
                await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("transaction_ops.sweeper_error", error=str(exc))
        await asyncio.sleep(interval)
