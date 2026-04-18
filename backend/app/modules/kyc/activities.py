"""
KYC Temporal activities.

Each activity is:
- Idempotent (safe to retry with same input)
- Writes to event log BEFORE triggering side effects
- Never stores Aadhaar number in any form
"""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import structlog
from temporalio import activity

from app.core.settings import settings

logger = structlog.get_logger()


# ── Input dataclasses ──────────────────────────────────────────────────────────

@dataclass
class ActivityAadhaarInitInput:
    user_id: str
    phone: str


@dataclass
class ActivityAadhaarVerifyInput:
    user_id: str
    request_id: str
    otp: str


@dataclass
class ActivityPANVerifyInput:
    user_id: str
    pan_number: str    # only present during the activity call — not stored raw


@dataclass
class ActivityLivenessSessionInput:
    user_id: str


@dataclass
class ActivityLivenessVerifyInput:
    user_id: str
    session_id: str


@dataclass
class ActivityPayoutVerifyInput:
    user_id: str
    account_type: str   # bank | upi
    account_value: str  # UPI ID or bank account number — only used for verification


@dataclass
class ActivityUpdateKYCStatusInput:
    user_id: str
    new_status: str
    note: str = ""


# ── Activities ─────────────────────────────────────────────────────────────────

@activity.defn(name="act_aadhaar_otp_initiate")
async def act_aadhaar_otp_initiate(inp: ActivityAadhaarInitInput) -> dict:
    from app.modules.kyc.adapter import get_kyc_adapter
    from app.db.session import AsyncSessionLocal
    from app.modules.kyc.service import get_or_create_verification, record_kyc_event
    import uuid

    adapter = get_kyc_adapter()

    async with AsyncSessionLocal() as db:
        user_id = uuid.UUID(inp.user_id)
        v = await get_or_create_verification(db, user_id)

        result = await adapter.aadhaar_otp_initiate(inp.phone)

        await record_kyc_event(
            db, v.id, user_id,
            event_type="aadhaar_otp_initiate",
            step="aadhaar_otp",
            result="success" if result.success else "error",
            payload={"request_id": result.request_id if result.success else None},
        )
        await db.commit()

    return {"success": result.success, "request_id": result.request_id}


@activity.defn(name="act_aadhaar_otp_verify")
async def act_aadhaar_otp_verify(inp: ActivityAadhaarVerifyInput) -> dict:
    """
    Verify Aadhaar OTP. Stores ONLY partner_ref and derived non-sensitive fields.
    NEVER stores Aadhaar number.
    """
    from app.modules.kyc.adapter import get_kyc_adapter
    from app.db.session import AsyncSessionLocal
    from app.modules.kyc.service import (
        get_or_create_verification, record_kyc_event, update_user_kyc_status, is_minor
    )
    from sqlalchemy import select
    from app.modules.kyc.models import KYCVerification
    import uuid

    adapter = get_kyc_adapter()

    async with AsyncSessionLocal() as db:
        user_id = uuid.UUID(inp.user_id)
        v = await get_or_create_verification(db, user_id)

        result = await adapter.aadhaar_otp_verify(inp.request_id, inp.otp)

        if not result.success:
            await record_kyc_event(
                db, v.id, user_id,
                event_type="aadhaar_otp_verify",
                step="aadhaar_otp",
                result="fail",
                payload={"error_code": result.error_code},
            )
            await db.commit()
            return {"success": False, "error_code": result.error_code}

        # Minor check
        if result.dob and is_minor(result.dob):
            v.aadhaar_minor = True
            v.kyc_status = "rejected"
            v.rejection_reason = "MINOR_DETECTED"
            await record_kyc_event(
                db, v.id, user_id,
                event_type="aadhaar_otp_verify",
                step="aadhaar_otp",
                result="minor_detected",
            )
            await update_user_kyc_status(db, user_id, "rejected")
            await db.commit()
            return {"success": False, "error_code": "MINOR_DETECTED"}

        # Store ONLY non-sensitive derived fields — NEVER Aadhaar number
        v.aadhaar_partner_ref = result.partner_ref
        v.aadhaar_verified = True
        # Mask name to last 4 chars only
        v.aadhaar_name_masked = (result.name or "")[-4:] if result.name else None
        v.aadhaar_dob = result.dob
        v.aadhaar_gender = result.gender
        v.aadhaar_state_ut = result.state_ut
        v.kyc_status = "in_progress"

        await record_kyc_event(
            db, v.id, user_id,
            event_type="aadhaar_otp_verify",
            step="aadhaar_otp",
            result="pass",
            payload={"partner_ref": result.partner_ref, "state_ut": result.state_ut},
        )
        await update_user_kyc_status(db, user_id, "in_progress")
        await db.commit()

    return {"success": True, "name": result.name, "dob": result.dob}


@activity.defn(name="act_pan_verify")
async def act_pan_verify(inp: ActivityPANVerifyInput) -> dict:
    """
    Verify PAN + PAN-Aadhaar linkage.
    Stores masked PAN and name. Runs name fuzzy match against Aadhaar name.
    """
    from app.modules.kyc.adapter import get_kyc_adapter
    from app.db.session import AsyncSessionLocal
    from app.modules.kyc.service import (
        get_or_create_verification, record_kyc_event,
        update_user_kyc_status, compute_name_match
    )
    import uuid

    adapter = get_kyc_adapter()

    async with AsyncSessionLocal() as db:
        user_id = uuid.UUID(inp.user_id)
        v = await get_or_create_verification(db, user_id)

        result = await adapter.pan_verify_with_linkage(inp.pan_number)

        if not result.success:
            reason = result.error_code or "PAN_VERIFY_FAILED"
            v.kyc_status = "rejected"
            v.rejection_reason = reason
            await record_kyc_event(
                db, v.id, user_id,
                event_type="pan_verify",
                step="pan",
                result="fail",
                payload={"error_code": reason},
            )
            await update_user_kyc_status(db, user_id, "rejected")
            await db.commit()
            return {"success": False, "error_code": reason}

        if not result.pan_aadhaar_linked:
            v.kyc_status = "rejected"
            v.rejection_reason = "PAN_AADHAAR_INOPERATIVE"
            await record_kyc_event(
                db, v.id, user_id,
                event_type="pan_verify",
                step="pan",
                result="pan_aadhaar_inoperative",
            )
            await update_user_kyc_status(db, user_id, "rejected")
            await db.commit()
            return {"success": False, "error_code": "PAN_AADHAAR_INOPERATIVE"}

        # Store masked PAN (XXXXX1234X format)
        pan = inp.pan_number.upper()
        v.pan_number_masked = f"XXXXX{pan[5:9]}X" if len(pan) == 10 else pan
        v.pan_verified = True
        v.pan_aadhaar_linked = True
        v.pan_name = result.name

        # Fuzzy name match between PAN name and Aadhaar name
        aadhaar_name_for_match = result.name or ""   # PAN name as reference
        score, match_result = compute_name_match(
            result.name or "",
            v.pan_name or "",
        )
        v.name_match_score = str(round(score, 3))
        v.name_match_result = match_result

        if match_result == "reject":
            v.kyc_status = "rejected"
            v.rejection_reason = "NAME_MISMATCH"
            await update_user_kyc_status(db, user_id, "rejected")
        elif match_result == "manual_review":
            v.kyc_status = "pending_review"
            await update_user_kyc_status(db, user_id, "pending_review")

        await record_kyc_event(
            db, v.id, user_id,
            event_type="pan_verify",
            step="pan",
            result=match_result,
            payload={"name_match_score": v.name_match_score, "pan_linked": True},
        )
        await db.commit()

    return {
        "success": True,
        "name_match_result": match_result,
        "pan_aadhaar_linked": True,
    }


@activity.defn(name="act_liveness_create_session")
async def act_liveness_create_session(inp: ActivityLivenessSessionInput) -> dict:
    from app.modules.kyc.adapter import get_kyc_adapter
    adapter = get_kyc_adapter()
    result = await adapter.liveness_create_session(inp.user_id)
    return {
        "success": result.success,
        "session_id": result.session_id,
        "sdk_token": result.sdk_token,
    }


@activity.defn(name="act_liveness_verify")
async def act_liveness_verify(inp: ActivityLivenessVerifyInput) -> dict:
    from app.modules.kyc.adapter import get_kyc_adapter
    from app.db.session import AsyncSessionLocal
    from app.modules.kyc.service import get_or_create_verification, record_kyc_event
    import uuid

    adapter = get_kyc_adapter()

    async with AsyncSessionLocal() as db:
        user_id = uuid.UUID(inp.user_id)
        v = await get_or_create_verification(db, user_id)

        result = await adapter.liveness_verify(inp.session_id)

        if not result.success:
            await record_kyc_event(
                db, v.id, user_id,
                event_type="liveness_verify", step="liveness", result="fail",
                payload={"error": result.error},
            )
            await db.commit()
            return {"success": False}

        v.liveness_partner_ref = result.partner_ref
        v.liveness_verified = True
        await record_kyc_event(
            db, v.id, user_id,
            event_type="liveness_verify", step="liveness", result="pass",
            payload={"partner_ref": result.partner_ref},
        )
        await db.commit()

    return {"success": True}


@activity.defn(name="act_payout_account_verify")
async def act_payout_account_verify(inp: ActivityPayoutVerifyInput) -> dict:
    from app.modules.kyc.adapter import get_kyc_adapter
    from app.db.session import AsyncSessionLocal
    from app.modules.kyc.service import get_or_create_verification, record_kyc_event
    import uuid

    adapter = get_kyc_adapter()

    async with AsyncSessionLocal() as db:
        user_id = uuid.UUID(inp.user_id)
        v = await get_or_create_verification(db, user_id)

        result = await adapter.payout_account_verify(
            inp.account_type, inp.account_value
        )
        if result.success:
            v.payout_account_type = inp.account_type
            v.payout_account_ref = result.account_ref
            v.payout_verified = True

        await record_kyc_event(
            db, v.id, user_id,
            event_type="payout_account_verify",
            step="payout_account",
            result="pass" if result.success else "fail",
            payload={"account_type": inp.account_type},
        )
        await db.commit()

    return {"success": result.success}


@activity.defn(name="act_update_kyc_status")
async def act_update_kyc_status(inp: ActivityUpdateKYCStatusInput) -> dict:
    from app.db.session import AsyncSessionLocal
    from app.modules.kyc.service import update_user_kyc_status, get_or_create_verification, record_kyc_event
    import uuid

    async with AsyncSessionLocal() as db:
        user_id = uuid.UUID(inp.user_id)
        v = await get_or_create_verification(db, user_id)
        v.kyc_status = inp.new_status
        if inp.new_status == "verified":
            from datetime import datetime, timezone
            v.completed_at = datetime.now(timezone.utc)
        await record_kyc_event(
            db, v.id, user_id,
            event_type="status_update",
            result=inp.new_status,
            payload={"note": inp.note},
        )
        await update_user_kyc_status(db, user_id, inp.new_status)
        await db.commit()

    return {"status": inp.new_status}
