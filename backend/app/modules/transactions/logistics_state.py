"""Sprint 6c — post-payment logistics state machine.

Single source of truth for what status comes next, who's allowed to move
us there, and what data must be present before a transition is legal.

Why a separate module
---------------------
The existing transactions.status field is touched from several places
(offers/service.py, transactions/shipped.py, disputes, admin). Without a
guard layer it's only a matter of time before two endpoints disagree
about whether a transition is legal — see the half-built shipped flow
that already lived in shipped.py. This module is the choke point for
Sprint 6c-onwards transitions.
"""
from __future__ import annotations

from dataclasses import dataclass


# Legal post-payment states
PAYMENT_CAPTURED = "payment_captured"
AT_HUB = "at_hub"                       # FE picked up + inspection passed, item received at hub
PICKUP_REJECTED = "pickup_rejected"      # FE pickup found item != listing → buyer auto-refunded
DELIVERY_IN_PROGRESS = "delivery_in_progress"
DELIVERED = "delivered"
COMPLETED = "completed"
DISPUTED = "disputed"

POST_PAYMENT_TERMINAL = {COMPLETED, DISPUTED, PICKUP_REJECTED}


@dataclass(frozen=True)
class _Transition:
    src: str
    dst: str
    why: str  # human reason for log/audit


_TRANSITIONS: tuple[_Transition, ...] = (
    _Transition(PAYMENT_CAPTURED, AT_HUB, "fe_pickup_inspection_passed"),
    _Transition(PAYMENT_CAPTURED, PICKUP_REJECTED, "fe_pickup_inspection_failed"),
    _Transition(AT_HUB, DELIVERY_IN_PROGRESS, "admin_routed_delivery"),
    _Transition(DELIVERY_IN_PROGRESS, DELIVERED, "delivery_handover"),
    _Transition(DELIVERED, COMPLETED, "buyer_confirmed_or_auto_completed"),
    _Transition(DELIVERED, DISPUTED, "buyer_opened_dispute"),
)


def is_legal_transition(src: str, dst: str) -> bool:
    return any(t.src == src and t.dst == dst for t in _TRANSITIONS)


def assert_legal_transition(src: str, dst: str) -> None:
    """Raise ValueError if the (src → dst) move isn't a defined edge."""
    if not is_legal_transition(src, dst):
        raise ValueError(f"INVALID_STATE_TRANSITION:{src}->{dst}")


def is_terminal(state: str) -> bool:
    return state in POST_PAYMENT_TERMINAL
