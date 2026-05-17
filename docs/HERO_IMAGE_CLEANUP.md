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
listing flow still works. If Redis is briefly unavailable, the API schedules a
best-effort in-process cleanup task after the listing transaction commits.

## Queue Contract

- Queue key: `owmee:media:hero-cleanup:v1`.
- Enqueue point: `POST /v1/listings/from-draft`, after the listing commit.
- Worker entrypoint: `python -m app.workers.main`.
- When `TEMPORAL_HOST=disabled`, the existing Render worker runs the media queue.
- When Temporal is enabled, the same worker process runs the media queue
  alongside Temporal workflows.
- Jobs are deduped for 24 hours by listing ID and hero key.
- Existing cleaned variants are reused when present to avoid unnecessary provider
  calls.

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
- Redis queue outage, with best-effort post-commit fallback.
- Duplicate cleanup jobs for the same listing hero.
