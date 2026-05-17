from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from dataclasses import dataclass
from urllib.parse import unquote, urlparse
from uuid import UUID

from redis.exceptions import ResponseError
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.types import String as SAString

from app.core.redis import get_redis
from app.core.settings import settings
from app.core.storage import download_bytes, thumbnail_key_for_display_key
from app.db.session import get_sessionmaker
from app.modules.media.image_cleanup import clean_hero_background

log = logging.getLogger(__name__)

HERO_CLEANUP_STREAM_KEY = "owmee:media:hero-cleanup:stream:v1"
HERO_CLEANUP_RETRY_KEY = "owmee:media:hero-cleanup:retry:v1"
HERO_CLEANUP_DLQ_KEY = "owmee:media:hero-cleanup:dead:v1"
HERO_CLEANUP_GROUP = "hero-cleanup-workers"
HERO_CLEANUP_DEDUPE_PREFIX = "owmee:media:hero-cleanup:dedupe:"
HERO_CLEANUP_DEDUPE_SECONDS = 24 * 60 * 60
HERO_CLEANUP_JOB_TIMEOUT_SECONDS = 90
HERO_CLEANUP_RETRY_DELAYS_SECONDS = (60, 300, 900)
HERO_CLEANUP_MAINTENANCE_SECONDS = 5

_DISPLAY_SUFFIX = ".display.webp"
_THUMB_SUFFIX = ".thumb.webp"
_CLEANED_MARKER = ".hero-cleaned.png"

_ENQUEUE_SCRIPT = """
if redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[2], '*', 'payload', ARGV[3])
end
return nil
"""


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

    This must stay a very small Redis write. If queueing is unavailable, the
    listing publish request still succeeds and the original processed photo
    remains in place; the API process never performs provider-heavy cleanup
    work inline.
    """
    if not hero_key:
        return False

    payload = {
        "listing_id": str(listing_id),
        "hero_key": hero_key,
        "category_slug": category_slug,
        "attempt": 1,
    }
    dedupe_key = f"{HERO_CLEANUP_DEDUPE_PREFIX}{listing_id}:{_stored_value_to_key(hero_key) or hero_key}"

    try:
        queued = await asyncio.wait_for(
            _enqueue_payload(payload, dedupe_key),
            timeout=settings.hero_cleanup_enqueue_timeout_seconds,
        )
        return queued
    except asyncio.TimeoutError:
        log.warning(
            "media.hero_cleanup.queue_timeout",
            extra={"listing_id": str(listing_id), "timeout_seconds": settings.hero_cleanup_enqueue_timeout_seconds},
        )
    except Exception as exc:
        log.warning(
            "media.hero_cleanup.queue_failed",
            extra={"listing_id": str(listing_id), "error": f"{type(exc).__name__}: {str(exc)[:200]}"},
        )
    return False


async def _enqueue_payload(payload: dict, dedupe_key: str) -> bool:
    redis = await get_redis()
    message_id = await redis.eval(
        _ENQUEUE_SCRIPT,
        2,
        dedupe_key,
        HERO_CLEANUP_STREAM_KEY,
        HERO_CLEANUP_DEDUPE_SECONDS,
        max(1000, settings.hero_cleanup_stream_maxlen),
        json.dumps(payload, separators=(",", ":")),
    )
    if not message_id:
        log.info("media.hero_cleanup.queue_duplicate", extra={"listing_id": payload.get("listing_id")})
        return False
    log.info(
        "media.hero_cleanup.queued",
        extra={"listing_id": payload.get("listing_id"), "stream_id": message_id},
    )
    return True


async def _safe_process_listing_hero_cleanup(payload: dict) -> HeroCleanupJobResult:
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
        return result
    except Exception as exc:
        log.warning(
            "media.hero_cleanup.job_unhandled",
            extra={
                "listing_id": payload.get("listing_id"),
                "error": f"{type(exc).__name__}: {str(exc)[:200]}",
            },
        )
        return HeroCleanupJobResult(
            status="failed",
            listing_id=str(payload.get("listing_id") or ""),
            reason=f"job_unhandled:{type(exc).__name__}",
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


async def _ensure_stream_group(redis) -> None:
    try:
        await redis.xgroup_create(
            HERO_CLEANUP_STREAM_KEY,
            HERO_CLEANUP_GROUP,
            id="0-0",
            mkstream=True,
        )
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


def _worker_name(index: int) -> str:
    return f"{socket.gethostname()}-{os.getpid()}-{index}"


async def _xadd_payload(redis, payload: dict, *, stream_key: str = HERO_CLEANUP_STREAM_KEY) -> str:
    message_id = await redis.xadd(
        stream_key,
        {"payload": json.dumps(payload, separators=(",", ":"))},
        maxlen=max(1000, settings.hero_cleanup_stream_maxlen),
        approximate=True,
    )
    return str(message_id)


def _message_payload(fields: dict) -> dict:
    raw_payload = fields.get("payload") if isinstance(fields, dict) else None
    if raw_payload is None:
        return {}
    return _coerce_payload(raw_payload)


def _payload_attempt(payload: dict) -> int:
    try:
        return max(1, int(payload.get("attempt") or 1))
    except (TypeError, ValueError):
        return 1


def _retry_delay_seconds(attempt: int) -> int:
    if attempt <= 0:
        return HERO_CLEANUP_RETRY_DELAYS_SECONDS[0]
    index = min(attempt - 1, len(HERO_CLEANUP_RETRY_DELAYS_SECONDS) - 1)
    return HERO_CLEANUP_RETRY_DELAYS_SECONDS[index]


def _is_retryable_result(result: HeroCleanupJobResult) -> bool:
    if result.status != "failed":
        return False
    reason = (result.reason or "").lower()
    retryable_prefixes = (
        "download_failed",
        "cleanup_timeout",
        "cleanup_error",
        "listing_update_failed",
        "job_unhandled",
    )
    retryable_exact = {
        "api_error",
        "no_image_output",
        "persist_failed",
    }
    return reason.startswith(retryable_prefixes) or reason in retryable_exact


async def _schedule_retry(redis, payload: dict, result: HeroCleanupJobResult) -> None:
    attempt = _payload_attempt(payload)
    next_payload = dict(payload)
    next_payload["attempt"] = attempt + 1
    next_payload["last_error"] = result.reason
    next_payload["last_failed_at"] = int(time.time())
    run_at = int(time.time()) + _retry_delay_seconds(attempt)
    next_payload["next_attempt_at"] = run_at
    await redis.zadd(
        HERO_CLEANUP_RETRY_KEY,
        {json.dumps(next_payload, sort_keys=True, separators=(",", ":")): run_at},
    )
    log.warning(
        "media.hero_cleanup.retry_scheduled",
        extra={
            "listing_id": payload.get("listing_id"),
            "attempt": attempt,
            "next_attempt": attempt + 1,
            "run_at": run_at,
            "reason": result.reason,
        },
    )


async def _dead_letter(redis, payload: dict, result: HeroCleanupJobResult) -> None:
    dead_payload = dict(payload)
    dead_payload["final_error"] = result.reason
    dead_payload["failed_at"] = int(time.time())
    dead_payload["status"] = result.status
    await _xadd_payload(redis, dead_payload, stream_key=HERO_CLEANUP_DLQ_KEY)
    log.warning(
        "media.hero_cleanup.dead_lettered",
        extra={
            "listing_id": payload.get("listing_id"),
            "attempt": _payload_attempt(payload),
            "reason": result.reason,
        },
    )


async def _drain_due_retries(redis, *, max_items: int) -> int:
    due = await redis.zrangebyscore(
        HERO_CLEANUP_RETRY_KEY,
        min="-inf",
        max=int(time.time()),
        start=0,
        num=max_items,
    )
    drained = 0
    for raw_member in due:
        removed = await redis.zrem(HERO_CLEANUP_RETRY_KEY, raw_member)
        if not removed:
            continue
        try:
            payload = _coerce_payload(raw_member)
            await _xadd_payload(redis, payload)
            drained += 1
        except Exception:
            try:
                payload = _coerce_payload(raw_member)
                run_at = int(payload.get("next_attempt_at") or (time.time() + _retry_delay_seconds(_payload_attempt(payload))))
                await redis.zadd(HERO_CLEANUP_RETRY_KEY, {raw_member: run_at})
            except Exception:
                log.warning("media.hero_cleanup.retry_restore_failed")
            raise
    if drained:
        log.info("media.hero_cleanup.retries_requeued", extra={"count": drained})
    return drained


async def _read_new_message(redis, consumer_name: str) -> tuple[str, dict] | None:
    messages = await redis.xreadgroup(
        HERO_CLEANUP_GROUP,
        consumer_name,
        streams={HERO_CLEANUP_STREAM_KEY: ">"},
        count=1,
        block=max(100, settings.hero_cleanup_read_block_ms),
    )
    if not messages:
        return None
    _stream, entries = messages[0]
    if not entries:
        return None
    message_id, fields = entries[0]
    return str(message_id), fields


async def _claim_stale_message(redis, consumer_name: str) -> tuple[str, dict] | None:
    try:
        response = await redis.xautoclaim(
            HERO_CLEANUP_STREAM_KEY,
            HERO_CLEANUP_GROUP,
            consumer_name,
            min_idle_time=max(30, settings.hero_cleanup_pending_idle_seconds) * 1000,
            start_id="0-0",
            count=1,
        )
    except ResponseError as exc:
        if "NOGROUP" in str(exc):
            await _ensure_stream_group(redis)
            return None
        raise

    entries = response[1] if isinstance(response, (list, tuple)) and len(response) > 1 else []
    if not entries:
        return None
    message_id, fields = entries[0]
    return str(message_id), fields


async def _handle_stream_message(redis, message_id: str, fields: dict) -> None:
    payload = _message_payload(fields)
    result = await _safe_process_listing_hero_cleanup(payload)
    if result.status == "failed":
        attempt = _payload_attempt(payload)
        if _is_retryable_result(result) and attempt < max(1, settings.hero_cleanup_retry_max_attempts):
            await _schedule_retry(redis, payload, result)
        else:
            await _dead_letter(redis, payload, result)

    await redis.xack(HERO_CLEANUP_STREAM_KEY, HERO_CLEANUP_GROUP, message_id)


async def _run_consumer_loop(index: int) -> None:
    redis = await get_redis()
    await _ensure_stream_group(redis)
    consumer_name = _worker_name(index)
    next_maintenance_at = 0.0
    log.info(
        "media.hero_cleanup.consumer_starting",
        extra={"consumer": consumer_name, "stream": HERO_CLEANUP_STREAM_KEY},
    )

    while True:
        try:
            now = time.monotonic()
            if now >= next_maintenance_at:
                next_maintenance_at = now + HERO_CLEANUP_MAINTENANCE_SECONDS
                await _drain_due_retries(redis, max_items=max(1, settings.hero_cleanup_worker_concurrency))
                claimed = await _claim_stale_message(redis, consumer_name)
                if claimed:
                    message_id, fields = claimed
                    await _handle_stream_message(redis, message_id, fields)
                    continue

            message = await _read_new_message(redis, consumer_name)
            if not message:
                continue
            message_id, fields = message
            await _handle_stream_message(redis, message_id, fields)
        except asyncio.CancelledError:
            raise
        except ResponseError as exc:
            if "NOGROUP" in str(exc):
                await _ensure_stream_group(redis)
            else:
                log.warning(
                    "media.hero_cleanup.consumer_redis_error",
                    extra={"consumer": consumer_name, "error": str(exc)[:240]},
                )
                await asyncio.sleep(1)
        except Exception as exc:
            log.warning(
                "media.hero_cleanup.consumer_error",
                extra={"consumer": consumer_name, "error": f"{type(exc).__name__}: {str(exc)[:240]}"},
            )
            await asyncio.sleep(1)


async def run_hero_cleanup_worker() -> None:
    concurrency = max(1, settings.hero_cleanup_worker_concurrency)
    redis = await get_redis()
    await _ensure_stream_group(redis)
    log.info(
        "media.hero_cleanup.worker_starting",
        extra={
            "stream": HERO_CLEANUP_STREAM_KEY,
            "group": HERO_CLEANUP_GROUP,
            "concurrency": concurrency,
            "max_attempts": settings.hero_cleanup_retry_max_attempts,
        },
    )
    tasks = [asyncio.create_task(_run_consumer_loop(index)) for index in range(concurrency)]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
