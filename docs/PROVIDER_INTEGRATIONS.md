# Provider Integrations

Owmee code should call app-level adapters, not third-party SDKs directly. This keeps vendor changes local and makes integrations plug-and-play.

## Active Provider Switches

| Capability | Env switch | Adapter module | Current provider |
| --- | --- | --- | --- |
| AI listing assist | `AI_PROVIDER` | `app.modules.ai_assistant.provider` | `gemini` |
| SMS OTP | `SMS_PROVIDER` | `app.modules.identity_auth.sms_adapter` | `mock`, `msg91` |
| Payment aggregator | `PA_PROVIDER` | `app.modules.payments.adapter` | `mock`, `razorpay` |
| KYC | `KYC_PARTNER` | `app.modules.kyc.adapter` | `mock`, `digio` |
| Reverse geocoding | `GEOCODING_PROVIDER` | `app.modules.geo.provider` | `photon` |
| Push notifications | `PUSH_PROVIDER` | `app.modules.notifications.push_adapter` | `noop`, `fcm` |

## Integration Rule

Business logic should import only the adapter/factory for the capability:

- AI listing routes call `ai_assistant.provider`, never `gemini_client`.
- Auth routes call `sms_adapter`, never MSG91 directly.
- Offer/transaction flows call `payments.adapter`, never Razorpay directly.
- Address routes call `geo.provider`, never Photon directly.
- Notification service calls `push_adapter`, never FCM directly.

## Swapping A Provider

1. Add a new adapter class in the module for that capability.
2. Return it from the factory when its env switch is selected.
3. Map provider-specific payloads into existing Owmee response/result types.
4. Add a provider-boundary test in `backend/tests/test_provider_boundaries.py`.
5. Keep database field changes separate from provider swaps unless the domain model truly changes.

## Production Guardrail

Unknown or empty providers now fail fast with a clear error. Explicit `mock` mode is still supported for private/staging environments, but production should never silently fall back to a fake integration because credentials are missing.
