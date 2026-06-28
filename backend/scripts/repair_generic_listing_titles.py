from __future__ import annotations

import argparse
import asyncio
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import selectinload

from app.db.session import get_sessionmaker

# Standalone ORM scripts need referenced tables registered before SQLAlchemy
# flushes Listing updates.
import app.modules.community.models  # noqa: F401,E402
import app.modules.field_executive.models  # noqa: F401,E402
import app.modules.identity_auth.models  # noqa: F401,E402

from app.modules.listings.models import Listing
from app.modules.listings.title_repair import plan_existing_listing_title_repair


def _listing_record(listing: Listing) -> dict:
    return {
        "id": str(listing.id),
        "title": listing.title,
        "description": listing.description,
        "model": listing.model,
        "category_slug": getattr(getattr(listing, "category", None), "slug", None),
        "seller_review_snapshot": listing.seller_review_snapshot,
    }


def _plan_payload(plan) -> dict:
    return {
        "listing_id": plan.listing_id,
        "category_family": plan.category_family,
        "old_title": plan.old_title,
        "new_title": plan.new_title,
        "old_model": plan.old_model,
        "new_model": plan.new_model,
        "category_specifics_changed": plan.category_specifics_changed,
        "old_category_specifics": plan.old_category_specifics,
        "new_category_specifics": plan.new_category_specifics,
        "reasons": list(plan.reasons),
    }


async def _run(args) -> dict[str, int]:
    summary = {
        "scanned": 0,
        "would_update": 0,
        "updated": 0,
        "skipped": 0,
    }
    statuses = set(args.listing_status or ["active"])
    async with get_sessionmaker()() as session:
        stmt = (
            select(Listing)
            .options(selectinload(Listing.category))
            .order_by(Listing.updated_at.desc(), Listing.created_at.desc())
        )
        if args.listing_id:
            stmt = stmt.where(Listing.id.in_([UUID(value) for value in args.listing_id]))
        elif not args.all_listing_statuses:
            stmt = stmt.where(Listing.status.in_(statuses))
        if args.limit:
            stmt = stmt.limit(args.limit)

        listings = list((await session.execute(stmt)).scalars().all())
        for listing in listings:
            summary["scanned"] += 1
            plan = plan_existing_listing_title_repair(_listing_record(listing))
            if plan is None:
                summary["skipped"] += 1
                continue

            print(json.dumps(_plan_payload(plan), sort_keys=True))
            if args.apply:
                listing.title = plan.new_title
                if plan.new_model is not None:
                    listing.model = plan.new_model
                if plan.seller_review_snapshot is not None:
                    listing.seller_review_snapshot = plan.seller_review_snapshot
                summary["updated"] += 1
            else:
                summary["would_update"] += 1

        if args.apply:
            await session.commit()
        else:
            await session.rollback()

    return summary


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Repair historical listings whose buyer-facing title is a generic "
            "placeholder such as 'Other Pink'. Dry-run by default."
        )
    )
    parser.add_argument("--apply", action="store_true", help="Persist updates. Omit for dry-run.")
    parser.add_argument("--limit", type=int, default=500, help="Maximum rows to scan.")
    parser.add_argument(
        "--listing-status",
        action="append",
        help="Listing status to scan. Defaults to active; repeat for more statuses.",
    )
    parser.add_argument(
        "--all-listing-statuses",
        action="store_true",
        help="Scan every listing status. Prefer explicit statuses in production.",
    )
    parser.add_argument(
        "--listing-id",
        action="append",
        help="Repair only the given listing id. Repeat to target multiple listings.",
    )
    return parser


def main() -> None:
    args = _parser().parse_args()
    try:
        summary = asyncio.run(_run(args))
    except (OSError, SQLAlchemyError) as exc:
        print(
            json.dumps(
                {
                    "apply": bool(args.apply),
                    "error": type(exc).__name__,
                    "detail": str(exc).splitlines()[0],
                    "hint": (
                        "Could not reach the configured database. Run this from "
                        "the backend environment/Render shell, or use a DB URL "
                        "reachable from this machine."
                    ),
                },
                sort_keys=True,
            )
        )
        raise SystemExit(2) from exc
    print(json.dumps({"apply": bool(args.apply), "summary": summary}, sort_keys=True))


if __name__ == "__main__":
    main()
