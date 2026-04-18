"""
Temporal client — Sprint 4 / Pass 3.

Module-level cached Temporal Client for API-layer workflow start + signal.
Mirrors the connection logic in app/workers/main.py so both sides use the
same namespace + TLS behaviour.

Pattern of use from an API handler:

    from app.core.temporal_client import get_temporal_client, TASK_QUEUE

    client = await get_temporal_client()
    handle = await client.start_workflow(
        FEVisitWorkflow.run,
        FEVisitWorkflowInput(...),
        id=f"fe-visit-{visit.id}",
        task_queue=TASK_QUEUE,
    )

    await handle.signal(FEVisitWorkflow.fe_started)

Failure policy: any Temporal client error is logged but does NOT fail the
DB commit. The workflow is a side-effect for ops visibility; the DB row is
the source of truth. This matches the Pass 2 architecture principle that
Postgres is the business system of record.
"""
from __future__ import annotations

import asyncio
from typing import Optional

import structlog
from temporalio.client import Client, TLSConfig

from app.core.settings import settings

logger = structlog.get_logger()

TASK_QUEUE = "owmee-main"

_client: Optional[Client] = None
_lock = asyncio.Lock()


async def get_temporal_client() -> Client:
    """Return a cached Temporal Client, connecting on first call."""
    global _client
    if _client is not None:
        return _client
    async with _lock:
        if _client is not None:
            return _client
        if settings.temporal_api_key:
            _client = await Client.connect(
                settings.temporal_host,
                namespace=settings.temporal_namespace,
                tls=True,
                api_key=settings.temporal_api_key,
            )
        else:
            _client = await Client.connect(
                settings.temporal_host,
                namespace=settings.temporal_namespace,
            )
        logger.info(
            "temporal.client.connected",
            host=settings.temporal_host,
            namespace=settings.temporal_namespace,
        )
        return _client


async def reset_temporal_client() -> None:
    """Test helper — drop the cached client so the next call reconnects."""
    global _client
    _client = None
