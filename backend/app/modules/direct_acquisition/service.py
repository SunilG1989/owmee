from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable


SUPPORTED_DIRECT_CATEGORIES = {"toys", "books"}
OTP_MAX_ATTEMPTS = 5

BOOKING_TERMINAL_STATUSES = {
    "seller_cancelled_before_visit",
    "seller_no_show",
    "fe_no_show",
    "item_rejected_by_fe",
    "seller_rejected_revised_offer",
    "payout_failed",
    "admin_cancelled",
    "fraud_review",
    "booking_completed",
}


class DirectAcquisitionError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def new_booking_code() -> str:
    return f"OD-{secrets.randbelow(900000) + 100000}"


def new_seller_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000}"


def hash_otp(otp: str) -> str:
    return hashlib.sha256(otp.encode("utf-8")).hexdigest()


def verify_otp(raw_otp: str, otp_hash: str) -> bool:
    return hash_otp(raw_otp.strip()) == otp_hash


def otp_expires_at(slot_end: datetime, *, now: datetime | None = None) -> datetime:
    """Visit codes are generated ahead of pickup, so keep them valid through the visit window."""
    base = slot_end if slot_end.tzinfo else slot_end.replace(tzinfo=timezone.utc)
    floor = (now or datetime.now(timezone.utc)) + timedelta(minutes=30)
    return max(base + timedelta(hours=6), floor)


def compute_change_percent(base_offer_inr: int, requested_offer_inr: int) -> Decimal:
    if base_offer_inr <= 0:
        raise DirectAcquisitionError("INVALID_BASE_OFFER", "Base offer must be greater than zero.")
    delta = Decimal(requested_offer_inr - base_offer_inr) * Decimal(100)
    return (delta / Decimal(base_offer_inr)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def requires_price_approval(
    *,
    base_offer_inr: int,
    requested_offer_inr: int,
    max_auto_increase_percent: Decimal | int | float | str = Decimal("10.00"),
) -> bool:
    change = compute_change_percent(base_offer_inr, requested_offer_inr)
    return change > Decimal(str(max_auto_increase_percent))


def assert_booking_assignable(booking) -> None:
    missing: list[str] = []
    if not getattr(booking, "seller_user_id", None):
        missing.append("seller_user_id")
    if not getattr(booking, "seller_account_id", None):
        missing.append("seller_account_id")
    if not getattr(booking, "pickup_address_id", None):
        missing.append("pickup_address_id")
    if not getattr(booking, "pickup_locality", None):
        missing.append("pickup_locality")
    if not getattr(booking, "pickup_pincode", None):
        missing.append("pickup_pincode")
    if not getattr(booking, "slot_start", None) or not getattr(booking, "slot_end", None):
        missing.append("slot")
    if not getattr(booking, "seller_phone_verified", False):
        missing.append("seller_phone_verified")
    if not getattr(booking, "seller_ownership_declaration", False):
        missing.append("seller_ownership_declaration")
    if not getattr(booking, "serviceable_area", False):
        missing.append("serviceable_area")
    items = list(getattr(booking, "items", []) or [])
    if not items:
        missing.append("acquisition_items")
    for item in items:
        if getattr(item, "category", None) not in SUPPORTED_DIRECT_CATEGORIES:
            missing.append(f"unsupported_category:{getattr(item, 'category', None)}")
        if not getattr(item, "seller_photos", None):
            missing.append(f"item_photos:{getattr(item, 'id', 'unknown')}")
        if getattr(item, "policy_status", "allowed") == "blocked":
            missing.append(f"policy_blocked:{getattr(item, 'id', 'unknown')}")
        if getattr(item, "direct_eligibility_status", "eligible") != "eligible":
            missing.append(f"direct_eligibility:{getattr(item, 'id', 'unknown')}")
        if not getattr(item, "qc_checklist_template_id", None):
            missing.append(f"qc_template:{getattr(item, 'id', 'unknown')}")
    if missing:
        raise DirectAcquisitionError(
            "BOOKING_NOT_ASSIGNABLE",
            f"Booking cannot be assigned. Missing or blocked: {', '.join(dict.fromkeys(missing))}",
        )


def assert_can_start_booking(booking, fe_id) -> None:
    if getattr(booking, "status", None) != "assigned_to_fe":
        raise DirectAcquisitionError("BOOKING_NOT_ASSIGNED", "Booking must be assigned before FE can start.")
    if getattr(booking, "assigned_fe_id", None) != fe_id:
        raise DirectAcquisitionError("NOT_YOUR_BOOKING", "This booking is assigned to another FE.")


def assert_seller_verified(booking) -> None:
    if getattr(booking, "status", None) not in {"seller_verified", "pickup_qc_in_progress"}:
        raise DirectAcquisitionError("SELLER_NOT_VERIFIED", "Verify seller OTP/QR before QC or payout.")


def assert_otp_attempt_allowed(*, attempts: int, expires_at: datetime | None, purpose: str) -> None:
    if attempts >= OTP_MAX_ATTEMPTS:
        raise DirectAcquisitionError("OTP_ATTEMPTS_EXCEEDED", f"{purpose} OTP has too many failed attempts.")
    if expires_at:
        expiry = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        if expiry < datetime.now(timezone.utc):
            raise DirectAcquisitionError("OTP_EXPIRED", f"{purpose} OTP has expired.")


def assert_item_can_be_qced(booking, item) -> None:
    assert_seller_verified(booking)
    if getattr(item, "item_status", None) in {"rejected", "acquired", "warehouse_inbound"}:
        raise DirectAcquisitionError("ITEM_CLOSED", "This item can no longer be changed.")


def assert_final_acceptance_allowed(booking) -> None:
    if getattr(booking, "status", None) != "pickup_qc_in_progress":
        raise DirectAcquisitionError(
            "FINAL_ACCEPTANCE_NOT_READY",
            "Seller final acceptance is allowed only after FE QC is complete.",
        )
    items = list(getattr(booking, "items", []) or [])
    unresolved = [
        i for i in items
        if getattr(i, "item_status", None) in {"pending_qc", "approval_pending"}
    ]
    if unresolved:
        raise DirectAcquisitionError(
            "UNRESOLVED_ITEMS",
            "Every manifest item must be accepted, revised, rejected, or resolved before seller acceptance.",
        )
    payable_items = [i for i in items if getattr(i, "item_status", None) in {"qc_passed", "qc_revised"}]
    if not payable_items:
        raise DirectAcquisitionError("NO_PAYABLE_ITEMS", "At least one item must pass QC before seller acceptance.")
    pending = [
        i for i in payable_items
        if getattr(i, "approval_required", False) and getattr(i, "approval_status", None) != "approved"
    ]
    if pending:
        raise DirectAcquisitionError("PRICE_APPROVAL_PENDING", "Resolve all required price approvals before seller acceptance.")
    for item in payable_items:
        assert_required_pickup_evidence(item)


def assert_required_pickup_evidence(item) -> None:
    photos = list(getattr(item, "pickup_photos", []) or [])
    required = list(getattr(item, "required_pickup_photos", []) or [])
    min_photos = max(1, len(required))
    if len(photos) < min_photos:
        raise DirectAcquisitionError(
            "PICKUP_PHOTOS_REQUIRED",
            f"Pickup evidence photos are required before QC. Need at least {min_photos}.",
        )


def assert_reject_evidence(evidence_photos: Iterable[str], item=None) -> None:
    combined = list(evidence_photos or [])
    if item is not None:
        combined.extend(list(getattr(item, "pickup_photos", []) or []))
    if not combined:
        raise DirectAcquisitionError(
            "EVIDENCE_PHOTO_REQUIRED",
            "Rejected items require pickup evidence photos.",
        )


def assert_price_revision_evidence(evidence_photos: Iterable[str]) -> None:
    if not list(evidence_photos or []):
        raise DirectAcquisitionError(
            "EVIDENCE_PHOTO_REQUIRED",
            "Price revision requires pickup evidence photos.",
        )


def final_payout_total(items: Iterable) -> int:
    total = 0
    for item in items:
        if getattr(item, "item_status", None) in {"qc_passed", "qc_revised"}:
            total += int(getattr(item, "fe_final_offer_inr", None) or getattr(item, "owmee_suggested_offer_inr", 0))
    return total


def _assert_positive_final_payout(booking) -> None:
    if not getattr(booking, "seller_final_accepted_at", None):
        raise DirectAcquisitionError("SELLER_FINAL_ACCEPTANCE_REQUIRED", "Seller final acceptance timestamp is missing.")
    if int(getattr(booking, "final_total_payout_inr", 0) or 0) <= 0:
        raise DirectAcquisitionError("INVALID_PAYOUT_AMOUNT", "Final payout must be greater than zero.")


def assert_payout_request_allowed(booking) -> None:
    if getattr(booking, "status", None) != "seller_final_acceptance":
        raise DirectAcquisitionError("SELLER_FINAL_ACCEPTANCE_REQUIRED", "Seller final acceptance is required before payout.")
    _assert_positive_final_payout(booking)


def assert_payout_process_allowed(booking) -> None:
    if getattr(booking, "status", None) != "payout_ready":
        raise DirectAcquisitionError("PAYOUT_NOT_READY", "FE must submit payout-ready before Finance can process payout.")
    if not getattr(booking, "payout_ready_at", None):
        raise DirectAcquisitionError("PAYOUT_NOT_READY", "Payout-ready timestamp is missing.")
    _assert_positive_final_payout(booking)


def assert_payout_allowed(booking) -> None:
    assert_payout_process_allowed(booking)


def assert_warehouse_receive_allowed(booking) -> None:
    if getattr(booking, "status", None) != "payout_completed":
        raise DirectAcquisitionError("PAYOUT_NOT_COMPLETED", "Complete seller payout ledger before handover.")
    if not getattr(booking, "payout_completed_at", None):
        raise DirectAcquisitionError("PAYOUT_NOT_COMPLETED", "Payout completion timestamp is missing.")


def assert_handover_allowed(booking) -> None:
    assert_warehouse_receive_allowed(booking)


def default_offer_valid_until(now: datetime | None = None) -> datetime:
    return (now or datetime.now(timezone.utc)) + timedelta(hours=24)
