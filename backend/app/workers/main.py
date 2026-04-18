"""
Owmee Temporal Worker
Registers all workflows and activities.
Connect to Temporal Cloud via TEMPORAL_API_KEY env var.
Local dev: connect to temporal:7233 (no TLS).

Sprint 4 / Pass 3: FEVisitWorkflow is now registered here so the workflow
actually runs when the API layer starts it on admin_assign. Without this
registration, start_workflow succeeds but the workflow never executes (and
signals hang).
"""
import asyncio
import structlog

from temporalio.client import Client
from temporalio.worker import Worker

from app.core.settings import settings

logger = structlog.get_logger()

TASK_QUEUE = "owmee-main"


async def main():
    logger.info("worker.starting", temporal_host=settings.temporal_host)

    # Connect — Temporal Cloud uses TLS + API key; local uses plain TCP
    if settings.temporal_api_key:
        client = await Client.connect(
            settings.temporal_host,
            namespace=settings.temporal_namespace,
            tls=True,
            api_key=settings.temporal_api_key,
        )
    else:
        client = await Client.connect(
            settings.temporal_host,
            namespace=settings.temporal_namespace,
        )

    logger.info("worker.connected", host=settings.temporal_host)

    # ── Workflows ────────────────────────────────────────────────────────
    from app.modules.kyc.workflows import KYCVerificationWorkflow
    from app.modules.transactions.workflows import TransactionWorkflow
    from app.modules.disputes.workflows import DisputeWorkflow
    # ── Sprint 4 / Pass 3: FE visit workflow ─────────────────────────────
    from app.modules.field_executive.workflows import FEVisitWorkflow

    # ── KYC activities ────────────────────────────────────────────────────
    from app.modules.kyc.activities import (
        act_aadhaar_otp_initiate,
        act_aadhaar_otp_verify,
        act_pan_verify,
        act_liveness_create_session,
        act_liveness_verify,
        act_payout_account_verify,
        act_update_kyc_status,
    )

    # ── Transaction activities ────────────────────────────────────────────
    from app.modules.transactions.activities import (
        act_check_transaction_status,
        act_trigger_refund,
        act_trigger_payout_eligibility,
        act_flag_seller_ghosting,
        act_auto_complete_transaction,
        act_notify_transaction_event,
    )

    # ── Dispute activities ────────────────────────────────────────────────
    from app.modules.disputes.activities import (
        act_archive_chat_evidence,
        act_freeze_transaction_for_dispute,
        act_apply_dispute_resolution,
        act_notify_dispute_event,
    )

    # ── Field Executive activities ────────────────────────────────────────
    from app.modules.field_executive.activities import (
        act_notify_fe_assigned,
        act_surface_stuck_visit,
        act_spawn_listing_review,
    )

    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[
            KYCVerificationWorkflow,
            TransactionWorkflow,
            DisputeWorkflow,
            FEVisitWorkflow,
        ],
        activities=[
            # KYC
            act_aadhaar_otp_initiate,
            act_aadhaar_otp_verify,
            act_pan_verify,
            act_liveness_create_session,
            act_liveness_verify,
            act_payout_account_verify,
            act_update_kyc_status,
            # Transactions
            act_check_transaction_status,
            act_trigger_refund,
            act_trigger_payout_eligibility,
            act_flag_seller_ghosting,
            act_auto_complete_transaction,
            act_notify_transaction_event,
            # Disputes
            act_archive_chat_evidence,
            act_freeze_transaction_for_dispute,
            act_apply_dispute_resolution,
            act_notify_dispute_event,
            # Field Executive
            act_notify_fe_assigned,
            act_surface_stuck_visit,
            act_spawn_listing_review,
        ],
    )

    logger.info("worker.running", task_queue=TASK_QUEUE,
                workflows=4, activities=21)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
