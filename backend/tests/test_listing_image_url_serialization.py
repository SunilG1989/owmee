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

    signed_keys: list[str] = []

    def fake_presign(key, expires_in=0):
        signed_keys.append(key)
        return f"https://fresh.test/{key}?sig=new"

    monkeypatch.setattr(
        feed_router,
        "generate_presigned_download_url",
        fake_presign,
    )

    card = feed_router._serialize_row(
        {
            "id": "listing-1",
            "seller_id": "seller-1",
            "price": 1200,
            "thumbnail_url": "listings/listing-1/hero.jpg.thumb.webp",
            "image_urls": ["listings/listing-1/hero.jpg.display.webp"],
        },
        distance_km=None,
    )

    assert card["image_urls"] == [
        "https://fresh.test/listings/listing-1/hero.jpg.display.webp?sig=new"
    ]
    assert card["thumbnail_url"] == card["image_urls"][0]
    assert signed_keys == ["listings/listing-1/hero.jpg.display.webp"]


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
