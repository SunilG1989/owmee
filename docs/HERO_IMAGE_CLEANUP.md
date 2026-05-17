# Hero Image Background Cleanup

Owmee cleans only the final listing hero image, but it no longer does that work
inside the seller's photo-analysis request. Background cleanup is a post-listing
media job so photo analysis stays fast and resilient.

1. Store every seller photo as durable originals and WebP display variants.
2. Run AI product detection across the uploaded photos.
3. Select one hero image.
4. Return the draft immediately with the selected hero first.
5. When the seller publishes the draft, enqueue a Redis media job.
6. The worker cleans only the listing's first hero image.
7. Store the cleaned hero as a new display/thumbnail variant.
8. Atomically replace the first listing image and thumbnail with the cleaned
   version.

The seller preview never waits for background cleanup. If the worker is delayed
or the provider fails, the listing keeps the original processed photo and the
listing flow still works. If Redis is briefly unavailable, the API does not run
cleanup inline; it logs the queue failure and preserves publish performance.

## Queue Contract

- Stream key: `owmee:media:hero-cleanup:stream:v1`.
- Consumer group: `hero-cleanup-workers`.
- Retry set: `owmee:media:hero-cleanup:retry:v1`.
- Dead-letter stream: `owmee:media:hero-cleanup:dead:v1`.
- Enqueue point: `POST /v1/listings/from-draft`, after the listing commit.
- Worker entrypoint: `python -m app.workers.main`.
- When `TEMPORAL_HOST=disabled`, the existing Render worker runs the media queue.
- When Temporal is enabled, the same worker process runs the media queue
  alongside Temporal workflows.
- Jobs are deduped for 24 hours by listing ID and hero key.
- Existing cleaned variants are reused when present to avoid unnecessary provider
  calls.

## Scale And Concurrency

- The API does not run provider-heavy cleanup work. It only writes one Redis
  Stream event with a 0.5 second enqueue timeout, then returns.
- Multiple worker instances can run in parallel. Redis Streams + consumer groups
  distribute jobs across workers without two workers intentionally processing
  the same stream entry.
- Each worker has bounded internal concurrency via
  `HERO_CLEANUP_WORKER_CONCURRENCY` (default `2`) so image editing cannot exhaust
  DB connections, R2 bandwidth, or Gemini quota.
- If a worker crashes after claiming a job, the entry stays pending. Other
  workers reclaim it after `HERO_CLEANUP_PENDING_IDLE_SECONDS` (default `180`).
- Retryable failures use delayed retries in Redis sorted sets. Defaults are
  1 minute, 5 minutes, and 15 minutes, capped by
  `HERO_CLEANUP_RETRY_MAX_ATTEMPTS` (default `4`).
- Permanent failures move to the dead-letter stream for inspection instead of
  blocking the main stream.

## Background Policy

The default background is consistent across listings:

- `owmee_warm_ivory`: warm ivory studio background, matte finish, and natural
  contact shadow. This is the default for almost every product so the catalog
  feels consistent and premium.

Only switch background style when the centered product color would blend into
the default background:

- Light/white/cream/silver product: use `owmee_soft_green_contrast`.

The product is never recolored for contrast. Only the background shade changes.
Brown, tan, caramel, copper, orange, and burnt-orange background tones are not
allowed in the cleanup prompt.

## Product Preservation Rules

The provider prompt explicitly forbids changing product shape, color, material,
texture, labels, logos, scratches, dents, cracks, stickers, accessories,
perspective, or visible defects. Originals always remain stored for buyer trust,
moderation, and dispute review.

## Edge Cases Covered

- Product color close to standard background.
- White/cream products disappearing on ivory.
- Provider failure or missing API key.
- Legacy single-photo clients.
- Multi-photo clients where the AI-selected hero is not the first uploaded
  image.
- Old stored signed URLs expiring in production.
- Redis queue outage without blocking listing publish.
- Duplicate cleanup jobs for the same listing hero.
