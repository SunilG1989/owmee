# Sprint 6 — Final KYC Model (patched after Sprint 6a close)

This doc supersedes the original Sprint 6 brief's KYC section. It reflects the
final model shipped in Sprint 6a (phases 1 through 2d).

## KYC model — finalized

| User action | KYC requirement |
|---|---|
| Sign up, explore, browse | None (phone OTP only) |
| List items as seller | None |
| Make offer, buy, pay | None |
| **Get "Verified by Owmee" badge** | **HARD — must complete full KYC** |
| **Request refund** (future feature) | **HARD — must complete full KYC first** |
| **Request return** (future feature) | **HARD — must complete full KYC first** |
| Seller payout | HARD (unchanged) |
| Dispute open (future feature) | Soft — can open, payout of refund requires KYC |

## What Sprint 6a shipped

- **Phase 1** (commit `7e45498`): DB column `seller_kyc_verified_at_listing_time` + API field `verified_by_owmee`.
- **Phase 2a** (commit `947dbbf`): Ranking boost + `create_listing` snapshot hook.
- **Phase 2b** (commit `dcdbb7c`): `_fmt_card` returns `seller_verified` + `verified_by_owmee` at top level. Mobile badge rendering goes live.
- **Phase 2c** (commit `c9a55bc` submodule, parent bump `143b65d`): KYC hard gates removed from MakeOffer, Publish, Checkout. Phone-OTP users can transact freely.
- **Phase 2d** (this commit): `KycRequiredForActionScreen` added (unwired — future use). ProfileScreen banner rewritten as opt-in badge prompt.

## What's deferred

- **Refund feature** — not in Sprint 6. Will be Sprint 7 or later. `KycRequiredForActionScreen` is ready to gate it when it ships.
- **Return feature** — same as refund.
- **Dispute UI** — backend tables exist, mobile wiring deferred.
- **Buyer verified badge on received offers** — needs buyer info rendering in OffersScreen card (minor design change) + backend payload field. Sprint 6a-e if prioritized, otherwise next sprint.

## Sprint 6b-c (up next)

- **6b**: Offer v2 — update-price endpoint, 3-update lockout, 7-day cooldown. Chat module deletion (no-op; never built).
- **6c**: Hybrid logistics wiring — FE pickup inspection → hub → FE or courier delivery (backend `shipments` table already has all needed columns).
