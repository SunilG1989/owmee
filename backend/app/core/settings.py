from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Environment ────────────────────────────────────────────────────────
    env: str = "development"

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    # ── Database ───────────────────────────────────────────────────────────
    database_url: str
    sync_database_url: str

    # ── Redis ──────────────────────────────────────────────────────────────
    redis_url: str

    # ── Temporal ───────────────────────────────────────────────────────────
    temporal_host: str = "localhost:7233"
    temporal_namespace: str = "default"
    temporal_api_key: str = ""

    # ── Cloudflare R2 ──────────────────────────────────────────────────────
    r2_endpoint: str
    r2_bucket: str = "owmee-media"
    r2_evidence_bucket: str = "owmee-evidence"
    r2_access_key: str
    r2_secret_key: str
    r2_public_url: str = ""

    # ── JWT ────────────────────────────────────────────────────────────────
    jwt_private_key_path: str = "./keys/private.pem"
    jwt_public_key_path: str = "./keys/public.pem"
    jwt_algorithm: str = "RS256"
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 30

    # ── App secret ─────────────────────────────────────────────────────────
    secret_key: str

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
    sms_api_key: str = ""
    sms_sender_id: str = "OWMAPP"
    sms_dlt_entity_id: str = ""

    # ── Chat (Stream)
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

    # ── Rate limiting ──────────────────────────────────────────────────────
    otp_rate_limit_per_hour: int = 3
    otp_max_attempts: int = 5

    # ── Observability ──────────────────────────────────────────────────────
    sentry_dsn: str = ""
    app_base_url: str = "http://localhost:8000"
    r2_public_endpoint: str = ""
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
