"""Auditable repairs for historical listing metadata.

New AI drafts are guarded before publish, but older rows may still have
buyer-facing placeholders such as "Other Pink". This module keeps the repair
deterministic and side-effect free so scripts can dry-run before touching data.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import re
from typing import Any, Mapping

from app.modules.ai_assistant.category_taxonomy import (
    OTHER_PLACEHOLDER_VALUES,
    TITLE_COLOR_WORDS,
    TITLE_FILLER_WORDS,
    category_family_for,
    clean_category_specifics,
    is_generic_listing_title,
)


_CATEGORY_TYPE_KEY_BY_FAMILY = {
    "toy": "toy_type",
    "book": "book_type",
    "appliance": "appliance_type",
}

_LEADING_DESCRIPTION_PREFIXES = (
    "this listing is for ",
    "listing is for ",
    "this is a ",
    "this is an ",
    "this is the ",
    "it is a ",
    "it is an ",
    "the item is a ",
    "the item is an ",
    "item is a ",
    "item is an ",
    "photo shows a ",
    "photo shows an ",
    "photo shows ",
    "image shows a ",
    "image shows an ",
    "image shows ",
    "the photo shows a ",
    "the photo shows an ",
    "the photo shows ",
    "the image shows a ",
    "the image shows an ",
    "the image shows ",
    "shown is a ",
    "shown is an ",
    "shown is ",
    "visible is a ",
    "visible is an ",
    "visible is ",
    "selling a ",
    "selling an ",
    "selling ",
)

_DESCRIPTION_CUT_PATTERNS = (
    " featuring ",
    " with ",
    " which ",
    " that ",
    " showing ",
    " comes with ",
    " has ",
    " includes ",
    " in good condition",
    " in working condition",
    " is visible",
    " are visible",
    " appears",
)

_LEADING_NOISE_WORDS = {
    "a",
    "an",
    "the",
    "cute",
    "nice",
    "good",
    "used",
    "preowned",
    "pre-owned",
    "secondhand",
    "second-hand",
    "clean",
    "well",
    "old",
}

_BAD_CANDIDATE_STARTS = {
    "buyer",
    "condition",
    "description",
    "details",
    "item",
    "listing",
    "mrp",
    "price",
    "seller",
}


@dataclass(frozen=True)
class ListingTitleRepairPlan:
    listing_id: str | None
    category_family: str
    old_title: str
    new_title: str
    old_model: str | None
    new_model: str | None
    seller_review_snapshot: dict[str, Any] | None
    old_category_specifics: dict[str, Any]
    new_category_specifics: dict[str, Any]
    reasons: tuple[str, ...]

    @property
    def model_changed(self) -> bool:
        return self.new_model is not None and self.new_model != self.old_model

    @property
    def category_specifics_changed(self) -> bool:
        return self.new_category_specifics != self.old_category_specifics


def _compact(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _candidate_text(value: Any) -> str | None:
    text = _compact(value)
    if not text:
        return None
    if is_generic_listing_title(text):
        return None
    first_token = re.sub(r"[^a-z0-9-]", "", text.split()[0].lower())
    if first_token in _BAD_CANDIDATE_STARTS:
        return None
    return text[:120]


def _display_title(value: str) -> str:
    text = _compact(value)
    if not text:
        return text
    if text.isupper() and len(text) > 4:
        text = text.title()
    return text[:1].upper() + text[1:]


def _strip_leading_noise(value: str) -> str:
    words = value.split()
    while words:
        token = words[0].strip(".,:/()[]{}").lower()
        if token not in _LEADING_NOISE_WORDS:
            break
        words.pop(0)
    return " ".join(words)


def _description_candidate(description: Any) -> str | None:
    text = _compact(description)
    if not text:
        return None

    # Try the first few sentence-like chunks. Descriptions often start with the
    # product noun, while later chunks carry condition or delivery copy.
    chunks = [part.strip() for part in re.split(r"[\n.!?]+", text) if part.strip()]
    for raw_chunk in chunks[:3]:
        chunk = raw_chunk
        lower = chunk.lower()
        for prefix in _LEADING_DESCRIPTION_PREFIXES:
            if lower.startswith(prefix):
                chunk = chunk[len(prefix) :]
                lower = chunk.lower()
                break

        for pattern in _DESCRIPTION_CUT_PATTERNS:
            index = lower.find(pattern)
            if index > 0:
                chunk = chunk[:index]
                lower = chunk.lower()

        chunk = _strip_leading_noise(chunk.strip(" -,:;"))
        chunk = re.sub(r"\s+", " ", chunk).strip(" -,:;")
        if not chunk:
            continue

        words = chunk.split()
        if len(words) > 8:
            chunk = " ".join(words[:8])
        candidate = _candidate_text(chunk)
        if candidate:
            return candidate
    return None


def _specific_type_candidate(specifics: dict[str, Any], family: str) -> str | None:
    type_key = _CATEGORY_TYPE_KEY_BY_FAMILY.get(family)
    if not type_key:
        return None
    return _candidate_text(specifics.get(type_key))


def _non_generic_model_candidate(model: Any) -> str | None:
    return _candidate_text(model)


def _should_repair_model(model: str | None, family: str) -> bool:
    if family == "device":
        return False
    return is_generic_listing_title(model)


def _specific_value_for_snapshot(candidate: str) -> str:
    text = _compact(candidate)
    if not text:
        return text
    return text[:1].lower() + text[1:]


def _audit_payload(
    *,
    old_title: str,
    new_title: str,
    old_model: str | None,
    new_model: str | None,
    reasons: tuple[str, ...],
) -> dict[str, Any]:
    return {
        "reason": "generic_title_backfill",
        "old_title": old_title,
        "new_title": new_title,
        "old_model": old_model,
        "new_model": new_model,
        "rules": list(reasons),
    }


def plan_existing_listing_title_repair(record: Mapping[str, Any]) -> ListingTitleRepairPlan | None:
    """Return a deterministic repair plan for one historical listing row.

    The function intentionally avoids LLM calls. It only repairs rows whose
    current buyer-facing title is already known-bad, and it refuses to invent a
    replacement when the existing listing data does not contain a concrete noun.
    """
    old_title = _compact(record.get("title"))
    if not is_generic_listing_title(old_title):
        return None

    raw_snapshot = record.get("seller_review_snapshot")
    snapshot = deepcopy(raw_snapshot) if isinstance(raw_snapshot, dict) else None
    raw_confirmed = snapshot.get("seller_confirmed") if isinstance(snapshot, dict) else None
    has_confirmed_snapshot = isinstance(raw_confirmed, dict)
    confirmed = raw_confirmed if has_confirmed_snapshot else {}

    category_slug = (
        record.get("category_slug")
        or confirmed.get("category_slug")
        or record.get("category")
    )
    old_model = _compact(record.get("model")) or None
    raw_specifics = confirmed.get("category_specifics")
    if not isinstance(raw_specifics, dict):
        raw_specifics = record.get("category_specifics") if isinstance(record.get("category_specifics"), dict) else {}

    family = _compact(confirmed.get("category_family")) or category_family_for(
        category_slug,
        detected_item_type=_specific_type_candidate(raw_specifics, "toy")
        or _specific_type_candidate(raw_specifics, "book")
        or _specific_type_candidate(raw_specifics, "appliance"),
        title=old_title,
        model=old_model,
    )
    old_specifics = clean_category_specifics(family, raw_specifics)

    candidate = (
        _specific_type_candidate(old_specifics, family)
        or _non_generic_model_candidate(old_model)
        or _description_candidate(record.get("description"))
    )
    if not candidate:
        return None

    family = category_family_for(category_slug, detected_item_type=candidate, title=candidate, model=old_model)
    old_specifics = clean_category_specifics(family, raw_specifics)
    new_title = _display_title(candidate)
    new_model = _display_title(candidate) if _should_repair_model(old_model, family) else None

    new_specifics = dict(old_specifics)
    type_key = _CATEGORY_TYPE_KEY_BY_FAMILY.get(family)
    reasons = ["generic_title"]
    if type_key and is_generic_listing_title(new_specifics.get(type_key)):
        new_specifics[type_key] = _specific_value_for_snapshot(candidate)
        reasons.append(f"generic_{type_key}")
    if new_model is not None:
        reasons.append("generic_model")

    next_snapshot = snapshot
    if isinstance(next_snapshot, dict) and has_confirmed_snapshot:
        next_confirmed = dict(confirmed)
        next_confirmed["title"] = new_title
        if new_model is not None:
            next_confirmed["model"] = new_model
        next_confirmed["category_family"] = family
        next_confirmed["category_specifics"] = new_specifics
        next_snapshot["seller_confirmed"] = next_confirmed
        repairs = next_snapshot.get("maintenance_repairs")
        if not isinstance(repairs, dict):
            repairs = {}
        repairs["generic_title_backfill"] = _audit_payload(
            old_title=old_title,
            new_title=new_title,
            old_model=old_model,
            new_model=new_model,
            reasons=tuple(reasons),
        )
        next_snapshot["maintenance_repairs"] = repairs

    return ListingTitleRepairPlan(
        listing_id=str(record.get("id")) if record.get("id") is not None else None,
        category_family=family,
        old_title=old_title,
        new_title=new_title,
        old_model=old_model,
        new_model=new_model,
        seller_review_snapshot=next_snapshot,
        old_category_specifics=old_specifics,
        new_category_specifics=new_specifics,
        reasons=tuple(reasons),
    )


__all__ = ["ListingTitleRepairPlan", "plan_existing_listing_title_repair"]
