"""Launch category taxonomy for AI-assisted listings.

Keep the AI prompt, router canonicalization, and backend validation on the same
small launch taxonomy. Mobile still keeps richer UI suggestion lists, but this
module is the backend source of truth for category slugs and aliases.
"""
from __future__ import annotations

CATEGORY_SLUGS = [
    "smartphones",
    "laptops",
    "tablets",
    "small-appliances",
    "kids-utility",
    "others",
]

SUPPORTED_CATEGORY_SLUGS = set(CATEGORY_SLUGS)
IDENTIFIER_CATEGORIES = {"smartphones", "laptops", "tablets"}

CATEGORY_ALIASES = {
    "smartphone": "smartphones",
    "smartphones": "smartphones",
    "phone": "smartphones",
    "phones": "smartphones",
    "mobile": "smartphones",
    "mobiles": "smartphones",
    "mobilephone": "smartphones",
    "mobilephones": "smartphones",
    "cellphone": "smartphones",
    "cellphones": "smartphones",
    "handset": "smartphones",
    "iphone": "smartphones",
    "android": "smartphones",
    "androidphone": "smartphones",
    "laptop": "laptops",
    "laptops": "laptops",
    "notebook": "laptops",
    "notebooks": "laptops",
    "macbook": "laptops",
    "computer": "laptops",
    "computers": "laptops",
    "ultrabook": "laptops",
    "pc": "laptops",
    "tablet": "tablets",
    "tablets": "tablets",
    "ipad": "tablets",
    "ipads": "tablets",
    "tab": "tablets",
    "tabs": "tablets",
    "appliance": "small-appliances",
    "appliances": "small-appliances",
    "smallappliance": "small-appliances",
    "smallappliances": "small-appliances",
    "homeappliance": "small-appliances",
    "homeappliances": "small-appliances",
    "kid": "kids-utility",
    "kids": "kids-utility",
    "child": "kids-utility",
    "children": "kids-utility",
    "toy": "kids-utility",
    "toys": "kids-utility",
    "kidstoys": "kids-utility",
    "kidseducation": "kids-utility",
    "kidslearning": "kids-utility",
    "kidsutility": "kids-utility",
    "baby": "kids-utility",
    "other": "others",
    "others": "others",
    "misc": "others",
    "miscellaneous": "others",
    "general": "others",
    "accessory": "others",
    "accessories": "others",
    "electronics": "others",
    "camera": "others",
    "cameras": "others",
    "headphone": "others",
    "headphones": "others",
    "speaker": "others",
    "speakers": "others",
    "furniture": "others",
    "book": "others",
    "books": "others",
    "fashion": "others",
    "clothes": "others",
    "clothing": "others",
    "shoes": "others",
    "sports": "others",
}

OTHER_PLACEHOLDER_VALUES = {
    "",
    "item",
    "used item",
    "product",
    "other",
    "others",
    "misc",
    "miscellaneous",
    "general",
    "accessory",
    "accessories",
    "electronics",
    "unknown",
    "not sure",
    "other / not sure",
}

CATEGORY_TAXONOMY_PROMPT = """
CATEGORY TAXONOMY
==================================================

category_slug must be one of:
- "smartphones"
- "laptops"
- "tablets"
- "small-appliances"
- "kids-utility"
- "others"
- null

Kids mapping:
- toys, LEGO, dolls, puzzles, board games, ride-on toys -> "kids-utility"
- books, flashcards, STEM kits, learning kits, school learning material -> "kids-utility"
- stroller, carrier, booster, baby monitor, baby chair, sterilizer, kids bag -> "kids-utility"

Other mapping:
- If a real sellable product is visible but it does not fit smartphones,
  laptops, tablets, small-appliances, or kids-utility, use "others".
- For "others", detected_item_type is mandatory when the item is visible.
  Use a concrete product type like "wireless headphones", "office chair",
  "camera lens", "gaming monitor", or "book set"; never use generic labels
  like "item", "product", "accessory", or "used item".
- Use null only when no sellable product is visible, the image is unsafe,
  or the item cannot be identified enough to create a listing draft.
"""


def category_token(slug: str | None) -> str:
    return "".join(ch for ch in (slug or "").strip().lower() if ch.isalnum())


def canonical_category_slug(slug: str | None, *, fallback_empty_to_others: bool = True) -> str | None:
    token = category_token(slug)
    if not token:
        return "others" if fallback_empty_to_others else None
    aliased = CATEGORY_ALIASES.get(token)
    if aliased:
        return aliased
    normalized = (slug or "").strip().lower().replace("_", "-")
    return normalized if normalized in SUPPORTED_CATEGORY_SLUGS else "others"


def is_meaningful_other_detail(value: str | None) -> bool:
    cleaned = " ".join((value or "").strip().lower().split())
    if cleaned in OTHER_PLACEHOLDER_VALUES:
        return False
    return len(cleaned) >= 3
