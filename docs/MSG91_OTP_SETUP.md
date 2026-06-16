# MSG91 OTP Setup

Owmee uses MSG91 only for phone-login OTP delivery. The app still verifies the
OTP server-side from Redis, so MSG91 must receive the same OTP value that Owmee
stores for the login attempt.

## Required Render Values

Set these on both `owmee-api` and `owmee-worker` when SMS delivery is enabled:

- `ENV=production`
- `SMS_PROVIDER=msg91`
- `SMS_API_BASE_URL=https://control.msg91.com`
- `SMS_API_KEY=<MSG91 authkey>`
- `SMS_TEMPLATE_ID=<MSG91 OTP-section template id>`
- `SMS_SENDER_ID=<approved sender id>`
- `SMS_DLT_ENTITY_ID=<DLT entity id, if required by the account/template>`
- `SMS_MSG91_TIMEOUT_SECONDS=10`
- `SMS_MSG91_OTP_EXPIRY_MINUTES=10`

Do not leave `SMS_TEMPLATE_ID` or `SMS_API_KEY` empty. Production startup now
fails fast for empty or `REPLACE_WITH_...` MSG91 values.

## MSG91 Dashboard Checklist

1. In MSG91, use the OTP product area, not a campaign/marketing flow.
2. Create or select an OTP template.
3. The template must include the OTP placeholder `##OTP##`.
4. Use the template id from that OTP template as `SMS_TEMPLATE_ID`.
5. Confirm the sender id/header is approved and attached to the template.
6. Confirm the principal entity, sender/header, and OTP template are approved
   and propagated through the required India DLT/operator routes, including
   the networks users will test on such as Jio and Airtel.
7. Confirm the authkey is active and permitted for the OTP service.
8. If IP security is enabled on the authkey, allow Render outbound IPs or
   disable the IP restriction for this key.
9. Use MSG91 OTP reports/delivery reports to inspect rejected submissions,
   absent subscribers, template mismatch, or DLT failures.

## Runtime Behavior

- Development always uses the mock/fixed OTP path.
- Production with `SMS_PROVIDER=msg91` sends `POST /api/v5/otp` to MSG91.
- The authkey is sent in the `authkey` header rather than the query string.
- Owmee sends the generated OTP and an expiry matching the Redis OTP TTL.
- If MSG91 returns an error response, Owmee returns `OTP_DELIVERY_FAILED` and
  deletes the stored OTP so the user cannot verify an undelivered code.

## Common Failure Modes

- `SMS_TEMPLATE_ID` points to a regular SMS template instead of an OTP template.
- Template text lacks `##OTP##`.
- Sender id/header is not approved or not mapped to the template.
- DLT/operator approval has not propagated for a user network such as Jio,
  Airtel, or Vi, so MSG91 accepts the request but the operator blocks delivery.
- Authkey is disabled, scoped to the wrong service, or blocked by IP security.
- The phone number is not in international format with country code.
- MSG91 accepts the request but delivery fails later due DLT/operator status;
  inspect MSG91 reports using the request id from logs.
