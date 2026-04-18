"""
DisputeWorkflow — Temporal durable workflow.

State machine:
  opened → evidence_collection (24h) → under_review → resolved | escalated → closed

Timers:
  - Evidence collection window: 24h
  - L1 review SLA: 48h before auto-escalation
  - L2 escalation SLA: 5 business days

Compensation:
  - full_refund → refund buyer, cancel payout
  - full_release → release payout to seller
  - partial_refund → partial refund + reduced payout
"""
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    import structlog
    logger = structlog.get_logger()
    from app.modules.disputes.activities import (
        ActivityDisputeInput,
        act_archive_chat_evidence,
        act_freeze_transaction_for_dispute,
        act_apply_dispute_resolution,
        act_notify_dispute_event,
    )

@workflow.defn(name="DisputeWorkflow")
class DisputeWorkflow:

    def __init__(self):
        self._resolution: str | None = None
        self._resolution_note: str = ""
        self._escalated = False

    # ── Signals ────────────────────────────────────────────────────────────

    @workflow.signal
    def resolve(self, resolution: str, note: str = ""):
        self._resolution = resolution
        self._resolution_note = note
        logger.info("dispute_workflow.resolution_signal", resolution=resolution)

    @workflow.signal
    def escalate(self):
        self._escalated = True
        logger.info("dispute_workflow.escalated")

    # ── Query ──────────────────────────────────────────────────────────────

    @workflow.query
    def get_state(self) -> dict:
        return {
            "resolution": self._resolution,
            "escalated": self._escalated,
        }

    # ── Main run ───────────────────────────────────────────────────────────

    @workflow.run
    async def run(self, dispute_id: str, transaction_id: str) -> dict:
        logger.info("dispute_workflow.started", dispute_id=dispute_id)

        retry = RetryPolicy(maximum_attempts=3, initial_interval=timedelta(seconds=2))
        inp = ActivityDisputeInput(dispute_id=dispute_id, transaction_id=transaction_id)

        # ── Step 1: Archive chat evidence immediately ─────────────────────
        await workflow.execute_activity(
            act_archive_chat_evidence,
            inp,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry,
        )

        # ── Step 2: Freeze transaction payout ─────────────────────────────
        await workflow.execute_activity(
            act_freeze_transaction_for_dispute,
            inp,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry,
        )

        # ── Step 3: Evidence collection window (24h) ──────────────────────
        await workflow.sleep(timedelta(hours=24))
        logger.info("dispute_workflow.evidence_window_closed", dispute_id=dispute_id)

        # ── Step 4: Wait for L1 reviewer resolution (48h SLA) ─────────────
        try:
            await workflow.wait_condition(
                lambda: self._resolution is not None or self._escalated,
                timeout=timedelta(hours=48),
            )
        except TimeoutError:
            # Auto-escalate if L1 didn't resolve in time
            self._escalated = True
            await workflow.execute_activity(
                act_notify_dispute_event,
                inp,
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=retry,
            )
            logger.info("dispute_workflow.auto_escalated", dispute_id=dispute_id)

        # ── Step 5: If escalated, wait longer for L2 (5 days) ─────────────
        if self._escalated and self._resolution is None:
            try:
                await workflow.wait_condition(
                    lambda: self._resolution is not None,
                    timeout=timedelta(days=5),
                )
            except TimeoutError:
                logger.info("dispute_workflow.l2_timeout", dispute_id=dispute_id)
                return {"status": "escalated_unresolved"}

        # ── Step 6: Apply resolution ───────────────────────────────────────
        from app.modules.disputes.activities import ActivityDisputeResolutionInput
        res_inp = ActivityDisputeResolutionInput(
            dispute_id=dispute_id,
            transaction_id=transaction_id,
            resolution=self._resolution or "escalated",
            resolution_note=self._resolution_note,
        )
        await workflow.execute_activity(
            act_apply_dispute_resolution,
            res_inp,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry,
        )

        logger.info("dispute_workflow.resolved", dispute_id=dispute_id,
                    resolution=self._resolution)
        return {"status": "resolved", "resolution": self._resolution}
