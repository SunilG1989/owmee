"""Admin authentication — Sprint 4 / Pass 4a.

Changes from Pass 3:
  - login + bootstrap now issue access + refresh token pair
  - new POST /refresh endpoint: validates refresh token from DB, rotates it,
    issues a new access + refresh pair
  - refresh tokens are stored as sha256 hashes server-side with revocation
    support; when rotated, the old token is marked revoked and linked to
    the new token for reuse detection

Compatibility: the access token format is unchanged (JWT with role_type='admin',
admin_id, admin_role claims). Existing admin endpoints keep working with the
same access token. Only the login *response shape* grows a refresh_token field.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import bcrypt
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_dependencies import AdminUser
from app.core.jwt import _private_key
from jose import jwt
from app.core.settings import settings
from app.core.dependencies import DBSession
from app.modules.admin.models import AdminUser as AdminUserModel


logger = structlog.get_logger(__name__)
router = APIRouter(tags=["admin-auth"])


# ── Refresh-token config ────────────────────────────────────────────────────
REFRESH_TOKEN_BYTES = 32  # 256 bits of entropy
REFRESH_TOKEN_DAYS = 14


def _hash_refresh(token: str) -> str:
    """SHA-256 hex. Fast, deterministic; we compare by hash on lookup."""
    return hashlib.sha256(token.encode()).hexdigest()


def _new_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, hash). Raw goes to client; hash goes to DB."""
    raw = secrets.token_urlsafe(REFRESH_TOKEN_BYTES)
    return raw, _hash_refresh(raw)


# ── Schemas ─────────────────────────────────────────────────────────────────
class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class AdminRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20)


class AdminLoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access token expires
    admin_id: str
    email: str
    admin_role: str
    name: str


class AdminBootstrapRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)
    role: str = Field(default="SUPER_ADMIN")


# ── Helpers ─────────────────────────────────────────────────────────────────
async def _issue_token_pair(
    db: AsyncSession,
    admin: AdminUserModel,
    previous_refresh_id: Optional[uuid.UUID] = None,
) -> AdminLoginResponse:
    """Mint a fresh access + refresh pair and store the refresh hash."""
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    access_exp = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    access_payload = {
        "role_type": "admin",
        "admin_id": str(admin.id),
        "admin_role": admin.role,
        "email": admin.email,
        "session_id": session_id,
        "iat": now,
        "exp": access_exp,
        "jti": str(uuid.uuid4()),
        "type": "access",
    }
    access_token = jwt.encode(
        access_payload, _private_key(), algorithm=settings.jwt_algorithm
    )
    raw_refresh, hash_refresh = _new_refresh_token()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=REFRESH_TOKEN_DAYS)

    # Import locally to avoid circular imports at module load
    from app.modules.admin.models import AdminRefreshToken

    rt_row = AdminRefreshToken(
        admin_id=admin.id,
        token_hash=hash_refresh,
        expires_at=expires_at,
    )
    db.add(rt_row)
    await db.flush()

    if previous_refresh_id is not None:
        # Link old token to new one so we can detect token-reuse attacks
        await db.execute(
            update(AdminRefreshToken)
            .where(AdminRefreshToken.id == previous_refresh_id)
            .values(rotated_to_id=rt_row.id)
        )

    return AdminLoginResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        expires_in=settings.jwt_access_token_expire_minutes * 60,
        admin_id=str(admin.id),
        email=admin.email,
        admin_role=admin.role,
        name=admin.name,
    )


# ── Endpoints ───────────────────────────────────────────────────────────────
@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(
    body: AdminLoginRequest,
    db: DBSession,
):
    """Verify email+password, issue access + refresh token pair."""
    res = await db.execute(
        select(AdminUserModel).where(AdminUserModel.email == body.email.lower())
    )
    admin = res.scalar_one_or_none()

    # Vague error on purpose: do not leak which field is wrong
    if admin is None or not admin.is_active:
        logger.info("admin.login.rejected", email=body.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_CREDENTIALS",
                    "message": "Email or password is incorrect."},
        )
    if not bcrypt.checkpw(body.password.encode(), admin.password_hash.encode()):
        logger.info("admin.login.bad_password", admin_id=str(admin.id))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_CREDENTIALS",
                    "message": "Email or password is incorrect."},
        )

    admin.last_login_at = datetime.now(timezone.utc)
    response = await _issue_token_pair(db, admin)
    await db.commit()
    logger.info("admin.login.ok", admin_id=str(admin.id), role=admin.role)
    return response


@router.post("/refresh", response_model=AdminLoginResponse)
async def admin_refresh(
    body: AdminRefreshRequest,
    db: DBSession,
):
    """Trade a valid refresh token for a new access + refresh pair.

    Design:
      - Look up refresh token by its sha256 hash (indexed).
      - Reject if revoked, expired, or not found.
      - On reuse of an already-rotated token (rotated_to_id is set), revoke
        the entire chain for that admin — likely compromised.
      - On success, issue new pair and link rotation.
    """
    from app.modules.admin.models import AdminRefreshToken

    token_hash = _hash_refresh(body.refresh_token)
    res = await db.execute(
        select(AdminRefreshToken).where(AdminRefreshToken.token_hash == token_hash)
    )
    rt = res.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if rt is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_REFRESH_TOKEN",
                    "message": "Refresh token is invalid or already used."},
        )

    if rt.revoked_at is not None or rt.expires_at <= now:
        # Already-revoked token being reused → aggressive revoke of the admin
        if rt.rotated_to_id is not None:
            logger.warning(
                "admin.refresh.reuse_detected",
                admin_id=str(rt.admin_id),
                token_id=str(rt.id),
            )
            await db.execute(
                update(AdminRefreshToken)
                .where(
                    AdminRefreshToken.admin_id == rt.admin_id,
                    AdminRefreshToken.revoked_at.is_(None),
                )
                .values(revoked_at=now)
            )
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_REFRESH_TOKEN",
                    "message": "Refresh token is invalid or already used."},
        )

    # Load admin
    res = await db.execute(
        select(AdminUserModel).where(AdminUserModel.id == rt.admin_id)
    )
    admin = res.scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "ADMIN_INACTIVE",
                    "message": "Admin account is no longer active."},
        )

    # Revoke the old token (it's being rotated now)
    rt.revoked_at = now

    response = await _issue_token_pair(
        db, admin, previous_refresh_id=rt.id
    )
    await db.commit()
    logger.info("admin.refresh.ok", admin_id=str(admin.id))
    return response


@router.get("/me")
async def admin_me(current_admin: AdminUser, db: DBSession):
    """Return the current admin's profile. Used by web console to verify token.

    Loads the full AdminUser row so we can return fields (name, mfa_enabled,
    last_login_at) that aren't in the JWT-claims-only CurrentAdmin dataclass.
    """
    res = await db.execute(
        select(AdminUserModel).where(AdminUserModel.id == current_admin.admin_id)
    )
    admin = res.scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "ADMIN_NOT_FOUND",
                    "message": "Session no longer valid."},
        )
    return {
        "admin_id": str(admin.id),
        "email": admin.email,
        "name": admin.name,
        "admin_role": admin.role,
        "is_active": admin.is_active,
        "mfa_enabled": admin.mfa_enabled,
        "last_login_at": admin.last_login_at.isoformat() if admin.last_login_at else None,
        "created_at": admin.created_at.isoformat() if admin.created_at else None,
    }


@router.post("/logout")
async def admin_logout(
    current_admin: AdminUser,
    body: AdminRefreshRequest,
    db: DBSession,
):
    """Revoke a refresh token. Access token stays valid until its 15-min expiry
    (standard JWT — we don't maintain a blocklist for access tokens)."""
    from app.modules.admin.models import AdminRefreshToken

    token_hash = _hash_refresh(body.refresh_token)
    now = datetime.now(timezone.utc)
    res = await db.execute(
        update(AdminRefreshToken)
        .where(
            AdminRefreshToken.token_hash == token_hash,
            AdminRefreshToken.admin_id == current_admin.admin_id,
            AdminRefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    await db.commit()
    return {"revoked": res.rowcount}


@router.post("/dev/bootstrap", response_model=AdminLoginResponse)
async def admin_bootstrap(
    body: AdminBootstrapRequest,
    db: DBSession,
):
    """Dev-only: create a super admin without MFA. Blocked in production.

    Returns a login-ready token pair so the caller can log in immediately.
    """
    if settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "BOOTSTRAP_DISABLED",
                    "message": "Bootstrap is not available in production."},
        )

    # If already exists, log in (idempotent for QA runs)
    res = await db.execute(
        select(AdminUserModel).where(AdminUserModel.email == body.email.lower())
    )
    existing = res.scalar_one_or_none()
    if existing is not None:
        if not bcrypt.checkpw(body.password.encode(), existing.password_hash.encode()):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "ADMIN_EXISTS",
                        "message": "Admin with this email already exists with a different password."},
            )
        existing.last_login_at = datetime.now(timezone.utc)
        response = await _issue_token_pair(db, existing)
        await db.commit()
        return response

    # New admin
    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    admin = AdminUserModel(
        email=body.email.lower(),
        password_hash=hashed,
        name=body.name,
        role=body.role,
        is_active=True,
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(admin)
    await db.flush()

    response = await _issue_token_pair(db, admin)
    await db.commit()
    logger.info(
        "admin.bootstrap.ok",
        admin_id=str(admin.id),
        email=admin.email,
        role=admin.role,
    )
    return response
