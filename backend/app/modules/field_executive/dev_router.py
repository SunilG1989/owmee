"""
Dev endpoints for Field Executive — Sprint 4 / Pass 2.

POST /v1/dev/make-fe/{phone}  — promote existing user to FE (dev only)

Mounted under /v1 by main.py.
"""
from fastapi import APIRouter, HTTPException
import structlog
from sqlalchemy import select

from app.core.dependencies import DBSession
from app.core.settings import settings
from app.modules.field_executive import service as fe_service
from app.modules.identity_auth.models import User

router = APIRouter()
logger = structlog.get_logger()


@router.post("/dev/make-fe/{phone}")
async def make_fe(phone: str, db: DBSession, city: str = "Bengaluru"):
    """
    Dev-only: promote an existing OTP-verified user (by phone) to FE role.
    The user keeps their existing User row — we add a FieldExecutive row that
    lights up the 'fe' role claim on their next token.
    """
    if settings.env != "development":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "DEV_ONLY",
                "message": "This endpoint is only available in development.",
            },
        )

    # Normalize Indian phone format for the lookup
    normalized = phone if phone.startswith("+") else f"+91{phone.lstrip('0')}"

    res = await db.execute(select(User).where(User.phone_number == normalized))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "USER_NOT_FOUND",
                "message": f"No user with phone {normalized}. Sign in via OTP first.",
            },
        )

    fe = await fe_service.create_fe_for_user(db, user=user, city=city)
    await db.commit()
    logger.info("dev.make_fe", user_id=str(user.id), fe_code=fe.fe_code)
    return {
        "user_id": str(user.id),
        "phone": user.phone_number,
        "fe_code": fe.fe_code,
        "city": fe.city,
        "message": "User promoted to FE. They must log out + log in again to get the new 'fe' role claim on their token.",
    }
