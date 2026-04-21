# Sprint 6 Brief — Owmee V2 Product Pivot

**Status:** Spec locked. Code not yet started.
**Owner:** Sunil
**Target:** 7 days of engineering + 1 day architecture/spec review

---

## 1. Why this sprint exists

External feedback called out three fundamental product decisions that conflict with the current architecture:

1. **KYC-gated listing kills seller acquisition.** Indian Aadhaar+PAN+selfie eKYC has 30-50% drop-off. Forcing it before a seller can list loses >50% of seller funnel.
2. **Chat is OLX's worst feature.** It enables lowball haggling, off-platform redirection, harassment, and is 90% of the C2C support burden. Replacing it with structured offers is a net product win.
3. **"Meet at home" is a safety liability.** Every serious C2C platform in 2026 (Mercari, Vinted, Daangn) has structured logistics or pickup points, not personal meetups.

After review and verified research on Mercari Japan's actual model, this sprint pivots Owmee toward a trust-first + friction-minimized model that mirrors Mercari's proven approach, adapted for India-specific constraints (Aadhaar KYC, courier serviceability, FE-based inspection).

## 2. Product decisions locked in this sprint

### 2.1 Seller KYC model — BADGE ONLY, NOT GATE

| Before Sprint 6 | After Sprint 6 |
|---|---|
| Listing creation blocked until KYC verified | Listing creation requires only phone OTP |
| Offer creation / acceptance gated by seller_tier | Offer flows ungated |
| Payout eligibility tied to `seller_tier == 'full_verified'` | Payout still requires KYC (unchanged) |
| KYC required to be a seller | KYC optional — earns a **"Verified by Owmee"** badge + **ranking boost** |

**Effect:** any user with a phone number can list. Verified sellers get discoverability advantage. This mirrors Mercari's model where "our search algorithm favors verified sellers" (Mercari Help, verified 2026).

The existing tri-state `auth_state` / `seller_tier` model is **kept** — it now drives badging and ranking rather than access control. No migration rollback needed. No throwaway of Sprint 4 Pass 1 work.

### 2.2 Buyer KYC model — NOT REQUIRED FOR PURCHASE

| Buyer action | KYC requirement |
|---|---|
| Browse, wishlist | None |
| Make offer, buy now, pay | None (phone OTP only) |
| Request refund | **KYC required** |
| Request return | **KYC required** |
| Open dispute | **KYC required** |

Reasoning: refund/return/dispute is the only moment where Owmee needs provable buyer identity (to prevent fraud where "buyer" claims non-receipt and is actually an unverifiable identity). KYC-at-friction-moment is acceptable because motivation is maximum.

### 2.3 Chat — DELETED ENTIRELY

No message UI, no chat tab, no `/v1/chat/*` endpoints, no Stream/Sendbird vendor. The entire `app/modules/chat/` directory is removed. The empty shell from Sprint 4 planning goes away.

Replaced by three structured interactions:

| Chat replaced by | Mechanism |
|---|---|
| "Is this still available?" | Auto-mark sold/reserved. Listing card shows real-time stock state. Already in model. |
| "Can you do ₹X?" | **Make Offer** with single price. Buyer can **update their offer price up to 3 times total** per listing. Each update replaces prior offer. Seller sees current offer. |
| Counter-offer | Seller can counter once. Buyer accepts or walks. End of negotiation. |
| "Where can we meet?" | **No meetups exist.** Logistics handled by Owmee (see 2.5). |

No text exchange anywhere in the buyer-seller interaction. Zero free-form messaging.

### 2.4 Offer mechanics — PRECISE RULES

**Buyer's offer lifecycle:**
```
offer_created (price_1) → buyer can update (price_2) → buyer can update (price_3) →
  LOCKED (no more updates from buyer) → seller_responds (accept | reject | counter)
```

- Buyer has made 3 offers → locked. Seller MUST respond within 24 hours.
- If seller rejects or offer expires → buyer cannot offer again on this listing for **7 days**.
- If seller counters → buyer can only accept or reject. No re-counter.
- If counter expires (48 hours with no buyer response) → offer dies, buyer in 7-day cooldown.

**Single active offer per (buyer, listing) pair.** Buyer cannot have 2 pending offers on the same listing simultaneously — only updates to the existing one.

### 2.5 Logistics — HYBRID FE + COURIER, WITH FE INSPECTION ALWAYS

**Pickup leg (always FE):**
- FE visits seller, inspects item against listing snapshot
- Captures verification photos, IMEI (for phones), condition notes
- Pass → item enters Owmee hub routing
- Fail → pickup rejected, buyer auto-refunded, seller notified, FE earns inspection fee regardless

**Delivery leg (admin chooses FE or courier per transaction):**
- **FE delivery:** another FE (or same) takes item to buyer, hands over, captures delivery photo
- **Courier delivery (stub for Sprint 6):** admin enters AWB manually, buyer sees a tracking page with admin-updated status

**"Meet at home" / personal meetup: REMOVED.** Not even opt-in. No database flag, no UI, no code path.

**Pickup points (partner locations): DEFERRED to Sprint 7.** Launch with FE pickup + FE/courier delivery only. Pickup points need real-world partnership work, not engineering.

### 2.6 Admin routing — MANUAL FOR SPRINT 6

Admin web gets a new queue: "Transactions at hub — awaiting delivery dispatch." For each transaction, admin picks FE or courier (manual entry AWB for courier). Building a rules engine is premature — we need to route 50 transactions manually first to learn the pattern.

## 3. Scope — three deliverables

### Deliverable 6a — KYC inversion

**Backend:**
- Remove KYC gate from `POST /v1/listings` creation. Phone-OTP session is sufficient.
- Remove KYC gate from `POST /v1/offers` creation and `POST /v1/offers/{id}/accept`.
- Keep KYC gate on `POST /v1/payouts/request` (unchanged).
- Add `POST /v1/kyc/require-for-action` soft-gate endpoint called before refund/return/dispute init.
- Add `Listing.seller_kyc_verified` computed field — true when seller's `kyc_status == 'verified'`.
- Search/browse: multiply ranking score by 1.3 when `seller_kyc_verified = true`. Keep scoring transparent in API response for ops debugging.

**Mobile:**
- Remove `KycFlow` modal trigger from `Sell` tab tap.
- Remove KYC gate from "Make offer" / "Buy now" buttons.
- Listing card: show "Verified by Owmee" badge (green checkmark) when `seller_kyc_verified = true`. No badge otherwise (NOT "unverified" — that's negative framing).
- New screen: `KycRequiredForActionScreen` — shown when buyer tries refund/return/dispute without KYC. "To protect both parties, we need to verify your identity before processing this request."
- Seller profile screen: if KYC not done, show banner "Complete KYC to get the Verified by Owmee badge — verified sellers' items rank higher in search."

**Migration `0027_kyc_to_badge`:**
- Add `listings.seller_kyc_verified_at_listing_time BOOLEAN` — snapshot at listing creation (optional for Sprint 6, required for Sprint 7 ranking history)
- No destructive changes. All Sprint 4 Pass 1 tri-state columns stay.

### Deliverable 6b — Chat removal + offer v2

**Backend:**
- Delete `app/modules/chat/` directory entirely.
- Remove `chat_channel_id` column from `offers` (if present).
- Remove chat token issuance from offer creation path.
- Remove chat evidence archival hooks from dispute flow (replace with "snapshot the offer thread" — same effect, no chat needed).
- Offer schema changes:
  - Add `Offer.update_count INTEGER DEFAULT 0` — increments on buyer price update
  - Add `Offer.lockout_until TIMESTAMPTZ` — populated when offer rejected/expired; buyer cannot create new offer on same listing until this time
  - Add `Offer.counter_price NUMERIC(10,2)` and `Offer.counter_expires_at TIMESTAMPTZ` — seller counter info
- New endpoint: `POST /v1/offers/{id}/update-price` — buyer updates their offer price (increments `update_count`, rejects if already 3)
- Modify `POST /v1/offers/{id}/counter` — seller sets counter_price, sets 48h expiry
- Modify `POST /v1/offers/{id}/accept` — buyer accepts either the original or countered price
- Logic: if buyer has an active offer on listing L, new `POST /v1/offers` on L returns 409 with "Update your existing offer instead."

**Mobile:**
- Remove "Deals" tab entirely. Tab bar goes to 4 tabs: Home, Search, Sell, Profile. (Or rename "Deals" → "My Offers" and keep it.)
- Remove `ChatScreen` if it exists. Remove any `message_seller` button from `ListingDetailScreen`.
- `MakeOfferScreen`: shows "This is a binding offer. You can update your price up to 3 times. After that, the seller decides."
- `MyOffersScreen` (Deals tab renamed): shows current status — Active / Countered / Rejected / Accepted. "Update price" button visible only when `update_count < 3`.
- If buyer hits 3-update limit, button greys out with tooltip.

**Migration `0028_offer_v2`:**
- Add 4 columns to `offers` table (listed above)
- Drop `chat_channels` table if exists
- Remove `chat_channel_id` FK from offers if exists
- Backfill: set `update_count = 0` for all existing offers

### Deliverable 6c — Hybrid logistics foundation

**Backend:**
- Extend `Transaction` state machine with new states:
  - `at_hub` — FE has completed pickup + inspection, item in Owmee's custody
  - `routed_to_fe_delivery` — admin assigned delivery to an FE
  - `routed_to_courier` — admin assigned delivery to courier (with AWB)
  - `delivery_in_progress` — item in transit
  - `delivered` — FE or courier delivered, awaiting buyer acceptance
- New endpoints (admin):
  - `GET /v1/admin/hub/transactions` — queue of transactions at `at_hub` state
  - `POST /v1/admin/transactions/{id}/route-to-fe-delivery` — body: `fe_user_id`
  - `POST /v1/admin/transactions/{id}/route-to-courier` — body: `courier_name`, `awb`, `estimated_delivery_date`
- New endpoint (FE): `GET /v1/fe/my-deliveries` — FE sees their delivery assignments alongside pickups
- New endpoint (FE): `POST /v1/fe/deliveries/{id}/complete` — FE marks delivered, uploads handover photo
- New endpoint (admin): `POST /v1/admin/transactions/{id}/update-courier-status` — admin manually updates courier tracking status until Sprint 7 real integration

**Remove:**
- Any `meetup_*` endpoints
- Any "meet at home" UI flags
- Any self-reported payment confirmation at meetup time

**Mobile (consumer):**
- `TransactionDetailScreen`: tracking timeline showing pickup → hub → delivery → delivered
- No meetup scheduling UI anywhere
- Remove "Mark as paid / received" self-confirmation buttons (payment is now authoritative from the PA / escrow)
- "Confirm receipt" button appears only after delivery confirmed by FE/courier

**Mobile (FE app):**
- New section: "My Deliveries" — list of transactions assigned to this FE for delivery leg
- Same capture flow as pickup, but captures **delivery photo** (item being handed to buyer) and **buyer acknowledgment** (signature or OTP-on-delivery)

**Admin web:**
- New tab: "Hub Dispatch" — queue of transactions at `at_hub` state
- Each row has: listing snapshot, FE pickup photos, value, buyer location, distance from hub
- Admin action: "Assign to FE" (dropdown of available FEs with city match) OR "Ship via courier" (enter courier name + AWB)

**Migration `0029_hybrid_logistics`:**
- Add states to `transactions.status` enum (or add `transactions.hub_state` column)
- Add `transactions.delivery_mode` enum: `fe | courier | NULL`
- Add `transactions.delivery_fe_id` (FK to users, nullable)
- Add `transactions.courier_name`, `transactions.courier_awb`, `transactions.courier_estimated_delivery_date`
- Add `transactions.delivered_at TIMESTAMPTZ`
- Drop `transactions.meetup_at`, `transactions.meetup_confirmed_by_*` if present

## 4. Out of scope — DEFERRED to Sprint 7 or later

- **Real Shiprocket/Delhivery courier API** — stub admin-manual updates for now
- **Pickup point partnerships** — FE-only logistics at launch
- **Rules engine for auto-routing** — manual admin decision for first 50 transactions
- **Hub inventory management** — assumed single hub per city, items tracked by transaction_id, no SKU-level hub ops
- **Second delivery attempt if buyer unavailable** — manual admin intervention
- **Return logistics (FE picks up returned item)** — Sprint 7, once return flow spec is written
- **FE handover protocol with courier** — assume FE drops at courier office, admin enters AWB manually
- **Buyer-initiated pickup (buyer goes to hub to collect)** — not supported in Sprint 6

## 5. Exit criteria

Sprint 6 is complete when all 7 are true:

1. A phone-OTP-only user creates a listing, receives an offer, accepts it. No KYC involved anywhere in this path.
2. A phone-OTP-only buyer places an offer, makes 2 price updates, accepts counter. No KYC involved.
3. Admin UI at `/admin/kyc-queue` shows KYC applications from sellers wanting the badge. Approving one flips `seller_kyc_verified` to true and listing cards start showing the badge.
4. Search for a category returns verified-badge listings above non-badged ones (verify with at least 2 listings — one verified, one not — at similar recency).
5. A transaction completes end-to-end with FE pickup → admin hub routing → FE delivery → buyer confirmation. No "meet at home" flow exists in the code.
6. A transaction completes end-to-end with FE pickup → admin hub routing → courier (with admin-entered AWB) → admin marks delivered → buyer confirmation.
7. Buyer requests refund. KYC wall appears. Buyer completes KYC. Refund processes. (Or: buyer skips KYC, refund blocked.)

## 6. Metrics to track post-launch

To validate the pivot empirically:

| Metric | Baseline hypothesis | Target after 30 days |
|---|---|---|
| Listings created per new user | Unknown (KYC gate was in the way) | 1.5+ per new seller |
| KYC completion rate for sellers | 100% of listings (forced) | 30-40% of listings (voluntary for badge) |
| Verified listings as % of total | 100% | 40-60% |
| Avg offers per listing | 0.5 (due to chat friction today) | 1.5+ |
| % offers updated 2+ times | 0 | 20-30% |
| % transactions routed to courier | 0 | 50-70% (by volume) |
| % transactions routed to FE delivery | 100% (current FE-only) | 30-50% |

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Removing KYC gate creates spam listings | Listing moderation queue is already built — images/IMEI go through moderation before live. Unverified sellers see listings go live within 2 hours (moderation SLA); verified sellers bypass moderation queue. |
| Courier stub is too manual for launch volume | Launch with 5-10 pilot users only. At that scale, admin can handle 2-3 courier dispatches per day manually. |
| Chat removal loses support visibility | Sprint 6 includes an admin "conversation log" per transaction that shows: offer history, counter history, FE inspection notes, delivery milestones. Replaces chat evidence for disputes. |
| FE inspection at pickup becomes bottleneck | FE earnings module is already designed to scale. Onboard more FEs in target city before volume ramps. |
| Buyer KYC-only-at-dispute means bad-actor buyers exist | Buyer OTP + device fingerprint + IP logged from day 1. Risk engine can flag suspicious buyers even without KYC. Actual fraud cases trigger KYC wall. |
| Offer v2 with update limit confuses users | UX copy tested explicitly: "Your offer is binding. You can change your mind 3 times. Then seller decides." Two rounds of copy revision before launch. |

## 8. Migration order (to avoid mid-sprint breakage)

Migrations applied in this sequence during Sprint 6:

1. `0027_kyc_to_badge` — additive only (new `seller_kyc_verified_at_listing_time` column, default values). Backward-compatible. Can deploy before mobile app is updated.
2. `0028_offer_v2` — additive (new offer columns), destructive (drop `chat_channels` if exists). Requires mobile update deployed alongside. **Breaking change** for clients on old offer schema.
3. `0029_hybrid_logistics` — additive. `meetup_*` columns dropped only after verifying no live transactions are in meetup-flow states.

**Pre-migration check before 0028:** confirm no live offers have `chat_channel_id` actively used. If any exist, flag them for manual ops close-out before dropping.

**Pre-migration check before 0029:** confirm no live transactions in `meetup_scheduled` or `meetup_confirmed` states. If any, transition them manually to `delivered` via admin tool.

## 9. Code order (suggested, not strict)

Each sub-deliverable ships as its own bundle + commit, in order:

1. Migration 0027 + backend KYC gate removal
2. Mobile KYC gate removal + badge rendering
3. Migration 0028 + offer v2 backend
4. Mobile offer v2 UI + chat module deletion
5. Migration 0029 + hybrid logistics backend + admin hub tab
6. Mobile transaction tracking UI + FE app delivery leg
7. End-to-end QA + admin training

## 10. Post-Sprint 6 — immediate follow-ups

**Sprint 7 shortlist (pick 1):**
- Real Shiprocket/Delhivery courier integration
- Pickup point partnerships (signed contracts first, then code)
- Return flow (buyer initiates return, FE picks up, seller refund)
- Real SMS OTP (replace dev-mode / whitelist)
- Real KYC partner (Digio/Signzy integration)

**Sprint 8:** deploy to Railway/AWS (if not already done between 6 and 7)

---

## Spec-level open questions (flag for next review)

1. Does the "buyer sees verified sellers first" ranking apply to search results, category browse, or both? Assuming both.
2. When a verified seller's KYC expires (re_verification_required state), does the badge disappear? Assume yes, reverts to unbadged until re-verified.
3. Pricing/fees: does Sprint 6 change anything about platform fees or TDS? Assume NO — unchanged from Sprint 5 baseline.
4. FE delivery earnings: is delivery leg paid same as pickup leg, or different rate? Current code has single "visit fee" — propose extending to `pickup_fee` and `delivery_fee` with admin-configurable rates. Flagged for Sprint 7 finance work.

---

**Spec lock date:** today
**Code start date:** upon Sunil's go-ahead
**Expected ship:** today + 7 calendar days
