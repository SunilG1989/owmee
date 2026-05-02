"""Concierge notification templates — master spec sections 5.2 + 7.3 + 8.

Each function wraps `notifications.service.push` with the canonical copy
+ deep-link payload for one notification type.

Why a separate file (rather than calling `push()` inline at the trigger
points): copy iteration. The product owner can rewrite a body string
here without grepping the codebase.

Deep links
----------
The `data` dict carries a `deep_link` key with `screen` + `params`. The
mobile app's notification-tap handler reads this to route the user.
Screen names match the RootStack registration in
`mobile/src/navigation/types.ts`.
"""
from __future__ import annotations

from uuid import UUID

import structlog

from app.modules.notifications.service import push

logger = structlog.get_logger()


# Default specialist info for pilot. Phase 2 supports a real
# specialist_name parameter — falls back to "your Owmee Specialist"
# if the FE row doesn't have a linked user yet.
def _name_or_fallback(name: str | None) -> str:
    return name if name and name.strip() else "your Owmee Specialist"


# ── N1: visit booked (within 60s of POST /v1/fe-visits/request) ──────────
async def notify_visit_booked(*, seller_id: UUID, visit_id: UUID) -> None:
    await push(
        user_id=seller_id,
        event_type="concierge_visit_booked",
        title="✓ Visit booked",
        body=(
            "We're matching you with an Owmee Specialist now. "
            "You'll get a notification once confirmed."
        ),
        data={"deep_link": {"screen": "MyConcierge", "params": {}}},
        entity_type="fe_visit",
        entity_id=str(visit_id),
    )


# ── N2: specialist assigned (admin clicks Assign) ────────────────────────
async def notify_specialist_assigned(
    *,
    seller_id: UUID,
    visit_id: UUID,
    specialist_first_name: str | None = None,
    specialist_last_initial: str | None = None,
    rating: float = 4.8,
    visit_count: int = 0,
) -> None:
    name = _name_or_fallback(specialist_first_name)
    title = f"🚚 {name} is your Owmee Specialist"
    badge = (
        f"{name}{' ' + specialist_last_initial.upper() + '.' if specialist_last_initial else ''}"
        f" · {rating:.1f}★ · {visit_count} visits · Verified by Owmee"
    )
    await push(
        user_id=seller_id,
        event_type="concierge_specialist_assigned",
        title=title,
        body=badge,
        data={"deep_link": {"screen": "VisitDetail", "params": {"visit_id": str(visit_id)}}},
        entity_type="fe_visit",
        entity_id=str(visit_id),
    )


# ── N3: day-before reminder (8pm IST day before) ─────────────────────────
async def notify_day_before(
    *,
    seller_id: UUID,
    visit_id: UUID,
    specialist_first_name: str | None,
    slot_label: str,  # e.g. "tomorrow, 2-4pm"
) -> None:
    name = _name_or_fallback(specialist_first_name)
    body = (
        "Quick prep that helps:\n"
        "• Charge devices to 50%+ if possible\n"
        "• Find original boxes/chargers if you have them\n"
        "• Have ID handy (for verification)\n\n"
        "Don't worry if you can't do all — we'll figure it out."
    )
    await push(
        user_id=seller_id,
        event_type="concierge_day_before",
        title=f"👋 {name} visits {slot_label}",
        body=body,
        data={"deep_link": {"screen": "VisitDetail", "params": {"visit_id": str(visit_id)}}},
        entity_type="fe_visit",
        entity_id=str(visit_id),
    )


# ── N4: specialist on the way (FE taps "Start route") ───────────────────
async def notify_specialist_starting(
    *,
    seller_id: UUID,
    visit_id: UUID,
    specialist_first_name: str | None,
    eta_label: str,  # "Estimated arrival: 2:30pm"
) -> None:
    name = _name_or_fallback(specialist_first_name)
    await push(
        user_id=seller_id,
        event_type="concierge_specialist_starting",
        title=f"📍 {name} is starting his visits",
        body=eta_label,
        data={"deep_link": {"screen": "VisitDetail", "params": {"visit_id": str(visit_id)}}},
        entity_type="fe_visit",
        entity_id=str(visit_id),
    )


# ── N5: arriving in 30 mins ──────────────────────────────────────────────
async def notify_specialist_arriving_soon(
    *,
    seller_id: UUID,
    visit_id: UUID,
    specialist_first_name: str | None,
) -> None:
    name = _name_or_fallback(specialist_first_name)
    await push(
        user_id=seller_id,
        event_type="concierge_specialist_arriving",
        title=f"{name} arriving in 30 mins",
        body="Tap to see verification code →",
        data={"deep_link": {"screen": "VisitDetail", "params": {"visit_id": str(visit_id)}}},
        entity_type="fe_visit",
        entity_id=str(visit_id),
    )


# ── N6: at the door (FE taps "Arrived") ─────────────────────────────────
async def notify_specialist_at_door(
    *,
    seller_id: UUID,
    visit_id: UUID,
    specialist_first_name: str | None,
    arrival_code: str,
) -> None:
    name = _name_or_fallback(specialist_first_name)
    await push(
        user_id=seller_id,
        event_type="concierge_specialist_at_door",
        title=f"👋 {name} is at your door — Code: {arrival_code}",
        body="Tap to verify →",
        data={
            "deep_link": {
                "screen": "ArrivalVerification",
                "params": {"visit_id": str(visit_id)},
            }
        },
        entity_type="fe_visit",
        entity_id=str(visit_id),
    )
