"""Pydantic request/response models for AI-assisted listing endpoints.

All money is stored as Decimal in DB but exposed as float in JSON
to match the rest of the API surface (see feed_router serialization).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# ── Draft creation (vision) ───────────────────────────────────────────────


class Comparable(BaseModel):
    """One sold-listing reference shown to the seller as price proof."""
    title: str
    price: float
    days_ago: int
    city: str | None = None
    image_url: str | None = None


class AIDetected(BaseModel):
    """Structured output from Gemini vision.

    Mirrors the listing schema 1:1 — every field here corresponds to a
    column we'll populate on the Listing row when the seller publishes.
    Earlier versions had only 6 fields and the seller had to fill the
    other 8 manually; that was the dominant cause of "AI didn't fill
    anything" complaints.
    """
    # Core identification
    category_slug: str | None = None
    category_confidence: float = 0.0
    brand: str | None = None
    model: str | None = None

    # Specs (electronics only; null for non-electronics)
    storage: str | None = None              # "128GB" | "1TB"
    ram: str | None = None                  # "8GB" | "16GB"
    processor: str | None = None            # "Apple A15" | "Snapdragon 8 Gen 2"
    screen_size: str | None = None          # "6.1\"" | "13\""

    # Cosmetic
    color: str | None = None                # "Midnight Black"
    purchase_year: int | None = None        # extracted from box/receipt if visible

    # Condition (guess + per-surface detail)
    condition_guess: str | None = None      # like_new | good | fair
    screen_condition: str | None = None     # flawless | minor_scratches | cracked
    body_condition: str | None = None       # flawless | minor_dents | major_damage
    defects: list[str] = Field(default_factory=list)  # short bullets ("hairline crack on top edge")
    battery_health: int | None = None       # 0-100, only if Settings → Battery screen visible

    # Extras seller can verify
    accessories: str | None = None          # "box, charger, original earphones" (free text)
    warranty_status: str | None = None      # "expired" | "active till YYYY-MM"

    # Pricing (integrated into vision so the model sees the photos)
    suggested_price_inr: int | None = None
    price_confidence: float = 0.0
    price_reasoning: str | None = None

    # Authoring
    title_suggestion: str | None = None
    description_suggestion: str | None = None
    flags: list[str] = Field(default_factory=list)
    # Image-set safety / quality flags. Old code reads from `flags`;
    # PROMPT v2 also surfaces these as a structured `image_set_quality`
    # block so post-processing can reason about them without string
    # matching:
    #   nsfw, personal_info, multiple_items, no_product, blurry,
    #   packaging_only, screenshot_only, stock_or_catalog_suspected
    image_set_quality: dict = Field(default_factory=dict)

    # Review routing — populated by Gemini per PROMPT v2 + reinforced
    # by the post-processing guardrails in claude_client.py.
    manual_review_required: bool = False
    auto_publish_candidate: bool = False
    blocking_reasons: list[str] = Field(default_factory=list)

    # Free-text rationale: "model exactness unclear", "asked seller for
    # battery screenshot", etc. Surfaced verbatim in admin web.
    extraction_notes: str | None = None

    # Short user-facing requests for better photos. UI renders these as
    # bullets above the camera button.
    seller_photo_feedback: list[str] = Field(default_factory=list)

    # Per-field confidence (0.0-1.0) — keys mirror the field names above.
    # Used by the post-processor and downstream UI to flag low-confidence
    # fields without taking a hard NULL stance.
    field_confidence: dict = Field(default_factory=dict)

    # Per-field evidence level: "direct_visible" | "strong_visual_inference"
    # | "not_evidenced". The post-processor enforces direct_visible for
    # spec fields (storage, ram, processor, battery_health, purchase_year).
    field_evidence: dict = Field(default_factory=dict)


class DraftFromImageResponse(BaseModel):
    draft_id: UUID
    photo_url: str
    detected: AIDetected
    suggested_price: float | None = None
    price_source: str = "none"               # comparables | ai | none
    comparables: list[Comparable] = Field(default_factory=list)
    expires_at: datetime
    needs_identifier: bool = False           # True for smartphones/laptops
    fallback_reason: str | None = None       # set if vision/price failed


# ── IMEI extraction ───────────────────────────────────────────────────────


class ExtractIMEIResponse(BaseModel):
    imei: str | None = None
    confidence: float = 0.0
    luhn_valid: bool = False
    ceir_status: str | None = None           # clean | blacklisted | invalid
    extracted_text: str | None = None
    suggest_manual: bool = False             # True after 2 failed attempts


# ── Create from draft ─────────────────────────────────────────────────────


class CreateFromDraftRequest(BaseModel):
    draft_id: UUID
    title: str = Field(min_length=4, max_length=200)
    price: float = Field(gt=0)
    condition: str
    category_slug: str
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    color: str | None = None
    description: str | None = None
    imei_1: str | None = None
    imei_2: str | None = None
    serial_number: str | None = None
    image_urls: list[str] | None = None      # if mobile uploaded extras
    video_url: str | None = None


class CreateFromDraftResponse(BaseModel):
    listing_id: UUID
    listing_state: str                        # 'pending_buyer' on success
    status: str                               # mirror of legacy field
    title: str
    price: float


# ── Seller info (progressive collection) ──────────────────────────────────


class SellerInfoRequest(BaseModel):
    pickup_address: str | None = None
    pickup_pincode: str | None = None
    accessories: str | None = None
    available_slots: list[str] | None = None  # ISO datetime strings


class SellerInfoNeededResponse(BaseModel):
    pickup_address_needed: bool
    accessories_needed: bool
    payout_kyc_needed: bool
    listing_state: str


# ── Listing edit (state-locked) ───────────────────────────────────────────


class EditListingRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    price: float | None = None
    condition: str | None = None
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    color: str | None = None
    accessories: str | None = None


class EditListingResponse(BaseModel):
    listing_id: UUID
    updated_fields: list[str]
    listing_state: str
    locked_reason: str | None = None


# ── Description regenerate ────────────────────────────────────────────────


class RegenerateDescriptionResponse(BaseModel):
    description: str
    ai_model: str
