"""
Admin seed script — Epic 6

POST /v1/admin/seed    — create first admin user (dev only)
GET  /v1/admin/users   — list admin users (dev only)
"""
import hashlib

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.dependencies import DBSession
from app.core.settings import settings
from app.modules.admin.models import AdminUser

logger = structlog.get_logger()
router = APIRouter()


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


class CreateAdminRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=254)
    name: str = Field(..., min_length=2, max_length=200)
    role: str = Field(..., pattern="^(L1_AGENT|L2_REVIEWER|FINANCE_OPS|RISK_ANALYST|SUPER_ADMIN)$")
    password: str = Field(..., min_length=8, max_length=100)


@router.post("/admin/seed", status_code=201)
async def seed_admin_user(body: CreateAdminRequest, db: DBSession):
    if settings.env == "production":
        raise HTTPException(status_code=404)

    result = await db.execute(select(AdminUser).where(AdminUser.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail={
            "error": "EMAIL_EXISTS",
            "message": "An admin user with this email already exists.",
        })

    admin = AdminUser(
        email=body.email,
        name=body.name,
        role=body.role,
        password_hash=_hash_password(body.password),
        is_active=True,
    )
    db.add(admin)
    await db.commit()
    logger.info("admin.user_created", email=body.email, role=body.role)
    return {
        "admin_id": str(admin.id),
        "email": admin.email,
        "name": admin.name,
        "role": admin.role,
        "message": f"Admin user created. Role: {admin.role}",
    }


@router.get("/admin/users")
async def list_admin_users(db: DBSession):
    if settings.env == "production":
        raise HTTPException(status_code=404)
    result = await db.execute(select(AdminUser).where(AdminUser.is_active == True))
    admins = result.scalars().all()
    return {"admins": [
        {"id": str(a.id), "email": a.email, "name": a.name, "role": a.role}
        for a in admins
    ]}
