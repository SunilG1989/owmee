from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from sqlalchemy import String as SAString
from sqlalchemy import bindparam, select, text
from sqlalchemy.dialects.postgresql import ARRAY as PGARRAY
from sqlalchemy.orm import selectinload

from app.core.settings import settings
from app.core.storage import download_bytes, thumbnail_key_for_display_key
from app.db.session import engine, get_sessionmaker

# Standalone ORM scripts need the referenced tables registered before
# SQLAlchemy flushes Listing updates.
import app.modules.community.models  # noqa: F401,E402
import app.modules.field_executive.models  # noqa: F401,E402
import app.modules.identity_auth.models  # noqa: F401,E402

from app.modules.listings.models import Listing
from app.modules.media.image_cleanup import clean_hero_background


_DISPLAY_SUFFIX = ".display.webp"
_THUMB_SUFFIX = ".thumb.webp"
_CLEANED_MARKER = ".hero-cleaned.png"


@dataclass
class PhotoSetResult:
    status: str
    original_key: str | None = None
    display_key: str | None = None
    thumbnail_key: str | None = None
    new_values: list[str] | None = None
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


def _original_key_for_cleanup(key: str | None) -> str | None:
    if not key:
        return None
    if _CLEANED_MARKER in key:
        return None
    if key.endswith(_DISPLAY_SUFFIX):
        return key[: -len(_DISPLAY_SUFFIX)]
    if key.endswith(_THUMB_SUFFIX):
        return key[: -len(_THUMB_SUFFIX)]
    return key


def _content_type_for_key(key: str) -> str:
    lower = key.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"


async def _backfill_photo_set(
    values: list[str],
    *,
    category_slug: str | None,
    label: str,
    apply: bool,
) -> PhotoSetResult:
    if not values:
        return PhotoSetResult(status="skipped", reason="no_images")

    normalized_values = [_stored_value_to_key(value) or value for value in values]
    hero_key = _stored_value_to_key(values[0])
    original_key = _original_key_for_cleanup(hero_key)
    if not original_key:
        status = "already_cleaned" if hero_key and _CLEANED_MARKER in hero_key else "skipped"
        return PhotoSetResult(
            status=status,
            original_key=hero_key,
            new_values=normalized_values,
            reason="already_cleaned" if status == "already_cleaned" else "missing_hero_key",
        )

    display_key = f"{original_key}{_CLEANED_MARKER}{_DISPLAY_SUFFIX}"
    thumbnail_key = thumbnail_key_for_display_key(display_key)

    if not apply:
        return PhotoSetResult(
            status="would_clean",
            original_key=original_key,
            display_key=display_key,
            thumbnail_key=thumbnail_key,
            new_values=[display_key, *normalized_values[1:]],
        )

    try:
        download_bytes(display_key)
        if thumbnail_key:
            download_bytes(thumbnail_key)
        return PhotoSetResult(
            status="cleaned_existing",
            original_key=original_key,
            display_key=display_key,
            thumbnail_key=thumbnail_key,
            new_values=[display_key, *normalized_values[1:]],
        )
    except Exception:
        pass

    print(f"{label}: cleaning {original_key}")
    try:
        raw = download_bytes(original_key)
    except Exception as exc:
        return PhotoSetResult(
            status="failed",
            original_key=original_key,
            new_values=normalized_values,
            reason=f"download_failed:{type(exc).__name__}",
        )

    cleanup = await clean_hero_background(
        raw,
        _content_type_for_key(original_key),
        original_key=original_key,
        selected_index=0,
        category_slug=category_slug,
    )
    if not cleanup.cleaned or not cleanup.display_key:
        return PhotoSetResult(
            status="failed",
            original_key=original_key,
            new_values=normalized_values,
            reason=cleanup.reason or "cleanup_failed",
        )

    new_values = list(normalized_values)
    new_values[0] = cleanup.display_key
    return PhotoSetResult(
        status="cleaned",
        original_key=original_key,
        display_key=cleanup.display_key,
        thumbnail_key=cleanup.thumbnail_key or thumbnail_key_for_display_key(cleanup.display_key),
        new_values=new_values,
    )


async def _backfill_listings(args) -> dict[str, int]:
    summary = {
        "cleaned": 0,
        "cleaned_existing": 0,
        "would_clean": 0,
        "failed": 0,
        "skipped": 0,
        "already_cleaned": 0,
        "normalized_only": 0,
    }
    statuses = set(args.listing_status or [])
    async with get_sessionmaker()() as session:
        stmt = (
            select(Listing)
            .options(selectinload(Listing.category))
            .order_by(Listing.created_at.desc())
        )
        if not args.all_listing_statuses:
            stmt = stmt.where(Listing.status.in_(statuses or {"active"}))
        if args.limit:
            stmt = stmt.limit(args.limit)

        listings = list((await session.execute(stmt)).scalars().all())
        for listing in listings:
            values = list(listing.image_urls or [])
            if not values:
                summary["skipped"] += 1
                print(f"listing:{listing.id}: skipped no_images")
                continue

            result = await _backfill_photo_set(
                values,
                category_slug=getattr(getattr(listing, "category", None), "slug", None),
                label=f"listing:{listing.id} {listing.title!r}",
                apply=args.apply,
            )
            if result.status == "cleaned":
                summary["cleaned"] += 1
                if args.apply:
                    listing.image_urls = result.new_values or values
                    listing.thumbnail_url = result.thumbnail_key or result.display_key
                print(f"listing:{listing.id}: cleaned -> {result.display_key}")
            elif result.status == "cleaned_existing":
                summary["cleaned_existing"] += 1
                if args.apply:
                    listing.image_urls = result.new_values or values
                    listing.thumbnail_url = result.thumbnail_key or result.display_key
                print(f"listing:{listing.id}: reused existing cleaned image -> {result.display_key}")
            elif result.status == "would_clean":
                summary["would_clean"] += 1
                print(f"listing:{listing.id}: would_clean {result.original_key} -> {result.display_key}")
            elif result.status == "already_cleaned":
                summary["already_cleaned"] += 1
                if args.apply and result.new_values and result.new_values != values:
                    listing.image_urls = result.new_values
                    listing.thumbnail_url = _stored_value_to_key(listing.thumbnail_url) or listing.thumbnail_url
                print(f"listing:{listing.id}: already_cleaned")
            elif result.new_values and result.new_values != values:
                summary["normalized_only"] += 1
                if args.apply:
                    listing.image_urls = result.new_values
                    listing.thumbnail_url = _stored_value_to_key(listing.thumbnail_url) or listing.thumbnail_url
                print(f"listing:{listing.id}: normalized_only ({result.reason})")
            else:
                summary["failed" if result.status == "failed" else "skipped"] += 1
                print(f"listing:{listing.id}: {result.status} {result.reason or ''}".strip())

        if args.apply:
            await session.commit()
        else:
            await session.rollback()
    return summary


async def _backfill_drafts(args) -> dict[str, int]:
    summary = {
        "cleaned": 0,
        "cleaned_existing": 0,
        "would_clean": 0,
        "failed": 0,
        "skipped": 0,
        "already_cleaned": 0,
        "normalized_only": 0,
    }
    statuses = set(args.draft_status or ["open"])
    async with get_sessionmaker()() as session:
        stmt = text(
            """
            SELECT id, status, photo_urls, ai_response
            FROM listing_drafts
            WHERE COALESCE(array_length(photo_urls, 1), 0) > 0
            ORDER BY created_at DESC
            """
        )
        rows = list((await session.execute(stmt)).mappings().all())
        if not args.all_draft_statuses:
            rows = [row for row in rows if row["status"] in statuses]
        if args.limit:
            rows = rows[: args.limit]

        update_stmt = text(
            "UPDATE listing_drafts SET photo_urls = :photo_urls WHERE id = :id"
        ).bindparams(bindparam("photo_urls", type_=PGARRAY(SAString)))

        for row in rows:
            values = list(row["photo_urls"] or [])
            ai_response = row["ai_response"] or {}
            category_slug = ai_response.get("category_slug") if isinstance(ai_response, dict) else None
            result = await _backfill_photo_set(
                values,
                category_slug=category_slug,
                label=f"draft:{row['id']} {row['status']}",
                apply=args.apply,
            )
            if result.status == "cleaned":
                summary["cleaned"] += 1
                if args.apply:
                    await session.execute(update_stmt, {"id": row["id"], "photo_urls": result.new_values or values})
                print(f"draft:{row['id']}: cleaned -> {result.display_key}")
            elif result.status == "cleaned_existing":
                summary["cleaned_existing"] += 1
                if args.apply:
                    await session.execute(update_stmt, {"id": row["id"], "photo_urls": result.new_values or values})
                print(f"draft:{row['id']}: reused existing cleaned image -> {result.display_key}")
            elif result.status == "would_clean":
                summary["would_clean"] += 1
                print(f"draft:{row['id']}: would_clean {result.original_key} -> {result.display_key}")
            elif result.status == "already_cleaned":
                summary["already_cleaned"] += 1
                if args.apply and result.new_values and result.new_values != values:
                    await session.execute(update_stmt, {"id": row["id"], "photo_urls": result.new_values})
                print(f"draft:{row['id']}: already_cleaned")
            elif result.new_values and result.new_values != values:
                summary["normalized_only"] += 1
                if args.apply:
                    await session.execute(update_stmt, {"id": row["id"], "photo_urls": result.new_values})
                print(f"draft:{row['id']}: normalized_only ({result.reason})")
            else:
                summary["failed" if result.status == "failed" else "skipped"] += 1
                print(f"draft:{row['id']}: {result.status} {result.reason or ''}".strip())

        if args.apply:
            await session.commit()
        else:
            await session.rollback()
    return summary


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Backfill one AI-cleaned hero image for existing listings/drafts."
    )
    parser.add_argument("--apply", action="store_true", help="Write DB updates. Without this, runs as dry-run.")
    parser.add_argument("--skip-listings", action="store_true", help="Do not process listings.")
    parser.add_argument("--include-drafts", action="store_true", help="Also process listing_drafts.")
    parser.add_argument("--all-listing-statuses", action="store_true", help="Process listings in every status.")
    parser.add_argument("--listing-status", action="append", help="Listing status to include. Defaults to active.")
    parser.add_argument("--all-draft-statuses", action="store_true", help="Process drafts in every status.")
    parser.add_argument("--draft-status", action="append", help="Draft status to include. Defaults to open.")
    parser.add_argument("--limit", type=int, default=0, help="Max records per target type.")
    return parser


async def main() -> None:
    args = _parser().parse_args()
    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"Hero image cleanup backfill: {mode}")
    print(f"provider={settings.image_cleanup_provider} model={settings.gemini_image_model}")

    totals: dict[str, dict[str, int]] = {}
    if not args.skip_listings:
        totals["listings"] = await _backfill_listings(args)
    if args.include_drafts:
        totals["drafts"] = await _backfill_drafts(args)

    print("Summary:")
    for target, summary in totals.items():
        print(f"  {target}: {summary}")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
