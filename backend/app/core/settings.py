from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Environment ────────────────────────────────────────────────────────
    env: str = "development"
    # Runtime provider adapters fail closed at call time when credentials are
    # absent. Turn this on only for a public-launch release gate where a missing
    # commercial provider must stop the API before any traffic is served.
    strict_provider_startup_validation: bool = False
    # Sprint 5b: OTP whitelist for test numbers (pre-real-SMS)
    # Comma-separated list of phone numbers (10-digit, +91..., or 91...).
    # Whitelisted phones receive the hardcoded `otp_whitelist_code` instead
    # of a random OTP. Empty string (default) = feature disabled.
    otp_whitelist: str = ""
    otp_whitelist_code: str = "123456"

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    # ── Database ───────────────────────────────────────────────────────────
    database_url: str
    sync_database_url: str = ""
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_recycle_seconds: int = 1800

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return self.database_url

    @property
    def sync_db_url(self) -> str:
        raw_url = self.sync_database_url or self.database_url
        if raw_url.startswith("postgresql+asyncpg://"):
            return raw_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        return raw_url

    # ── Redis ──────────────────────────────────────────────────────────────
    redis_url: str

    # ── Async media processing ─────────────────────────────────────────────
    # Hero cleanup is post-listing and worker-driven. Keep concurrency low by
    # default because image editing is provider-heavy and buyer-facing images
    # are not on the critical request path.
    hero_cleanup_worker_concurrency: int = 2
    hero_cleanup_enqueue_timeout_seconds: float = 0.5
    hero_cleanup_stream_maxlen: int = 50000
    hero_cleanup_retry_max_attempts: int = 4
    hero_cleanup_pending_idle_seconds: int = 180
    hero_cleanup_read_block_ms: int = 2000
    ai_draft_analysis_worker_concurrency: int = 1
    ai_draft_analysis_stream_maxlen: int = 50000
    ai_draft_analysis_retry_max_attempts: int = 3
    ai_draft_analysis_read_block_ms: int = 2000
    ai_draft_fast_path_enabled: bool = True
    ai_draft_full_fallback_enabled: bool = True
    ai_draft_shadow_full_analysis_enabled: bool = False
    ai_draft_fast_min_category_confidence: float = 0.55

    # ── Temporal ───────────────────────────────────────────────────────────
    temporal_host: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_api_key: str = ""

    # ── Cloudflare R2 ──────────────────────────────────────────────────────
    r2_endpoint: str
    # Backward-compatible alias used by some local .env files. Server-side
    # storage uses r2_endpoint; keep this accepted so app import/tests do not
    # fail on older environments.
    r2_internal_endpoint: str = ""
    r2_bucket: str = "owmee-media"
    r2_evidence_bucket: str = "owmee-evidence"
    r2_access_key: str
    r2_secret_key: str
    r2_public_url: str = ""

    # ── JWT ────────────────────────────────────────────────────────────────
    jwt_private_key: str = ""
    jwt_public_key: str = ""
    jwt_private_key_path: str = "./keys/private.pem"
    jwt_public_key_path: str = "./keys/public.pem"
    jwt_algorithm: str = "RS256"
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 30
    # Issuer/audience pinning — tokens are minted with these claims and rejected
    # on decode if they don't match, so a token signed by a different service
    # sharing the same keypair (or a future second token type) can't be replayed.
    jwt_issuer: str = "owmee"
    jwt_audience: str = "owmee-app"

    # ── App secret ─────────────────────────────────────────────────────────
    secret_key: str

    # ── Provider selection ─────────────────────────────────────────────────
    # These names are the app-level integration switches. Product code should
    # depend on module adapters, not directly on any third-party SDK shape.
    ai_provider: str = "gemini"
    geocoding_provider: str = "photon"
    push_provider: str = "fcm"

    # ── Fraud / risk decisioning ──────────────────────────────────────────
    fraud_provider: str = "mock"
    fraud_api_base_url: str = ""
    fraud_api_key: str = ""
    fraud_webhook_secret: str = ""
    # Keep Bureau endpoint shape configurable until the commercial contract is
    # finalized. The adapter normalizes the response into Owmee's policy model.
    fraud_onboarding_path: str = "/v1/onboarding/check"
    fraud_timeout_seconds: float = 3.0
    fraud_decision_valid_days: int = 30
    fraud_enforcement_enabled: bool = True
    high_value_verification_threshold_inr: int = 10000

    # ── KYC partner ────────────────────────────────────────────────────────
    kyc_partner: str = "digio"
    kyc_partner_api_key: str = ""
    kyc_partner_base_url: str = ""
    kyc_webhook_secret: str = ""

    # ── Payment Aggregator ─────────────────────────────────────────────────
    pa_provider: str = "razorpay"
    pa_key_id: str = ""
    pa_key_secret: str = ""
    pa_webhook_secret: str = ""

    # ── SMS ────────────────────────────────────────────────────────────────
    sms_provider: str = "msg91"
    sms_api_base_url: str = "https://control.msg91.com"
    sms_api_key: str = ""
    sms_sender_id: str = "OWMAPP"
    sms_dlt_entity_id: str = ""
    sms_template_id: str = ""
    sms_msg91_timeout_seconds: float = 10.0
    sms_msg91_otp_expiry_minutes: int = 10

    # ── Legacy Stream keys (unused; buyer-seller chat is not shipped)
    stream_api_key: str = ""
    stream_api_secret: str = ""

    # ── Push notifications ─────────────────────────────────────────────────
    fcm_server_key: str = ""
    apns_key_id: str = ""
    apns_team_id: str = ""
    apns_key_path: str = ""

    # ── CORS ───────────────────────────────────────────────────────────────
    allowed_origins: str = "http://localhost:3000"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    @model_validator(mode="after")
    def validate_production_config(self) -> "Settings":
        # ── Always-on invariants (enforced in every environment) ──────────────
        # JWT must use an asymmetric algorithm. With a symmetric alg (HS*), the
        # "public" verification key doubles as the signing secret, so anyone
        # holding the (intentionally distributable) public key can forge tokens.
        if not self.jwt_algorithm.upper().startswith(("RS", "ES", "PS")):
            raise ValueError(
                "JWT_ALGORITHM must be asymmetric (RS*/ES*/PS*); "
                f"got {self.jwt_algorithm!r}. Symmetric algorithms enable token forgery."
            )

        if not self.is_production:
            return self

        if len(self.secret_key.strip()) < 32 or "change_me" in self.secret_key.lower():
            raise ValueError("SECRET_KEY must be a production secret with at least 32 characters.")

        has_private_key = bool(self.jwt_private_key.strip()) or Path(self.jwt_private_key_path).exists()
        has_public_key = bool(self.jwt_public_key.strip()) or Path(self.jwt_public_key_path).exists()
        if not has_private_key or not has_public_key:
            raise ValueError("Production requires JWT_PRIVATE_KEY and JWT_PUBLIC_KEY, or mounted key files.")

        origins = [origin for origin in self.cors_origins if origin]
        if not origins or any("localhost" in origin or "127.0.0.1" in origin for origin in origins):
            raise ValueError("ALLOWED_ORIGINS must contain only production client origins.")

        # ── OTP / SMS: no mock-delivery bypass or static pilot OTP in prod ────
        # A mock SMS provider makes the fixed pilot OTP (otp_whitelist_code,
        # default 123456) accept for any phone, and a populated OTP_WHITELIST
        # does the same for listed numbers — both are full account-takeover
        # vectors if they reach production. Refuse to boot with either.
        sms_provider = (self.sms_provider or "").strip().lower()
        if sms_provider in {"", "mock", "dev", "log"}:
            raise ValueError(
                "SMS_PROVIDER must be a real delivery provider in production "
                "(not empty/mock/dev/log) — a mock provider enables the static OTP bypass."
            )
        if self.strict_provider_startup_validation and sms_provider in {"msg91", "msg-91"}:
            missing_msg91 = [
                name
                for name, value in {
                    "SMS_API_KEY": self.sms_api_key,
                    "SMS_TEMPLATE_ID": self.sms_template_id,
                }.items()
                if self._missing_required_secret(value)
            ]
            if missing_msg91:
                raise ValueError(
                    "MSG91 strict provider startup validation requires real values for "
                    + ", ".join(missing_msg91)
                    + " — placeholders or empty values mean OTP SMS cannot be delivered."
                )
        if self.otp_whitelist.strip():
            raise ValueError(
                "OTP_WHITELIST must be empty in production — whitelisted numbers "
                "authenticate with a static code, which is a login bypass."
            )

        # ── Fraud: no mock auto-allow in prod while enforcement is enabled ────
        fraud_provider = (self.fraud_provider or "").strip().lower()
        if (
            self.strict_provider_startup_validation
            and self.fraud_enforcement_enabled
            and fraud_provider in {"", "mock", "dev", "log"}
        ):
            raise ValueError(
                "Strict provider startup validation requires FRAUD_PROVIDER to be real "
                "when FRAUD_ENFORCEMENT_ENABLED is true — a mock provider silently "
                "bypasses every fraud step-up/block decision."
            )

        return self

    @staticmethod
    def _missing_required_secret(value: str | None) -> bool:
        raw = str(value or "").strip()
        return not raw or raw.startswith("REPLACE_WITH_")

    # ── Rate limiting ──────────────────────────────────────────────────────
    otp_rate_limit_per_hour: int = 3
    otp_max_attempts: int = 5

    # ── Observability ──────────────────────────────────────────────────────
    sentry_dsn: str = ""
    app_base_url: str = "http://localhost:8000"
    r2_public_endpoint: str = ""
    log_level: str = "INFO"
    # ── Google Gemini AI ─────────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_vision_model: str = "gemini-3-flash-preview"
    gemini_text_model: str = "gemini-3-flash-preview"
    gemini_image_model: str = "gemini-3.1-flash-image-preview"
    image_cleanup_provider: str = "gemini"

    # ── Photon (reverse geocoding) ───────────────────────────────────────
    # Public Photon (komoot.io) by default. If we hit fair-use limits in
    # pilot, swap to self-hosted Photon by setting PHOTON_URL — the rest
    # of the stack reads from this single env var.
    photon_url: str = "https://photon.komoot.io"
    photon_timeout_seconds: float = 6.0
@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
