# Architecture Amendment V3 — Owmee Product Pivot

This document amends `claude_architecture_prompt_patched.md` (v2) to reflect Sprint 6 product decisions. Every change below is a delta, not a rewrite. The full v3 architecture prompt will be generated after code lands and the model is proven in production.

---

## Amendment 1 — KYC model (section: "Core trust requirements")

### v2 text (to be replaced)

> Any user can browse. Nobody can transact until verified.
>
> Verification pipeline before transacting (buy or sell):
> 1. Mobile OTP
> 2. Aadhaar OTP-based verification through a licensed KYC partner
> 3. PAN verification — including a PAN-Aadhaar linkage status check
> 4. Name fuzzy match between Aadhaar and PAN
> 5. Selfie / liveness
> 6. Payout account or UPI verification
> 7. Risk checks

### v3 replacement

Any user can browse and transact with phone OTP alone. KYC is required at specific friction moments, not upfront.

**KYC NOT required for:**
- Registration / session establishment (phone OTP only)
- Listing creation (any category)
- Making offers, accepting offers, receiving offers
- Buying (including payment)

**KYC REQUIRED for:**
- **Seller:** requesting payout of accumulated earnings (existing behavior — unchanged)
- **Seller:** earning the "Verified by Owmee" badge + ranking boost (voluntary)
- **Buyer:** initiating refund, return, or dispute

**KYC flow (unchanged from v2 where it's required):**
1. Aadhaar OTP via partner
2. PAN verification + PAN-Aadhaar linkage check
3. Name fuzzy match
4. Selfie / liveness
5. For sellers requesting payout: bank/UPI account verification
6. Risk checks

**Minor detection, phone change policy, NRI policy:** unchanged from v2.

---

## Amendment 2 — Transaction modes (section: "Transaction modes")

### v2 text (to be replaced)

> 1. **Local Verified Exchange** — buyer and seller meet in person; payment is captured via UPI deep-link or in-app UPI flow; both parties confirm inside the app after exchange.
> 2. **Managed Shipped Exchange** — buyer payment is held via payment partner; item is picked up, inspected at pickup, shipped, and delivered; payout releases only after buyer acceptance or dispute window expiry.

### v3 replacement

**There is no personal meetup mode.** All transactions are logistics-managed by Owmee.

Every transaction follows this sequence:

**Pickup leg (always FE):**
- FE visits seller, picks up item, inspects against listing snapshot
- FE captures: verification photos, IMEI (phones), serial (laptops), condition notes, accessory checklist
- Pass → item enters Owmee hub routing
- Fail → pickup rejected, buyer auto-refunded, seller notified, FE still earns inspection fee

**Delivery leg (FE or courier, admin decides per transaction at launch):**
- **FE delivery:** FE (same or different from pickup FE) takes item to buyer, hands over, captures delivery handover photo + buyer acknowledgment
- **Courier delivery:** item handed to Shiprocket/Delhivery/Porter, AWB generated, buyer sees tracking
- Admin manually chooses mode for each transaction in Sprint 6 launch. Rules engine deferred to Sprint 7.

**Payout sequence:**
- Delivery confirmed
- Buyer acceptance window: 48 hours
- Buyer accepts OR window expires → payout becomes eligible
- Payout still requires seller KYC verified (unchanged)
- TDS withholding and GST line items apply as in v2

---

## Amendment 3 — Chat architecture (section: "Chat architecture")

### v2 text (to be deleted entirely)

The entire "Chat architecture" section from v2, including:
- Vendor selection (Stream/Sendbird/AppSync)
- Channel lifecycle
- Evidence preservation
- Abuse detection
- Off-platform pressure detection

### v3 replacement

**Chat is not part of Owmee's architecture.** Buyer and seller cannot send each other messages at any point in the transaction lifecycle.

All buyer-seller communication is structured:

| Communication need | Structured replacement |
|---|---|
| "Is this available?" | Real-time stock state on listing card. Auto-updated when reservations/sales occur. |
| "Will you take ₹X?" | **Make Offer** with a single price. Buyer can update price up to 3 times. Then seller responds: accept/reject/counter. |
| "Can you do better?" | Counter-offer mechanic. Seller counters once. Buyer accepts or walks. No re-counter. |
| "Where do we meet?" | No meetup exists. Owmee handles pickup + delivery. |
| "Hey is this legit?" | Trust signals: Verified badge, seller reputation score, FE inspection photos visible post-purchase. |

**Offer v2 precise rules (new in v3):**
- Buyer can create at most 1 active offer per listing at a time
- Buyer can update their offer price up to 3 times (`update_count <= 3`)
- After 3 updates, offer is locked — seller must respond
- Seller options: accept | reject | counter
- If seller counters: buyer accepts or rejects. No re-counter.
- If offer expires or is rejected: buyer in 7-day cooldown on that listing
- Counter-offer expiry: 48 hours

**Dispute evidence without chat:**
- Offer history is the transaction record (every price point, timestamp, who did what)
- FE pickup inspection photos and notes are immutable evidence
- FE delivery handover photo is immutable evidence
- No chat to archive because no chat exists

---

## Amendment 4 — Listing design constraints (section: "Listing design constraints")

### Addition to v2

Add the following to the existing section:

**Verified-by-Owmee badge and ranking boost:**
- `Listing.seller_kyc_verified` — computed field, true when listing's seller has `users.kyc_status = 'verified'`
- If true: listing card renders "Verified by Owmee" badge (green checkmark + shield icon)
- If false: no badge. No "unverified" label either — negative framing drives away new sellers
- Search/browse ranking: multiply composite score by 1.3 when `seller_kyc_verified = true`
- If seller's KYC enters `re_verification_required` state, badge is temporarily removed and ranking boost lost until re-verified
- Listing snapshot (at reservation time) records the seller's verification state at that moment, so a dispute doesn't inherit a later loss of badge

**Moderation bypass for verified sellers:**
- Verified sellers' listings skip the moderation queue and go live immediately
- Unverified sellers' listings enter moderation queue (existing behavior) with a 2-hour SLA target
- If moderation queue backs up, verified sellers still ship on time. This is a deliberate incentive.

---

## Amendment 5 — Category eligibility (section: "Category eligibility model")

### Addition to v2

In Sprint 6, **all categories are logistics-managed** (no local-only categories during launch).

The `local_eligible` column stays in the schema but is not exercised in Sprint 6. Every category with `shipping_eligible = true` (or items under it) uses the hybrid logistics flow. Bulky categories (future: furniture, large appliances) remain deferred until logistics can support them.

`local_eligible` will be revived in a future sprint if in-person pickup-point partnerships launch. For Sprint 6: ignore this flag.

---

## Amendment 6 — Hard architecture requirements (section: "Hard architecture requirements")

### Additions to v2

Append:

**Logistics as first-class subsystem.** Owmee operates the pickup-inspection-delivery pipeline, not just the marketplace. Field Executive (FE) inspection is non-negotiable at pickup — every item has human verification before funds move. This is the primary trust differentiator and must not be compromised even under volume pressure. If FE capacity is a bottleneck, listing throughput reduces before inspection quality reduces.

**Admin routing authority during pilot phase.** Transactions at `at_hub` state require an admin decision before proceeding to delivery. Admin chooses FE-delivery or courier-delivery per transaction. No automated routing rule is wired in Sprint 6 — this is a deliberate decision to gather routing intuition before coding rules.

**Courier abstraction.** The `courier` module exposes a thin adapter over real courier APIs (Shiprocket/Delhivery/Porter) but ships as a stub in Sprint 6. Admin enters AWB manually; status updates are admin-driven. Real courier integration is Sprint 7.

**Buyer identity minimization.** Buyers are not required to verify identity to transact. Device fingerprint, IP, and phone number are the sole identity signals pre-dispute. KYC is only invoked when the platform needs legally-attributable identity (refund disputes, return fraud investigations).

---

## Amendment 7 — What's unchanged from v2

For explicit clarity, these v2 decisions remain in effect:

- Postgres as source of truth
- Temporal for long-running workflows (including new hybrid-logistics state machine)
- Partner abstractions for KYC, payment, courier
- No Aadhaar storage (UIDAI compliance)
- DPDP consent capture before any KYC action
- TDS 194-O withholding at payout time
- GST on platform fees
- RBI Payment Aggregator for funds holding
- TRAI-compliant transactional SMS
- Modular monolith first, extraction path later
- Immutable event trail for every critical state transition
- Admin RBAC (L1/L2/Finance/Risk/Super Admin)
- SLOs as defined in v2

**What v2 said about chat and meetups is void. Everything else stands.**

---

## Amendment 8 — Top architecture decisions (section: "Top architecture decisions to freeze")

### v2 decision (to be replaced)

> 10. Local transactions must use UPI payment confirmation from payment partner, not self-reported confirmation.

### v3 replacement

10. **All transactions are logistics-managed.** No local meetup mode. Payment is held in PA nodal account until delivery confirmation. Self-reported payment confirmation does not exist as a flow.

### v3 additions

11. **Chat does not exist.** All buyer-seller communication is via structured offer mechanics. No free-form text exchange anywhere in the product.

12. **KYC is a badge, not a gate.** Except for payout (seller) and refund/return/dispute (buyer). Any other KYC gating is a step backward and must be justified in an ADR.

13. **Admin decides delivery routing during pilot.** FE or courier per transaction, manually, until at least 50 transactions are routed and a rule becomes obvious.

---

## Amendment 9 — Top mistakes to avoid (section: "Top 10 mistakes to avoid")

### v3 additions

Append to the v2 list:

11. **Re-adding chat after launch because support asks for it.** If users can't ask "is this available?", improve stock-state display. If they can't negotiate, improve the offer update UX. Chat solves support pain by creating 10x more support pain.

12. **KYC-gating a new user flow because it "feels safer".** Every unnecessary KYC gate kills funnel. Audit all KYC requirements quarterly — if a gate isn't tied to payout or refund/return/dispute, it needs a written justification.

13. **Auto-routing transactions to courier prematurely.** Cheap-at-scale hides inspection-failure cost. Use FE delivery for first 50 transactions minimum to ground-truth the model.

14. **Letting the "verified" badge become a negative framing ("unverified").** Missing badge is neutral. Present verification as an opt-in upgrade, never as a deficit to fix.

---

## Open amendment work (future sprints)

The following are acknowledged but deferred:

- **v3 search-and-ranking section:** the `1.3x` boost is a starter number. Once 500+ transactions are in the system, tune the boost to maximize both liquidity and quality. Sprint 8+.
- **v3 notification design:** with chat removed, notification becomes more important. Flesh out the notification spec for offer updates, counter-offers, FE pickup, FE delivery, courier tracking. Sprint 7.
- **v3 dispute state machine:** v2's state machine assumed chat evidence. Replace with offer-history + FE inspection evidence. Sprint 7.
- **v3 FE earnings model:** v2 implied single-visit fee. With delivery leg, we need `pickup_fee` and `delivery_fee` separately. Sprint 7 finance work.

---

**Amendment status:** to be merged into `claude_architecture_prompt_patched.md` as v3 once Sprint 6 ships. Until then, this delta document is authoritative.
