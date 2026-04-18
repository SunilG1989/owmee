"""
Admin RBAC dependencies — Sprint 4 / Pass 3.

Separate JWT pathway from the user JWT. Admin tokens carry:
    role_type:  "admin"
    admin_id:   UUID string of admin_users.id
    admin_role: one of L1_AGENT | L2_REVIEWER | FINANCE_OPS | RISK_ANALYST | SUPER_ADMIN

The existing `AdminUser` ORM model in app/modules/admin/models.py is the
source of truth for role assignment; the JWT is issued by POST /v1/admin/auth/login.
"""
from __future__ import annotations

from typing import Annotated, Iterable
from uuid import UUID

import structlog
from fastapi import Depends, Header, HTTPException, status

from app.core.jwt import decode_token

logger = structlog.get_logger()

ADMIN_ROLES = {
    "L1_AGENT",
    "L2_REVIEWER",
    "FINANCE_OPS",
    "RISK_ANALYST",
    "SUPER_ADMIN",
}


class CurrentAdmin:
    def __init__(
        self,
        admin_id: str,
        admin_role: str,
        email: str,
        session_id: str,
    ):
        self.admin_id = UUID(admin_id)
        self.admin_role = admin_role
        self.email = email
        self.session_id = session_id

    def has_role(self, *roles: str) -> bool:
        return self.admin_role in roles or self.admin_role == "SUPER_ADMIN"


def _decode_admin(authorization: str | None) -> CurrentAdmin | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
    except (ValueError, KeyError):
        return None
    if payload.get("type") != "access":
        return None
    if payload.get("role_type") != "admin":
        return None
    try:
        return CurrentAdmin(
            admin_id=payload["admin_id"],
            admin_role=payload["admin_role"],
            email=payload.get("email", ""),
            session_id=payload.get("session_id", ""),
        )
    except KeyError:
        return None


async def require_admin(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentAdmin:
    """Any authenticated admin (any admin_role)."""
    admin = _decode_admin(authorization)
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "error": "ADMIN_AUTH_REQUIRED",
                "message": "Sign in to the admin console to continue.",
            },
        )
    if admin.admin_role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "ADMIN_ROLE_INVALID",
                "message": f"Unknown admin role: {admin.admin_role}",
            },
        )
    return admin


def require_admin_roles(*allowed: str):
    """
    Factory: returns a dependency that only admits admins whose admin_role is
    in `allowed` (SUPER_ADMIN always admitted).
    """
    allowed_set = set(allowed)

    async def _dep(
        authorization: Annotated[str | None, Header()] = None,
    ) -> CurrentAdmin:
        admin = await require_admin(authorization=authorization)
        if admin.admin_role == "SUPER_ADMIN":
            return admin
        if admin.admin_role not in allowed_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "ADMIN_ROLE_FORBIDDEN",
                    "message": (
                        f"Role {admin.admin_role} cannot perform this action. "
                        f"Allowed: {sorted(allowed_set)}"
                    ),
                },
            )
        return admin

    return _dep


# Pre-built role gates used across the admin routers.
require_l1_or_above = require_admin_roles("L1_AGENT", "L2_REVIEWER", "FINANCE_OPS", "RISK_ANALYST")
require_l2_reviewer = require_admin_roles("L2_REVIEWER")
require_finance_ops = require_admin_roles("FINANCE_OPS")
require_risk_analyst = require_admin_roles("RISK_ANALYST")


AdminUser = Annotated[CurrentAdmin, Depends(require_admin)]
AdminL2 = Annotated[CurrentAdmin, Depends(require_l2_reviewer)]
AdminFinance = Annotated[CurrentAdmin, Depends(require_finance_ops)]
AdminAny = Annotated[CurrentAdmin, Depends(require_l1_or_above)]
