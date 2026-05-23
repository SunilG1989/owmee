"""Verification orchestration and action policy."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import settings
from app.db.session import AsyncSessionLocal
from app.modules.identity_auth.models import User
from app.modules.kyc.models import KYCVerification
from app.modules.verification.fraud_adapter import FraudCheckRequest, FraudCheckResult, get_fraud_adapter
from app.modules.verification.models import RiskDecision, VerificationCheck

logger = structlog.get_logger()


ACTION_SIGNUP = "signup"
ACTION_DRAFT_LISTING = "draft_listing"
ACTION_PUBLISH_LISTING = "publish_listing"
ACTION_BUY = "buy"
ACTION_PAYOUT = "payout"
ACTION_PHONE_CHANGE = "phone_change"
ACTION_GLOBAL = "global"
VALID_ACTIONS = {
    ACTION_SIGNUP,
    ACTION_DRAFT_LISTING,
    ACTION_PUBLISH_LISTING,
    ACTION_BUY,
    ACTION_PAYOUT,
    ACTION_PHONE_CHANGE,
    ACTION_GLOBAL,
}


@dataclass(frozen=True)
class ActionPolicyDecision:
    decision: str
    allowed: bool
    reason_codes: list[str] = field(default_factory=list)
    message: str = ""
    required_step: str | None = None
    risk_band: str | None = None

    def to_error_detail(self) -> dict:
        return {
            "error": "VERIFICATION_REQUIRED" if self.decision == "step_up" else "ACTION_NOT_ALLOWED",
            "decision": self.decision,
            "reason_codes": self.reason_codes,
            "message": self.message,
            "required_step": self.required_step,
            "risk_band": self.risk_band,
        }


def allow(reason: str = "ALLOWED", risk_band: str | None = None) -> ActionPolicyDecision:
    return ActionPolicyDecision(
        decision="allow",
        allowed=True,
        reason_codes=[reason],
        risk_band=risk_band,
    )


def step_up(reason: str, message: str, required_step: str, risk_band: str | None = None) -> ActionPolicyDecision:
    return ActionPolicyDecision(
        decision="step_up",
        allowed=False,
        reason_codes=[reason],
        message=message,
        required_step=required_step,
        risk_band=risk_band,
    )


def block(reason: str, message: str, risk_band: str | None = None) -> ActionPolicyDecision:
    return ActionPolicyDecision(
        decision="block",
        allowed=False,
        reason_codes=[reason],
        message=message,
        risk_band=risk_band,
    )


def manual_review(reason: str, message: str, risk_band: str | None = None) -> ActionPolicyDecision:
    return ActionPolicyDecision(
        decision="manual_review",
        allowed=False,
        reason_codes=[reason],
        message=message,
        required_step="manual_review",
        risk_band=risk_band,
    )


async def record_verification_check(
    db: AsyncSession,
    *,
    user_id: UUID,
    check_type: str,
    provider: str,
    status: str,
    provider_ref: str | None = None,
    applies_to: str | None = None,
    risk_band: str | None = None,
    reason_codes: list[str] | None = None,
    metadata: dict | None = None,
    idempotency_key: str | None = None,
    input_fingerprint: str | None = None,
    expires_at: datetime | None = None,
) -> VerificationCheck:
    if idempotency_key:
        existing = await db.execute(
            select(VerificationCheck).where(VerificationCheck.idempotency_key == idempotency_key)
        )
        row = existing.scalar_one_or_none()
        if row:
            return row

    now = datetime.now(timezone.utc)
    check = VerificationCheck(
        user_id=user_id,
        check_type=check_type,
        provider=provider,
        provider_ref=provider_ref or None,
        status=status,
        applies_to=applies_to,
        risk_band=risk_band,
        reason_codes=reason_codes or [],
        metadata_=metadata or {},
        idempotency_key=idempotency_key,
        input_fingerprint=input_fingerprint,
        completed_at=now if status in {"passed", "failed", "manual_review", "error"} else None,
        expires_at=expires_at,
    )
    db.add(check)
    await db.flush()
    return check


async def record_risk_decision(
    db: AsyncSession,
    *,
    user_id: UUID,
    decision: str,
    applies_to: str = ACTION_GLOBAL,
    source_check_id: UUID | None = None,
    risk_band: str | None = None,
    reason_codes: list[str] | None = None,
    message: str | None = None,
    metadata: dict | None = None,
    valid_until: datetime | None = None,
) -> RiskDecision:
    row = RiskDecision(
        user_id=user_id,
        applies_to=applies_to,
        decision=decision,
        source_check_id=source_check_id,
        risk_band=risk_band,
        reason_codes=reason_codes or [],
        message=message,
        metadata_=metadata or {},
        valid_until=valid_until,
    )
    db.add(row)
    await db.flush()
    return row


async def record_action_policy_decision(
    db: AsyncSession,
    *,
    user_id: UUID,
    action: str,
    policy: ActionPolicyDecision,
    metadata: dict | None = None,
    valid_until: datetime | None = None,
) -> RiskDecision:
    """Persist the Owmee policy outcome for dispute/support evidence.

    This is intentionally called at critical state transitions, not on every
    browse/read path. It gives support a timestamped record of what Owmee knew
    when a payment/publish/payout decision was made.
    """
    return await record_risk_decision(
        db,
        user_id=user_id,
        applies_to=action,
        decision=policy.decision,
        risk_band=policy.risk_band,
        reason_codes=policy.reason_codes,
        message=policy.message,
        metadata={
            **(metadata or {}),
            "required_step": policy.required_step,
            "allowed": policy.allowed,
        },
        valid_until=valid_until,
    )


async def record_phone_otp_verified(
    db: AsyncSession,
    *,
    user_id: UUID,
    phone: str,
    provider: str,
) -> VerificationCheck:
    return await record_verification_check(
        db,
        user_id=user_id,
        check_type="phone_otp",
        provider=(provider or "unknown").lower(),
        status="passed",
        applies_to=ACTION_SIGNUP,
        reason_codes=["PHONE_OTP_VERIFIED"],
        metadata={"phone_suffix": phone[-4:] if phone else None},
    )


async def run_onboarding_fraud_check(
    *,
    user_id: str,
    phone: str,
    device_id: str | None = None,
    device_model: str | None = None,
    os: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Run Bureau-style onboarding risk check off the signup critical path."""
    uid = UUID(user_id)
    idempotency_key = _onboarding_risk_idempotency_key(uid, phone, device_id)
    valid_until = datetime.now(timezone.utc) + timedelta(days=settings.fraud_decision_valid_days)

    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            select(VerificationCheck).where(
                VerificationCheck.idempotency_key == idempotency_key,
                VerificationCheck.status.in_(["pending", "passed"]),
            )
        )
        if existing.scalar_one_or_none():
            return

        pending = await record_verification_check(
            db,
            user_id=uid,
            check_type="bureau_fraud",
            provider=(settings.fraud_provider or "mock").lower(),
            status="pending",
            applies_to=ACTION_SIGNUP,
            reason_codes=["FRAUD_CHECK_STARTED"],
            metadata={
                "phone_suffix": phone[-4:] if phone else None,
                "device_model": device_model,
                "os": os,
                "ip_present": bool(ip_address),
                "user_agent_present": bool(user_agent),
            },
            idempotency_key=idempotency_key,
            input_fingerprint=_fingerprint("|".join([phone or "", device_id or "", ip_address or ""])),
            expires_at=valid_until,
        )
        await db.commit()

    result = await get_fraud_adapter().check_onboarding(
        FraudCheckRequest(
            user_id=user_id,
            phone=phone,
            device_id=device_id,
            device_model=device_model,
            os=os,
            ip_address=ip_address,
            user_agent=user_agent,
            context={"journey": "signup"},
        )
    )

    async with AsyncSessionLocal() as db:
        check = await db.get(VerificationCheck, pending.id)
        if check is None:
            return
        _apply_fraud_result_to_check(check, result, valid_until)
        await record_risk_decision(
            db,
            user_id=uid,
            applies_to=ACTION_GLOBAL,
            decision=_policy_decision_from_fraud(result),
            source_check_id=check.id,
            risk_band=result.risk_band,
            reason_codes=result.reason_codes or ([result.error] if result.error else []),
            message=_message_from_fraud_result(result),
            metadata={"provider": result.provider, "score": result.score},
            valid_until=valid_until,
        )
        await db.commit()
        logger.info(
            "verification.fraud_check.completed",
            user_id=user_id,
            provider=result.provider,
            success=result.success,
            risk_band=result.risk_band,
            decision=_policy_decision_from_fraud(result),
        )


async def evaluate_user_action(
    db: AsyncSession,
    *,
    user_id: UUID,
    action: str,
    context: dict | None = None,
) -> ActionPolicyDecision:
    """Return Owmee's policy decision for a trust-sensitive action.

    This must stay DB-only and fast. It should never call Bureau/KYC/payment
    providers inline.
    """
    context = context or {}
    user = await _get_user(db, user_id)
    if user is None:
        return block("USER_NOT_FOUND", "User not found.")
    if user.auth_state == "suspended" or user.is_restricted:
        return block("ACCOUNT_RESTRICTED", "This account is restricted. Please contact Owmee support.")

    if action == ACTION_SIGNUP:
        return allow("SIGNUP_ALLOWED")
    if action == ACTION_DRAFT_LISTING:
        if user.auth_state != "otp_verified" or not user.phone_verified:
            return step_up("PHONE_OTP_REQUIRED", "Sign in with OTP to create a draft.", "phone_otp")
        return allow("DRAFT_ALLOWED")

    provider_decision = await _latest_valid_risk_decision(db, user_id, action)
    if provider_decision and provider_decision.decision == "block":
        return block(
            "FRAUD_RISK_BLOCKED",
            provider_decision.message or "This action is temporarily blocked for account safety.",
            provider_decision.risk_band,
        )
    if provider_decision and provider_decision.decision == "manual_review":
        return manual_review(
            "FRAUD_MANUAL_REVIEW",
            provider_decision.message or "This action needs Owmee review.",
            provider_decision.risk_band,
        )
    if provider_decision and provider_decision.decision == "step_up":
        metadata = provider_decision.metadata_ or {}
        return step_up(
            "FRAUD_STEP_UP_REQUIRED",
            provider_decision.message or "Additional verification is required.",
            metadata.get("required_step") or "kyc",
            provider_decision.risk_band,
        )

    if action in {ACTION_PUBLISH_LISTING, ACTION_BUY, ACTION_PAYOUT, ACTION_PHONE_CHANGE}:
        fraud_decision = await _fraud_gate(db, user_id)
        if not fraud_decision.allowed:
            return fraud_decision

    if action == ACTION_PUBLISH_LISTING:
        return await _publish_policy(user, context)
    if action == ACTION_BUY:
        if user.buyer_eligible:
            return allow("BUYER_ELIGIBLE")
        if _is_high_value(context):
            return step_up(
                "BUYER_KYC_REQUIRED",
                "Complete identity verification before this high-value purchase.",
                "buyer_kyc",
            )
        return allow("BUY_ALLOWED_WITH_RISK_PASS")
    if action == ACTION_PAYOUT:
        kyc = await _get_kyc_verification(db, user_id)
        if kyc and kyc.pan_verified and kyc.payout_verified:
            return allow("PAYOUT_VERIFIED")
        return step_up(
            "PAYOUT_VERIFICATION_REQUIRED",
            "Verify PAN and payout account before receiving money.",
            "payout_kyc",
        )
    if action == ACTION_PHONE_CHANGE:
        return step_up(
            "PHONE_CHANGE_RECHECK_REQUIRED",
            "Verify the new phone number before continuing.",
            "phone_otp",
        )

    return allow("NO_POLICY_BLOCK")


async def flag_payout_duplicate_if_needed(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> bool:
    """Flag possible mule behavior when payout account ref is shared.

    KYC providers should return an opaque account reference. If the same ref
    appears on another Owmee account, we do not expose the account data; we add
    a risk decision that blocks payout release until manual review.
    """
    current = await _get_kyc_verification(db, user_id)
    if not current or not current.payout_account_ref:
        return False

    duplicate = await db.execute(
        select(KYCVerification.user_id).where(
            KYCVerification.user_id != user_id,
            KYCVerification.payout_account_ref == current.payout_account_ref,
        ).limit(1)
    )
    duplicate_user_id = duplicate.scalar_one_or_none()
    if duplicate_user_id is None:
        return False

    check = await record_verification_check(
        db,
        user_id=user_id,
        check_type="payout_duplicate",
        provider="internal",
        status="manual_review",
        applies_to=ACTION_PAYOUT,
        risk_band="medium",
        reason_codes=["PAYOUT_ACCOUNT_SHARED"],
        metadata={"duplicate_user_id": str(duplicate_user_id)},
        idempotency_key=f"payout-dup:{user_id}:{current.payout_account_ref[:64]}",
    )
    now = datetime.now(timezone.utc)
    existing_decision = await db.execute(
        select(RiskDecision).where(
            RiskDecision.user_id == user_id,
            RiskDecision.applies_to == ACTION_PAYOUT,
            RiskDecision.source_check_id == check.id,
            RiskDecision.decision == "manual_review",
            or_(RiskDecision.valid_until.is_(None), RiskDecision.valid_until > now),
        ).limit(1)
    )
    if existing_decision.scalar_one_or_none() is None:
        await record_risk_decision(
            db,
            user_id=user_id,
            applies_to=ACTION_PAYOUT,
            decision="manual_review",
            source_check_id=check.id,
            risk_band="medium",
            reason_codes=["PAYOUT_ACCOUNT_SHARED"],
            message="Payout account is already linked to another Owmee account.",
            metadata={"duplicate_user_id": str(duplicate_user_id)},
        )
    return True


async def build_trust_summary(db: AsyncSession, user_id: UUID) -> dict:
    user = await _get_user(db, user_id)
    if user is None:
        return {"user_id": str(user_id), "exists": False}
    latest_fraud = await _latest_verification_check(db, user_id, "bureau_fraud")
    kyc = await _get_kyc_verification(db, user_id)

    badges = []
    if user.phone_verified:
        badges.append({"key": "phone_verified", "label": "Phone verified"})
    if latest_fraud and latest_fraud.status == "passed" and latest_fraud.risk_band == "low":
        badges.append({"key": "risk_screened", "label": "Fraud screened"})
    if user.kyc_status == "verified":
        badges.append({"key": "identity_verified", "label": "Identity verified"})
    if kyc and kyc.payout_verified:
        badges.append({"key": "payout_verified", "label": "Payout verified"})

    return {
        "user_id": str(user.id),
        "phone_verified": bool(user.phone_verified),
        "auth_state": user.auth_state,
        "kyc_status": user.kyc_status,
        "buyer_eligible": bool(user.buyer_eligible),
        "seller_tier": user.seller_tier,
        "trust_score": user.trust_score,
        "fraud": {
            "status": latest_fraud.status if latest_fraud else "not_started",
            "risk_band": latest_fraud.risk_band if latest_fraud else None,
            "provider": latest_fraud.provider if latest_fraud else None,
            "checked_at": latest_fraud.completed_at.isoformat() if latest_fraud and latest_fraud.completed_at else None,
        },
        "badges": badges,
    }


async def _publish_policy(user: User, context: dict) -> ActionPolicyDecision:
    if not _listing_requires_seller_kyc(context):
        return allow("PUBLISH_ALLOWED_WITH_RISK_PASS")
    if user.seller_tier in {"lite", "full"}:
        return allow("SELLER_KYC_PRESENT")
    return step_up(
        "SELLER_KYC_REQUIRED",
        "Complete seller verification before publishing this listing.",
        "seller_kyc",
    )


async def _fraud_gate(db: AsyncSession, user_id: UUID) -> ActionPolicyDecision:
    if not settings.fraud_enforcement_enabled:
        return allow("FRAUD_ENFORCEMENT_DISABLED")
    if _fraud_provider_configured_for_bypass():
        return allow("FRAUD_PROVIDER_MOCK")

    latest = await _latest_verification_check(db, user_id, "bureau_fraud")
    if latest is None:
        return step_up(
            "FRAUD_CHECK_REQUIRED",
            "Account safety check is pending. Please try again shortly.",
            "risk_screening",
        )
    if latest.status == "pending":
        return step_up(
            "FRAUD_CHECK_PENDING",
            "Account safety check is still running. Please try again shortly.",
            "risk_screening",
        )
    if latest.status == "passed" and latest.risk_band == "low":
        return allow("FRAUD_LOW_RISK", risk_band="low")
    if latest.status == "passed" and latest.risk_band == "medium":
        return step_up(
            "FRAUD_MEDIUM_RISK",
            "Complete identity verification to continue.",
            "kyc",
            risk_band="medium",
        )
    if latest.status in {"manual_review"}:
        return manual_review(
            "FRAUD_MANUAL_REVIEW",
            "This account needs Owmee review before continuing.",
            latest.risk_band,
        )
    return block(
        "FRAUD_HIGH_RISK",
        "This action is temporarily blocked for account safety.",
        latest.risk_band,
    )


async def _get_user(db: AsyncSession, user_id: UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def _get_kyc_verification(db: AsyncSession, user_id: UUID) -> KYCVerification | None:
    result = await db.execute(select(KYCVerification).where(KYCVerification.user_id == user_id))
    return result.scalar_one_or_none()


async def _latest_valid_risk_decision(db: AsyncSession, user_id: UUID, action: str) -> RiskDecision | None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(RiskDecision)
        .where(
            RiskDecision.user_id == user_id,
            RiskDecision.applies_to.in_([action, ACTION_GLOBAL]),
            RiskDecision.decision.in_(["step_up", "manual_review", "block"]),
            or_(RiskDecision.valid_until.is_(None), RiskDecision.valid_until > now),
        )
        .order_by(desc(RiskDecision.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _latest_verification_check(
    db: AsyncSession,
    user_id: UUID,
    check_type: str,
) -> VerificationCheck | None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(VerificationCheck)
        .where(
            VerificationCheck.user_id == user_id,
            VerificationCheck.check_type == check_type,
            or_(VerificationCheck.expires_at.is_(None), VerificationCheck.expires_at > now),
        )
        .order_by(desc(VerificationCheck.created_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


def _apply_fraud_result_to_check(
    check: VerificationCheck,
    result: FraudCheckResult,
    valid_until: datetime,
) -> None:
    check.provider = result.provider
    check.provider_ref = result.provider_ref or None
    check.status = _check_status_from_fraud_result(result)
    check.risk_band = result.risk_band
    check.reason_codes = result.reason_codes or ([result.error] if result.error else [])
    check.metadata_ = {
        **(check.metadata_ or {}),
        "score": result.score,
        "error": result.error,
    }
    check.completed_at = datetime.now(timezone.utc)
    check.expires_at = valid_until


def _check_status_from_fraud_result(result: FraudCheckResult) -> str:
    if not result.success:
        return "error"
    if result.decision == "manual_review":
        return "manual_review"
    if result.decision == "block":
        return "failed"
    return "passed"


def _policy_decision_from_fraud(result: FraudCheckResult) -> str:
    if not result.success:
        return "step_up"
    if result.decision in {"allow", "step_up", "manual_review", "block"}:
        return result.decision
    if result.risk_band == "high":
        return "block"
    if result.risk_band in {"medium", "unknown"}:
        return "step_up"
    return "allow"


def _message_from_fraud_result(result: FraudCheckResult) -> str:
    decision = _policy_decision_from_fraud(result)
    if decision == "allow":
        return "Fraud screening passed."
    if decision == "step_up":
        return "Additional verification is required."
    if decision == "manual_review":
        return "Owmee review is required."
    return "Action blocked by account safety policy."


def _listing_requires_seller_kyc(context: dict) -> bool:
    category_slug = str(context.get("category_slug") or "").lower()
    if category_slug in {"smartphones", "laptops", "tablets"}:
        return True
    return _is_high_value(context)


def _is_high_value(context: dict) -> bool:
    value = context.get("price") or context.get("amount")
    try:
        amount = Decimal(str(value or "0"))
    except Exception:
        amount = Decimal("0")
    return amount >= Decimal(str(settings.high_value_verification_threshold_inr))


def _fraud_provider_configured_for_bypass() -> bool:
    provider = (settings.fraud_provider or "").strip().lower()
    return settings.env == "development" or provider in {"mock", "dev", "log"}


def _onboarding_risk_idempotency_key(user_id: UUID, phone: str, device_id: str | None) -> str:
    raw = f"{user_id}:{phone}:{device_id or 'unknown'}"
    return f"bureau:onboarding:{_fingerprint(raw)[:48]}"


def _fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
