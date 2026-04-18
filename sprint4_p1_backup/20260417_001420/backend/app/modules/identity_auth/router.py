from datetime import datetime, timedelta, timezone
from uuid import uuid4
import hashlib

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
import phonenumbers
import structlog

from app.core.dependencies import AuthUser, DBSession
from app.core.jwt import create_access_token, create_refresh_token
from app.core.redis import get_redis
from app.core.settings import settings

router = APIRouter()
logger = structlog.get_logger()


# ── Schemas ────────────────────────────────────────────────────────────────────

class SendOTPRequest(BaseModel):
    phone_number: str = Field(..., min_length=10, max_length=15, examples=["+919876543210"])


class VerifyOTPRequest(BaseModel):
    phone_number: str
    otp: str = Field(..., min_length=6, max_length=6)
    device_id: str | None = None
    device_model: str | None = None
    os: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    tier: str
    kyc_status: str


class RefreshRequest(BaseModel):
    refresh_token: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalise_phone(raw: str) -> str:
    try:
        parsed = phonenumbers.parse(raw, "IN")
        if not phonenumbers.is_valid_number(parsed):
            raise ValueError("Invalid number")
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "INVALID_PHONE", "message": "Enter a valid Indian mobile number."},
        )


def _otp_rate_key(phone: str) -> str:
    return f"otp:rate:{phone}"


def _otp_value_key(phone: str) -> str:
    return f"otp:value:{phone}"


def _otp_attempts_key(phone: str) -> str:
    return f"otp:attempts:{phone}"


def _otp_lock_key(phone: str) -> str:
    return f"otp:lock:{phone}"


async def _check_rate_limit(phone: str) -> None:
    # Fix #30: Skip rate limit in dev — OTP is logged to console anyway
    if settings.env == "development":
        return
    redis = await get_redis()
    key = _otp_rate_key(phone)
    count = await redis.get(key)
    if count and int(count) >= settings.otp_rate_limit_per_hour:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "OTP_RATE_LIMIT", "message": "Too many OTP requests. Try again in an hour."},
        )


async def _store_otp(phone: str, otp: str) -> None:
    redis = await get_redis()
    # Store OTP with 10 min expiry
    await redis.setex(_otp_value_key(phone), 600, otp)
    # Increment rate counter with 1 hour expiry
    rate_key = _otp_rate_key(phone)
    await redis.incr(rate_key)
    await redis.expire(rate_key, 3600)
    # Reset attempt counter
    await redis.delete(_otp_attempts_key(phone))


async def _verify_otp(phone: str, submitted_otp: str) -> None:
    redis = await get_redis()

    # Check if number is locked
    lock = await redis.get(_otp_lock_key(phone))
    if lock:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "OTP_LOCKED", "message": "Too many incorrect attempts. Try again in 30 minutes."},
        )

    stored_otp = await redis.get(_otp_value_key(phone))
    if not stored_otp or stored_otp != submitted_otp:
        # Increment failure counter
        attempts_key = _otp_attempts_key(phone)
        attempts = await redis.incr(attempts_key)
        await redis.expire(attempts_key, 3600)
        if int(attempts) >= settings.otp_max_attempts:
            await redis.setex(_otp_lock_key(phone), 1800, "1")  # 30 min lock
            await redis.delete(_otp_value_key(phone))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_OTP", "message": "Incorrect OTP. Check and try again."},
        )

    # Valid — clean up
    await redis.delete(_otp_value_key(phone))
    await redis.delete(_otp_attempts_key(phone))


def _generate_otp() -> str:
    """6-digit OTP — use secrets in production."""
    import secrets
    return str(secrets.randbelow(900000) + 100000)


async def _send_sms(phone: str, otp: str) -> None:
    """Send OTP via DLT-registered SMS. Stub in dev."""
    if settings.env == "development":
        logger.info("otp.dev_bypass", phone=phone, otp=otp)
        return
    # TODO: integrate MSG91 / Gupshup with DLT template ID
    raise NotImplementedError("SMS provider not configured")


async def _get_or_create_user(db: DBSession, phone: str):
    from sqlalchemy import select
    from app.modules.identity_auth.models import User
    result = await db.execute(select(User).where(User.phone_number == phone))
    user = result.scalar_one_or_none()
    if not user:
        user = User(
            phone_number=phone,
            phone_verified=True,
            tier="basic",
            kyc_status="not_started",
        )
        db.add(user)
        await db.flush()
        logger.info("user.created", user_id=str(user.id))
    else:
        user.phone_verified = True
    return user


def _user_to_dict(user) -> dict:
    """Standard user response — reused by /me and /me/profile."""
    return {
        "id": str(user.id),
        "user_id": str(user.id),
        "phone_number": user.phone_number,
        "phone_verified": user.phone_verified,
        "tier": user.tier,
        "kyc_status": user.kyc_status,
        "trust_score": user.trust_score,
        "name": user.name,
        "email": user.email,
        "address_house": user.address_house,
        "address_street": user.address_street,
        "address_locality": user.address_locality,
        "address_city": user.address_city,
        "address_pincode": user.address_pincode,
        "address_state": user.address_state,
        "num_kids": user.num_kids,
        "kids_age_range": user.kids_age_range,
        "created_at": user.created_at.isoformat() if hasattr(user, 'created_at') and user.created_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/otp/send", status_code=status.HTTP_204_NO_CONTENT)
async def send_otp(body: SendOTPRequest, request: Request):
    """Send OTP to phone number. Rate limited to 3/hour."""
    phone = _normalise_phone(body.phone_number)
    await _check_rate_limit(phone)
    otp = _generate_otp()
    await _store_otp(phone, otp)
    await _send_sms(phone, otp)
    logger.info("otp.sent", phone_suffix=phone[-4:])


@router.post("/otp/verify", response_model=TokenResponse)
async def verify_otp(body: VerifyOTPRequest, db: DBSession):
    """Verify OTP and issue JWT. Creates user on first visit."""
    phone = _normalise_phone(body.phone_number)
    await _verify_otp(phone, body.otp)

    user = await _get_or_create_user(db, phone)

    session_id = str(uuid4())
    access_token = create_access_token(
        user_id=str(user.id),
        session_id=session_id,
        phone_verified=True,
        tier=user.tier,
        kyc_status=user.kyc_status,
    )
    refresh_token = create_refresh_token(
        user_id=str(user.id),
        session_id=session_id,
    )

    # Store refresh token hash in DB
    from app.modules.identity_auth.models import Session as UserSession
    refresh_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        device_fingerprint=body.device_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_token_expire_days),
    )
    db.add(session)

    logger.info("auth.verified", user_id=str(user.id), tier=user.tier)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        tier=user.tier,
        kyc_status=user.kyc_status,
    )


@router.post("/token/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: DBSession):
    """Issue a new access token using a valid refresh token."""
    from sqlalchemy import select
    from app.core.jwt import decode_token
    from app.modules.identity_auth.models import Session as UserSession, User

    try:
        payload = decode_token(body.refresh_token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "INVALID_REFRESH_TOKEN"},
        )

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "INVALID_TOKEN_TYPE"})

    refresh_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()
    result = await db.execute(
        select(UserSession).where(
            UserSession.refresh_token_hash == refresh_hash,
            UserSession.is_revoked == False,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "SESSION_REVOKED"})

    user_result = await db.execute(select(User).where(User.id == session.user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"error": "USER_INACTIVE"})

    new_access = create_access_token(
        user_id=str(user.id),
        session_id=payload["session_id"],
        phone_verified=user.phone_verified,
        tier=user.tier,
        kyc_status=user.kyc_status,
    )

    return TokenResponse(
        access_token=new_access,
        refresh_token=body.refresh_token,
        tier=user.tier,
        kyc_status=user.kyc_status,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(current_user: AuthUser, body: RefreshRequest, db: DBSession):
    """Revoke session by invalidating refresh token."""
    from sqlalchemy import select
    from app.modules.identity_auth.models import Session as UserSession

    refresh_hash = hashlib.sha256(body.refresh_token.encode()).hexdigest()
    result = await db.execute(
        select(UserSession).where(UserSession.refresh_token_hash == refresh_hash)
    )
    session = result.scalar_one_or_none()
    if session:
        session.is_revoked = True
        session.revoked_at = datetime.now(timezone.utc)

    logger.info("auth.logout", user_id=str(current_user.user_id))


@router.get("/me")
async def get_me(current_user: AuthUser, db: DBSession):
    """Return full user profile from DB (not just JWT claims)."""
    from sqlalchemy import select
    from app.modules.identity_auth.models import User

    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})
    return _user_to_dict(user)


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    email: str | None = None
    address_house: str | None = None
    address_street: str | None = None
    address_locality: str | None = None
    address_city: str | None = None
    address_pincode: str | None = None
    address_state: str | None = None
    num_kids: int | None = None
    kids_age_range: str | None = None


@router.patch("/me/profile")
async def update_profile(
    body: UpdateProfileRequest,
    current_user: AuthUser,
    db: DBSession,
):
    """
    Update user profile — name, email, address, parent fields.
    Accepts JSON body. Only provided (non-null) fields are updated.
    """
    from sqlalchemy import select
    from app.modules.identity_auth.models import User

    result = await db.execute(select(User).where(User.id == current_user.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    # Update only fields that were explicitly provided
    sanitizers = {
        'name': lambda v: v[:200] if v else v,
        'email': lambda v: v[:320] if v else v,
        'address_house': lambda v: v[:500] if v else v,
        'address_street': lambda v: v[:500] if v else v,
        'address_locality': lambda v: v[:200] if v else v,
        'address_city': lambda v: v[:100] if v else v,
        'address_pincode': lambda v: v[:10] if v else v,
        'address_state': lambda v: v[:100] if v else v,
        'num_kids': lambda v: max(0, min(v, 10)) if v is not None else v,
        'kids_age_range': lambda v: v[:20] if v else v,
    }

    for field, sanitize in sanitizers.items():
        val = getattr(body, field, None)
        if val is not None:
            setattr(user, field, sanitize(val))

    await db.commit()
    return _user_to_dict(user)


# ── Sprint 1: Public seller profile ──────────────────────────────
@router.get("/users/{user_id}/public")
async def get_public_profile(user_id: str, db: DBSession):
    """Public seller profile — no auth required. Does NOT expose PII."""
    from uuid import UUID
    from sqlalchemy import select, func
    from app.modules.identity_auth.models import User

    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "INVALID_USER_ID"})

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    # Count active listings
    try:
        from app.modules.listings.models import Listing
        listing_count = await db.execute(
            select(func.count(Listing.id)).where(
                Listing.seller_id == uid,
                Listing.status == "active"
            )
        )
        active_listings = listing_count.scalar() or 0
    except Exception:
        active_listings = 0

    # Count completed deals + avg rating
    try:
        from app.modules.offers.models import Transaction
        deal_count_result = await db.execute(
            select(func.count(Transaction.id)).where(
                Transaction.seller_id == uid,
                Transaction.status == "completed"
            )
        )
        deal_count = deal_count_result.scalar() or 0
    except Exception:
        deal_count = 0

    avg_rating = None
    try:
        from app.modules.offers.models import Rating
        rating_result = await db.execute(
            select(func.avg(Rating.stars)).where(Rating.rated_user_id == uid)
        )
        raw = rating_result.scalar()
        if raw is not None:
            avg_rating = round(float(raw), 1)
    except Exception:
        pass

    return {
        "id": str(user.id),
        "name": user.name,
        "city": user.address_city,
        "kyc_verified": user.kyc_status == "verified",
        "trust_score": user.trust_score,
        "avg_rating": avg_rating,
        "deal_count": deal_count,
        "active_listings_count": active_listings,
        "member_since": user.created_at.isoformat() if hasattr(user, 'created_at') and user.created_at else None,
    }
