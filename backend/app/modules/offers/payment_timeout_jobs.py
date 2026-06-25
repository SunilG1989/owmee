"""Background maintenance for unpaid order payment windows."""
from __future__ import annotations

import asyncio

import structlog

from app.core.settings import settings
from app.db.session import AsyncSessionLocal
from app.modules.offers.service import expire_due_unpaid_transactions

logger = structlog.get_logger()


async def run_payment_timeout_sweeper() -> None:
    interval = max(15, int(settings.payment_timeout_sweeper_interval_seconds or 60))
    batch_size = max(1, int(settings.payment_timeout_sweeper_batch_size or 100))
    logger.info(
        "payment_timeout.sweeper_starting",
        interval_seconds=interval,
        batch_size=batch_size,
    )
    while True:
        try:
            async with AsyncSessionLocal() as db:
                expired = await expire_due_unpaid_transactions(db, limit=batch_size)
                await db.commit()
                if expired:
                    logger.info("payment_timeout.sweeper_expired", count=expired)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("payment_timeout.sweeper_error", error=str(exc))
        await asyncio.sleep(interval)
