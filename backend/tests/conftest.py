"""Test fixtures + minimal env stub so app modules can be imported without a
real DB / Redis / R2. The engine objects are constructed but never connected
to in unit tests."""
import os
import sys
from pathlib import Path

# Required settings fields (Settings has no defaults for these). Unit tests only
# need valid-looking values, but backend E2E tests connect to Postgres. Default
# to the repo's Docker Compose database on localhost so `pytest backend/tests`
# works on a fresh local dev stack; CI can still override these explicitly.
_DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://owmee:owmee_dev_password@localhost:5432/owmee_test"
_DEFAULT_TEST_SYNC_DATABASE_URL = "postgresql://owmee:owmee_dev_password@localhost:5432/owmee_test"
os.environ.setdefault("DATABASE_URL", os.environ.get("OWMEE_TEST_DATABASE_URL", _DEFAULT_TEST_DATABASE_URL))
os.environ.setdefault(
    "SYNC_DATABASE_URL",
    os.environ.get("OWMEE_TEST_SYNC_DATABASE_URL", _DEFAULT_TEST_SYNC_DATABASE_URL),
)
# Dev Redis runs with --requirepass (see docker-compose.yml); include the
# password so Redis-backed tests (rate-limit, revocation) actually exercise it
# instead of silently failing open. CI can override via REDIS_URL.
os.environ.setdefault(
    "REDIS_URL",
    os.environ.get("OWMEE_TEST_REDIS_URL", "redis://:owmee_redis_password@localhost:6379/0"),
)
os.environ.setdefault("R2_ENDPOINT", "https://example.r2.cloudflarestorage.com")
os.environ.setdefault("R2_ACCESS_KEY", "test")
os.environ.setdefault("R2_SECRET_KEY", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-not-for-prod")

# Make the backend root importable as `app.*`
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Pre-import every model module so SQLAlchemy can resolve cross-module
# foreign keys (e.g. users.community_id → communities.id) when any test
# touches the User mapper. Without this, individual tests that only
# import User trip NoReferencedTableError at flush time.
def _preload_all_models():  # noqa: D401
    import app.modules.admin.models  # noqa: F401
    import app.modules.community.models  # noqa: F401
    import app.modules.compliance.models  # noqa: F401
    import app.modules.disputes.models  # noqa: F401
    import app.modules.direct_acquisition.models  # noqa: F401
    import app.modules.field_executive.models  # noqa: F401
    import app.modules.identity_auth.models  # noqa: F401
    import app.modules.kyc.models  # noqa: F401
    import app.modules.listings.models  # noqa: F401
    import app.modules.media.models  # noqa: F401
    import app.modules.notifications.models  # noqa: F401
    import app.modules.offers.models  # noqa: F401
    import app.modules.payments.models  # noqa: F401
    import app.modules.risk.models  # noqa: F401
    import app.modules.transactions.models  # noqa: F401
    import app.modules.verification.models  # noqa: F401


_preload_all_models()
