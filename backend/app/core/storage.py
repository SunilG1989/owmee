import io
from typing import BinaryIO
from uuid import uuid4

import boto3
import structlog
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.settings import settings

logger = structlog.get_logger()


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
    base = (settings.r2_public_endpoint or settings.r2_public_url or settings.r2_endpoint).rstrip("/")
    bucket = settings.r2_bucket
    return f"{base}/{bucket}/{object_key}"


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


def resize_listing_image(
    original_key: str,
    *,
    max_dimension: int = 1200,
    webp_quality: int = 80,
    bucket: str | None = None,
) -> str | None:
    """Resize an uploaded listing image into a 1200px-max webp thumbnail.
    Stored alongside the original at `<original-key>.thumb.webp`.

    Returns the thumbnail key on success, None on failure (logged but
    silent — we don't want a Pillow hiccup to block the upload-confirm
    flow; the original is still serveable via presigned URL).

    Why 1200px webp at q=80
    -----------------------
    - 800px is too small for zoom on phone listings; 1200 is a safe
      ceiling for the 6.7"-screen long-edge.
    - WebP at quality 80 is ~50% smaller than JPEG at the same perceived
      quality. India mobile networks really notice this.

    The original is preserved untouched. Once we have a CDN we can
    serve the webp from edge cache and let originals live cold.
    """
    try:
        from io import BytesIO
        from PIL import Image  # type: ignore
    except Exception:
        logger.warning("resize.pillow_missing", original_key=original_key)
        return None

    try:
        raw = download_bytes(original_key, bucket=bucket)
        img = Image.open(BytesIO(raw))
        # Strip EXIF + alpha mode handling so webp encode is deterministic.
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.thumbnail((max_dimension, max_dimension))
        out = BytesIO()
        img.save(out, format="WEBP", quality=webp_quality, method=4)
        out.seek(0)
        thumb_key = f"{original_key}.thumb.webp"
        upload_bytes(out.getvalue(), thumb_key, content_type="image/webp", bucket=bucket)
        return thumb_key
    except Exception as e:
        # Don't crash the upload flow on a resize hiccup — log + serve
        # the original via the unchanged image_urls fallback.
        logger.warning("resize.failed", original_key=original_key, error=str(e))
        return None


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
