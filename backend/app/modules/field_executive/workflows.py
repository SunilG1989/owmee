"""
Field Executive Temporal workflow — Sprint 4 / Pass 2.

FEVisitWorkflow is the long-running state owner for a visit between
'scheduled' and a terminal state. It holds timers for:
  - SLA alert if FE hasn't started within 30 minutes of scheduled slot end
  - In-progress timeout if visit runs longer than 2 hours

The workflow receives signals from the API layer when the FE starts the visit
and when the outcome is submitted. Signals are the only way external code
mutates workflow state.

Versioning: every change to run() must pass through `workflow.patched` gates so
in-flight instances keep running on the old path. See HANDOFF_PASS_3.md for
the versioning catalog.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from temporalio import workflow

# Import activities through the workflow.unsafe context so they're visible
# but not imported into the deterministic sandbox.
with workflow.unsafe.imports_passed_through():
    from app.modules.field_executive.activities import (
        act_notify_fe_assigned,
        act_spawn_listing_review,
        act_surface_stuck_visit,
    )


SLA_NOT_STARTED_MINUTES = 30
IN_PROGRESS_TIMEOUT_MINUTES = 120


@dataclass
class FEVisitWorkflowInput:
    visit_id: str
    fe_user_id: str
    scheduled_end_iso: str   # ISO string; workflows must avoid non-deterministic types


@dataclass
class VisitOutcomeSignal:
    outcome: str
    outcome_reason: Optional[str] = None
    listing_id: Optional[str] = None


@workflow.defn(name="FEVisitWorkflow")
class FEVisitWorkflow:
    def __init__(self) -> None:
        self._started: bool = False
        self._outcome: Optional[VisitOutcomeSignal] = None

    @workflow.signal
    def fe_started(self) -> None:
        self._started = True

    @workflow.signal
    def fe_submitted_outcome(self, signal: VisitOutcomeSignal) -> None:
        self._outcome = signal

    @workflow.run
    async def run(self, input: FEVisitWorkflowInput) -> dict:
        # Notify FE of the assignment (fire-and-forget).
        await workflow.execute_activity(
            act_notify_fe_assigned,
            args=[input.visit_id, input.fe_user_id],
            start_to_close_timeout=timedelta(seconds=30),
        )

        # Wait for FE to start, with SLA timer.
        try:
            await workflow.wait_condition(
                lambda: self._started,
                timeout=timedelta(minutes=SLA_NOT_STARTED_MINUTES),
            )
        except TimeoutError:
            await workflow.execute_activity(
                act_surface_stuck_visit,
                args=[input.visit_id, "fe_did_not_start_within_sla"],
                start_to_close_timeout=timedelta(seconds=30),
            )
            # Keep waiting but don't re-alert; admin will intervene.
            await workflow.wait_condition(lambda: self._started)

        # FE has started. Wait for outcome submission, with in-progress timeout.
        try:
            await workflow.wait_condition(
                lambda: self._outcome is not None,
                timeout=timedelta(minutes=IN_PROGRESS_TIMEOUT_MINUTES),
            )
        except TimeoutError:
            await workflow.execute_activity(
                act_surface_stuck_visit,
                args=[input.visit_id, "visit_in_progress_too_long"],
                start_to_close_timeout=timedelta(seconds=30),
            )
            await workflow.wait_condition(lambda: self._outcome is not None)

        outcome = self._outcome
        assert outcome is not None  # narrowed for type checker

        # On a successful listing, queue the review workflow.
        if outcome.outcome == "listed" and outcome.listing_id:
            await workflow.execute_activity(
                act_spawn_listing_review,
                args=[input.visit_id, outcome.listing_id],
                start_to_close_timeout=timedelta(seconds=30),
            )

        return {
            "visit_id": input.visit_id,
            "outcome": outcome.outcome,
            "listing_id": outcome.listing_id,
        }
