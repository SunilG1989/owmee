"""Sprint 8 Phase 2 — AI-Assisted Listing Creation.

Photo-first listing flow: seller takes a photo, Claude vision identifies
the item, the platform proposes a price from comparables (or AI fallback),
and the seller validates with a single tap.

Public API:
    from app.modules.ai_assistant.router import router

Module structure:
    router.py            — 7 FastAPI endpoints
    schemas.py           — Pydantic request/response models
    prompts.py           — System prompts for vision/OCR/description
    claude_client.py     — Anthropic SDK wrapper (vendor-abstracted)
    price_estimator.py   — DB comparables → AI fallback → sanity-checked price
    ceir_client.py       — IMEI validation (Luhn + mock CEIR)
"""
