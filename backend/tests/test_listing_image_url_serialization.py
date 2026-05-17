from types import SimpleNamespace

from app.modules.listings import feed_router, router as listings_router


def test_detail_gallery_promotes_current_thumbnail_identity(monkeypatch):
    listings_router._IMG_URL_CACHE.clear()
    monkeypatch.setattr(
        listings_router,
        "generate_presigned_download_url",
        lambda key, expires_in=0: f"https://fresh.test/{key}?sig=new",
    )
    listing = SimpleNamespace(
        thumbnail_url="listings/listing-1/hero.jpg.thumb.webp",
        image_urls=[
            "https://old.test/owmee-media/ai-drafts/user/expired.jpg?X-Amz-Date=old",
            "listings/listing-1/hero.jpg",
            "listings/listing-1/side.jpg.display.webp",
        ],
    )

    urls = listings_router._detail_image_urls(listing)

    assert urls[0] == "https://fresh.test/listings/listing-1/hero.jpg?sig=new"
    assert "X-Amz-Date=old" not in "\n".join(urls)
    assert "https://fresh.test/ai-drafts/user/expired.jpg?sig=new" in urls


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
