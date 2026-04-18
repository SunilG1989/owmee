"""
Phase 2: Shipped transaction flow

Endpoints:
  POST /transactions/{id}/ship              — initiate shipped flow (seller)
  POST /transactions/{id}/pickup-confirm    — logistics confirms pickup + inspection
  POST /transactions/{id}/delivery-confirm  — logistics confirms delivery
  POST /transactions/{id}/accept-delivery   — buyer accepts item
  POST /transactions/{id}/payout-release    — admin/auto releases payout after TDS

State machine:
  payment_captured → shipment_created → picked_up → in_transit
    → delivered → buyer_accepted | disputed → payout_released
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import Column, String, Numeric, Boolean, Text, DateTime, JSON
from sqlalchemy import select, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.core.dependencies import DBSession
from app.core.dependencies import VerifiedUser, require_verified

logger = structlog.get_logger()
router = APIRouter(tags=["shipped"])

# ── TDS constants (India Income Tax Act Section 194-O) ────────────────────────
TDS_THRESHOLD_INR = Decimal("500000")  # ₹5,00,000 per FY
TDS_RATE = Decimal("0.01")             # 1%
PLATFORM_FEE_RATE = Decimal("0.02")    # 2% platform fee
GST_RATE = Decimal("0.18")             # 18% GST on platform fee
BUYER_ACCEPTANCE_WINDOW_HOURS = 48


# ── Schemas ───────────────────────────────────────────────────────────────────

class InitiateShipmentRequest(BaseModel):
    pickup_address: str
    logistics_provider: str = "shiprocket"

class InspectionResult(BaseModel):
    inspection_passed: bool
    inspection_notes: str = ""
    inspection_images: list[str] = []

class DeliveryConfirmRequest(BaseModel):
    tracking_id: str

class AcceptDeliveryRequest(BaseModel):
    accepted: bool
    reason: str = ""  # required if not accepted


# ── TDS computation ───────────────────────────────────────────────────────────

async def compute_tds(db, seller_id: UUID, gross_amount: Decimal, transaction_id: UUID) -> dict:
    """
    Compute TDS 194-O for a payout.
    Returns: tds_amount, net_payout, cumulative_fy_payout, tds_threshold_crossed
    """
    from app.modules.offers.models import Transaction

    # Get current financial year (April-March)
    now = datetime.now(timezone.utc)
    fy_start_year = now.year if now.month >= 4 else now.year - 1
    fy = f"{fy_start_year}-{str(fy_start_year + 1)[-2:]}"

    # Get cumulative payouts this FY for seller (excluding current transaction)
    result = await db.execute(
        select(Transaction).where(
            Transaction.seller_id == seller_id,
            Transaction.status.in_(["completed", "auto_completed", "payout_released"]),
            Transaction.id != transaction_id,
            Transaction.completed_at >= datetime(fy_start_year, 4, 1, tzinfo=timezone.utc),
        )
    )
    prior_txns = result.scalars().all()
    cumulative_prior = sum(Decimal(str(t.net_payout or 0)) for t in prior_txns)

    # Platform fee + GST
    platform_fee = (gross_amount * PLATFORM_FEE_RATE).quantize(Decimal("0.01"))
    gst_on_fee = (platform_fee * GST_RATE).quantize(Decimal("0.01"))
    amount_after_fees = gross_amount - platform_fee - gst_on_fee

    # TDS computation
    cumulative_with_current = cumulative_prior + amount_after_fees
    tds_threshold_crossed = cumulative_with_current > TDS_THRESHOLD_INR

    if not tds_threshold_crossed:
        tds_amount = Decimal("0")
    elif cumulative_prior >= TDS_THRESHOLD_INR:
        # Already over threshold — TDS on full amount
        tds_amount = (amount_after_fees * TDS_RATE).quantize(Decimal("0.01"))
    else:
        # Crossing threshold this payout — TDS on excess only
        excess = cumulative_with_current - TDS_THRESHOLD_INR
        tds_amount = (excess * TDS_RATE).quantize(Decimal("0.01"))

    net_payout = amount_after_fees - tds_amount

    return {
        "financial_year": fy,
        "gross_amount": gross_amount,
        "platform_fee": platform_fee,
        "gst_on_fee": gst_on_fee,
        "tds_amount": tds_amount,
        "tds_rate": float(TDS_RATE),
        "net_payout": net_payout,
        "cumulative_fy_payout": cumulative_with_current,
        "tds_threshold_crossed": tds_threshold_crossed,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/transactions/{transaction_id}/ship")
async def initiate_shipment(
    transaction_id: UUID,
    body: InitiateShipmentRequest,
    current_user: VerifiedUser,
    db: DBSession,
):
    """Seller initiates shipped flow after payment is captured."""
    from app.modules.offers.models import Transaction
    from app.modules.listings.models import Listing

    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.seller_id != current_user.user_id:
        raise HTTPException(403, {"error": "FORBIDDEN"})
    if txn.status != "payment_captured":
        raise HTTPException(400, {"error": "INVALID_STATUS", "message": f"Transaction is {txn.status}"})

    # Verify category is shipping_eligible
    listing_result = await db.execute(select(Listing).where(Listing.id == txn.listing_id))
    listing = listing_result.scalar_one_or_none()
    if not listing:
        raise HTTPException(404, {"error": "LISTING_NOT_FOUND"})

    from app.modules.listings.models import Category
    cat_result = await db.execute(select(Category).where(Category.id == listing.category_id))
    category = cat_result.scalar_one_or_none()
    if category and not category.shipping_eligible:
        raise HTTPException(400, {"error": "CATEGORY_NOT_SHIPPABLE",
                                   "message": "This category only supports local meetup transactions."})

    # Create shipment record
    from sqlalchemy import text
    now = datetime.now(timezone.utc)

    await db.execute(text("""
        INSERT INTO shipments (id, transaction_id, status, logistics_provider,
            pickup_address, gross_amount, created_at, updated_at)
        VALUES (gen_random_uuid(), :txn_id, 'pending', :provider,
            :pickup_address, :gross_amount, now(), now())
    """), {
        "txn_id": str(transaction_id),
        "provider": body.logistics_provider,
        "pickup_address": body.pickup_address,
        "gross_amount": str(txn.gross_amount or 0),
    })

    txn.status = "shipment_created"
    txn.transaction_type = "shipped"
    await db.commit()

    logger.info("shipment.initiated", transaction_id=str(transaction_id))
    return {
        "transaction_id": str(transaction_id),
        "status": "shipment_created",
        "message": "Shipment initiated. Logistics partner will contact you for pickup.",
        "logistics_provider": body.logistics_provider,
    }


@router.post("/transactions/{transaction_id}/pickup-confirm")
async def confirm_pickup(
    transaction_id: UUID,
    body: InspectionResult,
    current_user: VerifiedUser,
    db: DBSession,
):
    """
    Logistics/admin confirms pickup with inspection result.
    If inspection fails, payout is paused and routed to ops review.
    """
    from app.modules.offers.models import Transaction
    from sqlalchemy import text, update

    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.status != "shipment_created":
        raise HTTPException(400, {"error": "INVALID_STATUS"})

    now = datetime.now(timezone.utc)

    # Update shipment
    await db.execute(text("""
        UPDATE shipments SET
            inspection_passed = :passed,
            inspection_notes = :notes,
            inspection_images = :images,
            picked_up_at = :now,
            status = :status,
            updated_at = now()
        WHERE transaction_id = :txn_id
    """), {
        "passed": body.inspection_passed,
        "notes": body.inspection_notes,
        "images": str(body.inspection_images),
        "now": now,
        "status": "picked_up" if body.inspection_passed else "inspection_failed",
        "txn_id": str(transaction_id),
    })

    if not body.inspection_passed:
        txn.status = "inspection_failed"
        await db.commit()
        return {
            "transaction_id": str(transaction_id),
            "status": "inspection_failed",
            "message": "Inspection failed. Routed to ops review.",
        }

    txn.status = "in_transit"
    await db.commit()

    logger.info("shipment.picked_up", transaction_id=str(transaction_id),
                inspection_passed=body.inspection_passed)
    return {
        "transaction_id": str(transaction_id),
        "status": "in_transit",
        "message": "Item picked up and in transit to buyer.",
    }


@router.post("/transactions/{transaction_id}/delivery-confirm")
async def confirm_delivery(
    transaction_id: UUID,
    body: DeliveryConfirmRequest,
    current_user: VerifiedUser,
    db: DBSession,
):
    """Logistics confirms delivery. Starts 48h buyer acceptance window."""
    from app.modules.offers.models import Transaction
    from sqlalchemy import text

    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.status != "in_transit":
        raise HTTPException(400, {"error": "INVALID_STATUS"})

    now = datetime.now(timezone.utc)
    acceptance_deadline = now + timedelta(hours=BUYER_ACCEPTANCE_WINDOW_HOURS)

    await db.execute(text("""
        UPDATE shipments SET
            tracking_id = :tracking_id,
            delivered_at = :now,
            dispute_deadline = :deadline,
            status = 'delivered',
            updated_at = now()
        WHERE transaction_id = :txn_id
    """), {
        "tracking_id": body.tracking_id,
        "now": now,
        "deadline": acceptance_deadline,
        "txn_id": str(transaction_id),
    })

    txn.status = "delivered"
    txn.buyer_acceptance_deadline = acceptance_deadline
    await db.commit()

    logger.info("shipment.delivered", transaction_id=str(transaction_id))
    return {
        "transaction_id": str(transaction_id),
        "status": "delivered",
        "buyer_acceptance_deadline": acceptance_deadline.isoformat(),
        "message": f"Delivered. Buyer has {BUYER_ACCEPTANCE_WINDOW_HOURS}h to accept or raise a dispute.",
    }


@router.post("/transactions/{transaction_id}/accept-delivery")
async def accept_delivery(
    transaction_id: UUID,
    body: AcceptDeliveryRequest,
    current_user: VerifiedUser,
    db: DBSession,
):
    """Buyer accepts or disputes delivery. Triggers TDS-aware payout on acceptance."""
    from app.modules.offers.models import Transaction
    from sqlalchemy import text

    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.buyer_id != current_user.user_id:
        raise HTTPException(403, {"error": "FORBIDDEN"})
    if txn.status != "delivered":
        raise HTTPException(400, {"error": "INVALID_STATUS",
                                   "message": f"Cannot accept delivery in status {txn.status}"})

    now = datetime.now(timezone.utc)

    if not body.accepted:
        # Open dispute
        txn.status = "disputed"
        await db.execute(text("""
            UPDATE shipments SET status = 'disputed', updated_at = now()
            WHERE transaction_id = :txn_id
        """), {"txn_id": str(transaction_id)})
        await db.commit()
        return {
            "transaction_id": str(transaction_id),
            "status": "disputed",
            "message": "Dispute opened. Our team will review within 48 hours.",
        }

    # Buyer accepted — compute TDS and flag payout
    tds_result = await compute_tds(
        db,
        txn.seller_id,
        Decimal(str(txn.gross_amount or 0)),
        transaction_id,
    )

    txn.status = "buyer_accepted"
    txn.tds_withheld = tds_result["tds_amount"]
    txn.platform_fee = tds_result["platform_fee"]
    txn.gst_on_fee = tds_result["gst_on_fee"]
    txn.net_payout = tds_result["net_payout"]
    txn.payout_flagged_at = now
    txn.buyer_confirmed_at = now

    await db.execute(text("""
        UPDATE shipments SET
            buyer_accepted_at = :now,
            payout_eligible_at = :now,
            tds_withheld = :tds,
            platform_fee = :fee,
            gst_on_fee = :gst,
            net_payout = :net,
            status = 'buyer_accepted',
            updated_at = now()
        WHERE transaction_id = :txn_id
    """), {
        "now": now,
        "tds": str(tds_result["tds_amount"]),
        "fee": str(tds_result["platform_fee"]),
        "gst": str(tds_result["gst_on_fee"]),
        "net": str(tds_result["net_payout"]),
        "txn_id": str(transaction_id),
    })

    await db.commit()
    logger.info("shipment.buyer_accepted", transaction_id=str(transaction_id),
                net_payout=str(tds_result["net_payout"]),
                tds=str(tds_result["tds_amount"]))

    return {
        "transaction_id": str(transaction_id),
        "status": "buyer_accepted",
        "payout_breakdown": {
            "gross_amount": str(tds_result["gross_amount"]),
            "platform_fee": str(tds_result["platform_fee"]),
            "gst_on_fee": str(tds_result["gst_on_fee"]),
            "tds_withheld": str(tds_result["tds_amount"]),
            "net_payout": str(tds_result["net_payout"]),
            "financial_year": tds_result["financial_year"],
            "tds_threshold_crossed": tds_result["tds_threshold_crossed"],
        },
        "message": "Delivery accepted. Payout will be released within 24 hours.",
    }


@router.get("/transactions/{transaction_id}/shipment")
async def get_shipment(
    transaction_id: UUID,
    current_user: VerifiedUser,
    db: DBSession,
):
    """Get shipment details for a transaction."""
    from app.modules.offers.models import Transaction
    from sqlalchemy import text

    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(404, {"error": "NOT_FOUND"})
    if txn.buyer_id != current_user.user_id and txn.seller_id != current_user.user_id:
        raise HTTPException(403, {"error": "FORBIDDEN"})

    shipment_result = await db.execute(
        text("SELECT * FROM shipments WHERE transaction_id = :txn_id ORDER BY created_at DESC LIMIT 1"),
        {"txn_id": str(transaction_id)}
    )
    row = shipment_result.mappings().first()
    if not row:
        raise HTTPException(404, {"error": "SHIPMENT_NOT_FOUND"})

    return dict(row)
