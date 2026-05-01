# Owmee pilot readiness

Single-source list of what's shipped vs pending vs deferred, ahead of the
Bengaluru hyperlocal pilot (Kanakapura Rd / Judicial Layout + Bannerghatta
Rd / Vijaya Bank Layout). Replaces the stack-ranked list that used to
live only in conversation context.

**Pilot scope (locked):**
- No platform fee.
- ₹100 delivery fee on small-appliances category only.
- Every product >₹1000 is FE-verified before publish.
- All categories except large-appliances.
- Buyer and seller never meet — Owmee FE handles pickup, hub, delivery.

Last reviewed: 2026-05-01.

---

## Shipped (in `main`)

### Identity, KYC, trust
- KYC tri-state model (`auth_state`, `buyer_eligible`, `seller_tier`); call
  `derive_tri_state_from_kyc(user_id)` after every KYC step.
- "Verified by Owmee" snapshot on listings (Sprint 6a).
- Hyperlocal geo-fence + IMEI dedup (`fb4197b`).
- Payout-verified gate; no buyer-seller meetups (`6b42714`).
- OTP whitelist for test users (Sprint 5b); dev KYC bypass via
  `POST /v1/dev/kyc-approve/{phone}`.
- Real admin JWT verification (`backend/app/modules/admin/admin_auth.py`),
  shared by `kyc_queue.py` and `logistics_router.py`. Phase 8.

### Listings + offers
- Photo-first AI-assisted listing flow (Sprint 8 Phase 2).
- Gemini schema expanded to 22 fields:
  price, brand, model, RAM, processor, screen size, purchase year, screen
  condition, body condition, defects, battery health, accessories, warranty
  status, suggested price, etc. (`6359e69`).
- Offer v2: update-price (3-revision lock), 48h counter window, 7-day
  cooldown on rejection or counter-expiry (Sprint 6b).
- Offer-thread is dispute evidence; chat module fully removed.

### Logistics (hybrid model)
- State machine + schema (Sprint 6c Phase 1).
- Admin/FE/buyer API surface (Phase 2).
- Server-rendered Jinja2 admin web at `/admin/*` — dispatch, hub, txn
  detail, disputes, refunds, returns (Phase 3).
- Mobile consumer tracking UI (Phase 4).
- FE app — pickups + deliveries (Phase 5).

### Buyer protection
- Refund flow + Razorpay adapter (`46df387`).
- Dispute flow wired to refund (`9a03048`).
- Return flow: 7-day window, admin approval, FE return-pickup, auto-refund
  (`bb05856`).
- Refund webhook, rate limits, image resize (`e73ed41`).

### Infra / hygiene
- Sentry on (`6b42714`).
- TDS, FK cascades, image URLs (`0f008a8`).
- Alembic split heads merged via `0032_merge_heads`. Phase 8.
- Mobile typecheck clean (`tsc --noEmit` exit 0). Phase 8.
- v4 "Warm Trust" palette swept across mobile screens.
- Backend tests: `test_offer_v2.py`, `test_listings_seller_verified.py`.

---

## Pending — pre-pilot

### Push notification path (mobile side)
**Backend ready:** `app/modules/notifications/service.py` does FCM v1 with
in-app fallback; `users.fcm_token` column exists; registration endpoint at
`POST /v1/offers/.../register-fcm-token` (in `offers/router.py:802`).

**Missing:** the mobile app has no `@react-native-firebase/messaging`
integration. No token retrieval, no permission request, no register call.
Affects ack-code delivery, offer counter alerts, FE-arrival notifications,
dispute updates.

### Buyer-initiated pre-delivery cancel
`backend/app/modules/transactions/refund_service.py:8` — TODO. Buyer can
currently only request return after delivery; no cancel-before-pickup path.

### Ack-code delivery to buyer
`backend/app/modules/transactions/logistics_router.py:480` — TODO. Code is
generated on FE pickup but the buyer-side push delivery is not wired
(blocked on the FCM client work above).

### Tests for new flows
No pytest coverage for refund / dispute / return / logistics state
transitions. The two existing test files only cover offers + listings.

### `KNOWN_ISSUES.md` carryovers
- **A.** Auto-detected location stuck at `"Detecting…"`
  (`mobile/src/navigation/RootNavigator.tsx:175`). User-visible on every
  fresh install that grants GPS without going through the picker.
- **C.** Pre-Sprint-6a listings + late-verifying sellers don't get the
  badge. Cosmetic; small cohort.
- **D.** ~~Alembic split heads~~ — fixed by `0032_merge_heads`.

### Admin UI consolidation
- Vite `admin/` (FE assign/list/earnings, dispatch, audit log, stuck
  workflows) is legacy. README header now flags this.
- Port FE-management pages into `backend/app/admin_web/` (Jinja2), then
  delete `admin/`.

---

## Deferred (you'll handle these)

- **Razorpay real integration.** Adapter exists at
  `backend/app/modules/payments/adapter.py` with both `_DevPaymentAdapter`
  and `_RazorpayAdapter`; flip the env switch when keys are ready.
- **Digio real KYC integration.** Tri-state hook is in place; swap the
  bypass for the real Digio webhook when ready.
- **Railway production deploy.**
- **End-to-end smoke** with real money — blocked on Razorpay above.
- **FE field test** in the two pilot zones with real FEs.

---

## Phase 8 fixes — local, not yet committed

16 modified + 3 untracked files in working tree:
- `0032_merge_heads.py` (alembic merge migration)
- `admin_auth.py` (real JWT-verifying admin dependencies)
- `globals.d.ts` (Timeout aliased to `number` for RN runtime)
- mobile typecheck cleanup across ~10 screens
- `admin/README.md` legacy note

Next steps after commit: pick one of the pending items above, or wait on
the deferred set.
