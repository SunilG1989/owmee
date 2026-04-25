"""Two-phase price estimator.

Phase 1: Query the DB for completed listings of the same brand/model in
         the same state from the last 90 days. If ≥3, return the median.

Phase 2: If insufficient comparables, ask Claude (claude_client.estimate_price).

Sanity check: if AI returns a price >10x or <0.1x of category baseline,
              reject and let the seller set their own price.

Public API:
    async def estimate_price(db, brand, model, storage, condition, state) -> dict
        Returns: {
            "price": float | None,
            "source": "comparables" | "ai" | "none",
            "comparables": [Comparable, ...],   # for display in UI
            "comparables_count": int,
            "reasoning": str | None,
        }
"""
from __future__ import annotations

import logging
import statistics
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ai_assistant import claude_client
from app.modules.ai_assistant.schemas import Comparable

log = logging.getLogger(__name__)


# Generic Indian-market sanity bounds per category. Used only to reject
# absurd AI outputs — not as the price source itself.
CATEGORY_PRICE_BOUNDS: dict[str, tuple[int, int]] = {
    "smartphones":      (500, 200_000),
    "laptops":          (3_000, 500_000),
    "tablets":          (1_000, 200_000),
    "small-appliances": (200,  50_000),
    "kids-utility":     (100,  20_000),
}


async def _comparables_query(
    db: AsyncSession,
    *,
    brand: str | None,
    model: str | None,
    storage: str | None,
    state: str | None,
) -> list[dict]:
    """Find sold/delivered/payout-done listings matching the spec.

    Uses raw SQL because newer columns may not be on the model.
    Filters by listing_state if populated, else falls back to status.
    """
    if not brand or not model:
        return []

    sql = text("""
        SELECT
            l.id,
            l.title,
            l.price,
            l.city,
            l.image_urls,
            l.created_at,
            EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400.0 AS days_ago
        FROM listings l
        WHERE LOWER(l.brand) = LOWER(:brand)
          AND LOWER(l.model) = LOWER(:model)
          AND (CAST(:storage AS TEXT) IS NULL OR l.storage = CAST(:storage AS TEXT))
          AND (CAST(:state AS TEXT) IS NULL OR LOWER(l.state) = LOWER(CAST(:state AS TEXT)))
          -- SPRINT8_PHASE2_GEMINI_V2_PE_FIX: explicit casts prevent asyncpg AmbiguousParameterError
          -- when storage/state are None.
          AND (
              l.listing_state IN ('pickup_done', 'delivered', 'payout_eligible', 'payout_done')
              OR l.status IN ('sold')
          )
          AND l.created_at > NOW() - INTERVAL '90 days'
        ORDER BY l.created_at DESC
        LIMIT 20
    """)

    result = await db.execute(
        sql,
        {"brand": brand, "model": model, "storage": storage, "state": state},
    )
    rows = result.mappings().all()
    return [dict(r) for r in rows]


def _to_comparable(row: dict) -> Comparable:
    image_urls = row.get("image_urls") or []
    image_url = image_urls[0] if image_urls else None
    return Comparable(
        title=str(row.get("title") or "")[:200],
        price=float(row.get("price") or 0),
        days_ago=int(row.get("days_ago") or 0),
        city=row.get("city"),
        image_url=image_url,
    )


def _sanity_check(price: float, category_slug: str | None) -> bool:
    """Return True if price is within reasonable bounds for the category."""
    if not category_slug or category_slug not in CATEGORY_PRICE_BOUNDS:
        # Unknown category → permissive bounds
        return 50 <= price <= 1_000_000
    lo, hi = CATEGORY_PRICE_BOUNDS[category_slug]
    return lo <= price <= hi


async def estimate_price(
    db: AsyncSession,
    *,
    brand: str | None,
    model: str | None,
    storage: str | None,
    condition: str | None = "good",
    state: str | None = None,
    category_slug: str | None = None,
) -> dict[str, Any]:
    """Two-phase price estimate. Always returns a dict."""

    # ── Phase 1: DB comparables ────────────────────────────────────────────
    rows = await _comparables_query(
        db,
        brand=brand,
        model=model,
        storage=storage,
        state=state,
    )

    comparables_objs = [_to_comparable(r) for r in rows]

    if len(rows) >= 3:
        prices = [float(r["price"]) for r in rows if r.get("price") is not None]
        if prices:
            med = statistics.median(prices)
            if _sanity_check(med, category_slug):
                return {
                    "price": float(round(med, -1)),  # round to nearest 10 INR
                    "source": "comparables",
                    "comparables": comparables_objs[:5],
                    "comparables_count": len(rows),
                    "reasoning": f"Median of {len(rows)} similar listings sold in last 90 days.",
                }

    # ── Phase 2: AI fallback ───────────────────────────────────────────────
    ai = await claude_client.estimate_price(
        brand=brand,
        model=model,
        storage=storage,
        condition=condition,
    )

    if ai and _sanity_check(ai["price_inr"], category_slug):
        return {
            "price": float(ai["price_inr"]),
            "source": "ai",
            "comparables": comparables_objs[:5],   # show what we have, even if <3
            "comparables_count": len(rows),
            "reasoning": ai.get("reasoning") or "AI estimate based on Indian retail prices.",
        }

    # ── Both failed: let seller set price ──────────────────────────────────
    return {
        "price": None,
        "source": "none",
        "comparables": comparables_objs[:5],
        "comparables_count": len(rows),
        "reasoning": "Not enough comparables and AI estimate unavailable. Please set your own price.",
    }
