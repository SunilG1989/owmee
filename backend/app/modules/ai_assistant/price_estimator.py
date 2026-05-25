"""Two-phase price estimator.

Phase 1: Query the DB for completed listings of the same brand/model in
         the same state from the last 90 days. If ≥3, return the median.

Phase 2: If insufficient comparables, use a conservative category anchor for
         clear low-value everyday items, otherwise ask the configured AI provider.

Sanity check: if AI returns a price >10x or <0.1x of category baseline,
              reject and let the seller set their own price.

Public API:
    async def estimate_price(
        db, brand, model, storage, condition, state, allow_ai_fallback=True,
    ) -> dict
        Returns: {
            "price": float | None,
            "source": "comparables" | "category_anchor" | "ai" | "none",
            "comparables": [Comparable, ...],   # for display in UI
            "comparables_count": int,
            "reasoning": str | None,
        }
"""
from __future__ import annotations

import logging
import re
import statistics
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.ai_assistant import provider as ai_provider
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
    "others":           (50,   1_000_000),
}

_ELECTRONIC_CATEGORIES = {"smartphones", "laptops", "tablets"}

_GENERIC_ITEM_PRICE_ANCHORS: list[tuple[re.Pattern[str], tuple[int, int]]] = [
    (re.compile(r"\b(water\s*bottle|bottle|sipper|flask)\b", re.I), (120, 450)),
    (re.compile(r"\b(book|textbook|ncert|storybook|novel)\b", re.I), (80, 350)),
    (re.compile(r"\b(toy|teddy|doll|puzzle|board\s*game|blocks?)\b", re.I), (150, 900)),
    (re.compile(r"\b(school\s*bag|backpack|bag)\b", re.I), (250, 900)),
    (re.compile(r"\b(chair|study\s*table|desk)\b", re.I), (600, 3500)),
    (re.compile(r"\b(mixer|kettle|iron|toaster|speaker|headphones?|earbuds?)\b", re.I), (350, 2500)),
]


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


def _condition_factor(condition: str | None) -> float:
    normalized = (condition or "good").strip().lower()
    if normalized in {"like_new", "like new", "excellent"}:
        return 0.85
    if normalized in {"fair", "used", "visible_wear"}:
        return 0.55
    return 0.70


def _clean_price(value: float) -> float:
    if value < 500:
        return float(round(value / 10) * 10)
    if value < 5000:
        return float(round(value / 50) * 50)
    return float(round(value / 100) * 100)


def _generic_item_price(
    *,
    category_slug: str | None,
    detected_item_type: str | None,
    model: str | None,
    condition: str | None,
) -> dict[str, Any] | None:
    """Low-risk guidance for common everyday resale items.

    Electronics still need proper model/spec confidence. For visible low-value
    items like bottles, books, toys, bags and small appliances, forcing exact
    brand/model makes the seller flow look broken. This stays conservative and
    only runs when the item type is specific enough.
    """
    if category_slug in _ELECTRONIC_CATEGORIES:
        return None
    text_value = " ".join(part for part in (detected_item_type, model) if part).strip()
    if len(text_value) < 3:
        return None

    for pattern, (low, high) in _GENERIC_ITEM_PRICE_ANCHORS:
        if pattern.search(text_value):
            midpoint = (low + high) / 2
            price = _clean_price(midpoint * _condition_factor(condition))
            if _sanity_check(price, category_slug):
                return {
                    "price": price,
                    "source": "category_anchor",
                    "comparables": [],
                    "comparables_count": 0,
                    "reasoning": "Conservative Owmee estimate from item type and condition.",
                }
    return None


async def estimate_price(
    db: AsyncSession,
    *,
    brand: str | None,
    model: str | None,
    storage: str | None,
    condition: str | None = "good",
    state: str | None = None,
    category_slug: str | None = None,
    detected_item_type: str | None = None,
    allow_ai_fallback: bool = True,
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

    generic = _generic_item_price(
        category_slug=category_slug,
        detected_item_type=detected_item_type,
        model=model,
        condition=condition,
    )
    if generic:
        generic["comparables"] = comparables_objs[:5]
        generic["comparables_count"] = len(rows)
        return generic

    if not allow_ai_fallback:
        return {
            "price": None,
            "source": "none",
            "comparables": comparables_objs[:5],
            "comparables_count": len(rows),
            "reasoning": "Not enough comparables. Text AI price fallback was skipped for fast draft readiness.",
        }

    # ── Phase 2: AI fallback ───────────────────────────────────────────────
    ai = await ai_provider.estimate_price(
        brand=brand,
        model=model,
        storage=storage,
        condition=condition,
        category_slug=category_slug,
        detected_item_type=detected_item_type,
    )

    if ai and ai.get("price_inr") and _sanity_check(ai["price_inr"], category_slug):
        result = {
            "price": float(ai["price_inr"]),
            "source": "ai",
            "comparables": comparables_objs[:5],   # show what we have, even if <3
            "comparables_count": len(rows),
            "reasoning": ai.get("reasoning") or "AI estimate based on Indian retail prices.",
        }
        mrp = ai.get("mrp_inr")
        if mrp and _sanity_check(float(mrp), category_slug) and float(mrp) > result["price"]:
            result.update({
                "mrp_inr": int(mrp),
                "mrp_source": ai.get("mrp_source") or "market_anchor",
                "mrp_confidence": float(ai.get("mrp_confidence") or 0.0),
                "mrp_reasoning": ai.get("mrp_reasoning"),
            })
        return result

    if ai and ai.get("mrp_inr") and _sanity_check(float(ai["mrp_inr"]), category_slug):
        return {
            "price": None,
            "source": "none",
            "comparables": comparables_objs[:5],   # show what we have, even if <3
            "comparables_count": len(rows),
            "reasoning": ai.get("reasoning") or "AI price unavailable; market MRP anchor returned.",
            "mrp_inr": int(ai["mrp_inr"]),
            "mrp_source": ai.get("mrp_source") or "market_anchor",
            "mrp_confidence": float(ai.get("mrp_confidence") or 0.0),
            "mrp_reasoning": ai.get("mrp_reasoning"),
        }

    # ── Both failed: let seller set price ──────────────────────────────────
    return {
        "price": None,
        "source": "none",
        "comparables": comparables_objs[:5],
        "comparables_count": len(rows),
        "reasoning": "Not enough comparables and AI estimate unavailable. Please set your own price.",
    }
