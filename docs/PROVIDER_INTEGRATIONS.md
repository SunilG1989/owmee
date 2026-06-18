# Provider Integrations

Owmee code should call app-level adapters, not third-party SDKs directly. This keeps vendor changes local and makes integrations plug-and-play.

## Active Provider Switches

| Capability | Env switch | Adapter module | Current provider |
| --- | --- | --- | --- |
| AI listing assist | `AI_PROVIDER` | `app.modules.ai_assistant.provider` | `gemini` |
| SMS OTP | `SMS_PROVIDER` | `app.modules.identity_auth.sms_adapter` | `mock`, `msg91` |
| Fraud/risk decisioning | `FRAUD_PROVIDER` | `app.modules.verification.fraud_adapter` | `mock`, `bureau` |
| Payment aggregator | `PA_PROVIDER` | `app.modules.payments.adapter` | `mock`, `razorpay` |
| KYC | `KYC_PARTNER` | `app.modules.kyc.adapter` | `mock`, `digio` |
| Reverse geocoding | `GEOCODING_PROVIDER` | `app.modules.geo.provider` | `photon` |
| Push notifications | `PUSH_PROVIDER` | `app.modules.notifications.push_adapter` | `noop`, `fcm` |

## Integration Rule

Business logic should import only the adapter/factory for the capability:

- AI listing routes call `ai_assistant.provider`, never `gemini_client`.
- Auth routes call `sms_adapter`, never MSG91 directly.
- Signup/action policy calls `verification.service`, never Bureau directly.
- Offer/transaction flows call `payments.adapter`, never Razorpay directly.
- Address routes call `geo.provider`, never Photon directly.
- Notification service calls `push_adapter`, never FCM directly.

## Swapping A Provider

1. Add a new adapter class in the module for that capability.
2. Return it from the factory when its env switch is selected.
3. Map provider-specific payloads into existing Owmee response/result types.
4. Add a provider-boundary test in `backend/tests/test_provider_boundaries.py`.
5. Keep database field changes separate from provider swaps unless the domain model truly changes.

## Verification Policy

Verification is deliberately layered:

- MSG91 proves phone ownership.
- Bureau provides fraud/risk signals.
- KYC partners prove legal identity, liveness, PAN, and payout account status.
- Owmee policy decides whether the user can publish, buy, receive payout, or needs manual review.

Use `app.modules.verification.service.evaluate_user_action(...)` for trust-sensitive actions.
Do not call provider APIs from product screens or high-traffic read endpoints.
See [VERIFICATION_ARCHITECTURE.md](VERIFICATION_ARCHITECTURE.md) for the full model.

## Razorpay Payment Contract

Owmee currently uses Razorpay Payment Links for buyer collection. The app creates the link through `app.modules.payments.adapter`, then trusts only signed Razorpay webhooks to advance the transaction.

Production Razorpay mode requires:

- `PA_PROVIDER=razorpay`
- `PA_KEY_ID`
- `PA_KEY_SECRET`
- `PA_WEBHOOK_SECRET`

Configure the Razorpay dashboard webhook URL to:

```txt
https://<api-host>/v1/payments/webhook/razorpay
```

Enable these events:

- `payment_link.paid`
- `refund.processed`
- `refund.failed`

Do not use the Payment Link `callback_url` as the webhook. Razorpay treats `callback_url` as the buyer browser redirect after checkout; webhooks are configured separately in the dashboard and signed with `X-Razorpay-Signature`.

Refund retries use Razorpay's `X-Refund-Idempotency` header so a network retry cannot double-refund the buyer.

Seller payout is deliberately not released when the buyer pays. Payout processing starts only after Owmee pickup/inspection succeeds:

1. Buyer payment captured: move to seller readiness and notify the seller to confirm pickup.
2. Seller confirms readiness: allow Owmee ops to assign pickup.
3. FE pickup passes inspection: item moves to hub custody and seller payout processing starts.
4. If the seller payout account/KYC is not verified, notify the seller to complete payout verification; `payout_released_at` must remain empty.
5. Delivery completes: buyer gets the confirmation/dispute window; payout processing continues.
6. Buyer confirms, auto-complete fires after the window, or a dispute resolves to seller release: ops/provider settlement can release the already-processing payout after seller payout/KYC checks.

## Production Guardrail

Unknown or empty providers now fail fast with a clear error. Explicit `mock` mode is still supported for private/staging environments, but production should never silently fall back to a fake integration because credentials are missing.
