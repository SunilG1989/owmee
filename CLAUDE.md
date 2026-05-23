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

## Founder decision: order E2E and seller readiness

Decision captured on 2026-05-23 after reviewing current repo state and
marketplace patterns. Owmee's pilot flow must treat seller readiness as the
post-payment gate. A buyer payment is not enough to send an FE blindly.

Valid pilot use cases:
- Buyer pays through Owmee; order becomes operational only after payment
  capture, not payment-link creation.
- Seller receives a structured paid-order task: confirm item availability,
  pickup address, pickup slot/readiness, condition unchanged, and included
  accessories.
- If seller confirms, Owmee assigns FE pickup. If seller declines or misses
  the response deadline, buyer is refunded and the seller/order is flagged
  for ops.
- Transaction stores immutable buyer delivery and seller pickup snapshots.
  FE pickup/delivery tasks read from transaction snapshots, not mutable
  current user defaults.
- FE pickup, hub routing, FE/courier delivery, buyer ack code, delivered
  state, 48h buyer acceptance, auto-complete, refund/return/dispute, and
  payout eligibility are one canonical state machine.
- Reuse existing code primitives where possible: Concierge already has
  `FEVisit.address_snapshot`, seller arrival verification, seller approval,
  visit issues, and close-visit handover fields. Post-purchase readiness must
  be transaction-owned, but it should borrow those patterns instead of
  inventing a second ops language.
- Existing AI listing seller-info endpoints collect pickup address,
  pincode, accessories, and available_slots, but they currently write mostly
  to mutable user/listing records. They are useful inputs, not sufficient
  transaction snapshots.

Backlog, not pilot blockers:
- Real courier API integrations and webhook status sync.
- Automated routing rules after enough manual routes are observed.
- Multi-quantity inventory and stock ledger. Pilot remains one listing =
  one item, with reservation expiry and payment-timeout release.
- Advanced seller defect scoring, RTO/NDR, live maps, pickup points, and
  vendor dashboards.

Still rejected:
- Buyer/seller chat, Make Offer notes, buyer-seller meetup, seller-managed
  shipping, and self-reported payment confirmation.
