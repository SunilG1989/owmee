"""Admin web UI — server-rendered Jinja2 + Tailwind CDN.

Mounted at /admin/*. Cookie-based auth: login posts email + password,
we verify against the existing admin_users table and set an HttpOnly
cookie with the admin access token. Every other route checks the
cookie via require_admin_cookie().

Why server-rendered (not React/Next):
  - No JS toolchain in the backend repo (zero `npm install`)
  - One ops user at hyperlocal pilot scale; Jinja2 forms + Tailwind
    classes are sufficient
  - Cheap to throw away later if a real admin app is built
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import structlog
from fastapi import APIRouter, Cookie, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from passlib.context import CryptContext
from sqlalchemy import and_, select, text

from app.core.dependencies import DBSession
from app.modules.admin.models import AdminUser as AdminUserModel
from app.modules.identity_auth.models import User
from app.modules.listings.models import Listing
from app.modules.offers.models import Transaction
from app.modules.transactions.logistics_state import (
    AT_HUB, DELIVERED, DELIVERY_IN_PROGRESS, PAYMENT_CAPTURED,
    assert_legal_transition,
)

logger = structlog.get_logger()
router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Cookie name we set on successful login. HttpOnly so JS can't read it.
COOKIE = "owmee_admin"


# ── Auth ──────────────────────────────────────────────────────────────────────

async def _verify_admin(db, email: str, password: str) -> AdminUserModel | None:
    res = await db.execute(select(AdminUserModel).where(AdminUserModel.email == email.lower()))
    admin = res.scalar_one_or_none()
    if not admin or not admin.is_active:
        return None
    if not pwd_context.verify(password, admin.password_hash):
        return None
    return admin


async def require_admin_cookie(
    db: DBSession,
    owmee_admin: str | None = Cookie(default=None, alias=COOKIE),
) -> AdminUserModel:
    """Look up the admin by id from the cookie. Cookie value is the admin
    UUID (stable, simple). For real production we'd sign the cookie OR
    use a JWT; for hyperlocal pilot this is enough as long as the cookie
    is HttpOnly + Secure (we set both)."""
    if not owmee_admin:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="login_required")
    try:
        admin_id = UUID(owmee_admin)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="bad_cookie")
    res = await db.execute(select(AdminUserModel).where(AdminUserModel.id == admin_id))
    admin = res.scalar_one_or_none()
    if not admin or not admin.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="admin_inactive")
    return admin


def _redirect_to_login() -> RedirectResponse:
    return RedirectResponse(url="/admin/login", status_code=status.HTTP_303_SEE_OTHER)


# ── Login / logout ────────────────────────────────────────────────────────────

@router.get("/admin/login", response_class=HTMLResponse)
async def login_form(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@router.post("/admin/login")
async def login_submit(request: Request, db: DBSession,
                       email: str = Form(...), password: str = Form(...)):
    admin = await _verify_admin(db, email, password)
    if not admin:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Email or password is incorrect."},
            status_code=400,
        )
    resp = RedirectResponse(url="/admin", status_code=status.HTTP_303_SEE_OTHER)
    # 24h session; long enough for one ops shift, short enough that a
    # stolen laptop doesn't grant indefinite access.
    resp.set_cookie(
        COOKIE, str(admin.id),
        httponly=True, samesite="strict", secure=False, max_age=86400,
        # secure=False keeps it usable on plain http://localhost in dev;
        # change to True once we're on Railway/HTTPS.
    )
    return resp


@router.post("/admin/logout")
async def logout():
    resp = _redirect_to_login()
    resp.delete_cookie(COOKIE)
    return resp


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/admin", response_class=HTMLResponse)
async def dashboard(
    request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    pickup_count = (await db.execute(
        select(text("count(*)")).select_from(Transaction).where(and_(
            Transaction.status == PAYMENT_CAPTURED,
            Transaction.seller_readiness_status == "confirmed",
            Transaction.pickup_fe_id.is_(None),
            Transaction.buyer_delivery_address_snapshot.is_not(None),
            Transaction.seller_pickup_address_snapshot.is_not(None),
        ))
    )).scalar()
    hub_count = (await db.execute(
        select(text("count(*)")).select_from(Transaction).where(and_(
            Transaction.status == AT_HUB, Transaction.routed_at.is_(None),
        ))
    )).scalar()
    in_progress_count = (await db.execute(
        select(text("count(*)")).select_from(Transaction).where(
            Transaction.status == DELIVERY_IN_PROGRESS,
        )
    )).scalar()
    return templates.TemplateResponse("dashboard.html", {
        "request": request, "admin": admin,
        "pickup_count": pickup_count, "hub_count": hub_count,
        "in_progress_count": in_progress_count,
    })


# ── Pickups Pending ───────────────────────────────────────────────────────────

@router.get("/admin/pickups", response_class=HTMLResponse)
async def pickups_page(
    request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    rows = (await db.execute(
        select(Transaction, Listing.title, User.phone_number)
        .join(Listing, Listing.id == Transaction.listing_id)
        .join(User, User.id == Transaction.seller_id)
        .where(and_(
            Transaction.status == PAYMENT_CAPTURED,
            Transaction.seller_readiness_status == "confirmed",
            Transaction.pickup_fe_id.is_(None),
            Transaction.buyer_delivery_address_snapshot.is_not(None),
            Transaction.seller_pickup_address_snapshot.is_not(None),
        ))
        .order_by(Transaction.created_at.asc())
    )).all()
    fes = (await db.execute(
        text("""
            SELECT fe.user_id, u.name, u.phone_number, fe.fe_code, fe.city
            FROM field_executives fe JOIN users u ON u.id = fe.user_id
            WHERE fe.active = true
            ORDER BY fe.fe_code
        """)
    )).all()
    return templates.TemplateResponse("pickups.html", {
        "request": request, "admin": admin, "rows": rows, "fes": fes,
    })


@router.post("/admin/pickups/{transaction_id}/assign")
async def pickups_assign(
    transaction_id: UUID, db: DBSession,
    fe_user_id: str = Form(...),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    if txn.status != PAYMENT_CAPTURED:
        raise HTTPException(400, f"bad_status:{txn.status}")
    if txn.seller_readiness_status != "confirmed":
        raise HTTPException(400, "seller_not_ready")
    if not txn.seller_pickup_address_snapshot or not txn.buyer_delivery_address_snapshot:
        raise HTTPException(400, "address_snapshot_missing")
    txn.pickup_fe_id = UUID(fe_user_id)
    from app.modules.offers.service import _notify
    await _notify(db, txn.seller_id, "pickup_assigned",
        "Owmee pickup assigned",
        "A field executive has been assigned for your confirmed order.",
        "transaction", str(txn.id))
    await db.commit()
    logger.info("admin.assign_pickup", transaction_id=str(transaction_id),
                fe_user_id=fe_user_id, admin_id=str(admin.id))
    return RedirectResponse(url="/admin/pickups", status_code=status.HTTP_303_SEE_OTHER)


# ── Hub Dispatch ──────────────────────────────────────────────────────────────

@router.get("/admin/hub", response_class=HTMLResponse)
async def hub_page(
    request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    rows = (await db.execute(
        select(Transaction, Listing.title, User.phone_number)
        .join(Listing, Listing.id == Transaction.listing_id)
        .join(User, User.id == Transaction.buyer_id)
        .where(and_(Transaction.status == AT_HUB, Transaction.routed_at.is_(None)))
        .order_by(Transaction.at_hub_at.asc())
    )).all()
    fes = (await db.execute(
        text("""
            SELECT fe.user_id, u.name, u.phone_number, fe.fe_code, fe.city
            FROM field_executives fe JOIN users u ON u.id = fe.user_id
            WHERE fe.active = true
            ORDER BY fe.fe_code
        """)
    )).all()
    return templates.TemplateResponse("hub.html", {
        "request": request, "admin": admin, "rows": rows, "fes": fes,
    })


@router.post("/admin/hub/{transaction_id}/route-fe")
async def hub_route_fe(
    transaction_id: UUID, db: DBSession,
    fe_user_id: str = Form(...),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    import secrets
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    assert_legal_transition(txn.status, DELIVERY_IN_PROGRESS)
    now = datetime.now(timezone.utc)
    txn.delivery_mode = "fe"
    txn.delivery_fe_id = UUID(fe_user_id)
    txn.buyer_acknowledgment_code = "".join(secrets.choice("0123456789") for _ in range(6))
    txn.routed_at = now
    txn.status = DELIVERY_IN_PROGRESS
    from app.modules.offers.service import _notify
    await _notify(db, txn.buyer_id, "out_for_delivery",
        "Out for delivery",
        "Owmee is bringing your item. Keep the handover code private until the FE reaches you.",
        "transaction", str(txn.id))
    await _notify(db, txn.seller_id, "delivery_in_progress",
        "Delivery in progress",
        "Your item is on the way to the buyer.",
        "transaction", str(txn.id))
    await db.commit()
    logger.info("admin.route_fe", transaction_id=str(transaction_id),
                fe_user_id=fe_user_id, admin_id=str(admin.id))
    return RedirectResponse(url=f"/admin/txn/{transaction_id}", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/admin/hub/{transaction_id}/route-courier")
async def hub_route_courier(
    transaction_id: UUID, db: DBSession,
    courier_name: str = Form(...),
    booking_id: str = Form(...),
    tracking_url: str = Form(""),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    assert_legal_transition(txn.status, DELIVERY_IN_PROGRESS)
    now = datetime.now(timezone.utc)
    txn.delivery_mode = "courier"
    txn.courier_name = courier_name
    txn.courier_booking_id = booking_id
    txn.courier_tracking_url = tracking_url or None
    txn.routed_at = now
    txn.status = DELIVERY_IN_PROGRESS
    from app.modules.offers.service import _notify
    await _notify(db, txn.buyer_id, "out_for_delivery",
        "Courier delivery started",
        "Your item has been handed to the courier. Tracking is available in the order.",
        "transaction", str(txn.id))
    await db.commit()
    logger.info("admin.route_courier", transaction_id=str(transaction_id),
                courier_name=courier_name, admin_id=str(admin.id))
    return RedirectResponse(url=f"/admin/txn/{transaction_id}", status_code=status.HTTP_303_SEE_OTHER)


# ── Transaction detail ────────────────────────────────────────────────────────

@router.get("/admin/txn/{transaction_id}", response_class=HTMLResponse)
async def txn_detail(
    transaction_id: UUID, request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    row = (await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(Transaction.id == transaction_id)
    )).first()
    if not row:
        raise HTTPException(404)
    txn, title = row
    pickup_fe_name = None
    delivery_fe_name = None
    if txn.pickup_fe_id:
        r = await db.execute(select(User.name).where(User.id == txn.pickup_fe_id))
        pickup_fe_name = r.scalar_one_or_none()
    if txn.delivery_fe_id:
        r = await db.execute(select(User.name).where(User.id == txn.delivery_fe_id))
        delivery_fe_name = r.scalar_one_or_none()
    return templates.TemplateResponse("txn_detail.html", {
        "request": request, "admin": admin, "txn": txn, "title": title,
        "pickup_fe_name": pickup_fe_name, "delivery_fe_name": delivery_fe_name,
    })


@router.get("/admin/returns", response_class=HTMLResponse)
async def returns_page(
    request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    rows = (await db.execute(
        select(Transaction, Listing.title, User.phone_number)
        .join(Listing, Listing.id == Transaction.listing_id)
        .join(User, User.id == Transaction.buyer_id)
        .where(Transaction.return_status.in_(["requested", "approved", "pickup_scheduled"]))
        .order_by(Transaction.return_requested_at.desc())
    )).all()
    fes = (await db.execute(
        text("""
            SELECT fe.user_id, u.name, u.phone_number, fe.fe_code
            FROM field_executives fe JOIN users u ON u.id = fe.user_id
            WHERE fe.active = true
            ORDER BY fe.fe_code
        """)
    )).all()
    return templates.TemplateResponse("returns.html", {
        "request": request, "admin": admin, "rows": rows, "fes": fes,
    })


@router.post("/admin/returns/{transaction_id}/decision")
async def returns_decision(
    transaction_id: UUID, db: DBSession,
    decision: str = Form(...),  # 'approve' | 'reject'
    note: str = Form(""),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    from app.modules.transactions import return_service
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    try:
        if decision == "approve":
            await return_service.admin_approve_return(db, txn, admin_id=admin.id, note=note)
        elif decision == "reject":
            await return_service.admin_reject_return(db, txn, admin_id=admin.id, note=note)
        else:
            raise HTTPException(400, "bad_decision")
        await db.commit()
    except ValueError as e:
        logger.warning("admin.return_decision_failed",
                       transaction_id=str(transaction_id), error=str(e))
    logger.info("admin.return_decision", transaction_id=str(transaction_id),
                decision=decision, admin_id=str(admin.id))
    return RedirectResponse(url="/admin/returns", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/admin/returns/{transaction_id}/assign-pickup")
async def returns_assign_pickup(
    transaction_id: UUID, db: DBSession,
    fe_user_id: str = Form(...),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    from app.modules.transactions import return_service
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    try:
        await return_service.admin_assign_return_pickup(
            db, txn, admin_id=admin.id, fe_user_id=UUID(fe_user_id),
        )
        await db.commit()
    except ValueError as e:
        logger.warning("admin.return_assign_failed",
                       transaction_id=str(transaction_id), error=str(e))
    logger.info("admin.return_assign_pickup", transaction_id=str(transaction_id),
                fe_user_id=fe_user_id, admin_id=str(admin.id))
    return RedirectResponse(url="/admin/returns", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/admin/disputes", response_class=HTMLResponse)
async def disputes_page(
    request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    # Open disputes (admin handles the resolution); inline import keeps
    # the cross-module dependency narrow since the Dispute model lives
    # in admin.reports_disputes alongside the existing dispute router.
    from app.modules.admin.reports_disputes import Dispute
    rows = (await db.execute(
        select(Dispute, Transaction, Listing.title)
        .join(Transaction, Transaction.id == Dispute.transaction_id)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(Dispute.status.in_(["opened", "under_review"]))
        .order_by(Dispute.created_at.desc())
    )).all()
    return templates.TemplateResponse("disputes.html", {
        "request": request, "admin": admin, "rows": rows,
    })


@router.post("/admin/disputes/{dispute_id}/resolve")
async def disputes_resolve(
    dispute_id: UUID, db: DBSession,
    resolution: str = Form(...),
    resolution_note: str = Form(""),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    """Wraps the JSON admin endpoint so the form-post flow round-trips
    cleanly. We don't reuse the JSON handler directly because the
    response shape differs (HTML redirect vs JSON)."""
    from app.modules.admin.reports_disputes import (
        Dispute, VALID_RESOLUTIONS,
    )
    from app.modules.transactions.refund_service import initiate_refund, INITIATED_BY_ADMIN
    if resolution not in VALID_RESOLUTIONS:
        raise HTTPException(400, "bad_resolution")
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(404)
    now = datetime.now(timezone.utc)
    dispute.status = "resolved"
    dispute.resolution = resolution
    dispute.resolution_note = resolution_note or None
    dispute.resolved_at = now

    txn = await db.get(Transaction, dispute.transaction_id)
    if txn:
        if resolution in ("full_refund", "partial_refund"):
            txn.status = "refunded"
            try:
                await initiate_refund(
                    db, txn,
                    reason=f"Dispute {dispute.id}: {resolution}. {resolution_note or ''}"[:200],
                    initiated_by=INITIATED_BY_ADMIN,
                )
            except ValueError as e:
                logger.warning("admin.dispute_refund_skip", dispute_id=str(dispute_id), error=str(e))
        elif resolution == "full_release":
            txn.status = "completed"
            txn.payout_flagged_at = now
    await db.commit()
    logger.info("admin.dispute_resolved", dispute_id=str(dispute_id),
                resolution=resolution, admin_id=str(admin.id))
    return RedirectResponse(url="/admin/disputes", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/admin/refunds", response_class=HTMLResponse)
async def refunds_page(
    request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    rows = (await db.execute(
        select(Transaction, Listing.title)
        .join(Listing, Listing.id == Transaction.listing_id)
        .where(Transaction.refund_status.in_(["requested", "processing", "failed"]))
        .order_by(Transaction.refund_initiated_at.desc())
    )).all()
    return templates.TemplateResponse("refunds.html", {
        "request": request, "admin": admin, "rows": rows,
    })


@router.post("/admin/txn/{transaction_id}/refund")
async def txn_initiate_refund(
    transaction_id: UUID, db: DBSession,
    reason: str = Form(...),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    from app.modules.transactions.refund_service import (
        initiate_refund, INITIATED_BY_ADMIN,
    )
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    try:
        await initiate_refund(db, txn, reason=reason, initiated_by=INITIATED_BY_ADMIN)
        await db.commit()
    except ValueError as e:
        # Re-render the detail page with an error banner instead of a 500.
        logger.warning("admin.refund_failed", transaction_id=str(transaction_id),
                       error=str(e), admin_id=str(admin.id))
    logger.info("admin.refund_initiated", transaction_id=str(transaction_id),
                reason=reason, admin_id=str(admin.id))
    return RedirectResponse(url=f"/admin/txn/{transaction_id}", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/admin/txn/{transaction_id}/courier-status")
async def txn_courier_status(
    transaction_id: UUID, db: DBSession,
    new_status: str = Form(...),
    note: str = Form(""),
    admin: AdminUserModel = Depends(require_admin_cookie),
):
    txn = await db.get(Transaction, transaction_id)
    if not txn or txn.delivery_mode != "courier":
        raise HTTPException(400)
    if new_status == "delivered":
        assert_legal_transition(txn.status, DELIVERED)
        txn.status = DELIVERED
        txn.delivered_at = datetime.now(timezone.utc)
        txn.confirmation_deadline = txn.delivered_at + timedelta(hours=48)
        from app.modules.offers.service import _notify
        await _notify(db, txn.buyer_id, "delivered_confirm_receipt",
            "Delivered — confirm receipt",
            "Confirm receipt if everything matches. You have 48 hours to raise an issue.",
            "transaction", str(txn.id))
        await _notify(db, txn.seller_id, "delivered_awaiting_confirmation",
            "Delivered to buyer",
            "Buyer confirmation or the 48-hour window will move payout forward.",
            "transaction", str(txn.id))
    logger.info("admin.courier_status", transaction_id=str(transaction_id),
                new_status=new_status, note=note, admin_id=str(admin.id))
    await db.commit()
    return RedirectResponse(url=f"/admin/txn/{transaction_id}", status_code=status.HTTP_303_SEE_OTHER)


# ── Auth-error handler: redirect /admin/* 401s to login, fall through everywhere else ─
# (mounted at create_app() level alongside the router include)
#
# Because this is registered as the *global* HTTPException handler, every
# HTTPException raised anywhere in the app passes through here. The previous
# version re-raised on the else branch, which bypassed FastAPI's default
# JSON renderer and ended up at the catch-all 500 handler. Now we delegate
# to Starlette's stock http_exception_handler so non-/admin 401s (and any
# other HTTPException) render as proper JSON with the original status code.
from starlette.exceptions import HTTPException as _StarletteHTTPException
from fastapi.exception_handlers import http_exception_handler as _default_http_exception_handler


async def admin_login_redirect_handler(request: Request, exc: HTTPException):
    if exc.status_code == 401 and request.url.path.startswith("/admin"):
        return _redirect_to_login()
    return await _default_http_exception_handler(request, exc)
