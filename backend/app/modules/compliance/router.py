"""
DPDP Act 2023 compliance endpoints.

Right to erasure: nulls PII columns, preserves audit rows.
Consent log: records explicit consent events.
Data export: provides user their own data.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text

from app.core.dependencies import DBSession
from app.core.dependencies import VerifiedUser

logger = structlog.get_logger()
router = APIRouter(tags=["compliance"])


class ErasureRequest(BaseModel):
    reason: str = "user_requested"
    confirm: bool = False  # must be True to proceed


@router.post("/me/erase", status_code=status.HTTP_202_ACCEPTED)
async def request_data_erasure(
    body: ErasureRequest,
    current_user: VerifiedUser,
    db: DBSession,
):
    """
    DPDP right to erasure.

    What gets erased:
    - User PII: phone_number masked, fcm_token cleared
    - KYC: aadhaar_partner_ref, pan_number_masked, pan_name, liveness_partner_ref cleared
    - Profile: num_kids, kids_age_range cleared

    What is retained (legal obligation):
    - Audit event rows (with PII fields nulled)
    - Transaction records (financial audit, TDS compliance)
    - Dispute records (legal hold)
    - KYC verification decision and timestamp (regulatory requirement)

    Active disputes or transactions block erasure until resolved.
    """
    if not body.confirm:
        return {
            "status": "confirmation_required",
            "message": "Set confirm=true to proceed with data erasure. This cannot be undone.",
            "what_will_be_erased": [
                "Phone number (masked)",
                "FCM push token",
                "Aadhaar KYC partner reference",
                "PAN number (masked version)",
                "Name from PAN/Aadhaar",
                "Liveness partner reference",
                "Kids profile data",
            ],
            "what_will_be_retained": [
                "Transaction records (TDS compliance — 7 years)",
                "Dispute records (legal hold)",
                "KYC verification decision and timestamp",
                "Audit event trail",
            ],
        }

    user_id = current_user.user_id

    # Block erasure if active disputes exist
    dispute_check = await db.execute(text("""
        SELECT COUNT(*) FROM disputes d
        JOIN transactions t ON d.transaction_id = t.id
        WHERE (t.buyer_id = :uid OR t.seller_id = :uid)
        AND d.status NOT IN ('resolved', 'closed')
    """), {"uid": str(user_id)})
    active_disputes = dispute_check.scalar()
    if active_disputes > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "ACTIVE_DISPUTES",
                "message": f"Cannot erase data while {active_disputes} dispute(s) are open. Resolve them first.",
            },
        )

    # Block if active transactions exist
    txn_check = await db.execute(text("""
        SELECT COUNT(*) FROM transactions
        WHERE (buyer_id = :uid OR seller_id = :uid)
        AND status NOT IN ('completed', 'auto_completed', 'cancelled',
                           'refunded', 'cancelled_at_meetup', 'buyer_accepted')
    """), {"uid": str(user_id)})
    active_txns = txn_check.scalar()
    if active_txns > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "ACTIVE_TRANSACTIONS",
                "message": f"Cannot erase data while {active_txns} transaction(s) are in progress.",
            },
        )

    now = datetime.now(timezone.utc)
    erased_fields = []

    # ── Null user PII ────────────────────────────────────────────────────────
    await db.execute(text("""
        UPDATE users SET
            phone_number = 'erased_' || id::text,
            fcm_token = NULL,
            updated_at = :now
        WHERE id = :uid
    """), {"uid": str(user_id), "now": now})
    erased_fields.extend(["phone_number (masked)", "fcm_token"])

    # ── Null KYC PII ─────────────────────────────────────────────────────────
    await db.execute(text("""
        UPDATE kyc_verifications SET
            aadhaar_partner_ref = NULL,
            aadhaar_name_masked = NULL,
            aadhaar_dob = NULL,
            aadhaar_gender = NULL,
            aadhaar_state_ut = NULL,
            pan_number_masked = NULL,
            pan_name = NULL,
            payout_account_ref = NULL,
            liveness_partner_ref = NULL,
            updated_at = :now
        WHERE user_id = :uid
    """), {"uid": str(user_id), "now": now})
    erased_fields.extend(["aadhaar_partner_ref", "pan_number_masked", "pan_name",
                           "liveness_partner_ref", "payout_account_ref"])

    # ── Null profile fields ───────────────────────────────────────────────────
    await db.execute(text("""
        UPDATE users SET num_kids = NULL, kids_age_range = NULL
        WHERE id = :uid
    """), {"uid": str(user_id)})
    erased_fields.extend(["num_kids", "kids_age_range"])

    # ── Record erasure event (audit row, no PII) ──────────────────────────────
    # kyc_events.verification_id is NOT NULL — look it up first
    ver_row = await db.execute(text(
        "SELECT id FROM kyc_verifications WHERE user_id = :uid LIMIT 1"
    ), {"uid": str(user_id)})
    ver_id = ver_row.scalar()
    if ver_id:
        await db.execute(text("""
            INSERT INTO kyc_events
                (id, verification_id, user_id, event_type, step, result, payload, created_at)
            VALUES
                (gen_random_uuid(), :ver_id, :uid, 'dpdp_erasure', 'erasure', 'completed',
                 :payload::jsonb, :now)
        """), {
            "ver_id": str(ver_id),
            "uid": str(user_id),
            "payload": '{"reason": "' + body.reason + '", "fields_erased": ' +
                       str(len(erased_fields)) + '}',
            "now": now,
        })

    await db.commit()

    logger.info("dpdp.erasure_completed",
                user_id=str(user_id),
                fields_erased=len(erased_fields),
                reason=body.reason)

    return {
        "status": "erased",
        "erased_at": now.isoformat(),
        "fields_erased": erased_fields,
        "retained": [
            "Transaction records (TDS compliance)",
            "KYC decision and timestamps",
            "Audit trail",
        ],
        "message": "Your personal data has been erased. "
                   "Some records are retained for legal and tax compliance.",
    }


@router.get("/me/data-export")
async def export_my_data(
    current_user: VerifiedUser,
    db: DBSession,
):
    """
    DPDP right to data portability — export all user data as JSON.
    """
    from app.modules.identity_auth.models import User
    from app.modules.kyc.models import KYCVerification
    from app.modules.offers.models import Offer, Transaction

    user_id = current_user.user_id

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, {"error": "NOT_FOUND"})

    # Listings
    listings_result = await db.execute(text(
        "SELECT id, title, price, status, city, created_at FROM listings WHERE seller_id = :uid"
    ), {"uid": str(user_id)})
    listings = [dict(r._mapping) for r in listings_result]

    # Offers
    offers_result = await db.execute(text(
        "SELECT id, listing_id, offered_price, status, created_at FROM offers WHERE buyer_id = :uid"
    ), {"uid": str(user_id)})
    offers_data = [dict(r._mapping) for r in offers_result]

    # Transactions
    txns_result = await db.execute(text(
        "SELECT id, status, gross_amount, net_payout, created_at FROM transactions WHERE buyer_id = :uid OR seller_id = :uid"
    ), {"uid": str(user_id)})
    txns_data = [dict(r._mapping) for r in txns_result]

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": {
            "phone_number": user.phone_number,
            "tier": user.tier,
            "kyc_status": user.kyc_status,
            "trust_score": user.trust_score,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "listings": [
            {**l, "id": str(l["id"]), "created_at": str(l["created_at"])}
            for l in listings
        ],
        "offers": [
            {**o, "id": str(o["id"]), "listing_id": str(o["listing_id"]),
             "created_at": str(o["created_at"])}
            for o in offers_data
        ],
        "transactions": [
            {**t, "id": str(t["id"]), "created_at": str(t["created_at"])}
            for t in txns_data
        ],
    }
