# Claude Code context for Owmee

This file is read on every Claude Code session for project context.

## Project shape
Trust-first C2C resale platform for India. React Native + FastAPI + Postgres
+ Redis + Temporal + MinIO. Photo-first AI-assisted listing flow via Gemini.

## Critical conventions (do NOT violate without explicit user approval)

- Postgres is the source of truth. Partner systems are external sources.
- UUID primary keys: Python defaults use uuid.uuid4(); migrations use
  uuid_generate_v4() from uuid-ossp. NEVER gen_random_uuid().
- Async SQLAlchemy via DBSession type alias.
- metadata_ is the Python attribute mapped to the metadata column.
- TimestampMixin imported from app.db.session (not app.db.mixins).
- CurrentUser is built from JWT claims, not DB rows.
- KYC tri-state model: auth_state, buyer_eligible, seller_tier.
  After every KYC step success, call derive_tri_state_from_kyc(user_id).
- Temporal workflow versioning: use get_version on every workflow change.

## Reading actual code FIRST

Never write stub or placeholder code before reading the actual codebase.
Read the relevant files, infer existing patterns, then write code
that fits the conventions.

## Active dev environment
- Docker Compose stack at docker-compose.yml
- API binds 0.0.0.0:8000
- LAN IP in mobile/src/config.ts and .env R2_PUBLIC_ENDPOINT
- Test phone: configured via OTP_WHITELIST in .env (Sprint 5b feature).
  OTP for whitelisted numbers: OTP_WHITELIST_CODE in .env (default 123456).
- Dev KYC bypass: POST /v1/dev/kyc-approve/{phone} (dev env only).

## Gemini quota
Free tier is 20 vision calls/day on gemini-2.5-flash. Resets at midnight
Pacific. If exhausted: enable billing on the project, or switch to
gemini-1.5-flash in .env (separate quota pool).

## Documentation
README.md plus docs/SETUP.md, docs/DEV_NOTES.md, docs/TROUBLESHOOTING.md.
Sprint briefs at the repo root (SPRINT_6_*.md, ARCHITECTURE_AMENDMENT_V3.md).
KNOWN_ISSUES.md tracks pre-existing gaps surfaced post-fix.

## Sprint 6b (shipped)

Sprint 6b shipped on 2026-04-30. It removed the chat module entirely
and replaced free-form negotiation with structured offer mechanics:
- POST /v1/offers/{id}/update-price (capped at 3 revisions; then locked)
- 48h counter window (counter_expires_at) when seller counters
- 7-day cooldown (lockout_until) on rejection or counter-expiry
- Offer-thread is now the dispute evidence (chat-archive Temporal
  activity is a named no-op pending the snapshot rebuild)

Migration: 0025_offer_v2. Mobile: OffersScreen now reachable as the
MyOffers route from Profile, with update-price + counter accept/decline
+ cooldown rendering on the Sent tab.
