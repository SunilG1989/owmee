"""
Offers router — Owmee V1 (escrow + managed logistics, no meetups, no cash)

Key endpoints:
  POST /v1/offers                          — create offer
  POST /v1/offers/{id}/update-price        — buyer revises (max 3 times)
  POST /v1/offers/{id}/counter             — seller counters (48h window)
  POST /v1/offers/{id}/accept              — accept (creates txn + payment link)
  POST /v1/offers/{id}/reject              — reject (sets 7-day cooldown)
  POST /v1/offers/{id}/withdraw            — buyer withdraws their own offer
  GET  /v1/users/me/reputation             — seller reputation ladder
  PUT  /v1/notifications/preferences       — notification bucket preferences
  GET  /v1/listings/activity               — activity ticker for home screen
  POST /v1/listings/{id}/mark-sold         — sold on owmee or sold elsewhere
  PUT  /v1/listings/{id}/price             — update price (triggers wishlist notifications)

Removed (Sprint 6c — no-meetup mandate):
  /accept-cash, /transactions/{id}/meetup, /transactions/{id}/cancel-meetup.
  Buyer-seller meetups don't exist; logistics is fully managed.
"""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select

from app.core.dependencies import BasicUser, DBSession
from app.core.rate_limit import OFFER_CREATE_PER_USER, limit_by_user
from app.core.settings import settings
from app.modules.offers.models import (
    NotificationEvent, NotificationPreference, Offer, PaymentLink,
    Rating, Transaction, Wishlist,
)
from app.modules.offers.service import (
    accept_offer, add_to_wishlist, buyer_confirm_deal,
    counter_offer, make_offer,
    notify_price_drop, process_payment_paid, reject_offer,
    remove_from_wishlist, submit_rating, update_offer_price, withdraw_offer,
)
from app.modules.listings.models import Listing

router = APIRouter()
logger = structlog.get_logger()


# ── Schemas ────────────────────────────────────────────────────────────────────

class MakeOfferRequest(BaseModel):
    listing_id: UUID
    offered_price: Decimal = Field(..., gt=0, le=10000000)
    offer_note: str | None = Field(None, max_length=200)


class CounterOfferRequest(BaseModel):
    counter_price: Decimal = Field(..., gt=0, le=10000000)


class RejectOfferRequest(BaseModel):
    reason: str = ""


# Sprint 6b — buyer revises their offer price (capped at 3 revisions).
class UpdateOfferPriceRequest(BaseModel):
    new_price: Decimal = Field(..., gt=0, le=10000000)


class RateRequest(BaseModel):
    stars: int = Field(..., ge=1, le=5)
    comment: str | None = Field(None, max_length=500)
    item_as_described: str | None = Field(None, pattern="^(yes|mostly|no)$")


class NotificationPreferencesRequest(BaseModel):
    transactions_enabled: bool = True   # Cannot truly disable but kept for completeness
    messages_enabled: bool = True
    promotions_enabled: bool = False


class MarkSoldRequest(BaseModel):
    sold_where: str = Field(..., pattern="^(on_owmee|elsewhere)$")


class UpdatePriceRequest(BaseModel):
    new_price: Decimal = Field(..., gt=0, le=10000000)


# ── Formatters ─────────────────────────────────────────────────────────────────

def _fmt_offer(o: Offer) -> dict:
    return {
        "id": str(o.id),
        "listing_id": str(o.listing_id),
        "buyer_id": str(o.buyer_id),
        "seller_id": str(o.seller_id),
        "offered_price": str(o.offered_price),
        "counter_price": str(o.counter_price) if o.counter_price else None,
        "offer_note": o.offer_note,
        "status": o.status,
        "expires_at": o.expires_at.isoformat() if o.expires_at else None,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        # Sprint 6b — offer v2 mechanics surfaced so mobile can disable
        # the update-price button at 3 and show the counter countdown.
        "update_count": o.update_count,
        "updates_remaining": max(0, 3 - o.update_count),
        "counter_expires_at": o.counter_expires_at.isoformat() if o.counter_expires_at else None,
        "lockout_until": o.lockout_until.isoformat() if o.lockout_until else None,
    }


def _fmt_txn(t: Transaction) -> dict:
    return {
        "id": str(t.id),
        "listing_id": str(t.listing_id),
        "buyer_id": str(t.buyer_id),
        "seller_id": str(t.seller_id),
        "gross_amount": str(t.gross_amount),
        "net_payout": str(t.net_payout),
        "payment_method": t.payment_method,
        "status": t.status,
        "agreed_meetup_at": t.agreed_meetup_at.isoformat() if t.agreed_meetup_at else None,
        "meetup_deadline": t.meetup_deadline.isoformat() if t.meetup_deadline else None,
        "seller_response_deadline": t.seller_response_deadline.isoformat() if t.seller_response_deadline else None,
        "rate_available_at": t.rate_available_at.isoformat() if t.rate_available_at else None,
        "confirmation_deadline": t.confirmation_deadline.isoformat() if t.confirmation_deadline else None,
        "buyer_confirmed_at": t.buyer_confirmed_at.isoformat() if t.buyer_confirmed_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "payout_flagged_at": t.payout_flagged_at.isoformat() if t.payout_flagged_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ── Offer endpoints ─────────────────────────────────────────────────────────────

@router.post(
    "/offers",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_by_user("offer_create", OFFER_CREATE_PER_USER))],
)
async def make_offer_endpoint(body: MakeOfferRequest, current_user: BasicUser, db: DBSession):
    try:
        offer = await make_offer(db, body.listing_id, current_user.user_id,
                                  body.offered_price, body.offer_note)
        await db.commit()
    except ValueError as e:
        code = str(e)
        msgs = {
            "LISTING_NOT_AVAILABLE": "This listing is no longer available.",
            "CANNOT_OFFER_OWN_LISTING": "You cannot make an offer on your own listing.",
            "OFFER_ALREADY_EXISTS": "You already have an active offer on this listing. Update your existing offer instead.",
            "INVALID_PRICE": "Offer price must be greater than zero.",
            "LOCKOUT_ACTIVE": "Your last offer on this listing was rejected. You can offer again in 7 days.",
        }
        # Sprint 6b: 409 Conflict for LOCKOUT_ACTIVE / OFFER_ALREADY_EXISTS so
        # the mobile client can branch (steer the buyer to the existing offer
        # or surface the cooldown). Other validation errors stay 400.
        status_code = 409 if code in ("OFFER_ALREADY_EXISTS", "LOCKOUT_ACTIVE") else 400
        raise HTTPException(status_code=status_code, detail={"error": code, "message": msgs.get(code, code)})
    return {"offer": _fmt_offer(offer)}


@router.post("/offers/{offer_id}/update-price")
async def update_offer_price_endpoint(
    offer_id: UUID,
    body: UpdateOfferPriceRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Sprint 6b — buyer revises the price on their existing offer.
    Capped at 3 revisions; afterwards the offer is locked and seller must respond."""
    try:
        offer = await update_offer_price(db, offer_id, current_user.user_id, body.new_price)
        await db.commit()
    except ValueError as e:
        code = str(e)
        msgs = {
            "OFFER_NOT_FOUND": "Offer not found or not yours.",
            "UPDATE_LIMIT_REACHED": "You've used all 3 price updates. Wait for the seller to respond.",
            "INVALID_PRICE": "New price must be greater than zero.",
        }
        if code.startswith("INVALID_STATUS:"):
            raise HTTPException(status_code=409, detail={
                "error": "INVALID_STATUS",
                "message": "This offer can no longer be updated.",
            })
        status_code = 404 if code == "OFFER_NOT_FOUND" else (409 if code == "UPDATE_LIMIT_REACHED" else 400)
        raise HTTPException(status_code=status_code, detail={"error": code, "message": msgs.get(code, code)})
    return {"offer": _fmt_offer(offer)}


@router.get("/offers/received")
async def offers_received(current_user: BasicUser, db: DBSession,
                          status_filter: str | None = Query(None)):
    q = select(Offer).where(Offer.seller_id == current_user.user_id)
    if status_filter:
        q = q.where(Offer.status == status_filter)
    result = await db.execute(q.order_by(Offer.created_at.desc()))
    return {"offers": [_fmt_offer(o) for o in result.scalars().all()]}


@router.get("/offers/sent")
async def offers_sent(current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(Offer).where(Offer.buyer_id == current_user.user_id).order_by(Offer.created_at.desc())
    )
    return {"offers": [_fmt_offer(o) for o in result.scalars().all()]}


@router.post("/offers/{offer_id}/counter")
async def counter_offer_endpoint(offer_id: UUID, body: CounterOfferRequest,
                                  current_user: BasicUser, db: DBSession):
    try:
        offer = await counter_offer(db, offer_id, current_user.user_id, body.counter_price)
        await db.commit()
    except ValueError as e:
        code = str(e)
        if code.startswith("INVALID_STATUS:"):
            raise HTTPException(status_code=400, detail={"error": "INVALID_STATUS"})
        raise HTTPException(status_code=400, detail={"error": code})
    return {"offer": _fmt_offer(offer)}


@router.post("/offers/{offer_id}/accept")
async def accept_offer_endpoint(offer_id: UUID, current_user: BasicUser, db: DBSession):
    try:
        offer, reservation, txn, payment_link = await accept_offer(db, offer_id, current_user.user_id)
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
    resp = {
        "offer": _fmt_offer(offer),
        "transaction_id": str(txn.id),
        "payment_method": txn.payment_method,
        "message": "Offer accepted.",
    }
    if payment_link:
        resp["payment_link"] = payment_link.short_url
        resp["payment_link_expires_at"] = payment_link.expires_at.isoformat() if payment_link.expires_at else None
    return resp


@router.post("/offers/{offer_id}/reject")
async def reject_offer_endpoint(offer_id: UUID, body: RejectOfferRequest,
                                 current_user: BasicUser, db: DBSession):
    try:
        offer = await reject_offer(db, offer_id, current_user.user_id, body.reason)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})
    return {"offer": _fmt_offer(offer)}


@router.post("/offers/{offer_id}/withdraw")
async def withdraw_offer_endpoint(offer_id: UUID, current_user: BasicUser, db: DBSession):
    try:
        offer = await withdraw_offer(db, offer_id, current_user.user_id)
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})
    return {"offer": _fmt_offer(offer)}


# ── Transaction endpoints ───────────────────────────────────────────────────────

@router.get("/transactions")
async def my_transactions(current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(Transaction).where(
            (Transaction.buyer_id == current_user.user_id) |
            (Transaction.seller_id == current_user.user_id)
        ).order_by(Transaction.created_at.desc())
    )
    return {"transactions": [_fmt_txn(t) for t in result.scalars().all()]}


@router.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: UUID, current_user: BasicUser, db: DBSession):
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND"})
    if txn.buyer_id != current_user.user_id and txn.seller_id != current_user.user_id:
        raise HTTPException(status_code=403, detail={"error": "FORBIDDEN"})
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
async def confirm_deal(transaction_id: UUID, current_user: BasicUser, db: DBSession):
    try:
        txn = await buyer_confirm_deal(db, transaction_id, current_user.user_id)
        await db.commit()
    except ValueError as e:
        code = str(e).split(":")[0]
        raise HTTPException(status_code=400, detail={"error": code})
    return {
        "transaction_id": str(transaction_id),
        "status": txn.status,
        "rate_available_at": txn.rate_available_at.isoformat() if txn.rate_available_at else None,
        "message": "Deal confirmed. You can rate in 2 hours.",
        "payout_flagged_at": txn.payout_flagged_at.isoformat() if txn.payout_flagged_at else None,
    }


@router.post("/transactions/{transaction_id}/rate")
async def rate_transaction(transaction_id: UUID, body: RateRequest,
                            current_user: BasicUser, db: DBSession):
    try:
        rating = await submit_rating(db, transaction_id, current_user.user_id,
                                      body.stars, body.comment, body.item_as_described)
        await db.commit()
    except ValueError as e:
        msgs = {
            "ALREADY_RATED": "You have already rated this transaction.",
            "DEAL_NOT_COMPLETE": "You can only rate a completed deal.",
            "NOT_YOUR_TRANSACTION": "This is not your transaction.",
            "INVALID_STARS": "Rating must be between 1 and 5 stars.",
            "RATING_NOT_YET_AVAILABLE": "Rating opens 2 hours after deal confirmation — giving both parties time to reflect.",
        }
        code = str(e)
        raise HTTPException(status_code=400, detail={"error": code, "message": msgs.get(code, code)})
    return {
        "rating_id": str(rating.id),
        "stars": rating.stars,
        "revealed": bool(rating.revealed_at),
        "message": "Rating submitted. It will be revealed when your counterpart also rates, or after 7 days.",
    }


# ── Listing management (price update, mark sold) ────────────────────────────────

@router.put("/listings/{listing_id}/price")
async def update_listing_price(listing_id: UUID, body: UpdatePriceRequest,
                                current_user: BasicUser, db: DBSession):
    """Update listing price. Notifies wishlisters if price drops."""
    result = await db.execute(select(Listing).where(
        Listing.id == listing_id, Listing.seller_id == current_user.user_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})
    if listing.status not in ("active", "draft"):
        raise HTTPException(status_code=400, detail={"error": "INVALID_STATUS"})

    old_price = listing.price
    new_price = body.new_price
    listing.price = new_price

    notified = 0
    if new_price < old_price and listing.status == "active":
        notified = await notify_price_drop(db, listing_id, old_price, new_price)

    await db.commit()
    return {
        "listing_id": str(listing_id),
        "old_price": str(old_price),
        "new_price": str(new_price),
        "wishlists_notified": notified,
        "message": f"Price updated. {notified} people on their wishlist notified." if notified else "Price updated.",
    }


@router.post("/listings/{listing_id}/mark-sold")
async def mark_sold(listing_id: UUID, body: MarkSoldRequest,
                    current_user: BasicUser, db: DBSession):
    """
    Seller marks item as sold — on Owmee or elsewhere.
    Clears active offers, notifies buyers, reopens (sold_elsewhere) or closes (on_owmee).
    """
    result = await db.execute(select(Listing).where(
        Listing.id == listing_id, Listing.seller_id == current_user.user_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=404, detail={"error": "LISTING_NOT_FOUND"})
    if listing.status not in ("active", "reserved"):
        raise HTTPException(status_code=400, detail={"error": "INVALID_STATUS"})

    new_status = "sold" if body.sold_where == "on_owmee" else "sold_elsewhere"
    listing.status = new_status

    # Cancel all pending offers and notify buyers
    offers_result = await db.execute(
        select(Offer).where(
            Offer.listing_id == listing_id,
            Offer.status.in_(["pending", "countered"]),
        )
    )
    offers = offers_result.scalars().all()
    from app.modules.offers.service import _notify
    for offer in offers:
        offer.status = "cancelled"
        await _notify(
            db, offer.buyer_id, "listing_sold",
            "Item no longer available",
            f"'{listing.title[:40]}' was sold. Browse similar listings.",
            "listing", str(listing_id), bucket="message",
        )

    await db.commit()
    return {
        "listing_id": str(listing_id),
        "status": new_status,
        "offers_cancelled": len(offers),
        "message": f"Listing marked as {new_status.replace('_', ' ')}. {len(offers)} open offer(s) cancelled.",
    }


# ── Reputation ladder ───────────────────────────────────────────────────────────

@router.get("/users/me/reputation")
async def my_reputation(current_user: BasicUser, db: DBSession):
    """
    Seller reputation ladder — shows progress toward Trusted Seller badge.
    India UX: gamified progress encourages first-time sellers to complete their first deal.
    """
    from app.modules.identity_auth.models import User
    user_result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = user_result.scalar_one_or_none()

    listings_result = await db.execute(
        select(Listing).where(Listing.seller_id == current_user.user_id, Listing.status.in_(["active", "sold", "sold_elsewhere"]))
    )
    listing_count = len(listings_result.scalars().all())

    deals_result = await db.execute(
        select(Transaction).where(
            Transaction.seller_id == current_user.user_id,
            Transaction.status.in_(["completed", "auto_completed"]),
        )
    )
    deal_count = len(deals_result.scalars().all())

    ratings_result = await db.execute(
        select(Rating).where(Rating.ratee_id == current_user.user_id, Rating.revealed_at != None)
    )
    ratings = ratings_result.scalars().all()
    avg_rating = round(sum(r.stars for r in ratings) / len(ratings), 1) if ratings else None

    # Reputation ladder steps
    steps = [
        {"id": "kyc_verified", "label": "KYC verified", "done": current_user.kyc_status == "verified", "description": "Identity verified"},
        {"id": "first_listing", "label": "First listing", "done": listing_count >= 1, "description": "Listed your first item"},
        {"id": "first_deal", "label": "First deal", "done": deal_count >= 1, "description": "Completed your first sale"},
        {"id": "five_deals", "label": "5 deals", "done": deal_count >= 5, "description": "5 successful sales"},
        {"id": "ten_deals", "label": "Trusted Seller", "done": deal_count >= 10, "description": "10 deals — Trusted Seller badge"},
    ]
    completed = sum(1 for s in steps if s["done"])
    next_step = next((s for s in steps if not s["done"]), None)

    badge = None
    if deal_count >= 10:
        badge = "trusted_seller"
    elif deal_count >= 5:
        badge = "active_seller"
    elif deal_count >= 1:
        badge = "new_seller"

    # Build ladder in format expected by mobile app and test
    ladder = [{"step": s["id"], "label": s["label"], "achieved": s["done"]} for s in steps]
    current_step_obj = next((s for s in steps if not s["done"]), steps[-1]) if steps else {}
    return {
        "user_id": str(current_user.user_id),
        "current_step": current_step_obj.get("id", "new_seller"),
        "next_step": next_step["id"] if next_step else None,
        "deal_count": deal_count,
        "avg_rating": avg_rating,
        "kyc_verified": True,
        "ladder": ladder,
        "stats": {
            "listing_count": listing_count,
            "deal_count": deal_count,
            "avg_rating": avg_rating,
            "ratings_count": len(ratings),
            "trust_score": user.trust_score if user else 50,
        },
        "badge": badge,
        "steps": steps,
        "progress": f"{completed}/{len(steps)}",
    }


# ── Notification preferences ────────────────────────────────────────────────────

@router.get("/notifications/preferences")
async def get_notification_preferences(current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == current_user.user_id)
    )
    prefs = result.scalar_one_or_none()
    if not prefs:
        return {
            "transactions_enabled": True,
            "messages_enabled": True,
            "promotions_enabled": False,
            "note": "Transactions cannot be disabled — they include payments and deal updates.",
        }
    return {
        "transactions_enabled": True,  # Always on
        "messages_enabled": prefs.messages_enabled,
        "promotions_enabled": prefs.promotions_enabled,
        "note": "Transactions cannot be disabled — they include payments and deal updates.",
    }


@router.put("/notifications/preferences")
async def update_notification_preferences(body: NotificationPreferencesRequest,
                                           current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == current_user.user_id)
    )
    prefs = result.scalar_one_or_none()
    if not prefs:
        prefs = NotificationPreference(
            user_id=current_user.user_id,
            transactions_enabled=True,  # Always on regardless of request
            messages_enabled=body.messages_enabled,
            promotions_enabled=body.promotions_enabled,
        )
        db.add(prefs)
    else:
        prefs.transactions_enabled = True  # Always on
        prefs.messages_enabled = body.messages_enabled
        prefs.promotions_enabled = body.promotions_enabled
    await db.commit()
    return {"message": "Preferences updated.", "messages_enabled": prefs.messages_enabled,
            "promotions_enabled": prefs.promotions_enabled}


# ── Wishlist ─────────────────────────────────────────────────────────────────────

@router.get("/wishlist")
async def get_wishlist(current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(Wishlist).where(Wishlist.user_id == current_user.user_id)
        .order_by(Wishlist.created_at.desc())
    )
    return {"wishlist": [{"listing_id": str(w.listing_id), "saved_at": w.created_at.isoformat()}
                          for w in result.scalars().all()]}


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


# ── Notifications ────────────────────────────────────────────────────────────────

@router.get("/notifications")
async def get_notifications(current_user: BasicUser, db: DBSession,
                             unread_only: bool = Query(False)):
    q = select(NotificationEvent).where(NotificationEvent.user_id == current_user.user_id)
    if unread_only:
        q = q.where(NotificationEvent.is_read == False)
    result = await db.execute(q.order_by(NotificationEvent.created_at.desc()).limit(50))
    return {"notifications": [
        {"id": str(n.id), "type": n.event_type, "bucket": n.notification_bucket,
         "title": n.title, "body": n.body, "entity_type": n.entity_type,
         "entity_id": n.entity_id, "is_read": n.is_read,
         "created_at": n.created_at.isoformat()}
        for n in result.scalars().all()
    ]}


@router.get("/notifications/unread-count")
async def unread_notification_count(current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(NotificationEvent).where(
            NotificationEvent.user_id == current_user.user_id,
            NotificationEvent.is_read == False,
        )
    )
    return {"unread_count": len(result.scalars().all())}


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_notification_read(notification_id: UUID, current_user: BasicUser, db: DBSession):
    result = await db.execute(
        select(NotificationEvent).where(
            and_(NotificationEvent.id == notification_id,
                 NotificationEvent.user_id == current_user.user_id))
    )
    n = result.scalar_one_or_none()
    if n:
        n.is_read = True
        await db.commit()


# ── Activity ticker (home screen social proof) ──────────────────────────────────

@router.get("/listings/activity")
async def listing_activity(db: DBSession, city: str | None = Query(None)):
    """
    Home screen social proof: "14 deals completed today · 8 new listings in Bengaluru"
    India UX: First-time users need proof that real people are active here.
    """
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    # Deals completed today
    deals_result = await db.execute(
        select(Transaction).where(
            Transaction.status.in_(["completed", "auto_completed"]),
            Transaction.completed_at >= cutoff,
        )
    )
    deals_today = len(deals_result.scalars().all())

    # New listings in last 24h (optionally in city)
    q = select(Listing).where(
        Listing.status == "active",
        Listing.published_at >= cutoff,
    )
    if city:
        q = q.where(Listing.city.ilike(f"%{city}%"))
    new_listings_result = await db.execute(q)
    new_listings = len(new_listings_result.scalars().all())

    # Total active listings in city
    q2 = select(Listing).where(Listing.status == "active")
    if city:
        q2 = q2.where(Listing.city.ilike(f"%{city}%"))
    total_result = await db.execute(q2)
    total_active = len(total_result.scalars().all())

    return {
        "deals_completed_today": deals_today,
        "new_listings_24h": new_listings,
        "total_active_listings": total_active,
        "city": city,
        # Human-readable ticker strings for the UI
        "ticker_deals": f"{deals_today} deal{'s' if deals_today != 1 else ''} completed today" if deals_today else "Be the first to complete a deal today",
        "ticker_listings": f"{new_listings} new listing{'s' if new_listings != 1 else ''} in {city or 'your city'} today" if new_listings else f"{total_active} listings available",
    }


@router.get("/listings/new-since-visit")
async def new_since_last_visit(
    current_user: BasicUser,
    db: DBSession,
    city: str | None = Query(None),
):
    """
    Home screen retention: 'New since your last visit'
    Updates user.last_seen_at on every call — so next visit shows delta.
    India UX: gives users a reason to return daily.
    """
    from app.modules.identity_auth.models import User as UserModel

    # Fetch user's last_seen_at
    user_result = await db.execute(select(UserModel).where(UserModel.id == current_user.user_id))
    user = user_result.scalar_one_or_none()

    last_seen = user.last_seen_at if user and user.last_seen_at else None
    now = datetime.now(timezone.utc)

    # Update last_seen_at to now (for next call)
    if user:
        user.last_seen_at = now
        await db.commit()

    if not last_seen:
        # First visit — show last 24h of listings as "new"
        last_seen = now - timedelta(hours=24)

    q = select(Listing).where(
        Listing.status == "active",
        Listing.published_at >= last_seen,
    )
    if city:
        q = q.where(Listing.city.ilike(f"%{city}%"))
    q = q.order_by(Listing.published_at.desc()).limit(10)
    result = await db.execute(q)
    listings = result.scalars().all()

    from app.modules.listings.router import _fmt_card
    return {
        "since": last_seen.isoformat(),
        "count": len(listings),
        "listings": [_fmt_card(l) for l in listings],
        "label": f"{len(listings)} new listing{'s' if len(listings) != 1 else ''} since your last visit" if listings else "You're all caught up",
    }


# ── Payment webhook ──────────────────────────────────────────────────────────────

@router.post("/payments/webhook/razorpay", status_code=status.HTTP_200_OK)
async def razorpay_webhook(request: Request, db: DBSession):
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    from app.modules.payments.adapter import get_payment_adapter
    adapter = get_payment_adapter()
    verify = adapter.verify_webhook(body, signature)
    if not verify.valid:
        return {"status": "ignored"}

    if verify.event == "payment_link.paid":
        import json
        payload = json.loads(body)
        txn = await process_payment_paid(
            db, razorpay_link_id=verify.payment_link_id,
            razorpay_payment_id=verify.payment_id, webhook_payload=payload,
        )
        if txn:
            await db.commit()

    elif verify.event in ("refund.processed", "refund.failed") and verify.refund_id:
        # Async refund completion. Razorpay calls back when their banking
        # partner confirms the refund landed (or failed). We acknowledge
        # 200 OK either way so they stop retrying.
        from app.modules.transactions.refund_service import (
            mark_refund_completed, REFUND_STATUS_FAILED,
        )
        if verify.event == "refund.processed":
            txn = await mark_refund_completed(db, verify.refund_id)
            if txn:
                await db.commit()
        else:  # refund.failed
            from sqlalchemy import select as _select
            from app.modules.offers.models import Transaction as _Txn
            r = await db.execute(
                _select(_Txn).where(_Txn.razorpay_refund_id == verify.refund_id)
            )
            txn = r.scalar_one_or_none()
            if txn:
                txn.refund_status = REFUND_STATUS_FAILED
                logger.error(
                    "refund.razorpay_failed",
                    transaction_id=str(txn.id),
                    refund_id=verify.refund_id,
                )
                await db.commit()

    return {"status": "ok"}


@router.get("/dev/pay/{link_id}")
async def dev_pay(link_id: str, db: DBSession):
    provider = (settings.pa_provider or "").strip().lower()
    if settings.env != "development" and provider not in {"", "mock", "dev"} and settings.pa_key_id:
        raise HTTPException(status_code=404)
    result = await db.execute(select(PaymentLink).where(PaymentLink.razorpay_link_id == link_id))
    pl = result.scalar_one_or_none()
    if not pl:
        raise HTTPException(status_code=404, detail={"error": "LINK_NOT_FOUND"})
    if pl.status == "paid":
        return {"status": "already_paid", "transaction_id": str(pl.transaction_id)}
    from app.modules.payments.adapter import get_payment_adapter
    import json
    adapter = get_payment_adapter()
    payload = adapter.build_dev_paid_webhook(link_id, str(pl.transaction_id))
    body = json.dumps(payload).encode()
    verify = adapter.verify_webhook(body, "dev_signature")
    if verify.event == "payment_link.paid":
        txn = await process_payment_paid(
            db, razorpay_link_id=verify.payment_link_id,
            razorpay_payment_id=verify.payment_id, webhook_payload=payload,
        )
        if txn:
            await db.commit()
            return {"status": "payment_simulated", "transaction_id": str(txn.id),
                    "transaction_status": txn.status}
    return {"status": "error"}

# Sprint 6b — chat removed. The /chat/token endpoint and the entire
# app.modules.chat module were deleted. Buyer-seller communication is
# now exclusively via structured offer + transaction state.


# ── FCM token registration ─────────────────────────────────────────────────────

class FCMTokenRequest(BaseModel):
    fcm_token: str

@router.put("/devices/fcm", status_code=status.HTTP_204_NO_CONTENT)
async def register_fcm_token(
    body: FCMTokenRequest,
    current_user: BasicUser,
    db: DBSession,
):
    """Register or update FCM push token for this device."""
    from app.modules.identity_auth.models import User
    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if user:
        user.fcm_token = body.fcm_token
        await db.commit()


# ── Dev KYC approve (development only) ───────────────────────────────────────

@router.post("/dev/kyc-approve/{phone}")
async def dev_kyc_approve(phone: str, db: DBSession):
    """Dev-only: create KYC record in verified state and set user tier=verified."""
    if settings.env != "development":
        raise HTTPException(status_code=404)
    from app.modules.identity_auth.models import User
    from app.modules.kyc.models import KYCVerification
    from app.modules.kyc.service import update_user_kyc_status

    result = await db.execute(select(User).where(User.phone_number == phone))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})
    if user.tier == "verified":
        return {"status": "already_verified", "user_id": str(user.id)}

    # Get or create KYC verification record
    v_result = await db.execute(
        select(KYCVerification).where(KYCVerification.user_id == user.id)
    )
    v = v_result.scalar_one_or_none()
    if not v:
        v = KYCVerification(
            user_id=user.id,
            kyc_status="verified",
            aadhaar_verified=True,
            pan_verified=True,
            liveness_verified=True,
            payout_verified=True,
            name_match_result="pass",
            name_match_score="100",
        )
        v.completed_at = datetime.now(timezone.utc)
        v.reviewed_at = datetime.now(timezone.utc)
        db.add(v)
        await db.flush()
    else:
        v.kyc_status = "verified"
        v.completed_at = datetime.now(timezone.utc)
        v.reviewed_at = datetime.now(timezone.utc)
        await db.flush()

    await update_user_kyc_status(db, user.id, "verified")
    await db.commit()
    return {"status": "verified", "user_id": str(user.id)}


# ── Sprint 1: Buy Now — direct purchase at listed price ──────────
class BuyNowRequest(BaseModel):
    listing_id: str
    address_id: str | None = None
    # P0.2 (2026-05-03): optional delivery instructions captured by mobile
    # CheckoutScreen. Plumbed onto Transaction.order_notes for the FE
    # delivery agent.
    order_notes: str | None = Field(default=None, max_length=500)


@router.post("/orders/buy-now")
async def buy_now(body: BuyNowRequest, current_user: BasicUser, db: DBSession):
    """
    Buy Now — direct purchase at listed price.
    Creates offer at asking price + auto-accepts + creates transaction.
    Requires verified user.
    """
    from uuid import UUID
    from sqlalchemy import select
    from app.modules.listings.models import Listing

    try:
        listing_id = UUID(body.listing_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "INVALID_LISTING_ID"})

    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()

    if not listing or listing.status != "active":
        raise HTTPException(status_code=400, detail={"error": "LISTING_NOT_AVAILABLE"})
    if listing.seller_id == current_user.user_id:
        raise HTTPException(status_code=400, detail={"error": "CANNOT_BUY_OWN_LISTING"})

    # Sprint trust pillar: buyer must also be inside a launch zone for
    # FE-managed delivery to work. Use the checkout-selected saved address
    # when mobile sends one; otherwise fall back to the user's default saved
    # address via the shared resolver. This keeps Checkout/AddressPicker and
    # backend serviceability checks on the same source of truth.
    from app.core.zones import is_in_service_area, out_of_service_message
    buyer_lat = buyer_lng = None
    if body.address_id:
        try:
            address_id = UUID(body.address_id)
        except ValueError:
            raise HTTPException(status_code=400, detail={"error": "INVALID_ADDRESS_ID"})
        from app.modules.identity_auth.models import UserAddress
        addr_res = await db.execute(
            select(UserAddress).where(
                UserAddress.id == address_id,
                UserAddress.user_id == current_user.user_id,
            )
        )
        addr = addr_res.scalar_one_or_none()
        if not addr:
            raise HTTPException(status_code=400, detail={"error": "ADDRESS_NOT_FOUND"})
        buyer_lat = float(addr.lat)
        buyer_lng = float(addr.lng)
    else:
        from app.modules.identity_auth.user_location import get_user_location
        buyer_lat, buyer_lng, _city, _state = await get_user_location(db, current_user.user_id)
    if not is_in_service_area(buyer_lat, buyer_lng):
        raise HTTPException(status_code=400, detail=out_of_service_message())

    # Create offer at listed price
    from app.modules.offers.service import make_offer, accept_offer
    offer = await make_offer(
        db=db,
        listing_id=listing_id,
        buyer_id=current_user.user_id,
        offered_price=listing.price,
        offer_note="Buy Now — direct purchase",
    )

    # Auto-accept
    try:
        txn, payment_link = await accept_offer(
            db=db,
            offer_id=offer.id,
            seller_id=listing.seller_id,
        )
        # Attach buyer's order notes to the transaction so the FE delivery
        # agent sees them. accept_offer creates the Transaction; we set the
        # field before commit so it lands in the same insert.
        if txn and body.order_notes:
            txn.order_notes = body.order_notes.strip() or None
        await db.commit()

        return {
            "transaction_id": str(txn.id) if txn else None,
            "offer_id": str(offer.id),
            "amount": str(listing.price),
            "status": txn.status if txn else "pending",
            "payment_link": payment_link.short_url if payment_link else None,
            "message": "Order placed successfully.",
        }
    except Exception as e:
        # If auto-accept fails, return the offer (seller can accept manually)
        await db.commit()
        return {
            "transaction_id": None,
            "offer_id": str(offer.id),
            "amount": str(listing.price),
            "status": "offer_created",
            "payment_link": None,
            "message": f"Offer created at listed price. Seller will confirm shortly.",
        }
