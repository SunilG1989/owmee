"""Security regression tests for Wave 1 auth/identity hardening.

Covers:
  - JWT algorithm-confusion guard (symmetric algorithms refused everywhere).
  - JWT issuer/audience pinning round-trip + rejection.
  - Production config guards: mock SMS provider, OTP whitelist, mock fraud
    provider must all refuse to boot in production.
  - Redis-backed access-token revocation (session-level + user-epoch level).
"""
import time
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core import jwt as jwtmod
from app.core.revocation import (
    is_revoked,
    revoke_all_user_sessions,
    revoke_session,
)
from app.core.settings import Settings


# ── Settings builders ────────────────────────────────────────────────────────

def _base_prod_kwargs(**overrides):
    """A baseline-valid production Settings kwargs dict; override one field per
    test to assert the guard fires. Init kwargs take precedence over .env."""
    kwargs = dict(
        env="production",
        database_url="postgresql://u:p@db:5432/owmee",
        redis_url="redis://cache:6379/0",
        r2_endpoint="https://acct.r2.cloudflarestorage.com",
        r2_access_key="ak",
        r2_secret_key="sk",
        secret_key="x" * 48,  # >= 32, no "change_me"
        jwt_private_key="inline-private-key-material",
        jwt_public_key="inline-public-key-material",
        jwt_algorithm="RS256",
        allowed_origins="https://app.owmee.com",
        sms_provider="msg91",
        otp_whitelist="",
        fraud_provider="bureau",
        fraud_enforcement_enabled=True,
    )
    kwargs.update(overrides)
    return kwargs


def test_baseline_prod_config_is_valid():
    # Sanity: the baseline must pass, otherwise the negative tests prove nothing.
    Settings(**_base_prod_kwargs())


# ── JWT algorithm confusion ──────────────────────────────────────────────────

def test_symmetric_jwt_algorithm_rejected_in_any_env():
    # Always-on invariant — even in development a symmetric alg is refused.
    with pytest.raises(ValidationError):
        Settings(
            env="development",
            database_url="postgresql://u:p@db/owmee",
            redis_url="redis://cache:6379/0",
            r2_endpoint="https://acct.r2.example.com",
            r2_access_key="ak",
            r2_secret_key="sk",
            secret_key="x" * 48,
            jwt_algorithm="HS256",
        )


def test_require_asymmetric_algorithm_helper(monkeypatch):
    monkeypatch.setattr(jwtmod.settings, "jwt_algorithm", "HS256", raising=False)
    with pytest.raises(RuntimeError):
        jwtmod._require_asymmetric_algorithm()


# ── JWT issuer / audience pinning ────────────────────────────────────────────

def test_access_token_roundtrip_carries_iss_aud():
    uid = str(uuid4())
    token = jwtmod.create_access_token(
        user_id=uid,
        session_id=str(uuid4()),
        phone_verified=True,
        tier="basic",
        kyc_status="not_started",
    )
    payload = jwtmod.decode_token(token)
    assert payload["sub"] == uid
    assert payload["iss"] == jwtmod.settings.jwt_issuer
    assert payload["aud"] == jwtmod.settings.jwt_audience
    assert payload["type"] == "access"


def test_token_with_wrong_audience_is_rejected():
    from jose import jwt as jose_jwt

    bad = jose_jwt.encode(
        {
            "sub": str(uuid4()),
            "session_id": str(uuid4()),
            "type": "access",
            "iss": jwtmod.settings.jwt_issuer,
            "aud": "some-other-service",
        },
        jwtmod._private_key(),
        algorithm="RS256",
    )
    with pytest.raises(ValueError):
        jwtmod.decode_token(bad)


def test_token_with_wrong_issuer_is_rejected():
    from jose import jwt as jose_jwt

    bad = jose_jwt.encode(
        {
            "sub": str(uuid4()),
            "session_id": str(uuid4()),
            "type": "access",
            "iss": "evil-issuer",
            "aud": jwtmod.settings.jwt_audience,
        },
        jwtmod._private_key(),
        algorithm="RS256",
    )
    with pytest.raises(ValueError):
        jwtmod.decode_token(bad)


# ── Production config guards (S4 / M5) ───────────────────────────────────────

@pytest.mark.parametrize("provider", ["mock", "dev", "log", ""])
def test_mock_sms_provider_refused_in_production(provider):
    with pytest.raises(ValidationError):
        Settings(**_base_prod_kwargs(sms_provider=provider))


def test_otp_whitelist_refused_in_production():
    with pytest.raises(ValidationError):
        Settings(**_base_prod_kwargs(otp_whitelist="+919876543210"))


@pytest.mark.parametrize("provider", ["mock", "dev", "log", ""])
def test_mock_fraud_provider_refused_in_production_when_enforcing(provider):
    with pytest.raises(ValidationError):
        Settings(**_base_prod_kwargs(fraud_provider=provider, fraud_enforcement_enabled=True))


def test_mock_fraud_provider_allowed_in_production_when_enforcement_disabled():
    # If an operator explicitly disables enforcement, a mock provider is allowed
    # (no decision is being enforced anyway).
    Settings(**_base_prod_kwargs(fraud_provider="mock", fraud_enforcement_enabled=False))


# ── Access-token revocation (S10) ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_revoke_session_kills_only_that_session():
    sess = f"sess-{uuid4()}"
    other = f"sess-{uuid4()}"
    uid = str(uuid4())
    assert await is_revoked(sess, uid, None) is False
    await revoke_session(sess)
    assert await is_revoked(sess, uid, None) is True
    # A different session for the same user is unaffected.
    assert await is_revoked(other, uid, None) is False


@pytest.mark.asyncio
async def test_revoke_all_user_sessions_kills_tokens_issued_before_now():
    uid = str(uuid4())
    now = int(time.time())
    # Token minted "before" the revocation is killed; one minted "after" survives.
    await revoke_all_user_sessions(uid)
    assert await is_revoked(None, uid, now - 30) is True
    assert await is_revoked(None, uid, now + 300) is False


@pytest.mark.asyncio
async def test_revocation_is_scoped_per_user():
    uid_a = str(uuid4())
    uid_b = str(uuid4())
    now = int(time.time())
    await revoke_all_user_sessions(uid_a)
    assert await is_revoked(None, uid_a, now - 30) is True
    # User B was never revoked.
    assert await is_revoked(None, uid_b, now - 30) is False
