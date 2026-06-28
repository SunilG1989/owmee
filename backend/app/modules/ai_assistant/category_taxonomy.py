"""Launch category taxonomy for AI-assisted listings.

Keep the AI prompt, router canonicalization, and backend validation on the same
small launch taxonomy. Mobile still keeps richer UI suggestion lists, but this
module is the backend source of truth for category slugs and aliases.
"""
from __future__ import annotations

from typing import Any

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

Category family:
- Also return category_family as one of "device", "appliance", "toy",
  "book", or "other".
- smartphones/laptops/tablets -> "device"
- small-appliances -> "appliance"
- kids toys, games, puzzles, baby gear, learning kits -> "toy"
- books, comics, textbooks, workbooks, flashcards, boxed reading sets -> "book"
- anything else in "others" -> "other" unless the visible item clearly fits
  appliance/toy/book.

category_specifics should contain only observed or seller-needed facts. Use
null when unknown; do not claim working, complete, clean, safe, original,
sanitized, or defect-free unless directly supported.

Use compact P0 buyer-trust fields. Do not invent a field just to fill the
schema; null/omission is safer than false certainty.

For toy:
- toy_type
- age_suitability
- hygiene_status
- missing_parts_status
- safety_status
- battery_status / working_status when batteries/electronics are involved

For book:
- book_type
- language
- page_condition
- markings_status
- pages_complete
- set_status when it is a set/series/box
- class_board_edition for textbooks/workbooks/school study material
  only when exact printed class/board/edition text is legible; do not use
  placeholder text such as "shown" or "not sure"

For appliance:
- appliance_type
- working_status
- accessories_status
- defects_disclosed
- pickup_complexity for bulky appliances
- installation_status / power_requirement for installation-heavy appliances
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


DEVICE_CATEGORY_SLUGS = {"smartphones", "laptops", "tablets"}

BOOK_KEYWORDS = {
    "book",
    "books",
    "bookset",
    "textbook",
    "textbooks",
    "workbook",
    "workbooks",
    "storybook",
    "storybooks",
    "comic",
    "comics",
    "novel",
    "novels",
    "manga",
    "magazine",
    "dictionary",
    "encyclopedia",
    "flashcard",
    "flashcards",
    "reader",
    "readers",
}

TOY_KEYWORDS = {
    "toy",
    "toys",
    "lego",
    "duplo",
    "doll",
    "dolls",
    "puzzle",
    "puzzles",
    "boardgame",
    "game",
    "games",
    "stem",
    "kit",
    "playset",
    "blocks",
    "rideon",
    "remotecontrol",
    "batterytoy",
    "learningtablet",
    "stroller",
    "carseat",
    "highchair",
    "carrier",
    "crib",
    "walker",
    "baby",
}

APPLIANCE_KEYWORDS = {
    "appliance",
    "appliances",
    "airconditioner",
    "airpurifier",
    "mixer",
    "grinder",
    "mixergrinder",
    "microwave",
    "oven",
    "washingmachine",
    "washer",
    "refrigerator",
    "fridge",
    "waterpurifier",
    "vacuum",
    "vacuumcleaner",
    "geyser",
    "induction",
    "cooktop",
    "airfryer",
    "coffeemaker",
    "iron",
    "fan",
    "toaster",
    "foodprocessor",
    "chimney",
    "dishwasher",
}

LARGE_APPLIANCE_KEYWORDS = {
    "airconditioner",
    "washingmachine",
    "refrigerator",
    "fridge",
    "dishwasher",
    "chimney",
    "geyser",
}

POWERED_TOY_KEYWORDS = {
    "battery",
    "electronic",
    "remote",
    "learningtablet",
    "rideon",
    "musical",
    "monitor",
}

SET_BOOK_KEYWORDS = {"set", "series", "box", "boxed", "bundle", "combo"}
EDUCATIONAL_BOOK_KEYWORDS = {
    "textbook",
    "workbook",
    "class",
    "grade",
    "standard",
    "std",
    "ncert",
    "cbse",
    "icse",
    "stateboard",
    "school",
    "science",
    "math",
    "mathematics",
    "evs",
    "socialscience",
    "exam",
    "guide",
}
EDUCATIONAL_BOOK_PLACEHOLDER_VALUES = {
    "classboardeditionshown",
    "shown",
    "visible",
    "notsure",
    "notchecked",
    "unknown",
    "na",
    "notapplicable",
    "detailsnotavailable",
}
SAFE_DISCLOSURE_TOKENS = {
    "allpagespresent",
    "complete",
    "completeallpartsincluded",
    "completeallpagespresent",
    "completegoodworking",
    "completeworking",
    "fullyworking",
    "noknowndefect",
    "noknowndefects",
    "noknownissue",
    "noknownissues",
    "nomarkings",
    "nomissingpages",
    "nopagemissing",
    "nopartsmissing",
    "notapplicable",
    "novisibledefect",
    "novisibledefects",
    "novisibleissue",
    "novisiblesafetyissue",
    "nowritingorhighlights",
    "working",
    "workingproperly",
}
GENERIC_NEGATIVE_DISCLOSURE_TOKENS = {
    "defectdisclosed",
    "defectsdisclosed",
    "damaged",
    "issuedisclosed",
    "lightdamage",
    "minordefectdisclosed",
    "minormissingpartsdisclosed",
    "missingpagedisclosed",
    "missingpages",
    "missingpagesdisclosed",
    "missingparts",
    "missingpartsdisclosed",
    "needsrepair",
    "notesdisclosed",
    "notchecked",
    "nottested",
    "notworking",
    "pagesmissing",
    "partialsetdisclosed",
    "repairneeded",
    "somepartsmissing",
    "visibledefectdisclosed",
}
GENERIC_NEGATIVE_DISCLOSURE_FRAGMENTS = (
    "defectdisclosed",
    "defectsdisclosed",
    "highlightdisclosed",
    "highlightsdisclosed",
    "issuedisclosed",
    "markingsdisclosed",
    "missingpartsdisclosed",
    "notesdisclosed",
    "notesandhighlightsdisclosed",
    "notchecked",
    "nottested",
    "notworking",
    "partialsetdisclosed",
)
DESCRIPTION_NEGATIVE_DISCLOSURE_TERMS = (
    "broken",
    "crack",
    "damage",
    "defect",
    "highlight",
    "issue",
    "mark",
    "missing",
    "notes",
    "notchecked",
    "nottested",
    "notworking",
    "partial",
    "repair",
    "scratch",
    "tear",
    "torn",
)

TOY_REQUIRED_SPECIFICS = ("missing_parts_status", "safety_status")
BOOK_REQUIRED_SPECIFICS = (
    "book_type",
    "language",
    "page_condition",
    "markings_status",
    "pages_complete",
)
APPLIANCE_REQUIRED_SPECIFICS = (
    "working_status",
    "accessories_status",
    "defects_disclosed",
)

_ALLOWED_SPECIFIC_KEYS = {
    "toy": {
        "toy_type",
        "age_suitability",
        "hygiene_status",
        "missing_parts_status",
        "safety_status",
        "battery_status",
        "working_status",
        "material",
        "set_count",
        "part_count",
        "box_or_manual",
        "recall_checked",
        "notes",
    },
    "book": {
        "book_type",
        "language",
        "page_condition",
        "markings_status",
        "pages_complete",
        "set_status",
        "set_count",
        "author_or_publisher",
        "class_board_edition",
        "edition",
        "class_or_grade",
        "board",
        "subject",
        "isbn",
        "cover_condition",
        "notes",
    },
    "appliance": {
        "appliance_type",
        "working_status",
        "accessories_status",
        "defects_disclosed",
        "pickup_complexity",
        "installation_status",
        "power_requirement",
        "bill_or_warranty",
        "hygiene_status",
        "capacity_or_size",
        "material",
        "notes",
    },
    "device": set(),
    "other": set(),
}


def _compact_text(*values: str | None) -> str:
    return " ".join(str(v or "").lower() for v in values if v).replace("-", " ")


def _keyword_token(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _has_keyword(text: str, keywords: set[str]) -> bool:
    compact = _keyword_token(text)
    return any(keyword in compact for keyword in keywords)


def category_family_for(
    category_slug: str | None,
    *,
    detected_item_type: str | None = None,
    title: str | None = None,
    model: str | None = None,
) -> str:
    """Return the launch requirement family for listing review.

    Families are intentionally narrower than DB categories. They let Owmee ask
    buyer-relevant questions for books/toys/appliances without expanding the
    category table or making another AI call.
    """
    canonical = canonical_category_slug(category_slug, fallback_empty_to_others=True)
    text = _compact_text(detected_item_type, title, model)
    if canonical in DEVICE_CATEGORY_SLUGS:
        return "device"
    if canonical == "small-appliances":
        return "appliance"
    if canonical == "kids-utility":
        return "book" if _has_keyword(text, BOOK_KEYWORDS) else "toy"
    if _has_keyword(text, BOOK_KEYWORDS):
        return "book"
    if _has_keyword(text, APPLIANCE_KEYWORDS):
        return "appliance"
    if _has_keyword(text, TOY_KEYWORDS):
        return "toy"
    return "other"


def requires_powered_toy_status(*values: str | None) -> bool:
    return _has_keyword(_compact_text(*values), POWERED_TOY_KEYWORDS)


def requires_book_set_status(*values: str | None) -> bool:
    return _has_keyword(_compact_text(*values), SET_BOOK_KEYWORDS)


def requires_educational_book_details(*values: str | None) -> bool:
    return _has_keyword(_compact_text(*values), EDUCATIONAL_BOOK_KEYWORDS)


def has_educational_book_detail(specifics: dict[str, Any] | None) -> bool:
    if not isinstance(specifics, dict):
        return False
    for field in ("class_board_edition", "class_or_grade", "edition"):
        raw_value = specifics.get(field)
        if raw_value in (None, "", [], {}):
            continue
        token = _keyword_token(str(raw_value))
        if token and token not in EDUCATIONAL_BOOK_PLACEHOLDER_VALUES:
            return True
    return False


def _specific_values(specifics: dict[str, Any] | None, *fields: str) -> list[Any]:
    if not isinstance(specifics, dict):
        return []
    return [specifics.get(field) for field in fields]


def _value_needs_issue_detail(value: Any) -> bool:
    token = _keyword_token(str(value or ""))
    if not token:
        return False
    if token in SAFE_DISCLOSURE_TOKENS:
        return False
    if any(safe in token for safe in SAFE_DISCLOSURE_TOKENS if len(safe) > 8):
        return False
    if token in GENERIC_NEGATIVE_DISCLOSURE_TOKENS:
        return True
    if any(fragment in token for fragment in GENERIC_NEGATIVE_DISCLOSURE_FRAGMENTS):
        return True
    return False


def requires_issue_disclosure_detail(family: str, specifics: dict[str, Any] | None) -> bool:
    """Return true when category-specific values need plain buyer-facing detail.

    Negative disclosures are allowed, but a generic value like "defects
    disclosed" or "missing pages disclosed" is not enough unless the listing
    description explains what the buyer should expect.
    """
    fields: tuple[str, ...]
    if family == "toy":
        fields = ("missing_parts_status", "safety_status")
    elif family == "book":
        fields = ("page_condition", "markings_status", "pages_complete")
    elif family == "appliance":
        fields = ("working_status", "defects_disclosed")
    else:
        return False
    return any(_value_needs_issue_detail(value) for value in _specific_values(specifics, *fields))


def has_issue_disclosure_detail(description: str | None) -> bool:
    text = " ".join(str(description or "").split())
    if not text:
        return False
    lower = text.lower()
    if "disclosure:" in lower:
        return len(lower.split("disclosure:", 1)[1].strip()) >= 6
    compact = _keyword_token(text)
    return len(text) >= 20 and any(term in compact for term in DESCRIPTION_NEGATIVE_DISCLOSURE_TERMS)


def requires_appliance_pickup_status(*values: str | None) -> bool:
    return _has_keyword(_compact_text(*values), LARGE_APPLIANCE_KEYWORDS)


def required_category_specific_fields(family: str) -> tuple[str, ...]:
    if family == "toy":
        return TOY_REQUIRED_SPECIFICS
    if family == "book":
        return BOOK_REQUIRED_SPECIFICS
    if family == "appliance":
        return APPLIANCE_REQUIRED_SPECIFICS
    return ()


def clean_category_specifics(family: str, value: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    allowed = _ALLOWED_SPECIFIC_KEYS.get(family, set())
    if not allowed:
        return {}

    cleaned: dict[str, Any] = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key or "").strip()
        if key not in allowed or raw_value is None:
            continue
        if isinstance(raw_value, bool):
            cleaned[key] = raw_value
            continue
        if isinstance(raw_value, (int, float)) and not isinstance(raw_value, bool):
            cleaned[key] = raw_value
            continue
        if isinstance(raw_value, list):
            out = []
            for item in raw_value:
                text = " ".join(str(item or "").split())[:120]
                if text:
                    out.append(text)
                if len(out) >= 8:
                    break
            if out:
                cleaned[key] = out
            continue
        text = " ".join(str(raw_value or "").split())[:160]
        if text:
            cleaned[key] = text
    return cleaned
