"""
Admin RBAC dependencies — Sprint 4 / Pass 3.

Separate JWT pathway from the user JWT. Admin tokens carry:
    role_type:  "admin"
    admin_id:   UUID string of admin_users.id
    admin_role: one of ADMIN_ROLES below

The existing `AdminUser` ORM model in app/modules/admin/models.py is the
source of truth for role assignment; the JWT is issued by POST /v1/admin/auth/login.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

import structlog
from fastapi import Depends, Header, HTTPException, status

from app.core.jwt import decode_token

logger = structlog.get_logger()

ADMIN_ROLE_DEFINITIONS = {
    "L1_AGENT": {
        "label": "L1 agent",
        "description": "Read queues, triage basic issues, resolve non-money workflow alerts.",
        "capabilities": ["read_ops_queues", "resolve_stuck_workflows"],
    },
    "L1_SUPPORT": {
        "label": "L1 support",
        "description": "Customer-support equivalent of L1 agent for launch operations.",
        "capabilities": ["read_ops_queues", "resolve_stuck_workflows"],
    },
    "OPS_DISPATCHER": {
        "label": "Ops dispatcher",
        "description": "Assign FE pickup/delivery work and manage logistics queues.",
        "capabilities": ["read_ops_queues", "assign_fe_work", "resolve_stuck_workflows"],
    },
    "FE_MANAGER": {
        "label": "FE manager",
        "description": "Onboard, verify, activate, suspend, and capacity-manage field executives.",
        "capabilities": ["read_ops_queues", "manage_field_executives", "assign_fe_work"],
    },
    "LISTING_REVIEWER": {
        "label": "Listing reviewer",
        "description": "Approve, reject, or send back listings and Direct inventory.",
        "capabilities": ["read_ops_queues", "review_listings", "review_direct_inventory"],
    },
    "WAREHOUSE_OPS": {
        "label": "Warehouse ops",
        "description": "Receive Direct inventory, record custody issues, and manage rework/quarantine.",
        "capabilities": ["read_ops_queues", "warehouse_receiving", "inventory_custody"],
    },
    "L2_REVIEWER": {
        "label": "L2 reviewer",
        "description": "Approve higher-risk reviews across listings, FE, disputes, and compliance.",
        "capabilities": ["read_ops_queues", "approve_high_risk_reviews", "review_listings", "manage_field_executives"],
    },
    "FINANCE_OPS": {
        "label": "Finance ops",
        "description": "Handle payouts, refunds, payment exceptions, and money-moving queues.",
        "capabilities": ["read_ops_queues", "manage_refunds", "manage_payouts"],
    },
    "RISK_ANALYST": {
        "label": "Risk analyst",
        "description": "Investigate fraud, dispute, policy, and trust-safety cases.",
        "capabilities": ["read_ops_queues", "review_risk", "review_disputes"],
    },
    "OPS_MANAGER": {
        "label": "Ops manager",
        "description": "Launch operations lead with broad non-super-admin permissions.",
        "capabilities": [
            "read_ops_queues", "assign_fe_work", "manage_field_executives",
            "review_listings", "review_direct_inventory", "warehouse_receiving",
        ],
    },
    "SUPER_ADMIN": {
        "label": "Super admin",
        "description": "Break-glass owner for admin users, role changes, and production-critical overrides.",
        "capabilities": ["all_admin_capabilities", "manage_admin_users", "view_super_admin_actions"],
    },
}

ADMIN_ROLES = set(ADMIN_ROLE_DEFINITIONS.keys())

READ_ONLY_ADMIN_ROLES = tuple(role for role in ADMIN_ROLE_DEFINITIONS if role != "SUPER_ADMIN")
L2_ADMIN_ROLES = (
    "L2_REVIEWER",
    "LISTING_REVIEWER",
    "FE_MANAGER",
    "WAREHOUSE_OPS",
    "OPS_MANAGER",
)
FINANCE_ADMIN_ROLES = ("FINANCE_OPS", "OPS_MANAGER")
RISK_ADMIN_ROLES = ("RISK_ANALYST", "OPS_MANAGER")


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


# Pre-built role gates used across the admin routers. SUPER_ADMIN is admitted
# by require_admin_roles for every gate; these tuples describe non-super roles.
require_l1_or_above = require_admin_roles(*READ_ONLY_ADMIN_ROLES)
require_l2_reviewer = require_admin_roles(*L2_ADMIN_ROLES)
require_finance_ops = require_admin_roles(*FINANCE_ADMIN_ROLES)
require_risk_analyst = require_admin_roles(*RISK_ADMIN_ROLES)
require_super_admin = require_admin_roles("SUPER_ADMIN")


AdminUser = Annotated[CurrentAdmin, Depends(require_admin)]
AdminL2 = Annotated[CurrentAdmin, Depends(require_l2_reviewer)]
AdminFinance = Annotated[CurrentAdmin, Depends(require_finance_ops)]
AdminAny = Annotated[CurrentAdmin, Depends(require_l1_or_above)]
AdminSuper = Annotated[CurrentAdmin, Depends(require_super_admin)]
