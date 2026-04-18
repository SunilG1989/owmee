"""
TransactionWorkflow — Temporal durable workflow.

State machine:
  payment_pending → payment_captured → meetup_pending
    → awaiting_confirmation → completed | cancelled_at_meetup

Timers:
  - Seller response deadline: 24h to confirm meetup
  - Cancel window: 30 min around meetup time
  - Auto-complete: 48h after meetup if buyer doesn't confirm

Compensation:
  - Payment captured but txn fails → refund via PA
  - Seller no-show → full refund, trust score impact
"""
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ApplicationError

with workflow.unsafe.imports_passed_through():
    import structlog
    logger = structlog.get_logger()
    from app.modules.transactions.activities import (
        ActivityTransactionInput,
        act_check_transaction_status,
        act_trigger_refund,
        act_trigger_payout_eligibility,
        act_flag_seller_ghosting,
        act_auto_complete_transaction,
        act_notify_transaction_event,
    )

@workflow.defn(name="TransactionWorkflow")
class TransactionWorkflow:

    def __init__(self):
        self._payment_captured = False
        self._meetup_confirmed = False
        self._deal_confirmed = False
        self._cancelled = False
        self._dispute_raised = False
        self._cancel_reason: str | None = None

    # ── Signals ────────────────────────────────────────────────────────────

    @workflow.signal
    def payment_captured(self):
        self._payment_captured = True
        logger.info("txn_workflow.payment_captured")

    @workflow.signal
    def meetup_confirmed(self):
        self._meetup_confirmed = True
        logger.info("txn_workflow.meetup_confirmed")

    @workflow.signal
    def deal_confirmed(self):
        self._deal_confirmed = True
        logger.info("txn_workflow.deal_confirmed")

    @workflow.signal
    def cancelled(self, reason: str = ""):
        self._cancelled = True
        self._cancel_reason = reason
        logger.info("txn_workflow.cancelled", reason=reason)

    @workflow.signal
    def dispute_raised(self):
        self._dispute_raised = True
        logger.info("txn_workflow.dispute_raised")

    # ── Queries ────────────────────────────────────────────────────────────

    @workflow.query
    def get_state(self) -> dict:
        return {
            "payment_captured": self._payment_captured,
            "meetup_confirmed": self._meetup_confirmed,
            "deal_confirmed": self._deal_confirmed,
            "cancelled": self._cancelled,
            "dispute_raised": self._dispute_raised,
        }

    # ── Main run ───────────────────────────────────────────────────────────

    @workflow.run
    async def run(self, transaction_id: str) -> dict:
        logger.info("txn_workflow.started", transaction_id=transaction_id)

        retry = RetryPolicy(
            maximum_attempts=3,
            initial_interval=timedelta(seconds=2),
            backoff_coefficient=2.0,
        )

        inp = ActivityTransactionInput(transaction_id=transaction_id)

        # ── Wait for payment capture (max 30 min — link expiry) ───────────
        try:
            await workflow.wait_condition(
                lambda: self._payment_captured or self._cancelled,
                timeout=timedelta(minutes=35),
            )
        except TimeoutError:
            logger.info("txn_workflow.payment_timeout", transaction_id=transaction_id)
            return {"status": "expired", "reason": "PAYMENT_TIMEOUT"}

        if self._cancelled:
            return {"status": "cancelled", "reason": self._cancel_reason}

        # ── Payment captured — wait for seller meetup confirm (24h SLA) ───
        try:
            await workflow.wait_condition(
                lambda: self._meetup_confirmed or self._cancelled or self._dispute_raised,
                timeout=timedelta(hours=24),
            )
        except TimeoutError:
            # Seller ghosting — flag and refund
            logger.info("txn_workflow.seller_ghosting", transaction_id=transaction_id)
            await workflow.execute_activity(
                act_flag_seller_ghosting,
                inp,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            await workflow.execute_activity(
                act_trigger_refund,
                inp,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return {"status": "cancelled", "reason": "SELLER_GHOSTING"}

        if self._cancelled:
            await workflow.execute_activity(
                act_trigger_refund,
                inp,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return {"status": "cancelled", "reason": self._cancel_reason}

        if self._dispute_raised:
            # Freeze — dispute workflow takes over
            return {"status": "disputed"}

        # ── Meetup confirmed — wait for buyer confirmation (48h auto-complete) ─
        try:
            await workflow.wait_condition(
                lambda: self._deal_confirmed or self._cancelled or self._dispute_raised,
                timeout=timedelta(hours=48),
            )
        except TimeoutError:
            # Auto-complete after 48h — buyer didn't dispute
            logger.info("txn_workflow.auto_complete", transaction_id=transaction_id)
            await workflow.execute_activity(
                act_auto_complete_transaction,
                inp,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            await workflow.execute_activity(
                act_trigger_payout_eligibility,
                inp,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return {"status": "auto_completed"}

        if self._cancelled:
            await workflow.execute_activity(
                act_trigger_refund,
                inp,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=retry,
            )
            return {"status": "cancelled", "reason": self._cancel_reason}

        if self._dispute_raised:
            return {"status": "disputed"}

        # ── Deal confirmed by buyer ────────────────────────────────────────
        await workflow.execute_activity(
            act_trigger_payout_eligibility,
            inp,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry,
        )
        logger.info("txn_workflow.completed", transaction_id=transaction_id)
        return {"status": "completed"}
