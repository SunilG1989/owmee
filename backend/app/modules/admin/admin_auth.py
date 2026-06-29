"""Admin auth dependency — production-grade replacement for the
permissive `pass` stubs that lived inline in admin/kyc_queue.py and
transactions/logistics_router.py.

Verifies the Authorization header against the admin JWT signing key
(same RSA pair as the user JWT, keyed apart by `role_type`='admin' in
the claims). Returns a CurrentAdmin handle the route can use; raises
401 with a generic message on any failure (don't leak why).

Why this exists
---------------
The earlier stubs were written when admin endpoints were prototype
plumbing. Leaving them in place once the same modules started
managing real money paths (refund queue, hub dispatch, dispute
resolution) was a real exposure: anyone hitting /v1/admin/logistics/*
with no token could have routed transactions to themselves as FE.

Two roles
---------
The admin_users table has a `role` column (SUPER_ADMIN, L1_REVIEWER,
L2_REVIEWER, FINANCE, RISK). For now we expose:

  require_admin       — any active admin
  require_l2_reviewer — KYC L2 sign-off (matches the prior stub name)

Add more dependencies (require_finance, require_risk, …) here as
endpoints surface a need.
"""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import structlog
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import DBSession
from app.core.jwt import decode_token
from app.modules.admin.models import AdminUser as AdminUserModel

logger = structlog.get_logger()


@dataclass(frozen=True)
class CurrentAdmin:
    admin_id: UUID
    role: str
    email: str
    session_id: str


_INVALID = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail={"error": "INVALID_ADMIN_TOKEN", "message": "Sign in to the admin console."},
    # Force any browser/client cache holding a stale 200 to retry
    headers={"WWW-Authenticate": "Bearer"},
)


async def _resolve_admin(authorization: str | None, db: AsyncSession) -> CurrentAdmin:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _INVALID
    token = authorization[7:].strip()
    if not token:
        raise _INVALID

    try:
        payload = decode_token(token)
    except ValueError:
        raise _INVALID

    # role_type='admin' separates admin tokens from user tokens (which
    # share the same signing key). type='access' rejects refresh tokens.
    if payload.get("role_type") != "admin" or payload.get("type") != "access":
        raise _INVALID

    admin_id_str = payload.get("admin_id")
    role = payload.get("admin_role")
    email = payload.get("email", "")
    session_id = payload.get("session_id", "")
    if not admin_id_str or not role:
        raise _INVALID

    try:
        admin_id = UUID(admin_id_str)
    except (TypeError, ValueError):
        raise _INVALID

    # Verify the admin row still exists + is active (revoked accounts
    # shouldn't be able to keep using a token until expiry).
    res = await db.execute(select(AdminUserModel).where(AdminUserModel.id == admin_id))
    admin = res.scalar_one_or_none()
    if admin is None or not admin.is_active:
        logger.info("admin_auth.deactivated_token_use", admin_id=admin_id_str)
        raise _INVALID

    return CurrentAdmin(admin_id=admin_id, role=role, email=email, session_id=session_id)


async def require_admin(
    db: DBSession,
    authorization: str | None = Header(default=None),
) -> CurrentAdmin:
    """Any active admin (any role)."""
    return await _resolve_admin(authorization, db)


# Roles allowed to approve / reject KYC. SUPER_ADMIN is included so
# super-admins can step in for an L2 reviewer when needed.
_L2_ROLES = {"L2_REVIEWER", "SUPER_ADMIN"}
_MONEY_ROLES = {"FINANCE_OPS", "FINANCE", "L2_REVIEWER", "SUPER_ADMIN"}


async def require_l2_reviewer(
    db: DBSession,
    authorization: str | None = Header(default=None),
) -> CurrentAdmin:
    """L2 KYC reviewer or super-admin."""
    admin = await _resolve_admin(authorization, db)
    if admin.role not in _L2_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "L2_ROLE_REQUIRED",
                    "message": "L2 reviewer or super-admin role required."},
        )
    return admin


async def require_money_admin(
    db: DBSession,
    authorization: str | None = Header(default=None),
) -> CurrentAdmin:
    """Finance/L2/super-admin gate for irreversible money-moving actions."""
    admin = await _resolve_admin(authorization, db)
    if admin.role not in _MONEY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "MONEY_ROLE_REQUIRED",
                "message": "Finance, L2 reviewer, or super-admin role required.",
            },
        )
    return admin
