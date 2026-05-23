# Verification Architecture

Owmee treats verification as a trust ladder, not a single `verified` boolean.
Each provider answers one narrow question, and Owmee's own policy layer decides
what a user can do.

## Provider Roles

| Layer | Provider | Question answered |
| --- | --- | --- |
| Phone ownership | MSG91 | Does this user control this mobile number? |
| Fraud/risk | Bureau | Is this signup/device/user pattern risky? |
| Legal identity | KYC partner | Does this user pass Aadhaar/PAN/liveness/payout checks? |
| Product trust | Owmee | Can this user publish, buy, receive payout, or get a badge? |

Do not collapse these into one label. OTP is not KYC. KYC is not item review.
Fraud screening is not a seller/listing guarantee.

## Core Tables

`verification_checks` stores provider-neutral check records:

- `phone_otp` via MSG91
- `bureau_fraud` via Bureau
- future `aadhaar`, `pan`, `liveness`, `payout` mirrors if needed

It stores provider references, status, risk band, reason codes, expiry, and
scrubbed metadata only. Never store raw Aadhaar, OTP, full PAN, or full bank
account numbers here.

`risk_decisions` stores Owmee's product decision:

- `allow`
- `step_up`
- `manual_review`
- `block`

Product routes should consume this decision model instead of reading vendor
payloads directly.

`allow` decisions are audit evidence only. Runtime policy must only treat
`step_up`, `manual_review`, and `block` as active gates so an old/specific
allow record can never hide a broader fraud block or manual review.

## Runtime Flow

```text
OTP verify
  -> create/update user as otp_verified
  -> record phone_otp verification check
  -> return tokens immediately
  -> run Bureau onboarding fraud check in background
  -> store bureau_fraud check + risk_decision
```

The signup path must remain fast. Bureau/KYC latency must not block OTP login.

## Action Policy

Use `app.modules.verification.service.evaluate_user_action(...)` for
trust-sensitive actions.

| Action | Minimum policy |
| --- | --- |
| Browse | Public |
| Draft listing | OTP verified |
| Publish normal listing | OTP verified + Bureau low-risk/pass |
| Publish smartphone/laptop/tablet/high-value listing | Bureau pass + seller KYC |
| Buy/pay | Bureau pass; KYC step-up for high-risk/high-value |
| Payment webhook | Re-check buyer policy before delivery starts |
| Payout | Bureau pass + PAN + payout account verification |
| Phone change after KYC | New OTP + Bureau rerun |

The policy function is intentionally DB-only. It must not call Bureau, MSG91,
KYC, payment, or notification providers inline.

Critical transitions (`publish`, `buy`, `payment_webhook`, `payout`) should
write policy evidence through `record_action_policy_decision(...)` with the
listing/transaction context. This gives support a timestamped answer to
"what did Owmee know when this happened?"

## Manual Review

Risk analysts use `/v1/admin/verification/risk-queue` to see active
`step_up`, `manual_review`, and `block` decisions. Admin overrides are written
as provider-neutral `manual_risk_review` checks plus action-scoped
`risk_decisions`.

Duplicate payout account references are treated as a mule-account signal:
payout release goes to manual review without exposing another user's account
details.

## Performance Rules

- No vendor calls from home feed, listing detail, search, or normal navigation.
- OTP send is the only critical-path SMS call.
- Fraud checks run in background after OTP verification.
- KYC checks run only inside explicit user verification flows.
- Product routes read cached DB decisions and return clear step-up states.

## KYC Name Match Rule

Owmee should not infer Aadhaar/PAN name match locally unless the full source
names are available in the same secure provider workflow. Because the app does
not store full Aadhaar names, a missing provider-side name-match result must
fall to `manual_review`, not `pass`.

## Buyer/Seller Labels

Never show a blanket "Verified seller" unless the seller actually holds the
matching trust state. Prefer precise labels:

- Phone verified
- Fraud screened
- Identity verified
- Payout verified
- Owmee reviewed
- Seller confirmed
- AI-assisted

Buyer/seller chat is not part of Owmee and should not be introduced as a
verification workaround.

## Provider Configuration

Relevant environment switches:

- `SMS_PROVIDER=msg91`
- `FRAUD_PROVIDER=bureau`
- `KYC_PARTNER=...`
- `FRAUD_API_BASE_URL`
- `FRAUD_API_KEY`
- `FRAUD_ONBOARDING_PATH`
- `FRAUD_TIMEOUT_SECONDS`
- `FRAUD_DECISION_VALID_DAYS`
- `FRAUD_ENFORCEMENT_ENABLED`

`FRAUD_PROVIDER=mock` is allowed for local/private testing. Production should
switch to Bureau once credentials and the final endpoint contract are confirmed.
