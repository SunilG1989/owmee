# Owmee E2E Product and Operations Flow Design

Version: 2026-06-29

## 1. Scope

This document describes the complete Owmee end-to-end flow across buyer,
seller, FE, admin, finance, warehouse, and provider systems. It covers happy
paths, negative paths, state transitions, and launch-critical edge cases.

Non-goals:

- Buyer/seller chat.
- Buyer/seller meetup.
- Free-form Make Offer notes.
- Offline FE cash/UPI collection.

## 2. Actors

| Actor | Responsibilities |
| --- | --- |
| Buyer | Browse, wishlist, offer/buy, pay, track, accept delivery, request return/dispute |
| Seller | Create listing, confirm listing facts, respond to offer, confirm readiness, complete payout/KYC when needed |
| FE | Visit seller, verify seller, inspect item, capture proof, deliver/return when assigned |
| Ops admin | Assign FE, route hub items, monitor stuck workflows, handle exceptions |
| Risk/admin | Review fraud decisions, reports, disputes, blocks |
| Finance | Release/refund/payout queues, direct acquisition payout ledger |
| Warehouse/admin | Receive direct acquisition custody, quarantine mismatch, approve buyer-facing inventory |
| Providers | MSG91, Razorpay, Gemini, Bureau, KYC, R2, geo, FCM/noop |

## 3. Flow A - User Onboarding

```text
User enters phone
  -> API sends OTP through configured SMS adapter
  -> User verifies OTP
  -> API creates/updates user/session/device
  -> Address gate checks saved address state
  -> User can browse, list, offer, or buy
  -> Fraud check may run in background
```

Positive cases:

- Returning user with saved address goes directly into the app.
- New user without address is sent through address capture.
- OTP send failure deletes stored OTP so an undelivered code cannot be used.

Negative cases:

- Invalid OTP fails.
- Expired OTP fails.
- MSG91 delivery failure returns `OTP_DELIVERY_FAILED`.
- Production OTP whitelist cannot bypass MSG91 login.
- Risk decision can step up or block sensitive actions later.

## 4. Flow B - Address And Location

```text
User grants location or searches manually
  -> reverse geocode provider returns structured address
  -> app validates address shape
  -> user confirms address details
  -> backend stores user address
```

Important rules:

- Address responses must be shaped and retryable.
- Backend failures must propagate so the app can show recovery.
- Transaction logistics uses immutable snapshots, not mutable current address.

## 5. Flow C - AI Listing Creation

```text
Seller chooses sell flow
  -> uploads 3+ photos
  -> direct R2 upload session is created
  -> worker analyzes photos with Gemini
  -> draft becomes ready
  -> seller reviews buyer-visible facts
  -> seller completes required P0 checks
  -> backend validates same requirement contract
  -> listing publishes or enters moderation as policy requires
```

P0 fields:

- Photos.
- Category.
- Title.
- Price.
- Condition.
- Defect/missing-parts/safety disclosure.
- Locality and pickup/delivery method.
- Category-specific fields.
- Working or battery status where relevant.

Category-specific gates:

- Toys: age, hygiene, parts, safety, checklist, battery/working status when
  powered.
- Books: type, language, page condition, markings, completeness, set/class/
  board/edition where needed.
- Appliances: appliance type, working status, accessories, defects, pickup
  complexity for bulky/install-heavy items.
- Devices: brand/model/storage/RAM/identifier/accessory and condition facts.

Negative cases:

- Stock/catalog-only image blocks or forces review.
- Multiple unrelated products blocks or forces review.
- Private info, faces, cards, chats, UPI IDs, documents are safety blockers.
- Generic titles such as "Other Pink" are not acceptable.
- Vague negative disclosures need buyer-facing detail.
- Low-confidence P0 values require seller confirmation.

## 6. Flow D - Listing Moderation And Seller Inventory

```text
Listing created
  -> status active or moderation queue
  -> seller inventory reads listing plus latest transaction state
  -> buyer feed reads active buyer-facing listings
```

Seller inventory labels:

- Active: seller can manage listing.
- Payment pending: listing hidden/reserved while buyer payment attempt exists.
- Seller confirmation required: captured payment needs readiness.
- Pickup pending: seller confirmed readiness and pickup can be assigned.
- Sold/completed: show sold timestamp and order history.

Negative cases:

- Payment failure/cancel/timeout returns listing to available when safe.
- Captured payment must keep listing hidden/reserved.
- Lazy repair scopes to the seller and rolls back on failure.

## 7. Flow E - Browse, Search, Wishlist

```text
Buyer opens home/search
  -> API returns feed/listing cards
  -> buyer opens listing detail
  -> buyer can wishlist, offer, or buy
```

Rules:

- Listing detail must not call expensive providers.
- Trust labels must be precise: phone verified, identity verified, Owmee
  reviewed, seller confirmed, FE inspected.
- No "unverified" negative framing.
- No buyer-seller chat entry points.

## 8. Flow F - Make Offer

```text
Buyer makes one active offer
  -> seller accepts, rejects, or counters
  -> buyer can update own price up to 3 times before seller response
  -> counter can be accepted or rejected
  -> accepted offer leads to transaction/payment
```

Rules:

- One active offer per buyer/listing.
- Seller counter expires after 48 hours.
- No re-counter.
- Reject/expiry can trigger buyer cooldown.
- Offer history is the structured communication record.

Negative cases:

- Duplicate active offer is rejected.
- Update limit is enforced.
- Counter expiry is enforced at accept time.
- Invalid status transitions are rejected.

## 9. Flow G - Buy Now And Payment

```text
Buyer taps Buy Now
  -> backend creates offer/reservation/transaction/payment attempt
  -> listing becomes reserved/payment_pending
  -> mobile opens Razorpay in-app checkout
  -> success path verifies signature, order, amount, and captured status
  -> Razorpay webhook can also capture the payment
  -> transaction moves to payment_captured
```

Positive cases:

- Client confirmation verifies Razorpay signature.
- Webhook is signed and idempotent.
- Amount must match expected transaction amount.
- Already captured transaction returns idempotent success.

Negative cases:

- Invalid signature rejected.
- Underpayment rejected.
- Authorized but not captured waits for webhook.
- Payment failed releases inventory.
- Duplicate failure is idempotent.
- Cancelled unpaid transaction releases inventory only for owner.
- Late capture after cancel does not reopen sale.
- Capture after payment window expires releases and refunds.
- Timeout job releases stale unpaid attempts.

## 10. Flow H - Seller Readiness

```text
Payment captured
  -> seller readiness task opens
  -> seller confirms item available, condition unchanged, accessories,
     pickup address, and pickup slot/readiness
  -> admin can assign pickup
```

Rules:

- Readiness is structured, not chat.
- Admin pickup assignment requires readiness confirmed.
- Seller decline cancels/suppresses listing and refunds buyer.
- Missed readiness deadline goes to expiry/refund/ops review.

Negative cases:

- Payment captured without buyer address holds ops flow.
- Seller readiness confirm mutates only structured state.
- Seller decline triggers refund path and support evidence.

## 11. Flow I - Admin Pickup Assignment

```text
Admin pickup queue
  -> assign eligible FE
  -> FE sees assigned pickup
  -> FE starts route
```

Rules:

- FE must be active, trained, verified, device-approved where required, and
  certified for the category.
- Suspended or terminal FE profiles cannot receive work.
- Rebound devices deactivate FE until admin reapproval.

## 12. Flow J - FE Pickup And Inspection

```text
FE reaches seller
  -> verifies seller/arrival where applicable
  -> captures item proof
  -> checks item against listing snapshot
  -> pass moves item to hub custody
  -> fail triggers refund/rejection path
```

FE proof examples:

- Pickup photos.
- Condition notes.
- Accessories checklist.
- IMEI/serial for applicable devices.
- Safety and missing-parts checks for toys/books/appliances.

Negative cases:

- FE cannot complete pickup before assignment.
- FE cannot skip seller verification where required.
- Pickup fail refunds buyer and preserves evidence.
- Payout activity refuses release before pickup confirmation.

## 13. Flow K - Hub Routing

```text
Item at hub
  -> admin routes to FE delivery or courier
  -> FE delivery assigned or courier AWB/status entered
```

Launch rule:

- Admin manually chooses route during pilot.
- Courier integration can be stub/manual while real integration is pending.
- Admin routing decision should be audited.

## 14. Flow L - Delivery And Buyer Acceptance

```text
FE/courier delivers item
  -> delivery proof captured
  -> buyer tracking timeline updates
  -> buyer accepts or window expires
  -> payout can become release-eligible if seller payout/KYC checks pass
```

Rules:

- Delivery completion still holds payout until buyer confirmation or window
  expiry/dispute resolution.
- Buyer acceptance is separate from FE delivery proof.
- Buyer can request return/dispute through structured flow.

## 15. Flow M - Refunds, Returns, And Disputes

```text
Buyer initiates issue
  -> KYC/risk policy may require step-up
  -> evidence upload requested
  -> admin/risk reviews
  -> refund/return/dispute decision updates transaction and payout path
```

Rules:

- Buyer KYC is invoked for refund/return/dispute escalation.
- Dispute evidence comes from structured records, FE proof, delivery proof,
  snapshots, and payment events.
- No chat archive exists because chat is not part of Owmee.

Negative cases:

- Return without evidence can be held or rejected.
- Duplicate refund must be idempotent.
- Refund retries must not double refund.
- Dispute resolution must move money through the shared payment/refund path.

## 16. Flow N - Seller Payout

```text
Pickup passes
  -> payout processing can start
  -> seller payout/KYC status checked
  -> delivery and acceptance/dispute window complete
  -> payout release can occur
```

Rules:

- Payment capture alone does not release payout.
- Pickup pass starts processing only after Owmee validates custody.
- Unverified seller is prompted to complete payout verification.
- `payout_released_at` stays empty until all gates pass.

## 17. Flow O - Owmee Direct Acquisition

```text
Seller accepts Owmee Direct offer
  -> seller books address/slot and manifest
  -> ops assigns FE
  -> FE starts, arrives, verifies seller OTP/QR
  -> FE item photos and QC
  -> revise/reject/accept per item
  -> admin approval needed for high price increase
  -> seller final OTP acceptance
  -> FE requests payout-ready
  -> finance posts seller ledger credit
  -> warehouse receives custody
  -> admin approves buyer-facing listing
```

Negative cases:

- No offline booking.
- No QC before arrival verification.
- No price revision without evidence.
- No >10 percent price increase without admin approval.
- No payout for rejected items.
- No seller final acceptance while item QC is pending.
- FE cannot post payout.
- FE cannot complete warehouse handover.
- Warehouse mismatch quarantines payable items.
- Buyer-facing listing requires warehouse inbound and linked draft listing.

## 18. Flow P - FE Onboarding

```text
Admin creates/invites FE
  -> FE logs in through phone OTP
  -> FE binds device
  -> Admin completes verification, training, category certification
  -> FE checks in to shift
  -> FE can receive work only when ready
```

Blocks:

- Candidate FE cannot be assigned.
- Wrong category certification blocks assignment.
- Device rebind deactivates until admin reapproves.
- Suspended FE cannot shift or receive work.
- Terminal FE cannot bind device.

## 19. Flow Q - Notifications

Notification buckets stay transaction-oriented:

- Payment captured.
- Seller readiness needed/confirmed/declined.
- Pickup assigned/completed/failed.
- Hub routed.
- Delivery assigned/completed.
- Refund/return/dispute updates.
- Payout verification needed/released.

No notification should invite buyer/seller free-form messaging.

## 20. State Machine Summary

| Stage | Typical state | Owner | Next positive transition | Failure transition |
| --- | --- | --- | --- | --- |
| Listing | active | Seller/system | reserved | withdrawn/rejected |
| Payment | payment_pending | Buyer/Razorpay | payment_captured | payment_failed/cancelled/expired |
| Readiness | seller_readiness_pending | Seller | seller_ready | seller_declined/expired_refund |
| Pickup | pickup_assigned | Admin/FE | pickup_completed | pickup_rejected_refund |
| Hub | at_hub | Admin | delivery_assigned/courier_routed | ops_hold |
| Delivery | delivery_in_progress | FE/courier | delivered | delivery_issue |
| Acceptance | delivered | Buyer/system | completed | return/dispute |
| Payout | payout_processing | Finance/provider | payout_released | payout_blocked/manual_review |

## 21. Core P0 Regression Checklist

- OTP login works with MSG91 or mock mode as configured.
- New user address gate blocks until valid address exists.
- AI listing draft can be created through async R2 upload.
- Seller review blocks missing P0 category requirements.
- Listing publish stores seller review snapshot.
- Buyer can browse active listing.
- Offer rules enforce duplicate/update/counter limits.
- Buy-now reserves listing and creates payment attempt.
- Razorpay success verifies signature and amount.
- Payment failure/cancel/timeout releases inventory.
- Captured payment opens seller readiness, not pickup directly.
- Seller decline refunds and suppresses listing.
- Admin cannot assign pickup before readiness.
- FE pickup pass/fail updates transaction correctly.
- Payout is not released before pickup and delivery gates.
- Buyer tracking timeline reflects payment/readiness/pickup/delivery.
- Return/dispute path requires structured evidence and policy.
- Direct acquisition cannot bypass FE/finance/warehouse/admin gates.
- FE onboarding blocks unready/suspended/wrong-category FE assignment.

## 22. Current Test Coverage Anchors

| Area | Test files |
| --- | --- |
| Order/logistics contracts | `test_order_e2e_contract.py` |
| Checkout/payment failure/timeout | `test_checkout_payment_flow.py` |
| Direct acquisition functional gates | `test_direct_acquisition_functional.py`, `test_direct_acquisition_flow.py` |
| FE onboarding gates | `test_fe_onboarding.py` |
| Category requirements | `test_listing_category_requirements.py` |
| AI prompt safety/performance | `test_ai_prompt_contracts.py`, `test_ai_vision_strategy.py` |
| Verification policy | `test_verification_flow_contracts.py`, `test_verification_policy.py` |
| MSG91 adapter | `test_sms_msg91_adapter.py`, `test_msg91_probe_script.py` |

## 23. Open Launch Risks To Track

- Courier provider integration can remain manual for pilot, but SLA and AWB
  ownership must be explicit.
- Real payment settlement/payout provider reconciliation needs finance runbook.
- FE fraud controls should be monitored with geofence, device binding, evidence,
  issue reporting, and admin audit trails.
- Legacy design-system allow-list still exists in mobile; new screens must not
  add drift.
- AI output quality should be monitored by prompt version, category, correction
  rate, and seller edit rate.
