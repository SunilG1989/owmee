"""Wave 4: Gemini error classification so quota exhaustion is observable.

Free tier is ~20 vision calls/day (CLAUDE.md). Operators must be able to tell a
daily-quota hit (expected; switch model / enable billing) from a real bug.
"""
import pytest

from app.modules.ai_assistant.gemini_client import _classify_gemini_error


class _Err(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


@pytest.mark.parametrize("exc", [
    _Err("429 RESOURCE_EXHAUSTED: quota exceeded"),
    _Err("rate limit exceeded"),
    _Err("boom", code=429),
    _Err("You exceeded your current quota"),
])
def test_quota_errors_classified(exc):
    assert _classify_gemini_error(exc) == "quota_exhausted"


@pytest.mark.parametrize("exc", [
    _Err("503 Service Unavailable"),
    _Err("deadline exceeded"),
    _Err("connection timeout"),
    _Err("boom", code=503),
])
def test_transient_errors_classified(exc):
    assert _classify_gemini_error(exc) == "transient"


@pytest.mark.parametrize("exc", [
    _Err("invalid argument: bad schema"),
    _Err("unexpected response shape"),
    ValueError("parse error"),
])
def test_other_errors_default_to_error(exc):
    assert _classify_gemini_error(exc) == "error"
