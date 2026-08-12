"""Background settlement maintenance: the delivered auto-complete sweep.

Same worker pattern as the payment-timeout sweeper. This is the running
enforcement of the 48h buyer-acceptance window — the Temporal
TransactionWorkflow that nominally owned this timer is never started.
"""
from __future__ import annotations

import asyncio

import structlog

from app.core.settings import settings
from app.db.session import AsyncSessionLocal
from app.modules.settlement.service import auto_complete_due_delivered_transactions

logger = structlog.get_logger()


async def run_settlement_sweeper() -> None:
    interval = max(30, int(settings.settlement_sweeper_interval_seconds or 300))
    batch_size = max(1, int(settings.settlement_sweeper_batch_size or 100))
    logger.info(
        "settlement.sweeper_starting",
        interval_seconds=interval,
        batch_size=batch_size,
    )
    while True:
        try:
            async with AsyncSessionLocal() as db:
                completed = await auto_complete_due_delivered_transactions(
                    db, limit=batch_size
                )
                await db.commit()
                if completed:
                    logger.info("settlement.sweeper_completed", count=completed)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("settlement.sweeper_error", error=str(exc))
        await asyncio.sleep(interval)
