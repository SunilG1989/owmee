"""
Admin authentication router — Sprint 4 / Pass 3.

POST /v1/admin/auth/login — email + password → admin JWT
GET  /v1/admin/auth/me    — verify admin session

Uses bcrypt against admin_users.password_hash. Issues a short-lived (15m)
access token with role_type='admin' claim so app.core.admin_dependencies
rejects user tokens against admin endpoints and vice versa.

MFA enforcement is gated on admin_users.mfa_enabled; Phase 1 exit allows
login without MFA in non-production envs so ops can bootstrap.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import bcrypt
import structlog
from fastapi import APIRouter, HTTPException, status
from jose import jwt
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.core.admin_dependencies import AdminUser
from app.core.dependencies import DBSession
from app.core.settings import settings
from app.core.jwt import _private_key
from app.modules.admin.models import AdminUser as AdminUserModel

router = APIRouter()
logger = structlog.get_logger()


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    admin_id: str
    email: str
    admin_role: str
    name: str


def _create_admin_access_token(admin: AdminUserModel, session_id: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {
        "role_type": "admin",
        "admin_id": str(admin.id),
        "admin_role": admin.role,
        "email": admin.email,
        "session_id": session_id,
        "iat": now,
        "exp": expire,
        "jti": str(uuid4()),
        "type": "access",
    }
    return jwt.encode(payload, _private_key(), algorithm=settings.jwt_algorithm)


@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(body: AdminLoginRequest, db: DBSession):
    res = await db.execute(
        select(AdminUserModel).where(AdminUserModel.email == body.email.lower())
    )
    admin = res.scalar_one_or_none()
    if admin is None or not admin.is_active:
        # Deliberately vague — don't leak which emails exist.
        logger.warning("admin.login.failed", email=body.email.lower(), reason="not_found_or_inactive")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_CREDENTIALS", "message": "Invalid email or password."},
        )

    try:
        ok = bcrypt.checkpw(
            body.password.encode("utf-8"),
            admin.password_hash.encode("utf-8"),
        )
    except ValueError:
        ok = False
    if not ok:
        logger.warning("admin.login.failed", admin_id=str(admin.id), reason="bad_password")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_CREDENTIALS", "message": "Invalid email or password."},
        )

    # MFA: in production, require mfa_enabled + verified TOTP. For dev we skip.
    if admin.mfa_enabled and settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={"error": "MFA_REQUIRED", "message": "MFA flow pending. Contact super admin."},
        )

    session_id = str(uuid4())
    token = _create_admin_access_token(admin, session_id)
    admin.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info("admin.login.success", admin_id=str(admin.id), role=admin.role)
    return AdminLoginResponse(
        access_token=token,
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        admin_id=str(admin.id),
        email=admin.email,
        admin_role=admin.role,
        name=admin.name,
    )


@router.get("/me")
async def admin_me(current_admin: AdminUser, db: DBSession):
    res = await db.execute(
        select(AdminUserModel).where(AdminUserModel.id == current_admin.admin_id)
    )
    admin = res.scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "ADMIN_NOT_FOUND", "message": "Session no longer valid."},
        )
    return {
        "admin_id": str(admin.id),
        "email": admin.email,
        "name": admin.name,
        "admin_role": admin.role,
        "mfa_enabled": admin.mfa_enabled,
        "last_login_at": admin.last_login_at.isoformat() if admin.last_login_at else None,
    }


# ── Dev bootstrap endpoint ───────────────────────────────────────────────────
#
# In non-production, provision a Super Admin quickly so the QA script and the
# admin web UI can log in on a fresh DB. In production this raises 403.

class AdminBootstrapRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=256)
    name: str = Field(..., min_length=1, max_length=200)
    role: str = Field(default="SUPER_ADMIN")


@router.post("/dev/bootstrap")
async def admin_bootstrap(body: AdminBootstrapRequest, db: DBSession):
    if settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "DEV_ONLY", "message": "Not available in production."},
        )

    res = await db.execute(
        select(AdminUserModel).where(AdminUserModel.email == body.email.lower())
    )
    existing = res.scalar_one_or_none()
    if existing is not None:
        return {
            "admin_id": str(existing.id),
            "email": existing.email,
            "role": existing.role,
            "created": False,
        }

    pw_hash = bcrypt.hashpw(body.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    admin = AdminUserModel(
        email=body.email.lower(),
        name=body.name,
        role=body.role,
        password_hash=pw_hash,
        mfa_enabled=False,
        is_active=True,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    logger.info("admin.bootstrap", admin_id=str(admin.id), role=admin.role)
    return {
        "admin_id": str(admin.id),
        "email": admin.email,
        "role": admin.role,
        "created": True,
    }
