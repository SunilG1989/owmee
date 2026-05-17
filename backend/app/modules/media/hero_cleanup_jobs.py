from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from urllib.parse import unquote, urlparse
from uuid import UUID

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.types import String as SAString

from app.core.redis import get_redis
from app.core.settings import settings
from app.core.storage import download_bytes, thumbnail_key_for_display_key
from app.db.session import get_sessionmaker
from app.modules.media.image_cleanup import clean_hero_background

log = logging.getLogger(__name__)

HERO_CLEANUP_QUEUE_KEY = "owmee:media:hero-cleanup:v1"
HERO_CLEANUP_DEDUPE_PREFIX = "owmee:media:hero-cleanup:dedupe:"
HERO_CLEANUP_DEDUPE_SECONDS = 24 * 60 * 60
HERO_CLEANUP_ENQUEUE_TIMEOUT_SECONDS = 1.5
HERO_CLEANUP_JOB_TIMEOUT_SECONDS = 90
HERO_CLEANUP_IDLE_SECONDS = 2

_DISPLAY_SUFFIX = ".display.webp"
_THUMB_SUFFIX = ".thumb.webp"
_CLEANED_MARKER = ".hero-cleaned.png"


@dataclass(frozen=True)
class HeroCleanupJobResult:
    status: str
    listing_id: str
    original_key: str | None = None
    display_key: str | None = None
    thumbnail_key: str | None = None
    reason: str | None = None


def _stored_value_to_key(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if value.startswith("r2://"):
        return value[len("r2://") :]
    if value.startswith(("http://", "https://")):
        parsed = urlparse(value)
        path = unquote(parsed.path).lstrip("/")
        bucket = settings.r2_bucket.strip("/")
        if path == bucket:
            return None
        if path.startswith(f"{bucket}/"):
            return path[len(bucket) + 1 :]
        marker = f"/{bucket}/"
        full_path = unquote(parsed.path)
        if marker in full_path:
            return full_path.split(marker, 1)[1].lstrip("/")
        return path or None
    return value


def _strip_variant_suffix(key: str) -> str:
    if key.endswith(_DISPLAY_SUFFIX):
        return key[: -len(_DISPLAY_SUFFIX)]
    if key.endswith(_THUMB_SUFFIX):
        return key[: -len(_THUMB_SUFFIX)]
    return key


def _original_key_for_cleanup(value: str | None) -> str | None:
    key = _stored_value_to_key(value)
    if not key:
        return None
    key = _strip_variant_suffix(key)
    if _CLEANED_MARKER in key:
        return key.split(_CLEANED_MARKER, 1)[0] or None
    return key


def _content_type_for_key(key: str) -> str:
    lower = key.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"


def _gallery_with_cleaned_hero(values: list[str], *, original_key: str, cleaned_display_key: str) -> list[str]:
    """Put the cleaned hero first and remove older variants of that same hero."""
    normalized = [_stored_value_to_key(value) or value for value in values]
    rest = [
        value
        for value in normalized
        if _original_key_for_cleanup(value) != original_key
        and (_stored_value_to_key(value) or value) != cleaned_display_key
    ]
    return [cleaned_display_key, *rest]


def _coerce_payload(raw: str | bytes | dict) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


async def enqueue_listing_hero_cleanup(
    *,
    listing_id: UUID | str,
    hero_key: str | None,
    category_slug: str | None,
) -> bool:
    """Queue hero cleanup after the listing exists.

    The Redis worker is the production path. If Redis is briefly unavailable,
    we still schedule a best-effort in-process task so a seller is not blocked
    by media polish infrastructure.
    """
    if not hero_key:
        return False

    payload = {
        "listing_id": str(listing_id),
        "hero_key": hero_key,
        "category_slug": category_slug,
    }
    dedupe_key = f"{HERO_CLEANUP_DEDUPE_PREFIX}{listing_id}:{_stored_value_to_key(hero_key) or hero_key}"

    try:
        queued = await asyncio.wait_for(
            _enqueue_payload(payload, dedupe_key),
            timeout=HERO_CLEANUP_ENQUEUE_TIMEOUT_SECONDS,
        )
        return queued
    except asyncio.TimeoutError:
        log.warning(
            "media.hero_cleanup.queue_timeout",
            extra={"listing_id": str(listing_id), "timeout_seconds": HERO_CLEANUP_ENQUEUE_TIMEOUT_SECONDS},
        )
    except Exception as exc:
        log.warning(
            "media.hero_cleanup.queue_failed",
            extra={"listing_id": str(listing_id), "error": f"{type(exc).__name__}: {str(exc)[:200]}"},
        )
    try:
        asyncio.create_task(_safe_process_listing_hero_cleanup(payload))
    except RuntimeError:
        pass
    return False


async def _enqueue_payload(payload: dict, dedupe_key: str) -> bool:
    redis = await get_redis()
    added = await redis.set(
        dedupe_key,
        "1",
        ex=HERO_CLEANUP_DEDUPE_SECONDS,
        nx=True,
    )
    if not added:
        log.info("media.hero_cleanup.queue_duplicate", extra={"listing_id": payload.get("listing_id")})
        return False
    await redis.rpush(HERO_CLEANUP_QUEUE_KEY, json.dumps(payload))
    log.info("media.hero_cleanup.queued", extra={"listing_id": payload.get("listing_id")})
    return True


async def _safe_process_listing_hero_cleanup(payload: dict) -> None:
    try:
        result = await asyncio.wait_for(
            process_listing_hero_cleanup(
                listing_id=payload.get("listing_id"),
                hero_key=payload.get("hero_key"),
                category_slug=payload.get("category_slug"),
            ),
            timeout=HERO_CLEANUP_JOB_TIMEOUT_SECONDS,
        )
        if result.status == "failed":
            log.warning(
                "media.hero_cleanup.job_failed",
                extra={
                    "listing_id": result.listing_id,
                    "original_key": result.original_key,
                    "reason": result.reason,
                },
            )
    except Exception as exc:
        log.warning(
            "media.hero_cleanup.job_unhandled",
            extra={
                "listing_id": payload.get("listing_id"),
                "error": f"{type(exc).__name__}: {str(exc)[:200]}",
            },
        )


async def process_listing_hero_cleanup(
    *,
    listing_id: UUID | str | None,
    hero_key: str | None,
    category_slug: str | None,
) -> HeroCleanupJobResult:
    if not listing_id:
        return HeroCleanupJobResult(status="skipped", listing_id="", reason="missing_listing_id")

    listing_id_str = str(listing_id)
    requested_hero_key = _stored_value_to_key(hero_key)

    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                text("SELECT image_urls, thumbnail_url FROM listings WHERE id = :id"),
                {"id": listing_id_str},
            )
        ).mappings().first()
        if not row:
            return HeroCleanupJobResult(status="skipped", listing_id=listing_id_str, reason="listing_not_found")

        current_images = list(row.get("image_urls") or [])
        if not current_images and not requested_hero_key:
            return HeroCleanupJobResult(status="skipped", listing_id=listing_id_str, reason="no_images")

        hero_value = requested_hero_key or _stored_value_to_key(current_images[0]) or current_images[0]
        original_key = _original_key_for_cleanup(hero_value)
        if not original_key:
            return HeroCleanupJobResult(
                status="skipped",
                listing_id=listing_id_str,
                reason="missing_original_key",
            )

        expected_display_key = f"{original_key}{_CLEANED_MARKER}{_DISPLAY_SUFFIX}"
        expected_thumbnail_key = thumbnail_key_for_display_key(expected_display_key)

        existing_cleaned_variant = False
        try:
            download_bytes(expected_display_key)
            if expected_thumbnail_key:
                download_bytes(expected_thumbnail_key)
            existing_cleaned_variant = True
        except Exception:
            existing_cleaned_variant = False

        if existing_cleaned_variant:
            try:
                await _swap_listing_hero(
                    session,
                    listing_id=listing_id_str,
                    current_images=current_images,
                    original_key=original_key,
                    display_key=expected_display_key,
                    thumbnail_key=expected_thumbnail_key,
                )
                await session.commit()
                return HeroCleanupJobResult(
                    status="cleaned_existing",
                    listing_id=listing_id_str,
                    original_key=original_key,
                    display_key=expected_display_key,
                    thumbnail_key=expected_thumbnail_key,
                )
            except Exception as exc:
                await session.rollback()
                return HeroCleanupJobResult(
                    status="failed",
                    listing_id=listing_id_str,
                    original_key=original_key,
                    display_key=expected_display_key,
                    thumbnail_key=expected_thumbnail_key,
                    reason=f"listing_update_failed:{type(exc).__name__}",
                )

        try:
            raw = download_bytes(original_key)
        except Exception as exc:
            await session.rollback()
            return HeroCleanupJobResult(
                status="failed",
                listing_id=listing_id_str,
                original_key=original_key,
                reason=f"download_failed:{type(exc).__name__}",
            )

        try:
            cleanup = await asyncio.wait_for(
                clean_hero_background(
                    raw,
                    _content_type_for_key(original_key),
                    original_key=original_key,
                    selected_index=0,
                    category_slug=category_slug,
                ),
                timeout=HERO_CLEANUP_JOB_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            await session.rollback()
            return HeroCleanupJobResult(
                status="failed",
                listing_id=listing_id_str,
                original_key=original_key,
                reason="cleanup_timeout",
            )
        except Exception as exc:
            await session.rollback()
            return HeroCleanupJobResult(
                status="failed",
                listing_id=listing_id_str,
                original_key=original_key,
                reason=f"cleanup_error:{type(exc).__name__}",
            )

        if not cleanup.cleaned or not cleanup.display_key:
            await session.rollback()
            return HeroCleanupJobResult(
                status="failed",
                listing_id=listing_id_str,
                original_key=original_key,
                reason=cleanup.reason or "cleanup_failed",
            )

        thumbnail_key = cleanup.thumbnail_key or thumbnail_key_for_display_key(cleanup.display_key)
        try:
            await _swap_listing_hero(
                session,
                listing_id=listing_id_str,
                current_images=current_images,
                original_key=original_key,
                display_key=cleanup.display_key,
                thumbnail_key=thumbnail_key,
            )
            await session.commit()
        except Exception as exc:
            await session.rollback()
            return HeroCleanupJobResult(
                status="failed",
                listing_id=listing_id_str,
                original_key=original_key,
                display_key=cleanup.display_key,
                thumbnail_key=thumbnail_key,
                reason=f"listing_update_failed:{type(exc).__name__}",
            )

        log.info(
            "media.hero_cleanup.completed",
            extra={
                "listing_id": listing_id_str,
                "original_key": original_key,
                "display_key": cleanup.display_key,
                "provider": cleanup.provider,
                "style": cleanup.style,
            },
        )
        return HeroCleanupJobResult(
            status="cleaned",
            listing_id=listing_id_str,
            original_key=original_key,
            display_key=cleanup.display_key,
            thumbnail_key=thumbnail_key,
        )


async def _swap_listing_hero(
    session,
    *,
    listing_id: str,
    current_images: list[str],
    original_key: str,
    display_key: str,
    thumbnail_key: str | None,
) -> None:
    next_images = _gallery_with_cleaned_hero(
        current_images,
        original_key=original_key,
        cleaned_display_key=display_key,
    )
    await session.execute(
        text("""
            UPDATE listings
            SET image_urls = :image_urls,
                thumbnail_url = :thumbnail_url
            WHERE id = :id
        """).bindparams(bindparam("image_urls", type_=PGARRAY(SAString))),
        {
            "id": listing_id,
            "image_urls": next_images,
            "thumbnail_url": thumbnail_key or display_key,
        },
    )


async def run_hero_cleanup_worker() -> None:
    log.info("media.hero_cleanup.worker_starting", extra={"queue": HERO_CLEANUP_QUEUE_KEY})
    while True:
        try:
            redis = await get_redis()
            item = await redis.blpop(HERO_CLEANUP_QUEUE_KEY, timeout=HERO_CLEANUP_IDLE_SECONDS)
            if not item:
                continue
            _, raw_payload = item
            payload = _coerce_payload(raw_payload)
            await _safe_process_listing_hero_cleanup(payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning(
                "media.hero_cleanup.worker_error",
                extra={"error": f"{type(exc).__name__}: {str(exc)[:240]}"},
            )
            await asyncio.sleep(HERO_CLEANUP_IDLE_SECONDS)
