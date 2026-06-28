# Owmee Direct Acquisition Flow

Owmee Direct is a controlled acquisition transaction for MVP Toys and Books.
It is not an informal pickup and not the legacy seller-buyer marketplace flow.

## Product Rule

Seller sells to Owmee. Owmee assigns a Field Executive. The FE works only from a
system booking in the FE app. Seller payout goes only to the linked Owmee seller
account. Warehouse and Admin approval are required before the item can become
buyer-facing inventory.

## Lifecycle

```text
seller accepts Owmee offer
→ seller books pickup address and slot
→ direct_acquisition_booking is created with item manifest
→ Ops or auto-assignment assigns FE
→ FE opens assigned booking in FE app
→ FE starts visit
→ seller OTP/QR verification
→ per-item pickup photos and QC
→ item accept/revise/reject
→ >10% price increase requires admin approval
→ seller final payout acceptance
→ seller account ledger credit
→ handover completed
→ warehouse inbound
→ admin listing approval
→ buyer-facing listing can go live
```

## Hard Blocks

- No FE assignment without seller, address, slot, manifest, ownership declaration, and serviceability.
- No FE QC before seller OTP/QR verification.
- No payout for rejected items.
- No payout without QC, pickup photos, seller final acceptance, and positive final payout.
- No seller final acceptance while any manifest item is still pending QC or approval.
- No FE price increase above the configured threshold without admin approval.
- No FE price revision without pickup evidence photos.
- No handover before seller-account ledger payout is posted.
- No buyer-facing live listing before warehouse inbound and Admin approval.
- No offline booking, cash, manual UPI, or unsupported extra-item acquisition.

## MVP Data Model

- `direct_acquisition_bookings`: one FE visit/acquisition transaction.
- `acquisition_items`: one or more Toys/Books items inside the booking manifest.
- `price_override_approvals`: supervisor/admin approvals for price increases above FE threshold.
- `seller_account_ledger_entries`: internal Owmee seller-account payout credits.

`seller_account_id` currently uses the seller user id as a stable account surrogate until a dedicated
seller account table lands.

## FE App Focus

The FE app must make the workflow obvious:

1. Assigned Direct bookings are separated from legacy Concierge visits.
2. Booking detail shows seller address, slot, manifest, suggested payout, warnings, and progress.
3. FE cannot proceed with QC until seller verification succeeds.
4. Each item shows clear Accept, Revise, Reject states.
5. The final payout summary requires seller OTP confirmation before triggering ledger payout.
6. Handover is only enabled after payout is posted.

## Follow-Up Scope

The current implementation adds the controlled booking/FE/Ops/Admin spine. It does
not yet add seller-side Direct offer creation UI, masked seller calling, map launch,
extra-item add during visit, real seller-account payout rails, or warehouse SKU
generation UI. Those remain launch-critical follow-ups before Owmee Direct can run
outside internal pilots.
