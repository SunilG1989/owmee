# Owmee Seller Payouts — Settlement Model & Ledger

Version: 2026-08-12 (v1 design + implementation)

## 1. Why this exists

Before this work, Owmee had payout *bookkeeping* but no payout *capability*:

- `payout_flagged_at` was set at FE pickup and `net_payout`/TDS were computed,
  but **nothing ever set `payout_released_at`** — no endpoint, no worker, no
  admin surface.
- The seller's payout destination (UPI VPA / bank account) was **discarded**
  after Digio verification; only the opaque partner ref was stored. Even a
  manual payout had nothing on file to pay into.
- There was no marketplace ledger (the only `SellerAccountLedgerEntry` table
  belongs to Owmee Direct acquisitions), no finance queue, no seller-visible
  earnings/payout state, and no netting for refunds after payout.

## 2. Benchmark: how the bar is set

| Practice | Amazon | Flipkart / Meesho | Owmee v1 |
| --- | --- | --- | --- |
| Reserve until buyer-protection window closes | DD+7 delivery-date reserve; funds "Released" only after the 7-day window | T+7 from delivery before settlement | Payout **eligible** only at `completed` / `auto_completed` (buyer confirm or 48h auto-complete) |
| Settlement ledger visible to seller | Payments dashboard: Reserve → Available → Paid | Meesho: "Next Payout" + "Settled Payouts" + downloadable ledger | `GET /v1/me/payouts`: reserve balance, available balance, ledger entries, payout history |
| Deductions netted across cycles | Refunds deducted from future settlements | Meesho return deductions span 2–3 later cycles | `refund_clawback` ledger debit; negative balances net against future credits — refunds are never blocked on it |
| Idempotent, append-only ledger | (internal) | (internal) | `seller_ledger_entries` append-only, unique `reference_id` per business event, explicit reversal entries |
| Payout rail | ACH batch | NEFT/IMPS batches | v1: **manual rail** (finance records the bank/UPI transfer + UTR); adapter interface ready for RazorpayX/Route |

Design canon applied (Modern-Treasury-style): every balance is a *sum of
immutable entries*, never a mutable column; every posting is idempotent via a
unique reference; corrections are explicit reversal entries.

## 3. The settlement state machine

```
FE pickup passes            transaction completed /            finance releases
(custody milestone)         auto_completed (48h)               (manual rail v1)
        │                           │                                │
payout_flagged_at set     sale_credit posted to ledger      payout_debit posted
"processing" (reserve)    → seller's AVAILABLE balance      payout_released_at set
                          "payout_eligible" notification    UTR recorded, seller notified
```

- **Reserve balance** = Σ `net_payout` of transactions with `payout_flagged_at`
  set but no `sale_credit` yet (custody established, protection window open).
- **Available balance** = Σ ledger entries (credits − clawbacks − payouts).
  May be negative after a clawback; future credits net against it.
- A **return/refund completed after the sale credit** posts
  `refund_clawback` (idempotent per transaction). Refunds to buyers are never
  gated on the seller's balance.

## 4. Schema (migration `0052_seller_payouts`)

- `seller_payout_accounts` — the payout destination, captured at the KYC
  payout step (previously discarded). One active row per seller
  (`is_active` partial-unique). Stores `account_type` (upi|bank), the
  destination value (`vpa` / `account_number`+`ifsc`), a `masked_display`
  for every API surface, the Digio `provider_ref`, `verified_at`.
  APIs must only ever serialize `masked_display`.
- `seller_ledger_entries` — append-only. `entry_type` ∈
  {`sale_credit`, `refund_clawback`, `adjustment`, `payout_debit`},
  signed `amount_inr NUMERIC(12,2)`, unique `reference_id`
  (e.g. `sale:{txn_id}`, `clawback:{txn_id}`, `payout:{payout_id}`),
  `transaction_id`/`payout_id` links, `created_by`, `memo`.
- `seller_payouts` — one row per money-out event. `status` ∈
  {`recorded`, `failed`} in v1 (manual rail records after the transfer is
  made; an API rail adds `queued`/`processing`). Stores amount, method
  (`manual_bank`/`manual_upi`; `razorpayx` later), `payout_account_id`,
  `utr_reference` (bank UTR/UPI ref, required on manual), `initiated_by`
  (admin), `idempotency_key` unique.

## 5. Flows implemented

1. **KYC payout step** now persists the destination: masked display + value +
   provider ref into `seller_payout_accounts` (bank flow also forwards
   `ifsc_code`, which previously was accepted and dropped).
2. **Completion credits**: `buyer_confirm_deal` and the new
   **delivered-auto-complete sweeper** (`transactions/settlement_jobs.py`,
   registered in `workers/main.py` alongside the payment sweeper) post
   `sale_credit` idempotently and notify the seller (`payout_eligible`).
   The sweeper finally enforces the 48h window that the never-started
   Temporal `TransactionWorkflow` owned — delivered orders no longer stall
   forever.
3. **Refund clawback**: `mark_refund_completed` and return completion post
   `refund_clawback` iff a `sale_credit` exists for the transaction.
4. **Release (manual rail v1)**: finance admin (money-role, audited)
   uses the admin-web **Payouts queue** (`/admin/payouts`): sellers with
   available balance > 0 + verified payout account, masked destination,
   one-click "Record payout" with mandatory UTR after making the transfer.
   Backend: `POST /v1/admin/payouts/release` — row-locked, idempotent,
   posts `payout_debit`, stamps `payout_released_at` on the covered
   transactions, audit-logs, notifies the seller with amount + UTR.
5. **Seller visibility**: `GET /v1/me/payouts` returns reserve balance,
   available balance, payout account (masked), ledger entries, payout
   history. `_fmt_txn` now serializes `tds_withheld`, `net_payout`, and a
   derived `payout_status` (`processing` / `eligible` / `released`).
   Mobile: "Earnings & payouts" screen from Profile.

## 6. Explicitly deferred (v2+)

- **RazorpayX / Route API rail** — the `PayoutRail` adapter seam exists;
  flip `PAYOUT_RAIL=razorpayx` once keys + linked-account onboarding are
  ready. Route's hold-until-condition settlements map 1:1 to our
  reserve→available model.
- Scheduled settlement batches (Flipkart-style Mon/Wed/Fri) — v1 is
  on-demand from the finance queue; add a cron batch when volume warrants.
- TDS Form 16A / quarterly statements (engine already computes 194-O).
- Seller-level risk reserves (Amazon-style % holds) and payout account
  re-verification flows.
- Encrypting destination values at rest (beyond DB access controls) — do
  before scale; v1 masks on every API surface.
