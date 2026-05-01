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

from datetime import datetime, timezone
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
            Transaction.pickup_fe_id.is_(None),
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
        .where(and_(Transaction.status == PAYMENT_CAPTURED, Transaction.pickup_fe_id.is_(None)))
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
    txn.pickup_fe_id = UUID(fe_user_id)
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
    logger.info("admin.courier_status", transaction_id=str(transaction_id),
                new_status=new_status, note=note, admin_id=str(admin.id))
    await db.commit()
    return RedirectResponse(url=f"/admin/txn/{transaction_id}", status_code=status.HTTP_303_SEE_OTHER)


# ── Auth-error handler: redirect to login instead of JSON 401 ─────────────────
# (mounted at create_app() level alongside the router include)
async def admin_login_redirect_handler(request: Request, exc: HTTPException):
    if exc.status_code == 401 and request.url.path.startswith("/admin"):
        return _redirect_to_login()
    raise exc
