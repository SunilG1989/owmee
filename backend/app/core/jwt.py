from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import JWTError, jwt

from app.core.settings import settings


_ASYMMETRIC_PREFIXES = ("RS", "ES", "PS")


def _require_asymmetric_algorithm() -> str:
    """Return the configured algorithm, refusing symmetric ones.

    Defense in depth alongside the settings validator: a symmetric algorithm
    (HS*) would turn the published public key into the signing secret, enabling
    token forgery. We never sign or verify with one.
    """
    alg = settings.jwt_algorithm
    if not alg.upper().startswith(_ASYMMETRIC_PREFIXES):
        raise RuntimeError(
            f"Refusing to use symmetric JWT algorithm {alg!r}; "
            "configure an asymmetric algorithm (RS*/ES*/PS*)."
        )
    return alg


def _normalise_inline_key(value: str) -> str:
    return value.replace("\\n", "\n").strip()


def _write_public_key(private_path: Path, public_path: Path) -> None:
    private_key = serialization.load_pem_private_key(
        private_path.read_bytes(),
        password=None,
    )
    public_path.write_bytes(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )


def _generate_dev_keypair(private_path: Path, public_path: Path) -> None:
    private_path.parent.mkdir(parents=True, exist_ok=True)
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    public_path.write_bytes(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )


def _ensure_key_files() -> None:
    private_path = Path(settings.jwt_private_key_path)
    public_path = Path(settings.jwt_public_key_path)
    if private_path.exists() and public_path.exists():
        return
    if settings.is_production:
        raise RuntimeError(
            "JWT signing keys are missing. Set JWT_PRIVATE_KEY/JWT_PUBLIC_KEY "
            "or mount files at JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH."
        )
    if private_path.exists() and not public_path.exists():
        public_path.parent.mkdir(parents=True, exist_ok=True)
        _write_public_key(private_path, public_path)
        return
    _generate_dev_keypair(private_path, public_path)


def _load_key(path: str, inline_key: str, label: str) -> str:
    if inline_key.strip():
        return _normalise_inline_key(inline_key)
    key_path = Path(path)
    if not key_path.exists():
        _ensure_key_files()
    if not key_path.exists():
        raise RuntimeError(f"JWT {label} key is missing at {path}")
    return key_path.read_text()


def _private_key() -> str:
    return _load_key(
        settings.jwt_private_key_path,
        settings.jwt_private_key,
        "private",
    )


def _public_key() -> str:
    return _load_key(
        settings.jwt_public_key_path,
        settings.jwt_public_key,
        "public",
    )


def create_access_token(
    user_id: str,
    session_id: str,
    phone_verified: bool,
    tier: str,
    kyc_status: str,
    auth_state: str | None = None,
    buyer_eligible: bool | None = None,
    seller_tier: str | None = None,
    role: str | None = None,
) -> str:
    """
    Create an access token.

    Sprint 4 / v3: adds three new claims (auth_state, buyer_eligible,
    seller_tier). Pass 2: adds `role` claim ('user' | 'fe'). The existing
    `tier` and `kyc_status` claims are preserved for backward compatibility;
    callers that haven't been updated yet will still work — the new claims
    default to values inferred from Sprint 3 state.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)

    # Defaults for backward-compat callers
    if auth_state is None:
        auth_state = "otp_verified" if phone_verified else "guest"
    if buyer_eligible is None:
        buyer_eligible = tier == "verified"
    if seller_tier is None:
        seller_tier = "full" if tier == "verified" else "not_eligible"
    if role is None:
        role = "user"

    payload = {
        "sub": user_id,
        "session_id": session_id,
        "phone_verified": phone_verified,
        "tier": tier,
        "kyc_status": kyc_status,
        # ── Sprint 4 / v3 claims ──────────────────────────────────────────
        "auth_state": auth_state,
        "buyer_eligible": buyer_eligible,
        "seller_tier": seller_tier,
        # ── Sprint 4 / Pass 2 claim ───────────────────────────────────────
        "role": role,
        # ──────────────────────────────────────────────────────────────────
        "iat": now,
        "exp": expire,
        "jti": str(uuid4()),
        "type": "access",
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    return jwt.encode(payload, _private_key(), algorithm=_require_asymmetric_algorithm())


def create_refresh_token(user_id: str, session_id: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.jwt_refresh_token_expire_days)
    payload = {
        "sub": user_id,
        "session_id": session_id,
        "iat": now,
        "exp": expire,
        "jti": str(uuid4()),
        "type": "refresh",
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    return jwt.encode(payload, _private_key(), algorithm=_require_asymmetric_algorithm())


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            _public_key(),
            algorithms=[_require_asymmetric_algorithm()],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
        )
    except JWTError as e:
        raise ValueError(f"Invalid token: {e}") from e
