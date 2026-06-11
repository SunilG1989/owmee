"""Wave 6: admin-web session cookie is signed and unforgeable.

Previously the cookie was the raw admin UUID — forgeable by anyone who learned
an id, with no server-side expiry.
"""
from uuid import uuid4

from app.admin_web.router import _sign_cookie, _unsign_cookie


def test_sign_then_unsign_roundtrips():
    admin_id = str(uuid4())
    token = _sign_cookie(admin_id)
    assert token != admin_id  # not the bare id
    assert _unsign_cookie(token) == admin_id


def test_raw_uuid_is_not_accepted():
    # The old cookie format (bare UUID) must no longer authenticate.
    assert _unsign_cookie(str(uuid4())) is None


def test_tampered_token_is_rejected():
    token = _sign_cookie(str(uuid4()))
    tampered = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    assert _unsign_cookie(tampered) is None


def test_expired_token_is_rejected():
    token = _sign_cookie(str(uuid4()))
    # Zero max-age => anything older than "now" is expired.
    assert _unsign_cookie(token, max_age=-1) is None


def test_garbage_value_is_rejected():
    assert _unsign_cookie("not-base64-$$$") is None
    assert _unsign_cookie("") is None
