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
    raw_category_slug: str | None = None       # original LLM slug before backend normalization
    category_resolution: str | None = None     # canonical | alias | fallback_others | unresolved
    category_confidence: float = 0.0
    category_rationale: str | None = None      # short LLM/backend reason for category choice
    category_family: str | None = None         # device | appliance | toy | book | other
    category_specifics: dict[str, Any] = Field(default_factory=dict)
    detected_item_type: str | None = None      # "wireless headphones", "office chair", etc.
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
    mrp_inr: int | None = None              # original MRP / new-price anchor for discount display
    mrp_confidence: float = 0.0
    mrp_source: str | None = None           # visible_mrp | receipt_or_bill | market_anchor | none
    mrp_reasoning: str | None = None

    # Authoring
    title_suggestion: str | None = None
    description_suggestion: str | None = None
    # Top-level flags list. Per PROMPT v2's IMAGE SET VALIDITY section,
    # blocking signals are emitted here as string tokens:
    #   nsfw, personal_info, multiple_items, no_product, blurry,
    #   packaging_only, screenshot_only, stock_or_catalog_suspected,
    #   plus ai_failed:<reason> for client/SDK failures.
    # The provider post-processor reads from this list
    # reads from this list (NOT from image_set_quality).
    flags: list[str] = Field(default_factory=list)
    # Descriptive metadata about the photo set. Filled keys per the
    # canonical schema:
    #   is_single_sellable_item, has_actual_item_photo, has_box_or_packaging,
    #   has_settings_or_spec_screen, has_receipt_or_warranty,
    #   has_private_info, is_stock_or_catalog_image_suspected (booleans),
    #   overall_photo_quality ("good" | "usable" | "poor" | "unusable").
    # This block is purely descriptive — it is NOT a guardrail input.
    image_set_quality: dict = Field(default_factory=dict)
    # Zero-based index into the uploaded image set. The backend uses this
    # to choose the listing hero image and process only that image for
    # background cleanup.
    hero_image_index: int | None = None
    hero_image_rationale: str | None = None

    # Review routing — populated by Gemini per PROMPT v2 + reinforced
    # by the post-processing guardrails in the configured provider adapter.
    manual_review_required: bool = False
    auto_publish_candidate: bool = False
    blocking_reasons: list[str] = Field(default_factory=list)

    # Free-text rationale: "model exactness unclear", "asked seller for
    # battery screenshot", etc. Surfaced verbatim in admin web.
    extraction_notes: str | None = None

    # Short user-facing requests for better photos. UI renders these as
    # bullets above the camera button.
    seller_photo_feedback: list[str] = Field(default_factory=list)
    seller_edit_fields: list[str] = Field(default_factory=list)

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
    photo_urls: list[str] = Field(default_factory=list)
    detected: AIDetected
    suggested_price: float | None = None
    price_source: str = "none"               # comparables | vision | mrp_anchor | category_anchor | ai | none
    comparables: list[Comparable] = Field(default_factory=list)
    expires_at: datetime
    needs_identifier: bool = False           # True for smartphones/laptops/tablets
    fallback_reason: str | None = None       # set if vision/price failed
    analysis_contract: dict[str, Any] = Field(default_factory=dict)


class AIDraftUploadImageRequest(BaseModel):
    content_type: str = "image/jpeg"


class AIDraftUploadSessionRequest(BaseModel):
    images: list[AIDraftUploadImageRequest] = Field(min_length=1, max_length=6)


class AIDraftUploadSlot(BaseModel):
    index: int
    upload_url: str
    r2_key: str
    content_type: str
    expires_in_seconds: int


class AIDraftUploadSessionResponse(BaseModel):
    draft_id: UUID
    uploads: list[AIDraftUploadSlot]
    status: str = "uploading"
    expires_at: datetime


class AIDraftAnalysisStartResponse(BaseModel):
    draft_id: UUID
    status: str


class AIDraftAnalysisStatusResponse(BaseModel):
    draft_id: UUID
    status: str
    draft: DraftFromImageResponse | None = None
    error: str | None = None
    message: str | None = None
    retry_after_seconds: int | None = None


class DraftPriceRefreshRequest(BaseModel):
    """Seller-confirmed fields used to recover price guidance.

    Vision is allowed to be conservative on the first pass. This request lets
    the review screen send the fields the seller just confirmed so the backend
    can recompute MRP + asking-price guidance without making the seller start
    over or manually research the market.
    """
    category_slug: str | None = None
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    ram: str | None = None
    processor: str | None = None
    screen_size: str | None = None
    detected_item_type: str | None = None
    category_family: str | None = None
    category_specifics: dict[str, Any] | None = None
    condition: str | None = None
    purchase_year: int | None = Field(None, ge=2000, le=2030)
    screen_condition: str | None = Field(None, pattern="^(flawless|minor_scratches|cracked)$")
    body_condition: str | None = Field(None, pattern="^(flawless|minor_dents|major_damage)$")
    defects: list[str] | None = None
    original_price: float | None = Field(None, gt=0, le=10000000)
    mrp_source: str | None = None
    mrp_confidence: float | None = Field(None, ge=0, le=1)


# ── IMEI extraction ───────────────────────────────────────────────────────


class ExtractIMEIResponse(BaseModel):
    identifier_kind: str | None = None          # imei | serial
    identifier_value: str | None = None
    imei: str | None = None
    serial_number: str | None = None
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
    original_price: float | None = Field(None, gt=0, le=10000000)
    condition: str
    category_slug: str
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    ram: str | None = None
    processor: str | None = None
    screen_size: str | None = None
    color: str | None = None
    purchase_year: int | None = Field(None, ge=2000, le=2030)
    screen_condition: str | None = Field(None, pattern="^(flawless|minor_scratches|cracked)$")
    body_condition: str | None = Field(None, pattern="^(flawless|minor_dents|major_damage)$")
    defects: list[str] | None = None
    battery_health: int | None = Field(None, ge=0, le=100)
    accessories: str | None = None
    warranty_status: str | None = None
    age_suitability: str | None = None
    hygiene_status: str | None = None
    has_box: bool | None = None
    has_bill: bool | None = None
    has_charger: bool | None = None
    has_earphones: bool | None = None
    water_damage_history: bool | None = None
    seller_functional_attestation: bool | None = None
    kids_safety_checklist: dict[str, Any] | None = None
    category_family: str | None = None
    category_specifics: dict[str, Any] | None = None
    description: str | None = None
    mrp_source: str | None = None
    mrp_confidence: float | None = Field(None, ge=0, le=1)
    seller_mrp_confirmed: bool | None = None
    hero_image_index: int | None = Field(None, ge=0, le=5)
    removed_photo_indices: list[int] | None = None
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
    original_price: float | None = None


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
    ram: str | None = None
    processor: str | None = None
    screen_size: str | None = None
    color: str | None = None
    purchase_year: int | None = Field(None, ge=2000, le=2030)
    battery_health: int | None = Field(None, ge=0, le=100)
    accessories: str | None = None
    warranty_status: str | None = None
    age_suitability: str | None = None
    hygiene_status: str | None = None
    screen_condition: str | None = None
    body_condition: str | None = None
    defects: list[str] | None = None
    has_box: bool | None = None
    has_bill: bool | None = None
    has_charger: bool | None = None
    has_earphones: bool | None = None
    water_damage_history: bool | None = None
    seller_functional_attestation: bool | None = None


class EditListingResponse(BaseModel):
    listing_id: UUID
    updated_fields: list[str]
    listing_state: str
    locked_reason: str | None = None


# ── Description regenerate ────────────────────────────────────────────────


class RegenerateDescriptionResponse(BaseModel):
    description: str
    ai_model: str
