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

import base64
import hashlib
import hmac
import time
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
from app.core.rate_limit import ADMIN_LOGIN_PER_IP, limit_by_ip
from app.core.settings import settings
from app.modules.admin.models import AdminUser as AdminUserModel
from app.modules.admin.audit_log_router import log_admin_action
from app.modules.field_executive import service as fe_service
from app.modules.identity_auth.models import User
from app.modules.listings.models import Category, Listing
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
COOKIE_MAX_AGE = 86400  # 24h — one ops shift.

# Money-capable admin roles. SUPER_ADMIN is always admitted by the gate.
ADMIN_MONEY_ROLES = ("L2_REVIEWER", "FINANCE_OPS")


# ── Auth ──────────────────────────────────────────────────────────────────────

def _sign_cookie(admin_id: str) -> str:
    """Produce a tamper-proof, time-stamped cookie value.

    Previously the cookie was the raw admin UUID — anyone who learned an
    admin's id (they leak in logs/URLs/audit rows) could forge a session and
    it could not be expired server-side. We now HMAC the (id, issued_at) with
    the app secret so the value is unforgeable and carries its own expiry.
    """
    issued = str(int(time.time()))
    msg = f"{admin_id}:{issued}"
    sig = hmac.new(settings.secret_key.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{msg}:{sig}".encode()).decode()


def _unsign_cookie(value: str, *, max_age: int = COOKIE_MAX_AGE) -> str | None:
    """Return the admin id if the cookie signature is valid and unexpired."""
    try:
        raw = base64.urlsafe_b64decode(value.encode()).decode()
        admin_id, issued, sig = raw.rsplit(":", 2)
    except Exception:
        return None
    expected = hmac.new(
        settings.secret_key.encode(), f"{admin_id}:{issued}".encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        if int(time.time()) - int(issued) > max_age:
            return None
    except ValueError:
        return None
    return admin_id


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
    """Authenticate the admin from a signed, time-stamped cookie."""
    if not owmee_admin:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="login_required")
    admin_id_str = _unsign_cookie(owmee_admin)
    if not admin_id_str:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="bad_cookie")
    try:
        admin_id = UUID(admin_id_str)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="bad_cookie")
    res = await db.execute(select(AdminUserModel).where(AdminUserModel.id == admin_id))
    admin = res.scalar_one_or_none()
    if not admin or not admin.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="admin_inactive")
    return admin


def require_admin_cookie_roles(*allowed: str):
    """Factory: admit only admins whose role is in `allowed` (SUPER_ADMIN
    always admitted). Used to gate money-moving admin-web actions so a
    low-privilege agent can't issue refunds / release payouts."""

    async def _dep(admin: AdminUserModel = Depends(require_admin_cookie)) -> AdminUserModel:
        role = (admin.role or "").upper()
        if role == "SUPER_ADMIN" or role in allowed:
            return admin
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="insufficient_role")

    return _dep


require_admin_money_role = require_admin_cookie_roles(*ADMIN_MONEY_ROLES)


async def _required_category_slugs_for_transaction(db: DBSession, txn: Transaction) -> set[str] | None:
    result = await db.execute(
        select(Category.slug)
        .join(Listing, Listing.category_id == Category.id)
        .where(Listing.id == txn.listing_id)
    )
    slug = result.scalar_one_or_none()
    return {slug} if slug else None


async def _assert_fe_ready_for_transaction(db: DBSession, fe_user_id: UUID, txn: Transaction) -> None:
    try:
        await fe_service.assert_fe_user_ready_for_assignment(
            db,
            fe_user_id,
            required_categories=await _required_category_slugs_for_transaction(db, txn),
        )
    except fe_service.FEOnboardingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{exc.code}:{exc.message}")


def _txn_audit_state(txn: Transaction) -> dict:
    return {
        "status": txn.status,
        "seller_readiness_status": txn.seller_readiness_status,
        "pickup_fe_id": str(txn.pickup_fe_id) if txn.pickup_fe_id else None,
        "delivery_mode": txn.delivery_mode,
        "delivery_fe_id": str(txn.delivery_fe_id) if txn.delivery_fe_id else None,
        "courier_name": txn.courier_name,
        "courier_booking_id": txn.courier_booking_id,
        "refund_status": txn.refund_status,
        "return_status": txn.return_status,
        "routed_at": txn.routed_at.isoformat() if txn.routed_at else None,
        "delivered_at": txn.delivered_at.isoformat() if txn.delivered_at else None,
    }


async def _audit_transaction_action(
    db: DBSession,
    *,
    admin: AdminUserModel,
    action: str,
    txn: Transaction,
    before_state: dict,
    reviewer_notes: str | None = None,
) -> None:
    await log_admin_action(
        db,
        admin_id=admin.id,
        action=action,
        entity_type="transaction",
        entity_id=str(txn.id),
        before_state=before_state,
        after_state=_txn_audit_state(txn),
        reviewer_notes=reviewer_notes,
    )


def _redirect_to_login() -> RedirectResponse:
    return RedirectResponse(url="/admin/login", status_code=status.HTTP_303_SEE_OTHER)


# ── Login / logout ────────────────────────────────────────────────────────────

@router.get("/admin/login", response_class=HTMLResponse)
async def login_form(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@router.post("/admin/login")
async def login_submit(request: Request, db: DBSession,
                       email: str = Form(...), password: str = Form(...)):
    # Throttle online password guessing per IP.
    await limit_by_ip("admin_login_ip", ADMIN_LOGIN_PER_IP)(request)

    admin = await _verify_admin(db, email, password)
    if not admin:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Email or password is incorrect."},
            status_code=400,
        )
    resp = RedirectResponse(url="/admin", status_code=status.HTTP_303_SEE_OTHER)
    # 24h session; long enough for one ops shift, short enough that a
    # stolen laptop doesn't grant indefinite access. Cookie is signed (see
    # _sign_cookie) and Secure in production so it can't be sniffed or forged.
    resp.set_cookie(
        COOKIE, _sign_cookie(str(admin.id)),
        httponly=True, samesite="strict",
        secure=settings.is_production, max_age=COOKIE_MAX_AGE,
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
    fe_uuid = UUID(fe_user_id)
    before = _txn_audit_state(txn)
    await _assert_fe_ready_for_transaction(db, fe_uuid, txn)
    txn.pickup_fe_id = fe_uuid
    from app.modules.offers.service import _notify
    await _notify(db, txn.seller_id, "pickup_assigned",
        "Owmee pickup assigned",
        "A field executive has been assigned for your confirmed order.",
        "transaction", str(txn.id))
    await _audit_transaction_action(
        db,
        admin=admin,
        action="transaction.assign_pickup_fe",
        txn=txn,
        before_state=before,
        reviewer_notes=f"fe_user_id={fe_user_id}",
    )
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
    fe_uuid = UUID(fe_user_id)
    before = _txn_audit_state(txn)
    await _assert_fe_ready_for_transaction(db, fe_uuid, txn)
    now = datetime.now(timezone.utc)
    txn.delivery_mode = "fe"
    txn.delivery_fe_id = fe_uuid
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
    await _audit_transaction_action(
        db,
        admin=admin,
        action="transaction.route_fe_delivery",
        txn=txn,
        before_state=before,
        reviewer_notes=f"fe_user_id={fe_user_id}",
    )
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
    before = _txn_audit_state(txn)
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
    await _audit_transaction_action(
        db,
        admin=admin,
        action="transaction.route_courier",
        txn=txn,
        before_state=before,
        reviewer_notes=f"courier={courier_name}; booking_id={booking_id}",
    )
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
    admin: AdminUserModel = Depends(require_admin_money_role),
):
    from app.modules.transactions import return_service
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    before = _txn_audit_state(txn)
    try:
        if decision == "approve":
            await return_service.admin_approve_return(db, txn, admin_id=admin.id, note=note)
        elif decision == "reject":
            await return_service.admin_reject_return(db, txn, admin_id=admin.id, note=note)
        else:
            raise HTTPException(400, "bad_decision")
        await _audit_transaction_action(
            db,
            admin=admin,
            action=f"transaction.{decision}_return",
            txn=txn,
            before_state=before,
            reviewer_notes=note,
        )
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
    fe_uuid = UUID(fe_user_id)
    before = _txn_audit_state(txn)
    await _assert_fe_ready_for_transaction(db, fe_uuid, txn)
    try:
        await return_service.admin_assign_return_pickup(
            db, txn, admin_id=admin.id, fe_user_id=fe_uuid,
        )
        await _audit_transaction_action(
            db,
            admin=admin,
            action="transaction.assign_return_pickup_fe",
            txn=txn,
            before_state=before,
            reviewer_notes=f"fe_user_id={fe_user_id}",
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
    refund_amount_inr: str = Form(""),
    admin: AdminUserModel = Depends(require_admin_money_role),
):
    """Resolve a dispute from the admin console. Money-role gated, and routed
    through the same apply_dispute_resolution used by the JSON endpoint + the
    Temporal workflow so refunds actually move money and partial refunds honor
    an amount (no divergent inline copy)."""
    from decimal import Decimal, InvalidOperation
    from app.modules.admin.reports_disputes import Dispute, VALID_RESOLUTIONS
    from app.modules.disputes.resolution import apply_dispute_resolution
    from app.modules.transactions.refund_service import INITIATED_BY_ADMIN

    if resolution not in VALID_RESOLUTIONS:
        raise HTTPException(400, "bad_resolution")

    amount: Decimal | None = None
    if resolution == "partial_refund":
        try:
            amount = Decimal(refund_amount_inr)
        except (InvalidOperation, ValueError):
            amount = None
        if amount is None or amount <= 0:
            raise HTTPException(400, "partial_refund_amount_required")

    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(404)
    if dispute.status == "resolved":
        raise HTTPException(409, "already_resolved")

    txn = await db.get(Transaction, dispute.transaction_id)
    if amount is not None and txn is not None and amount > Decimal(str(txn.gross_amount or 0)):
        raise HTTPException(400, "refund_exceeds_gross")
    before = _txn_audit_state(txn) if txn else {}

    await apply_dispute_resolution(
        db, dispute=dispute, txn=txn, resolution=resolution,
        resolution_note=resolution_note or "", refund_amount=amount,
        initiated_by=INITIATED_BY_ADMIN,
    )
    if txn:
        await _audit_transaction_action(
            db,
            admin=admin,
            action="transaction.resolve_dispute",
            txn=txn,
            before_state=before,
            reviewer_notes=f"{resolution}: {resolution_note or ''}".strip(),
        )
    await db.commit()
    logger.info("admin.dispute_resolved", dispute_id=str(dispute_id),
                resolution=resolution, admin_id=str(admin.id))
    return RedirectResponse(url="/admin/disputes", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/admin/refunds", response_class=HTMLResponse)
async def refunds_page(
    request: Request, db: DBSession,
    admin: AdminUserModel = Depends(require_admin_money_role),
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
    admin: AdminUserModel = Depends(require_admin_money_role),
):
    from app.modules.transactions.refund_service import (
        initiate_refund, INITIATED_BY_ADMIN,
    )
    txn = await db.get(Transaction, transaction_id)
    if not txn:
        raise HTTPException(404)
    before = _txn_audit_state(txn)
    try:
        await initiate_refund(db, txn, reason=reason, initiated_by=INITIATED_BY_ADMIN)
        await _audit_transaction_action(
            db,
            admin=admin,
            action="transaction.initiate_refund",
            txn=txn,
            before_state=before,
            reviewer_notes=reason,
        )
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
    before = _txn_audit_state(txn)
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
    await _audit_transaction_action(
        db,
        admin=admin,
        action="transaction.courier_status",
        txn=txn,
        before_state=before,
        reviewer_notes=f"{new_status}: {note or ''}".strip(),
    )
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
