from io import BytesIO

from PIL import Image

from app.core import storage


def _jpeg_bytes(size=(1600, 1100), color=(92, 126, 132)) -> bytes:
    img = Image.new("RGB", size, color)
    out = BytesIO()
    img.save(out, format="JPEG", quality=95)
    return out.getvalue()


def test_process_listing_image_creates_durable_display_and_thumb(monkeypatch):
    raw = _jpeg_bytes()
    uploaded: dict[str, tuple[bytes, str]] = {}

    monkeypatch.setattr(storage, "download_bytes", lambda key, bucket=None: raw)

    def fake_upload(data, object_key, content_type="application/octet-stream", bucket=None, metadata=None):
        uploaded[object_key] = (data if isinstance(data, bytes) else data.read(), content_type)
        return object_key

    monkeypatch.setattr(storage, "upload_bytes", fake_upload)

    processed = storage.process_listing_image(
        "listings/abc/source.jpg",
        max_display_dimension=900,
        max_thumbnail_dimension=420,
    )

    assert processed.original_key == "listings/abc/source.jpg"
    assert processed.display_key == "listings/abc/source.jpg.display.webp"
    assert processed.thumbnail_key == "listings/abc/source.jpg.thumb.webp"
    assert uploaded[processed.display_key][1] == "image/webp"
    assert uploaded[processed.thumbnail_key][1] == "image/webp"

    display = Image.open(BytesIO(uploaded[processed.display_key][0]))
    thumb = Image.open(BytesIO(uploaded[processed.thumbnail_key][0]))
    assert max(display.size) <= 900
    assert max(thumb.size) <= 420


def test_thumbnail_key_for_display_key_uses_listing_variant_convention():
    assert (
        storage.thumbnail_key_for_display_key("listings/x/photo.jpg.display.webp")
        == "listings/x/photo.jpg.thumb.webp"
    )
    assert storage.thumbnail_key_for_display_key("listings/x/photo.jpg") is None
