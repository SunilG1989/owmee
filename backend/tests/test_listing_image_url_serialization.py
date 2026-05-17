from types import SimpleNamespace

from app.modules.listings import feed_router, router as listings_router


def test_detail_gallery_preserves_cleaned_display_hero(monkeypatch):
    listings_router._IMG_URL_CACHE.clear()
    monkeypatch.setattr(
        listings_router,
        "generate_presigned_download_url",
        lambda key, expires_in=0: f"https://fresh.test/{key}?sig=new",
    )
    listing = SimpleNamespace(
        thumbnail_url="listings/listing-1/original-phone-back.jpg.thumb.webp",
        image_urls=[
            "listings/listing-1/phone-front.hero-cleaned.png.display.webp",
            "https://old.test/owmee-media/ai-drafts/user/expired.jpg?X-Amz-Date=old",
            "listings/listing-1/side.jpg.display.webp",
        ],
    )

    urls = listings_router._detail_image_urls(listing)

    assert (
        urls[0]
        == "https://fresh.test/listings/listing-1/phone-front.hero-cleaned.png.display.webp?sig=new"
    )
    assert "X-Amz-Date=old" not in "\n".join(urls)
    assert "https://fresh.test/ai-drafts/user/expired.jpg?sig=new" in urls
    assert (
        "https://fresh.test/listings/listing-1/original-phone-back.jpg.thumb.webp?sig=new"
        in urls
    )


def test_detail_gallery_uses_thumbnail_for_legacy_rows(monkeypatch):
    listings_router._IMG_URL_CACHE.clear()
    monkeypatch.setattr(
        listings_router,
        "generate_presigned_download_url",
        lambda key, expires_in=0: f"https://fresh.test/{key}?sig=new",
    )
    listing = SimpleNamespace(
        thumbnail_url="listings/listing-1/hero.jpg.thumb.webp",
        image_urls=[],
    )

    urls = listings_router._detail_image_urls(listing)

    assert urls == ["https://fresh.test/listings/listing-1/hero.jpg.thumb.webp?sig=new"]


def test_feed_resigns_legacy_owmee_media_urls(monkeypatch):
    feed_router._IMG_URL_CACHE.clear()
    monkeypatch.setattr(
        feed_router,
        "generate_presigned_download_url",
        lambda key, expires_in=0: f"https://fresh.test/{key}?sig=new",
    )

    url = feed_router._img_url(
        "https://r2.example.com/owmee-media/listings/listing-1/photo.jpg?X-Amz-Date=old"
    )

    assert url == "https://fresh.test/listings/listing-1/photo.jpg?sig=new"


def test_feed_cards_use_display_hero_not_thumbnail(monkeypatch):
    feed_router._IMG_URL_CACHE.clear()
    monkeypatch.setattr(
        feed_router,
        "generate_presigned_download_url",
        lambda key, expires_in=0: f"https://fresh.test/{key}?sig=new",
    )

    hero = feed_router._first_display_image_url(
        "listings/listing-1/hero.jpg.thumb.webp",
        ["listings/listing-1/hero.jpg.display.webp"],
    )
    thumb = feed_router._thumbnail_image_url(
        "listings/listing-1/hero.jpg.thumb.webp",
        ["listings/listing-1/hero.jpg.display.webp"],
    )

    assert hero == "https://fresh.test/listings/listing-1/hero.jpg.display.webp?sig=new"
    assert thumb == "https://fresh.test/listings/listing-1/hero.jpg.thumb.webp?sig=new"


def test_listing_card_urls_prefer_display_hero(monkeypatch):
    listings_router._IMG_URL_CACHE.clear()
    monkeypatch.setattr(
        listings_router,
        "generate_presigned_download_url",
        lambda key, expires_in=0: f"https://fresh.test/{key}?sig=new",
    )
    listing = SimpleNamespace(
        thumbnail_url="listings/listing-1/hero.jpg.thumb.webp",
        image_urls=["listings/listing-1/hero.jpg.display.webp"],
    )

    urls = listings_router._card_image_urls(listing)

    assert urls == ["https://fresh.test/listings/listing-1/hero.jpg.display.webp?sig=new"]
