from datetime import datetime, timedelta, timezone
from uuid import uuid4
import hashlib

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from pydantic import BaseModel, Field
import phonenumbers
import structlog

from app.core.dependencies import AuthUser, DBSession
from app.core.jwt import create_access_token, create_refresh_token
from app.core.rate_limit import OTP_PER_IP, OTP_VERIFY_PER_IP, limit_by_ip
from app.core.redis import get_redis
from app.core.settings import settings
from app.modules.identity_auth.sms_adapter import (
    get_sms_adapter,
    sms_provider_is_mock,
)
from app.modules.verification.service import (
    record_phone_otp_verified,
    run_onboarding_fraud_check,
)

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
    user_id: str
    token_type: str = "Bearer"
    tier: str
    kyc_status: str
    # Sprint 4 / v3 additions
    auth_state: str
    buyer_eligible: bool
    seller_tier: str
    # Sprint 4 / Pass 2 addition
    role: str


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
    # Fix #30: Skip rate limit in dev — OTP is logged to console anyway.
    # Private Render staging currently runs SMS_PROVIDER=mock. In that mode
    # there is no real SMS delivery, so users must be able to use the fixed
    # pilot OTP without getting stuck behind production SMS rate limits.
    if settings.env == "development" or _uses_fixed_otp(phone):
        return
    redis = await get_redis()
    key = _otp_rate_key(phone)
    count = await redis.get(key)
    if count and int(count) >= settings.otp_rate_limit_per_hour:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "OTP_RATE_LIMIT", "message": "Too many OTP requests. Try again in an hour."},
        )


async def _store_otp(phone: str, otp: str, *, count_rate: bool = True) -> None:
    redis = await get_redis()
    # Store OTP with 10 min expiry
    await redis.setex(_otp_value_key(phone), 600, otp)
    if count_rate:
        # Increment rate counter with 1 hour expiry
        rate_key = _otp_rate_key(phone)
        await redis.incr(rate_key)
        await redis.expire(rate_key, 3600)
    # NOTE: deliberately do NOT clear the failed-attempt counter or lock here.
    # Clearing them on every resend let an attacker reset the lockout by
    # interleaving otp/send between guess bursts. Attempts/lock are cleared
    # only on a successful verification (see _verify_otp).


async def _verify_otp(phone: str, submitted_otp: str) -> None:
    redis = await get_redis()
    fixed_otp_enabled = _uses_fixed_otp(phone)

    if fixed_otp_enabled:
        if submitted_otp == _whitelist_otp_code():
            await redis.delete(_otp_value_key(phone), _otp_attempts_key(phone), _otp_lock_key(phone))
            return
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "OTP_INVALID", "message": "Incorrect OTP. Check your message and try again."},
        )

    # Check lock
    lock = await redis.get(_otp_lock_key(phone))
    if lock:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "OTP_LOCKED", "message": "Too many failed attempts. Try again in 15 minutes."},
        )

    # Fetch stored OTP
    stored = await redis.get(_otp_value_key(phone))
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "OTP_EXPIRED", "message": "OTP has expired. Please request a new one."},
        )

    # Compare
    stored_str = stored.decode() if isinstance(stored, bytes) else stored
    if stored_str != submitted_otp:
        attempts_key = _otp_attempts_key(phone)
        attempts = await redis.incr(attempts_key)
        await redis.expire(attempts_key, 900)  # 15 min window
        max_attempts = max(1, int(settings.otp_max_attempts))
        if attempts >= max_attempts:
            await redis.setex(_otp_lock_key(phone), 900, "1")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"error": "OTP_LOCKED", "message": "Too many failed attempts. Try again in 15 minutes."},
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "OTP_INVALID", "message": "Incorrect OTP. Check your message and try again."},
        )

    # Success — clear OTP + attempt counter
    await redis.delete(_otp_value_key(phone), _otp_attempts_key(phone))


# ── Sprint 5b: OTP whitelist for test users (pre-real-SMS) ──────────────────
def _sms_provider_is_mock() -> bool:
    return sms_provider_is_mock()


def _uses_fixed_otp(phone: str) -> bool:
    """True when the submitted phone should verify against fixed pilot OTP."""
    return _sms_provider_is_mock() or _is_whitelisted_phone(phone)


def _is_whitelisted_phone(phone: str) -> bool:
    """True if phone is in OTP_WHITELIST env var.

    Whitelist entries are compared post-normalization so they can be listed
    as 10-digit, +91..., or 91... and still match _normalise_phone output.
    """
    wl_raw = getattr(settings, "otp_whitelist", "") or ""
    if not wl_raw:
        return False
    target = _normalise_phone(phone)
    for entry in wl_raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            if _normalise_phone(entry) == target:
                return True
        except Exception:
            continue
    return False


def _whitelist_otp_code() -> str:
    """The hardcoded OTP for whitelisted numbers (default 123456)."""
    return str(getattr(settings, "otp_whitelist_code", "") or "123456")


def _generate_otp() -> str:
    import random
    return f"{random.randint(0, 999999):06d}"


async def _send_sms(phone: str, otp: str) -> None:
    try:
        result = await get_sms_adapter().send_otp(phone, otp)
    except RuntimeError as exc:
        logger.error("otp.provider_unsupported", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "SMS_PROVIDER_UNAVAILABLE", "message": "OTP delivery is temporarily unavailable."},
        )
    if result.success:
        logger.info("otp.sent", phone_suffix=phone[-4:], provider=result.provider)
        return
    logger.error(
        "otp.delivery_failed",
        phone_suffix=phone[-4:],
        provider=result.provider,
        error=result.error,
    )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={"error": "OTP_DELIVERY_FAILED", "message": "Could not send OTP. Please try again."},
    )


async def _get_or_create_user(db, phone: str):
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
            # Sprint 4 / v3: tri-state defaults
            auth_state="otp_verified",
            buyer_eligible=False,
            seller_tier="not_eligible",
        )
        db.add(user)
        await db.flush()
        logger.info("user.created", user_id=str(user.id))
    else:
        user.phone_verified = True
        # Bring any Sprint 3 users forward: ensure auth_state reflects OTP
        if user.auth_state == "guest" and not user.is_restricted:
            user.auth_state = "otp_verified"
    return user


async def _resolve_role(db, user_id) -> str:
    """
    Pass 2: role is derived from active field_executives row. Kept cheap —
    one indexed lookup per token issue. 'admin' is handled separately by the
    admin module; for end-user tokens we return 'user' | 'fe'.
    """
    from sqlalchemy import select
    from app.modules.field_executive.models import FieldExecutive
    res = await db.execute(
        select(FieldExecutive.active).where(FieldExecutive.user_id == user_id)
    )
    row = res.scalar_one_or_none()
    if row is True:
        return "fe"
    return "user"


def _user_to_dict(user, role: str = "user") -> dict:
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
        # ── Sprint 4 / v3: tri-state ───────────────────────────────────────
        "auth_state": user.auth_state,
        "buyer_eligible": bool(user.buyer_eligible),
        "seller_tier": user.seller_tier,
        # ── Sprint 4 / Pass 2: role ────────────────────────────────────────
        "role": role,
        # ───────────────────────────────────────────────────────────────────
        "created_at": user.created_at.isoformat() if hasattr(user, 'created_at') and user.created_at else None,
    }


def _issue_access_token(user, session_id: str, role: str = "user") -> str:
    """Single source of truth for access token creation — always includes tri-state claims + role."""
    return create_access_token(
        user_id=str(user.id),
        session_id=session_id,
        phone_verified=user.phone_verified,
        tier=user.tier,
        kyc_status=user.kyc_status,
        auth_state=user.auth_state,
        buyer_eligible=bool(user.buyer_eligible),
        seller_tier=user.seller_tier,
        role=role,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/otp/send", status_code=status.HTTP_204_NO_CONTENT)
async def send_otp(body: SendOTPRequest, request: Request):
    """Send OTP to phone number. Rate limited to 3/hour per phone, plus
    20/hour per IP (handles attacker cycling through numbers)."""
    phone = _normalise_phone(body.phone_number)
    fixed_otp_enabled = _uses_fixed_otp(phone)

    if not fixed_otp_enabled:
        # IP-level cap so a single attacker cycling through phone numbers
        # can't blow through our SMS budget. Fixed-OTP pilot numbers bypass
        # this so private staging doesn't get stuck behind a shared IP cap.
        await limit_by_ip("otp_send_ip", OTP_PER_IP)(request)
        await _check_rate_limit(phone)

    # Sprint 5b/private staging: fixed OTP override for whitelisted numbers
    # or SMS_PROVIDER=mock.
    if fixed_otp_enabled:
        otp = _whitelist_otp_code()
        logger.info("otp.fixed_code", phone=phone, otp=otp, sms_provider=settings.sms_provider)
        await _store_otp(phone, otp, count_rate=False)
        logger.info("otp.sent", phone_suffix=phone[-4:], provider="fixed")
        return
    else:
        otp = _generate_otp()

    await _store_otp(phone, otp, count_rate=True)
    try:
        await _send_sms(phone, otp)
    except HTTPException:
        redis = await get_redis()
        await redis.delete(_otp_value_key(phone), _otp_attempts_key(phone), _otp_lock_key(phone))
        raise
    logger.info("otp.sent", phone_suffix=phone[-4:])


@router.post("/otp/verify", response_model=TokenResponse)
async def verify_otp(
    body: VerifyOTPRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DBSession,
):
    """Verify OTP and issue JWT. Creates user on first visit."""
    phone = _normalise_phone(body.phone_number)
    # Per-IP guess cap on verify, independent of the per-phone lockout, so an
    # attacker can't reset the lockout by interleaving resends with guesses.
    if not (settings.env == "development" or _uses_fixed_otp(phone)):
        await limit_by_ip("otp_verify_ip", OTP_VERIFY_PER_IP)(request)
    await _verify_otp(phone, body.otp)

    user = await _get_or_create_user(db, phone)

    session_id = str(uuid4())
    role = await _resolve_role(db, user.id)
    access_token = _issue_access_token(user, session_id, role=role)
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
    await record_phone_otp_verified(
        db,
        user_id=user.id,
        phone=phone,
        provider=settings.sms_provider,
    )
    # Commit before the background risk task opens its own DB session.
    await db.commit()

    background_tasks.add_task(
        run_onboarding_fraud_check,
        user_id=str(user.id),
        phone=phone,
        device_id=body.device_id,
        device_model=body.device_model,
        os=body.os,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    logger.info(
        "auth.verified",
        user_id=str(user.id),
        tier=user.tier,
        auth_state=user.auth_state,
        seller_tier=user.seller_tier,
        role=role,
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user_id=str(user.id),
        tier=user.tier,
        kyc_status=user.kyc_status,
        auth_state=user.auth_state,
        buyer_eligible=bool(user.buyer_eligible),
        seller_tier=user.seller_tier,
        role=role,
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

    # A suspended account must not be able to mint fresh access tokens off a
    # still-valid refresh token, otherwise suspension is unenforceable for the
    # full refresh window.
    if user.auth_state == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "ACCOUNT_SUSPENDED", "message": "This account is suspended. Please contact support."},
        )

    role = await _resolve_role(db, user.id)
    new_access = _issue_access_token(user, payload["session_id"], role=role)

    return TokenResponse(
        access_token=new_access,
        refresh_token=body.refresh_token,
        user_id=str(user.id),
        tier=user.tier,
        kyc_status=user.kyc_status,
        auth_state=user.auth_state,
        buyer_eligible=bool(user.buyer_eligible),
        seller_tier=user.seller_tier,
        role=role,
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

    # Kill the still-valid access token now, instead of waiting for it to expire.
    from app.core.revocation import revoke_session

    await revoke_session(current_user.session_id)
    await db.commit()

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
    role = await _resolve_role(db, user.id)
    return _user_to_dict(user, role=role)


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
    role = await _resolve_role(db, user.id)
    return _user_to_dict(user, role=role)


# ── Sprint 1: Public seller profile ──────────────────────────────
@router.get("/users/{user_id}/public")
async def get_public_profile(user_id: str, db: DBSession):
    """Public seller profile — no auth required. Does NOT expose PII."""
    from uuid import UUID
    from sqlalchemy import select
    from app.modules.identity_auth.models import User

    try:
        uid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "INVALID_USER_ID"})

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error": "USER_NOT_FOUND"})

    return {
        "id": str(user.id),
        "name": user.name or "Owmee User",
        "trust_score": user.trust_score,
        "kyc_verified": user.tier == "verified",  # preserved for backward compat
        "seller_tier": user.seller_tier,  # Sprint 4
        # NOTE: address_city is user PII and is deliberately NOT exposed on this
        # unauthenticated endpoint (the docstring's "does NOT expose PII" promise).
        "member_since": user.created_at.isoformat() if user.created_at else None,
    }
