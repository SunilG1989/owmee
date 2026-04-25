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
    """Structured output from Claude vision."""
    category_slug: str | None = None
    category_confidence: float = 0.0
    brand: str | None = None
    model: str | None = None
    storage: str | None = None
    color: str | None = None
    condition_guess: str | None = None      # like_new | good | fair
    title_suggestion: str | None = None
    description_suggestion: str | None = None
    flags: list[str] = Field(default_factory=list)  # nsfw, multiple_items, etc.


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
