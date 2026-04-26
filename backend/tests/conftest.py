"""Test fixtures + minimal env stub so app modules can be imported without a
real DB / Redis / R2. The engine objects are constructed but never connected
to in unit tests."""
import os
import sys
from pathlib import Path

# Required settings fields (Settings has no defaults for these). We stuff
# valid-looking values so pydantic-settings is satisfied at import time.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("SYNC_DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("R2_ENDPOINT", "https://example.r2.cloudflarestorage.com")
os.environ.setdefault("R2_ACCESS_KEY", "test")
os.environ.setdefault("R2_SECRET_KEY", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-not-for-prod")

# Make the backend root importable as `app.*`
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
