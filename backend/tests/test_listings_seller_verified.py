"""Sprint 6a snapshot+live formula tests.

The badge-rendering invariant is that the listings router and the feed router
agree: a listing shows the "Verified by Owmee" badge iff
  (snapshot at listing creation time was True) AND (seller is currently verified).

Before this fix, listings/router.py used live status only, which diverged from
feed_router.py and broke the snapshot promise during re_verification_required
windows and for old listings created before snapshot existed.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.modules.listings.router import _seller_verified, _fmt_card, _fmt_detail


def _make_listing(snapshot: bool):
    """Just enough listing-shaped attrs to satisfy _fmt_card. Most fields are
    pass-through; we only care about seller_kyc_verified_at_listing_time."""
    return SimpleNamespace(
        id="00000000-0000-0000-0000-000000000001",
        title="Test",
        price=1000,
        condition="good",
        status="active",
        city="Bangalore",
        locality=None,
        category_id="00000000-0000-0000-0000-00000000c0c0",
        image_urls=[],
        thumbnail_url=None,
        view_count=0,
        is_kids_item=False,
        is_negotiable=True,
        brand=None, model=None, storage=None, ram=None, color=None,
        processor=None, screen_size=None, purchase_year=None,
        screen_condition=None, body_condition=None, defects=None,
        original_price=None, serial_number=None, age_suitability=None,
        published_at=None, created_at=None,
        # Field under test:
        seller_kyc_verified_at_listing_time=snapshot,
        # Fields used by _fmt_detail:
        description=None, state="Karnataka", moderation_status="approved",
        accessories=None, warranty_info=None, battery_health=None,
        hygiene_status=None, listing_source="self_prep",
        reviewed_by="none", kids_safety_checklist=None,
    )


def _make_seller(kyc_status: str):
    return SimpleNamespace(
        id="00000000-0000-0000-0000-0000000000aa",
        kyc_status=kyc_status,
        trust_score=80,
    )


# ── _seller_verified — the core formula ───────────────────────────────────────

def test_seller_verified_true_when_snapshot_and_live_both_match():
    """Happy path: listing was created when seller was verified, and the
    seller is still verified now → badge shows."""
    assert _seller_verified(_make_listing(True), _make_seller("verified")) is True


def test_seller_verified_false_when_snapshot_false_even_if_live_verified():
    """Pre-Sprint-6a listing semantic: the snapshot was backfilled FALSE for
    sellers who weren't verified at the time of backfill. Even if they later
    completed KYC, the badge should not retroactively appear on that listing."""
    assert _seller_verified(_make_listing(False), _make_seller("verified")) is False


def test_seller_verified_false_during_re_verification_required():
    """Sprint 6a amendment: 'If seller's KYC enters re_verification_required
    state, badge is temporarily removed and ranking boost lost until
    re-verified.' This is what stops a stale snapshot from leaking trust."""
    listing = _make_listing(True)
    seller = _make_seller("re_verification_required")
    assert _seller_verified(listing, seller) is False


def test_seller_verified_false_when_seller_missing():
    """Orphaned-listing safety: if the seller record can't be found, the
    badge must NOT render. Earlier code used `User()` as a fallback, which
    silently returned an empty model whose kyc_status is None — making this
    case look identical to 'unverified seller' and masking the data bug."""
    assert _seller_verified(_make_listing(True), None) is False


# ── _fmt_card ─────────────────────────────────────────────────────────────────

def test_fmt_card_seller_verified_field_propagates():
    """The seller_verified arg should round-trip into both badge fields the
    mobile API contract exposes (seller_verified for the Listing shape,
    verified_by_owmee mirror for forward compat)."""
    out = _fmt_card(_make_listing(True), seller_verified=True)
    assert out["seller_verified"] is True
    assert out["verified_by_owmee"] is True


def test_fmt_card_default_unverified():
    out = _fmt_card(_make_listing(True))  # no seller_verified arg
    assert out["seller_verified"] is False
    assert out["verified_by_owmee"] is False


# ── _fmt_detail consistency invariant — Bug #4 ────────────────────────────────

def test_fmt_detail_card_and_seller_block_agree_during_re_verification():
    """The whole point of this fix: card-level and seller-block badges must
    agree. The previous bug had the card use snapshot AND live (via callers)
    while the seller block used live only — disagreeing whenever a seller
    entered re_verification_required."""
    listing = _make_listing(True)
    seller = _make_seller("re_verification_required")
    out = _fmt_detail(listing, seller, avg_rating=None, deal_count=0)
    assert out["seller_verified"] is False
    assert out["verified_by_owmee"] is False
    assert out["seller"]["kyc_verified"] is False
    assert out["seller"]["verified_by_owmee"] is False


def test_fmt_detail_pre_sprint6a_listing_no_badge_even_if_seller_now_verified():
    """A listing created before Sprint 6a (snapshot=False from backfill) does
    not magically get the badge if the seller later verifies. The detail
    view used to wrongly show the badge here because it ignored the snapshot."""
    listing = _make_listing(False)
    seller = _make_seller("verified")
    out = _fmt_detail(listing, seller, avg_rating=None, deal_count=0)
    assert out["seller_verified"] is False
    assert out["seller"]["kyc_verified"] is False


def test_fmt_detail_happy_path():
    listing = _make_listing(True)
    seller = _make_seller("verified")
    out = _fmt_detail(listing, seller, avg_rating=4.7, deal_count=3)
    assert out["seller_verified"] is True
    assert out["seller"]["kyc_verified"] is True
    assert out["seller"]["avg_rating"] == 4.7
    assert out["seller"]["deal_count"] == 3
