# AI Draft Photo Analysis Pipeline

Owmee listing photo analysis is intentionally split so the API does not hold
multiple original photos in memory.

## Flow

1. Mobile calls `POST /v1/listings/draft/uploads/request` with the number of
   photos.
2. API creates a `listing_drafts` row in `uploading` status and returns
   short-lived R2 presigned PUT URLs.
3. Mobile uploads each photo directly to R2.
4. Mobile calls `POST /v1/listings/draft/{draft_id}/analysis/start`.
5. API validates ownership and draft image keys, then writes a Redis Stream
   job and marks the draft `processing`.
6. Worker downloads one photo at a time, checks object size before download,
   normalizes photos for Gemini, creates display/thumb variants, runs the
   configured Gemini draft strategy, estimates price without a second text-LLM
   fallback, and marks the draft `open`.
7. Mobile polls `GET /v1/listings/draft/{draft_id}/analysis/status` until the
   draft is `ready`, `failed`, or `expired`.
8. Mobile review derives the deterministic `category_family` requirement layer
   (`device`, `appliance`, `toy`, `book`, `other`) from the launch
   `category_slug`, item type, and title.
9. Seller confirms family-specific buyer facts before publishing. Books,
   toys/kids items, and home appliances use compact local choice sets; no
   extra LLM call is made.
10. Backend re-derives and validates the same category-family requirements in
    `POST /v1/listings/from-draft`, then persists seller-confirmed facts in
    `listings.seller_review_snapshot`.

## Scaling Rules

- API work stays small: database row, R2 signed URL, Redis enqueue.
- Worker concurrency is controlled by `AI_DRAFT_ANALYSIS_WORKER_CONCURRENCY`.
- Redis Stream retries are bounded by `AI_DRAFT_ANALYSIS_RETRY_MAX_ATTEMPTS`.
- Oversized uploads are rejected by the worker before downloading the body.
- Final retry exhaustion marks the draft `failed`, so the app does not poll
  forever.
- Mobile falls back to the bounded multipart endpoint when an older API build
  does not expose async routes yet, or when the phone cannot reach the
  presigned R2 PUT URL because of storage endpoint configuration.

## Operational Notes

- `owmee-api` and `owmee-worker` must both be deployed for the async path.
- Keep `WEB_CONCURRENCY=1` on small Render instances.
- Increase worker count or concurrency only when memory metrics are healthy.
- The first Gemini pass is intentionally small: low media resolution, compact
  schema, no MRP/deep copy enrichment, and no serial text-pricing fallback before
  the draft becomes ready.
- Fast vision is behind `AI_DRAFT_FAST_PATH_ENABLED`. Low-confidence fast
  results fall back to full vision when `AI_DRAFT_FULL_FALLBACK_ENABLED=true`.
  Fast results with safety blockers such as private info, stock/catalog image,
  no product, or multiple items are not silently cleared by full fallback.
- When full fallback is disabled or fails, weak fast results are marked for
  seller review instead of being treated as publish-ready AI output.
- `AI_DRAFT_SHADOW_FULL_ANALYSIS_ENABLED` can run full vision beside a fast
  result and persist comparison metadata in `provider_metrics`. Keep this off
  by default because it adds an extra Gemini call.
- `AI_DRAFT_FAST_MIN_CATEGORY_CONFIDENCE` controls when category confidence is
  considered too weak for fast-only handling.
- Worker logs include queue wait, image processing, Gemini vision, pricing,
  persistence, and total timings so production latency can be traced by stage.
- Gemini calls also emit durable provider instrumentation. `ai_analysis_artifacts`
  captures latency, input/output/cached token counts, model, prompt version, and
  a `provider_metrics` JSON block with total/thought tokens and media settings
  when the SDK returns them.
- Category-specific requirements for toys, books, and home appliances are
  intentionally deterministic. Gemini may pre-fill `category_family` and
  `category_specifics`, but backend and mobile do not trust the LLM alone; the
  seller must confirm required facts before publish. See
  `docs/LISTING_CATEGORY_REQUIREMENTS.md`.
- The legacy multipart endpoint remains for development fallback, but new app
  builds should use direct R2 upload plus async analysis.
- `R2_PUBLIC_ENDPOINT` must be the S3 API endpoint, for example
  `https://<account_id>.r2.cloudflarestorage.com`. Do not set it to the public
  CDN/custom domain; that value belongs in `R2_PUBLIC_URL`.
