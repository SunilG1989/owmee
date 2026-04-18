"""
Offers router — Epic 4

Endpoints:
  POST /v1/offers                          — make offer (verified)
  GET  /v1/offers/received                 — seller: offers on my listings
  GET  /v1/offers/sent                     — buyer: my offers
  POST /v1/offers/{id}/counter             — seller counters (verified)
  POST /v1/offers/{id}/accept              — seller accepts OR buyer accepts counter (verified)
  POST /v1/offers/{id}/reject              — seller rejects (verified)
  POST /v1/offers/{id}/withdraw            — buyer withdraws (verified)

  GET  /v1/transactions                    — my transactions
  GET  /v1/transactions/{id}               — transaction detail
  POST /v1/transactions/{id}/confirm       — buyer confirms deal (verified)
  POST /v1/transactions/{id}/rate          — submit rating after deal (verified)

  GET  /v1/wishlist                        — my wishlist (basic)
  POST /v1/wishlist/{listing_id}           — add to wishlist (basic)
  DELETE /v1/wishlist/{listing_id}         — remove from wishlist (basic)

  GET  /v1/notifications                   — my notifications (basic)
  POST /v1/notifications/{id}/read         — mark read (basic)

  POST /v1/payments/webhook/razorpay       — Razorpay webhook (no auth)
  GET  /dev/pay/{link_id}                  — dev: simulate payment (dev only)
"""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.core.dependencies import BasicUser, DBSession, VerifiedUser
from app.core.settings import settings
from app.modules.offers.models import (
    NotificationEvent, Offer, PaymentLink, Rating, Transaction, Wishlist,
)
from app.modules.offers.service import (
    accept_offer, add_to_wishlist, buyer_confirm_deal, counter_offer,
    make_offer, process_payment_paid, reject_offer, remove_from_wishlist,
    submit_rating, withdraw_offer,
)
from app.modules.listings.models import Listing

router = APIRouter()
logger = structlog.get_logger()


# ── Schemas ──────────────────────────────────────────────────────────────────────

class MakeOfferRequest(BaseModel):
    listing_id: UUID
    offered_price: Decimal = Field(..., gt=0, le=10000000)


class CounterOfferRequest(BaseModel):
    counter_price: Decimal = Field(..., gt=0, le=10000000)


class RejectOfferRequest(BaseModel):
    reason: str = ""


class RateRequest(BaseModel):
    stars: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=500)


# ── Helpers ───────────────────────────────────────────────────────────────────────

def _fmt_offer(o: Offer) -> dict:
    return {
        "id": str(o.id),
        "listing_id": str(o.listing_id),
        "buyer_id": str(o.buyer_id),
        "seller_id": str(o.seller_id),
        "offered_price": str(o.offered_price),
        "counter_price": str(o.counter_price) if o.counter_price else None,
        "status": o.status,
        "expires_at": o.expires_at.isoformat() if o.expires_at else None,
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }


def _fmt_txn(t: Transaction) -> dict:
    return {
        "id": str(t.id),
        "listing_id": str(t.listing_id),
        "buyer_id": str(t.buyer_id),
        "seller_id": str(t.seller_id),
        "gross_amount": str(t.gross_amount),
        "net_payout": str(t.net_payout),
        "status": t.status,
        "confirmation_deadline": t.confirmation_deadline.isoformat() if t.confirmation_deadline else None,
        "buyer_confirmed_at": t.buyer_confirmed_at.isoformat() if t.buyer_confirmed_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "payout_flagged_at": t.payout_flagged_at.isoformat() if t.payout_flagged_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ── Offer endpoints ───────────────────────────────────────────────────────────────

@router.post("/offers", status_code=status.HTTP_201_CREATED)
async def make_offer_endpoint(body: MakeOfferRequest, current_user: VerifiedUser, db: DBSession):
    try:
        offer = await make_offer(db, body.listing_id, current_user.user_id, body.offered_price)
        await db.commit()
    except ValueError as e:
        code = str(e)
        msgs = {
            "LISTING_NOT_AVAILABLE": "This listing is no longer available.",
            "CANNOT_OFFER_OWN_LISTING": "You cannot make an offer on your own listing.",
            "OFFER_ALREADY_EXISTS": "You already have an active offer on this listing.",
            "INVALID_PRICE": "Offer price must be greater than zero.",
        }
        raise HTTPException(status_code=400, detail={"error": code, "message": msgs.get(code, code)})
    return {"offer": _fmt_offer(offer)}


@router.get("/offers/received")
async def offers_received(current_user: VerifiedUser, db: DBSession,
                          status_filter: str | None = Query(None)):
    q = select(Offer).where(Offer.seller_id == current_user.user_id)
    if status_filter:
        q = q.where(Offer.status == status_filter)
    result = await db.execute(q.order_by(Offer.created_at.desc()))
    offers = result.scalars().all()
    return {"offers": [_fmt_offer(o) for o in offers], "count": len(offers)}


@router.get("/offers/sent")
async def offers_sent(current_user: VerifiedUser, db: DBSession):
    result = await db.execute(
        select(Offer).where(Offer.buyer_id == current_user.user_id)
        .order_by(Offer.created_at.desc())
    )
    offers = result.scalars().all()
    return {"offers": [_fmt_offer(o) for o in offers], "count": len(offers)}


@router.post("/offers/{offer_id}/counter")
async def counter_offer_endpoint(offer_id: UUID, body: CounterOfferRequest,
                                  current_user: VerifiedUser, db: DBSession):
    try:
        offer = await counter_offer(db, offer_id, current_user.user_id, body.counter_price)
        await db.commit()
    except ValueError as e:
        code = str(e)
        if code.startswith("INVALID_STATUS:"):
            raise HTTPException(status_code=400, detail={"error": "INVALID_STATUS"})
        msgs = {
            "OFFER_NOT_FOUND": "Offer not found.",
            "NOT_YOUR_OFFER": "This is not your offer to counter.",
            "COUNTER_MUST_BE_LESS_THAN_OFFER": "Counter price must be less than the buyer's offer.",
        }
        raise HTTPException(status_code=400, detail={"error": code, "message": msgs.get(code, code)})
    return {"offer": _fmt_offer(offer)}


@router.post("/offers/{offer_id}/accept")
async def accept_offer_endpoint(offer_id: UUID, current_user: VerifiedUser, db: DBSession):
    try:
        offer, reservation, transaction, payment_link = await accept_offer(
            db, offer_id, current_user.user_id
        )
        await db.commit()
    except ValueError as e:
        code = str(e).split(":")[0]
        msgs = {
            "OFFER_NOT_FOUND": "Offer not found.",
            "CANNOT_ACCEPT": "You cannot accept this offer.",
            "LISTING_NO_LONGER_AVAILABLE": "The listing is no longer available.",
            "PAYMENT_LINK_FAILED": "Could not create payment link. Please try again.",
        }
        raise HTTPException(status_code=400, detail={"error": code, "message": msgs.get(code, code)})
    return {
        "offer": _fmt_offer(offer),
        "transaction_id": str(transaction.id),
        "payment_link": payment_link.short_url,
        "payment_link_expires_at": payment_link.expires_at.isoformat() if payment_link.expires_at else None,
        "message": "Offer accepted. Payment link sent to buyer.",
    }


@router.post("/offers/{offer_id}/reject")
async def reject_offer_endpoint(offer_id: UUID, body: RejectOfferRequest,
                                 current_user: VerifiedUser, db: DBSession):
    try:
        offer = await reject_offer(db, offer_id, current_user.user_id, body.reason)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})
    return {"offer": _fmt_offer(offer)}


@router.post("/offers/{offer_id}/withdraw")
async def withdraw_offer_endpoint(offer_id: UUID, current_user: VerifiedUser, db: DBSession):
    try:
        offer = await withdraw_offer(db, offer_id, current_user.user_id)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})
    return {"offer": _fmt_offer(offer)}


# ── Transaction endpoints ─────────────────────────────────────────────────────────

@router.get("/transactions")
async def my_transactions(current_user: VerifiedUser, db: DBSession):
    result = await db.execute(
        select(Transaction).where(
            (Transaction.buyer_id == current_user.user_id) |
            (Transaction.seller_id == current_user.user_id)
        ).order_by(Transaction.created_at.desc())
    )
    txns = result.scalars().all()
    return {"transactions": [_fmt_txn(t) for t in txns], "count": len(txns)}


@router.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: UUID, current_user: VerifiedUser, db: DBSession):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})
    if txn.buyer_id != current_user.user_id and txn.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "FORBIDDEN"})

    # Get payment link if exists
    pl_result = await db.execute(
        select(PaymentLink).where(PaymentLink.transaction_id == transaction_id)
        .order_by(PaymentLink.created_at.desc())
    )
    pl = pl_result.scalars().first()

    data = _fmt_txn(txn)
    if pl:
        data["payment_link"] = pl.short_url
        data["payment_link_status"] = pl.status
        data["payment_link_expires_at"] = pl.expires_at.isoformat() if pl.expires_at else None
    return data


@router.post("/transactions/{transaction_id}/confirm")
async def confirm_deal(transaction_id: UUID, current_user: VerifiedUser, db: DBSession):
    try:
        txn = await buyer_confirm_deal(db, transaction_id, current_user.user_id)
        await db.commit()
    except ValueError as e:
        code = str(e).split(":")[0]
        raise HTTPException(status_code=400, detail={"error": code})
    return {
        "transaction_id": str(transaction_id),
        "status": txn.status,
        "message": "Deal confirmed. Please rate your experience.",
        "payout_flagged_at": txn.payout_flagged_at.isoformat() if txn.payout_flagged_at else None,
    }


@router.post("/transactions/{transaction_id}/rate")
async def rate_transaction(transaction_id: UUID, body: RateRequest,
                            current_user: VerifiedUser, db: DBSession):
    try:
        rating = await submit_rating(db, transaction_id, current_user.user_id, body.stars, body.comment)
        await db.commit()
    except ValueError as e:
        msgs = {
            "ALREADY_RATED": "You have already rated this transaction.",
            "DEAL_NOT_COMPLETE": "You can only rate a completed deal.",
            "NOT_YOUR_TRANSACTION": "This is not your transaction.",
            "INVALID_STARS": "Rating must be between 1 and 5 stars.",
        }
        code = str(e)
        raise HTTPException(status_code=400, detail={"error": code, "message": msgs.get(code, code)})
    return {"rating_id": str(rating.id), "stars": rating.stars, "message": "Thank you for your rating."}


# ── Wishlist endpoints ─────────────────────────────────────────────────────────────

@router.get("/wishlist")
async def get_wishlist(current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(Wishlist).where(Wishlist.user_id == current_user.user_id)
        .order_by(Wishlist.created_at.desc())
    )
    items = result.scalars().all()
    return {"wishlist": [{"listing_id": str(w.listing_id), "saved_at": w.created_at.isoformat()} for w in items]}


@router.post("/wishlist/{listing_id}", status_code=status.HTTP_201_CREATED)
async def add_wishlist(listing_id: UUID, current_user: BasicUser, db: DBSession):
    try:
        await add_to_wishlist(db, current_user.user_id, listing_id)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})
    return {"listing_id": str(listing_id), "wishlisted": True}


@router.delete("/wishlist/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_wishlist(listing_id: UUID, current_user: BasicUser, db: DBSession):
    try:
        await remove_from_wishlist(db, current_user.user_id, listing_id)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"error": str(e)})


# ── Notifications ──────────────────────────────────────────────────────────────────

@router.get("/notifications")
async def get_notifications(current_user: BasicUser, db: DBSession,
                             unread_only: bool = Query(False)):
    q = select(NotificationEvent).where(NotificationEvent.user_id == current_user.user_id)
    if unread_only:
        q = q.where(NotificationEvent.is_read == False)
    result = await db.execute(q.order_by(NotificationEvent.created_at.desc()).limit(50))
    items = result.scalars().all()
    return {"notifications": [
        {"id": str(n.id), "type": n.event_type, "title": n.title, "body": n.body,
         "entity_type": n.entity_type, "entity_id": n.entity_id,
         "is_read": n.is_read, "created_at": n.created_at.isoformat()}
        for n in items
    ], "count": len(items)}


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_notification_read(notification_id: UUID, current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(NotificationEvent).where(
            and_(NotificationEvent.id == notification_id,
                 NotificationEvent.user_id == current_user.user_id)
        )
    )
    n = result.scalar_one_or_none()
    if n:
        n.is_read = True
        await db.commit()


# ── Payment webhook ──────────────────────────────────────────────────────────────────

@router.post("/payments/webhook/razorpay", status_code=status.HTTP_200_OK)
async def razorpay_webhook(request: Request, db: DBSession):
    """
    Razorpay fires this when a payment link is paid.
    Must return 200 quickly — heavy work is done synchronously for MVP.
    Idempotent — safe to call multiple times.
    """
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    from app.modules.payments.adapter import get_payment_adapter
    adapter = get_payment_adapter()
    verify = adapter.verify_webhook(body, signature)

    if not verify.valid:
        logger.warning("webhook.invalid_signature")
        return {"status": "ignored"}

    if verify.event == "payment_link.paid":
        import json
        payload = json.loads(body)
        txn = await process_payment_paid(
            db,
            razorpay_link_id=verify.payment_link_id,
            razorpay_payment_id=verify.payment_id,
            webhook_payload=payload,
        )
        if txn:
            await db.commit()

    return {"status": "ok"}


# ── Dev pay simulation ───────────────────────────────────────────────────────────────

@router.get("/dev/pay/{link_id}")
async def dev_pay(link_id: str, db: DBSession):
    """
    DEV ONLY — simulates a buyer paying the payment link.
    Triggers the same webhook processing path as production.
    """
    if settings.env != "development":
        raise HTTPException(status_code=404)

    result = await db.execute(select(PaymentLink).where(PaymentLink.razorpay_link_id == link_id))
    pl = result.scalar_one_or_none()
    if not pl:
        raise HTTPException(status_code=404, detail={"error": "LINK_NOT_FOUND"})
    if pl.status == "paid":
        return {"status": "already_paid", "transaction_id": str(pl.transaction_id)}

    from app.modules.payments.adapter import get_payment_adapter
    adapter = get_payment_adapter()
    payload = adapter.build_dev_paid_webhook(link_id, str(pl.transaction_id))

    import json
    body = json.dumps(payload).encode()
    verify = adapter.verify_webhook(body, "dev_signature")

    if verify.event == "payment_link.paid":
        txn = await process_payment_paid(
            db,
            razorpay_link_id=verify.payment_link_id,
            razorpay_payment_id=verify.payment_id,
            webhook_payload=payload,
        )
        if txn:
            await db.commit()
            return {
                "status": "payment_simulated",
                "transaction_id": str(txn.id),
                "transaction_status": txn.status,
                "message": "Payment confirmed. Buyer can now confirm the deal.",
            }

    return {"status": "error", "message": "Could not simulate payment"}
