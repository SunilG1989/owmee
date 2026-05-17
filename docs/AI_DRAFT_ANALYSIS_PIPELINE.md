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
   normalizes photos for Gemini, creates display/thumb variants, runs vision
   analysis, estimates price, and marks the draft `open`.
7. Mobile polls `GET /v1/listings/draft/{draft_id}/analysis/status` until the
   draft is `ready`, `failed`, or `expired`.

## Scaling Rules

- API work stays small: database row, R2 signed URL, Redis enqueue.
- Worker concurrency is controlled by `AI_DRAFT_ANALYSIS_WORKER_CONCURRENCY`.
- Redis Stream retries are bounded by `AI_DRAFT_ANALYSIS_RETRY_MAX_ATTEMPTS`.
- Oversized uploads are rejected by the worker before downloading the body.
- Final retry exhaustion marks the draft `failed`, so the app does not poll
  forever.

## Operational Notes

- `owmee-api` and `owmee-worker` must both be deployed for the async path.
- Keep `WEB_CONCURRENCY=1` on small Render instances.
- Increase worker count or concurrency only when memory metrics are healthy.
- The legacy multipart endpoint remains for development fallback, but new app
  builds should use direct R2 upload plus async analysis.
