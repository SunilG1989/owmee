from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from dataclasses import dataclass
from uuid import UUID

from redis.exceptions import ResponseError
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.types import String as SAString

from app.core.redis import get_redis
from app.core.settings import settings
from app.core.storage import download_bytes, object_size_bytes
from app.db.session import get_sessionmaker
from app.modules.ai_assistant import provider as ai_provider, price_estimator
from app.modules.ai_assistant.schemas import AIDetected
from app.modules.media.image_cleanup import move_hero_first, select_hero_image_index

log = logging.getLogger(__name__)

AI_DRAFT_ANALYSIS_STREAM_KEY = "owmee:ai:draft-analysis:stream:v1"
AI_DRAFT_ANALYSIS_RETRY_KEY = "owmee:ai:draft-analysis:retry:v1"
AI_DRAFT_ANALYSIS_DLQ_KEY = "owmee:ai:draft-analysis:dead:v1"
AI_DRAFT_ANALYSIS_GROUP = "ai-draft-analysis-workers"
AI_DRAFT_ANALYSIS_DEDUPE_PREFIX = "owmee:ai:draft-analysis:dedupe:"
AI_DRAFT_ANALYSIS_DEDUPE_SECONDS = 24 * 60 * 60
AI_DRAFT_ANALYSIS_JOB_TIMEOUT_SECONDS = 110
AI_DRAFT_ANALYSIS_RETRY_DELAYS_SECONDS = (30, 120, 300)
AI_DRAFT_ANALYSIS_MAINTENANCE_SECONDS = 5

_ENQUEUE_SCRIPT = """
if redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[2], '*', 'payload', ARGV[3])
end
return nil
"""


@dataclass(frozen=True)
class AIDraftAnalysisResult:
    status: str
    draft_id: str
    reason: str | None = None


class UploadedPhotoTooLarge(ValueError):
    def __init__(self, size: int, max_bytes: int) -> None:
        super().__init__(f"uploaded photo is {size} bytes; max is {max_bytes}")
        self.size = size
        self.max_bytes = max_bytes


async def _download_bounded_object(key: str, *, max_bytes: int) -> bytes:
    size = await asyncio.to_thread(object_size_bytes, key)
    if size > max_bytes:
        raise UploadedPhotoTooLarge(size=size, max_bytes=max_bytes)
    raw = await asyncio.to_thread(download_bytes, key)
    if len(raw) > max_bytes:
        raise UploadedPhotoTooLarge(size=len(raw), max_bytes=max_bytes)
    return raw


def _coerce_payload(raw: str | bytes | dict) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def _payload_attempt(payload: dict) -> int:
    try:
        return max(1, int(payload.get("attempt") or 1))
    except (TypeError, ValueError):
        return 1


def _retry_delay_seconds(attempt: int) -> int:
    index = min(max(0, attempt - 1), len(AI_DRAFT_ANALYSIS_RETRY_DELAYS_SECONDS) - 1)
    return AI_DRAFT_ANALYSIS_RETRY_DELAYS_SECONDS[index]


async def enqueue_ai_draft_analysis(
    *,
    draft_id: UUID | str,
    user_id: UUID | str,
    photo_keys: list[str],
) -> bool:
    if not photo_keys:
        return False
    payload = {
        "draft_id": str(draft_id),
        "user_id": str(user_id),
        "photo_keys": photo_keys,
        "attempt": 1,
    }
    dedupe_key = f"{AI_DRAFT_ANALYSIS_DEDUPE_PREFIX}{draft_id}"
    try:
        queued = await asyncio.wait_for(
            _enqueue_payload(payload, dedupe_key),
            timeout=settings.hero_cleanup_enqueue_timeout_seconds,
        )
        return queued
    except Exception as exc:
        log.warning(
            "ai_draft_analysis.queue_failed",
            extra={"draft_id": str(draft_id), "error": f"{type(exc).__name__}: {str(exc)[:200]}"},
        )
        return False


async def _enqueue_payload(payload: dict, dedupe_key: str) -> bool:
    redis = await get_redis()
    message_id = await redis.eval(
        _ENQUEUE_SCRIPT,
        2,
        dedupe_key,
        AI_DRAFT_ANALYSIS_STREAM_KEY,
        AI_DRAFT_ANALYSIS_DEDUPE_SECONDS,
        max(1000, settings.ai_draft_analysis_stream_maxlen),
        json.dumps(payload, separators=(",", ":")),
    )
    if not message_id:
        log.info("ai_draft_analysis.queue_duplicate", extra={"draft_id": payload.get("draft_id")})
        return True
    log.info(
        "ai_draft_analysis.queued",
        extra={"draft_id": payload.get("draft_id"), "stream_id": message_id},
    )
    return True


async def _mark_draft_failed(session, draft_id: str, *, error: str, message: str) -> None:
    await session.execute(
        text("""
            UPDATE listing_drafts
            SET status = 'failed',
                ai_response = CAST(:ai_response AS JSONB)
            WHERE id = :id
        """),
        {
            "id": draft_id,
            "ai_response": json.dumps({"error": error, "message": message}),
        },
    )
    await session.commit()


async def _mark_payload_failed(payload: dict, result: AIDraftAnalysisResult) -> None:
    draft_id = payload.get("draft_id")
    if not draft_id:
        return
    reason = result.reason or "analysis_failed"
    if "TimeoutError" in reason or "timeout" in reason.lower():
        message = "Photo analysis took too long. Please try again with fewer or clearer photos."
    else:
        message = "We could not analyse these photos. Please try again."
    async with get_sessionmaker()() as session:
        await session.execute(
            text("""
                UPDATE listing_drafts
                SET status = 'failed',
                    ai_response = CAST(:ai_response AS JSONB)
                WHERE id = :id
                  AND status IN ('uploading', 'processing')
            """),
            {
                "id": str(draft_id),
                "ai_response": json.dumps({"error": "ANALYSIS_FAILED", "message": message, "reason": reason}),
            },
        )
        await session.commit()


async def process_ai_draft_analysis(
    *,
    draft_id: UUID | str | None,
    user_id: UUID | str | None,
    photo_keys: list[str] | None,
) -> AIDraftAnalysisResult:
    if not draft_id or not user_id or not photo_keys:
        return AIDraftAnalysisResult(status="failed", draft_id=str(draft_id or ""), reason="missing_payload")

    draft_id_str = str(draft_id)
    user_id_str = str(user_id)

    # Local import avoids a router<->worker import cycle while keeping exactly
    # the same product/category/price semantics as the synchronous fallback.
    from app.modules.ai_assistant import router as ai_router
    from app.modules.identity_auth.user_location import get_user_location

    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                text("""
                    SELECT user_id, photo_urls, expires_at, status
                    FROM listing_drafts
                    WHERE id = :id
                """),
                {"id": draft_id_str},
            )
        ).mappings().first()
        if not row:
            return AIDraftAnalysisResult(status="skipped", draft_id=draft_id_str, reason="draft_not_found")
        if str(row["user_id"]) != user_id_str:
            return AIDraftAnalysisResult(status="failed", draft_id=draft_id_str, reason="draft_user_mismatch")
        if row["status"] in {"open", "consumed"}:
            return AIDraftAnalysisResult(status="skipped", draft_id=draft_id_str, reason=f"status:{row['status']}")
        if row["expires_at"] and row["expires_at"].timestamp() < time.time():
            await _mark_draft_failed(
                session,
                draft_id_str,
                error="DRAFT_EXPIRED",
                message="This draft expired. Please analyse the photos again.",
            )
            return AIDraftAnalysisResult(status="failed", draft_id=draft_id_str, reason="draft_expired")

        stored_keys = list(row["photo_urls"] or [])
        keys = [key for key in photo_keys if key in stored_keys]
        if not keys:
            await _mark_draft_failed(
                session,
                draft_id_str,
                error="NO_IMAGES",
                message="No uploaded photos were found for this draft.",
            )
            return AIDraftAnalysisResult(status="failed", draft_id=draft_id_str, reason="no_images")

        await session.execute(
            text("UPDATE listing_drafts SET status = 'processing' WHERE id = :id"),
            {"id": draft_id_str},
        )
        await session.commit()

        async def process_key(key: str) -> tuple[str, tuple[bytes, str]]:
            try:
                raw = await _download_bounded_object(key, max_bytes=ai_router.MAX_ANALYSIS_UPLOAD_BYTES)
                prepared_bytes, prepared_type = await asyncio.to_thread(
                    ai_router._prepare_analysis_image_bytes,
                    raw,
                    ai_router._safe_upload_content_type(None),
                )
                del raw
                processed = await asyncio.to_thread(
                    ai_router.process_listing_image_bytes,
                    prepared_bytes,
                    original_key=key,
                    content_type=prepared_type,
                    upload_original=False,
                    max_display_dimension=ai_router.AI_DRAFT_DISPLAY_DIMENSION,
                    max_thumbnail_dimension=ai_router.AI_DRAFT_THUMBNAIL_DIMENSION,
                    display_quality=86,
                    thumbnail_quality=78,
                    polish=False,
                )
                return processed.display_key or key, (prepared_bytes, prepared_type)
            except UploadedPhotoTooLarge as exc:
                raise exc
            except Exception as exc:
                raise RuntimeError(f"photo_process_failed:{type(exc).__name__}") from exc

        semaphore = asyncio.Semaphore(ai_router.AI_DRAFT_IMAGE_IO_CONCURRENCY)

        async def process_key_bounded(key: str) -> tuple[str, tuple[bytes, str]]:
            async with semaphore:
                return await process_key(key)

        try:
            processed_images = await asyncio.gather(*[process_key_bounded(key) for key in keys])
        except UploadedPhotoTooLarge as exc:
            await _mark_draft_failed(
                session,
                draft_id_str,
                error="PHOTO_TOO_LARGE",
                message="One photo is too large. Please retake or select a smaller photo.",
            )
            return AIDraftAnalysisResult(
                status="failed",
                draft_id=draft_id_str,
                reason=f"photo_too_large:{exc.size}",
            )
        except Exception as exc:
            await _mark_draft_failed(
                session,
                draft_id_str,
                error="PHOTO_DOWNLOAD_FAILED",
                message="One of the uploaded photos could not be processed. Please try again.",
            )
            reason = str(exc) if str(exc).startswith("photo_process_failed:") else f"photo_process_failed:{type(exc).__name__}"
            return AIDraftAnalysisResult(
                status="failed",
                draft_id=draft_id_str,
                reason=reason,
            )

        photo_urls = [photo_url for photo_url, _ in processed_images]
        image_pairs = [image_pair for _, image_pair in processed_images]

        location_task = get_user_location(session, UUID(user_id_str))
        detected, (_lat, _lng, _city, user_state) = await asyncio.gather(
            ai_router._detect_from_images_bounded(image_pairs),
            location_task,
        )
        detected = ai_router._with_canonical_category(detected)
        hero_index = select_hero_image_index(detected, len(photo_urls))
        hero_index = ai_router._front_face_hero_override(detected, hero_index, len(photo_urls))
        detected = detected.model_copy(update={"hero_image_index": hero_index})

        rejection = ai_router._photo_rejection_detail(detected)
        if rejection:
            detail = rejection if isinstance(rejection, dict) else {"error": "PHOTO_REJECTED", "message": str(rejection)}
            await _mark_draft_failed(
                session,
                draft_id_str,
                error=detail.get("error") or "PHOTO_REJECTED",
                message=detail.get("message") or "Please upload clearer product photos.",
            )
            return AIDraftAnalysisResult(status="failed", draft_id=draft_id_str, reason="photo_rejected")

        vision_price_available = bool(detected.suggested_price_inr)
        analysis_failed = any(f.startswith("ai_failed:") for f in detected.flags)
        if analysis_failed:
            detected = ai_router._mark_hero_cleanup_skipped(detected, selected_index=hero_index, reason="vision_failed")
        else:
            detected = ai_router._mark_hero_cleanup_deferred(detected, selected_index=hero_index)

        price_result = await ai_router._estimate_price_bounded(
            price_estimator.estimate_price(
                session,
                brand=detected.brand,
                model=detected.model,
                storage=detected.storage,
                condition=detected.condition_guess or "good",
                state=user_state,
                category_slug=detected.category_slug,
                detected_item_type=detected.detected_item_type,
                allow_ai_fallback=not vision_price_available and not analysis_failed,
            )
        )
        price_result = ai_router._apply_price_fallbacks(price_result, detected)

        photo_urls = move_hero_first(photo_urls, hero_index)
        await session.execute(
            text("""
                UPDATE listing_drafts
                SET photo_urls = :photo_urls,
                    ai_response = CAST(:ai_response AS JSONB),
                    suggested_price = :price,
                    comparables_count = :ccount,
                    ai_model = :model,
                    status = 'open'
                WHERE id = :id
            """).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString))),
            {
                "id": draft_id_str,
                "photo_urls": photo_urls,
                "ai_response": ai_router._draft_ai_response_json(detected, price_result),
                "price": price_result.get("price"),
                "ccount": price_result.get("comparables_count", 0),
                "model": ai_provider.current_vision_model(),
            },
        )
        await session.commit()
        log.info(
            "ai_draft_analysis.completed",
            extra={
                "draft_id": draft_id_str,
                "image_count": len(photo_urls),
                "category_slug": detected.category_slug,
                "price_source": price_result.get("source"),
            },
        )
        return AIDraftAnalysisResult(status="ready", draft_id=draft_id_str)


async def _safe_process_ai_draft_analysis(payload: dict) -> AIDraftAnalysisResult:
    try:
        return await asyncio.wait_for(
            process_ai_draft_analysis(
                draft_id=payload.get("draft_id"),
                user_id=payload.get("user_id"),
                photo_keys=payload.get("photo_keys") or [],
            ),
            timeout=AI_DRAFT_ANALYSIS_JOB_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        log.warning(
            "ai_draft_analysis.job_unhandled",
            extra={"draft_id": payload.get("draft_id"), "error": f"{type(exc).__name__}: {str(exc)[:200]}"},
        )
        return AIDraftAnalysisResult(
            status="failed",
            draft_id=str(payload.get("draft_id") or ""),
            reason=f"job_unhandled:{type(exc).__name__}",
        )


def _is_retryable(result: AIDraftAnalysisResult) -> bool:
    reason = (result.reason or "").lower()
    return result.status == "failed" and reason.startswith("job_unhandled")


async def _ensure_stream_group(redis) -> None:
    try:
        await redis.xgroup_create(
            AI_DRAFT_ANALYSIS_STREAM_KEY,
            AI_DRAFT_ANALYSIS_GROUP,
            id="0-0",
            mkstream=True,
        )
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise


async def _xadd_payload(redis, payload: dict, *, stream_key: str = AI_DRAFT_ANALYSIS_STREAM_KEY) -> str:
    return str(await redis.xadd(
        stream_key,
        {"payload": json.dumps(payload, separators=(",", ":"))},
        maxlen=max(1000, settings.ai_draft_analysis_stream_maxlen),
        approximate=True,
    ))


async def _schedule_retry(redis, payload: dict, result: AIDraftAnalysisResult) -> None:
    attempt = _payload_attempt(payload)
    next_payload = dict(payload)
    next_payload["attempt"] = attempt + 1
    next_payload["last_error"] = result.reason
    run_at = int(time.time()) + _retry_delay_seconds(attempt)
    await redis.zadd(
        AI_DRAFT_ANALYSIS_RETRY_KEY,
        {json.dumps(next_payload, sort_keys=True, separators=(",", ":")): run_at},
    )


async def _dead_letter(redis, payload: dict, result: AIDraftAnalysisResult) -> None:
    dead = dict(payload)
    dead["final_error"] = result.reason
    dead["failed_at"] = int(time.time())
    await _xadd_payload(redis, dead, stream_key=AI_DRAFT_ANALYSIS_DLQ_KEY)


async def _drain_due_retries(redis, *, max_items: int) -> int:
    due = await redis.zrangebyscore(
        AI_DRAFT_ANALYSIS_RETRY_KEY,
        min="-inf",
        max=int(time.time()),
        start=0,
        num=max_items,
    )
    drained = 0
    for raw_member in due:
        removed = await redis.zrem(AI_DRAFT_ANALYSIS_RETRY_KEY, raw_member)
        if not removed:
            continue
        payload = _coerce_payload(raw_member)
        await _xadd_payload(redis, payload)
        drained += 1
    return drained


def _message_payload(fields: dict) -> dict:
    raw = fields.get("payload") if isinstance(fields, dict) else None
    return _coerce_payload(raw) if raw is not None else {}


async def _claim_stale_message(redis, consumer_name: str) -> tuple[str, dict] | None:
    response = await redis.xautoclaim(
        AI_DRAFT_ANALYSIS_STREAM_KEY,
        AI_DRAFT_ANALYSIS_GROUP,
        consumer_name,
        min_idle_time=120_000,
        start_id="0-0",
        count=1,
    )
    entries = response[1] if isinstance(response, (list, tuple)) and len(response) > 1 else []
    if not entries:
        return None
    message_id, fields = entries[0]
    return str(message_id), fields


async def _read_new_message(redis, consumer_name: str) -> tuple[str, dict] | None:
    messages = await redis.xreadgroup(
        AI_DRAFT_ANALYSIS_GROUP,
        consumer_name,
        streams={AI_DRAFT_ANALYSIS_STREAM_KEY: ">"},
        count=1,
        block=max(100, settings.ai_draft_analysis_read_block_ms),
    )
    if not messages:
        return None
    _stream, entries = messages[0]
    if not entries:
        return None
    message_id, fields = entries[0]
    return str(message_id), fields


async def _handle_message(redis, message_id: str, fields: dict) -> None:
    payload = _message_payload(fields)
    result = await _safe_process_ai_draft_analysis(payload)
    if result.status == "failed":
        attempt = _payload_attempt(payload)
        if _is_retryable(result) and attempt < max(1, settings.ai_draft_analysis_retry_max_attempts):
            await _schedule_retry(redis, payload, result)
        else:
            if _is_retryable(result):
                await _mark_payload_failed(payload, result)
            await _dead_letter(redis, payload, result)
    await redis.xack(AI_DRAFT_ANALYSIS_STREAM_KEY, AI_DRAFT_ANALYSIS_GROUP, message_id)


async def _run_consumer_loop(index: int) -> None:
    redis = await get_redis()
    await _ensure_stream_group(redis)
    consumer = f"{socket.gethostname()}-{os.getpid()}-ai-draft-{index}"
    next_maintenance_at = 0.0
    log.info("ai_draft_analysis.consumer_starting", extra={"consumer": consumer})
    while True:
        try:
            now = time.monotonic()
            if now >= next_maintenance_at:
                next_maintenance_at = now + AI_DRAFT_ANALYSIS_MAINTENANCE_SECONDS
                await _drain_due_retries(redis, max_items=max(1, settings.ai_draft_analysis_worker_concurrency))
                claimed = await _claim_stale_message(redis, consumer)
                if claimed:
                    await _handle_message(redis, claimed[0], claimed[1])
                    continue
            message = await _read_new_message(redis, consumer)
            if message:
                await _handle_message(redis, message[0], message[1])
        except asyncio.CancelledError:
            raise
        except ResponseError as exc:
            if "NOGROUP" in str(exc):
                await _ensure_stream_group(redis)
            else:
                log.warning("ai_draft_analysis.consumer_redis_error", extra={"error": str(exc)[:200]})
                await asyncio.sleep(1)
        except Exception as exc:
            log.warning(
                "ai_draft_analysis.consumer_error",
                extra={"error": f"{type(exc).__name__}: {str(exc)[:200]}"},
            )
            await asyncio.sleep(1)


async def run_ai_draft_analysis_worker() -> None:
    concurrency = max(1, settings.ai_draft_analysis_worker_concurrency)
    redis = await get_redis()
    await _ensure_stream_group(redis)
    log.info(
        "ai_draft_analysis.worker_starting",
        extra={"stream": AI_DRAFT_ANALYSIS_STREAM_KEY, "concurrency": concurrency},
    )
    tasks = [asyncio.create_task(_run_consumer_loop(index)) for index in range(concurrency)]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
