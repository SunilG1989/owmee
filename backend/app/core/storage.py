import io
from dataclasses import dataclass
from typing import BinaryIO
from uuid import uuid4

import boto3
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.settings import settings

logger = structlog.get_logger()


@dataclass(frozen=True)
class ProcessedListingImage:
    original_key: str
    display_key: str | None
    thumbnail_key: str | None


def _r2_client():
    """Internal client — uses minio:9000 (Docker network). For server-side operations."""
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key,
        aws_secret_access_key=settings.r2_secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _r2_public_client():
    """Public-facing client — uses R2_PUBLIC_ENDPOINT (Mac IP / Railway URL).
    Used ONLY for generating presigned URLs that phones/browsers will call."""
    public_endpoint = settings.r2_public_endpoint or settings.r2_endpoint
    return boto3.client(
        "s3",
        endpoint_url=public_endpoint,
        aws_access_key_id=settings.r2_access_key,
        aws_secret_access_key=settings.r2_secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def generate_presigned_upload_url(
    object_key: str,
    content_type: str = "image/jpeg",
    expires_in: int = 300,
    bucket: str | None = None,
) -> str:
    """Generate a presigned PUT URL for direct client upload.
    Uses PUBLIC endpoint so phones can reach it."""
    client = _r2_public_client()
    bucket = bucket or settings.r2_bucket
    url = client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket,
            "Key": object_key,
            "ContentType": content_type,
        },
        ExpiresIn=expires_in,
        HttpMethod="PUT",
    )
    return url


def generate_presigned_download_url(
    object_key: str,
    expires_in: int = 3600,
    bucket: str | None = None,
) -> str:
    """Generate a presigned GET URL for private objects.
    Uses PUBLIC endpoint so phones can reach it."""
    client = _r2_public_client()
    bucket = bucket or settings.r2_bucket
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": object_key},
        ExpiresIn=expires_in,
    )


def public_url(object_key: str) -> str:
    """Return public URL for public bucket objects."""
    if settings.r2_public_url:
        return f"{settings.r2_public_url.rstrip('/')}/{object_key}"
    base = (settings.r2_public_endpoint or settings.r2_endpoint).rstrip("/")
    return f"{base}/{settings.r2_bucket}/{object_key}"


def upload_bytes(
    data: bytes | BinaryIO,
    object_key: str,
    content_type: str = "application/octet-stream",
    bucket: str | None = None,
    metadata: dict | None = None,
) -> str:
    """Upload bytes directly (server-side). Uses internal endpoint."""
    client = _r2_client()
    bucket = bucket or settings.r2_bucket
    extra = {"ContentType": content_type}
    if metadata:
        extra["Metadata"] = {k: str(v) for k, v in metadata.items()}
    if isinstance(data, bytes):
        data = io.BytesIO(data)
    client.upload_fileobj(data, bucket, object_key, ExtraArgs=extra)
    return object_key


def delete_object(object_key: str, bucket: str | None = None) -> None:
    client = _r2_client()
    bucket = bucket or settings.r2_bucket
    client.delete_object(Bucket=bucket, Key=object_key)


def download_bytes(object_key: str, bucket: str | None = None) -> bytes:
    """Server-side fetch of an object as bytes. Used by the resize
    pipeline to read the original after the buyer's PUT lands."""
    client = _r2_client()
    bucket = bucket or settings.r2_bucket
    obj = client.get_object(Bucket=bucket, Key=object_key)
    return obj["Body"].read()


def _normalise_catalog_image(raw: bytes, *, polish: bool = True):
    """Open, orient, and lightly polish a seller photo for marketplace display.

    This intentionally does not remove or invent product details. It cleans the
    camera output: EXIF rotation, low-light noise, flat contrast, and phone-photo
    softness. The original upload remains untouched in R2.
    """
    from io import BytesIO
    from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps, ImageStat  # type: ignore

    img = Image.open(BytesIO(raw))
    img = ImageOps.exif_transpose(img)

    if img.mode == "RGBA":
        bg = Image.new("RGB", img.size, (255, 253, 248))
        bg.paste(img, mask=img.getchannel("A"))
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")

    if not polish:
        return img

    # Subtle denoise while keeping wear/scratches visible for buyer trust.
    denoised = img.filter(ImageFilter.MedianFilter(size=3))
    img = Image.blend(img, denoised, 0.22)

    gray = img.convert("L")
    mean_luma = ImageStat.Stat(gray).mean[0]
    img = ImageOps.autocontrast(img, cutoff=0.8)
    if mean_luma < 95:
        img = ImageEnhance.Brightness(img).enhance(1.08)
    elif mean_luma > 205:
        img = ImageEnhance.Brightness(img).enhance(0.97)

    img = ImageEnhance.Contrast(img).enhance(1.06)
    img = ImageEnhance.Color(img).enhance(1.035)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.05, percent=118, threshold=3))

    # Extremely cheap banding guard: if the image became perfectly flat in any
    # large area, restore a whisper of the original texture.
    diff = ImageChops.difference(img, denoised).convert("L")
    if ImageStat.Stat(diff).mean[0] < 1.5:
        img = Image.blend(img, denoised, 0.12)

    return img


def _webp_bytes(img, *, quality: int) -> bytes:
    from io import BytesIO

    out = BytesIO()
    img.save(out, format="WEBP", quality=quality, method=6)
    return out.getvalue()


def thumbnail_key_for_display_key(display_key: str | None) -> str | None:
    if not display_key:
        return None
    if display_key.endswith(".display.webp"):
        return display_key[: -len(".display.webp")] + ".thumb.webp"
    return None


def process_listing_image(
    original_key: str,
    *,
    max_display_dimension: int = 1800,
    max_thumbnail_dimension: int = 1200,
    display_quality: int = 92,
    thumbnail_quality: int = 86,
    bucket: str | None = None,
) -> ProcessedListingImage:
    """Create catalog-grade display and thumbnail variants for a listing photo.

    Stored alongside the original as:
      - `<original-key>.display.webp` for detail/gallery display
      - `<original-key>.thumb.webp` for cards/feed

    Returns keys on success; failures are logged and leave the original usable.

    Why this shape
    -----------------------
    - The display image is high enough for modern phone zoom without forcing
      every buyer to download raw camera files.
    - The thumbnail is smaller and denoised for fast feeds.
    - The original stays untouched for moderation, disputes, and trust.
    """
    try:
        raw = download_bytes(original_key, bucket=bucket)
        return process_listing_image_bytes(
            raw,
            original_key=original_key,
            upload_original=False,
            content_type="application/octet-stream",
            max_display_dimension=max_display_dimension,
            max_thumbnail_dimension=max_thumbnail_dimension,
            display_quality=display_quality,
            thumbnail_quality=thumbnail_quality,
            bucket=bucket,
        )
    except Exception as e:
        logger.warning("listing_image.process_failed", original_key=original_key, error=str(e))
        return ProcessedListingImage(original_key=original_key, display_key=None, thumbnail_key=None)


def process_listing_image_bytes(
    raw: bytes,
    *,
    original_key: str,
    content_type: str = "image/jpeg",
    upload_original: bool = True,
    max_display_dimension: int = 1800,
    max_thumbnail_dimension: int = 1200,
    display_quality: int = 92,
    thumbnail_quality: int = 86,
    polish: bool = True,
    bucket: str | None = None,
) -> ProcessedListingImage:
    """Upload the original bytes and create polished listing variants.

    Used by the AI multipart flow, where the backend receives image bytes
    directly instead of waiting for a mobile presigned PUT.
    """
    try:
        from PIL import Image  # type: ignore
    except Exception:
        logger.warning("listing_image.pillow_missing", original_key=original_key)
        if upload_original:
            upload_bytes(raw, original_key, content_type=content_type, bucket=bucket)
        return ProcessedListingImage(original_key=original_key, display_key=None, thumbnail_key=None)

    try:
        if upload_original:
            upload_bytes(raw, original_key, content_type=content_type, bucket=bucket)

        img = _normalise_catalog_image(raw, polish=polish)
        display = img.copy()
        display.thumbnail((max_display_dimension, max_display_dimension), Image.Resampling.LANCZOS)
        thumb = img.copy()
        thumb.thumbnail((max_thumbnail_dimension, max_thumbnail_dimension), Image.Resampling.LANCZOS)

        display_key = f"{original_key}.display.webp"
        thumb_key = f"{original_key}.thumb.webp"
        upload_bytes(
            _webp_bytes(display, quality=display_quality),
            display_key,
            content_type="image/webp",
            bucket=bucket,
        )
        upload_bytes(
            _webp_bytes(thumb, quality=thumbnail_quality),
            thumb_key,
            content_type="image/webp",
            bucket=bucket,
        )
        return ProcessedListingImage(
            original_key=original_key,
            display_key=display_key,
            thumbnail_key=thumb_key,
        )
    except Exception as e:
        logger.warning("listing_image.process_failed", original_key=original_key, error=str(e))
        if upload_original:
            try:
                upload_bytes(raw, original_key, content_type=content_type, bucket=bucket)
            except Exception as upload_error:
                logger.warning(
                    "listing_image.original_upload_failed",
                    original_key=original_key,
                    error=str(upload_error),
                )
        return ProcessedListingImage(original_key=original_key, display_key=None, thumbnail_key=None)


def resize_listing_image(
    original_key: str,
    *,
    max_dimension: int = 1200,
    webp_quality: int = 86,
    bucket: str | None = None,
) -> str | None:
    """Backward-compatible thumbnail helper for older call sites."""
    processed = process_listing_image(
        original_key,
        max_display_dimension=max(1800, max_dimension),
        max_thumbnail_dimension=max_dimension,
        thumbnail_quality=webp_quality,
        bucket=bucket,
    )
    return processed.thumbnail_key


def object_key_for_listing_image(listing_id: str, size: str = "original") -> str:
    """Deterministic key: listings/{listing_id}/{uuid}_{size}.jpg"""
    return f"listings/{listing_id}/{uuid4()}_{size}.jpg"


def object_key_for_dispute_evidence(transaction_id: str, filename: str) -> str:
    return f"evidence/{transaction_id}/{filename}"


# ── Sprint 4 / Pass 3 ─────────────────────────────────────────────────────────

def object_key_for_fe_visit_image(visit_id: str, size: str = "original") -> str:
    """
    Key for photos captured during a Field Executive visit.
    FE photos are captured before a listing exists, so they live under their
    own prefix; if the visit produces a listing (outcome=listed), the
    submit-listing call passes these keys in as image_urls.
    """
    return f"fe-visits/{visit_id}/{uuid4()}_{size}.jpg"
